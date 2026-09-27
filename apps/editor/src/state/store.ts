// エディタ全体の状態（開いている章・履歴・選択中の項目）を持つ入れ物。React の外に置き、
// 画面の部品は useEditorState で必要な所だけを見る（1 文字打つたびに全部を描き直さないため）。
//
// 章の中身は DocSession（読み込んだ YAML の Document）が持ち、編集はそこへ直接当てる。
// 履歴には書き換えの記録（Entry）を積む。テキストは保存などで必要になったときだけ作る。
import {
	type Data,
	DocSession,
	type Entry,
	mergeEntries,
} from "@/model/doc-session.ts";
import {
	canRedo,
	canUndo,
	createHistory,
	type History,
	push,
	redo,
	undo,
} from "@/model/history.ts";
import {
	listParts,
	type PartInfo,
	recordKeys,
	type Selection,
	selectionExists,
} from "@/model/paths.ts";
import { isTestimony } from "@/model/steps.ts";
import type { Op, Path } from "@/model/yaml-doc.ts";
import { listCases, readCase, writeCase } from "./api.ts";

export type FlagValue = boolean | number | string;

export interface Ids {
	characters: string[];
	evidence: string[];
	scenes: string[];
	places: string[];
	flags: string[];
}

/** 左の一覧に出すもの（シーンの種類・場所の名前つき） */
export interface TreePart extends PartInfo {
	testimony: boolean[];
	placeNames: string[];
}

export interface EditorState {
	files: string[];
	file: string | null;
	data: Data | null;
	parseError: string | null;
	/** 内容の版（編集のたびに変わり、元に戻すと前の値に戻る） */
	version: number;
	dirty: boolean;
	/** 開いたときのテキストの長さ（大きな章では自動のコンパイルなどを止める） */
	size: number;
	canUndo: boolean;
	canRedo: boolean;
	selection: Selection;
	/** 開いた項目の中で、見せたい場所（診断から開いたとき） */
	focus: { path: Path; serial: number } | null;
	message: { text: string; error: boolean } | null;
	/** 名前の一覧（選択肢に使う） */
	ids: Ids;
	flagValues: Record<string, FlagValue>;
	tree: TreePart[];
}

export interface EditorActions {
	edit(ops: Op[], coalesceKey?: string): boolean;
	setText(text: string, coalesceKey?: string): void;
	/** 今の内容のテキスト（書き換えていれば、ここで作る） */
	getText(): string;
	undo(): void;
	redo(): void;
	select(sel: Selection, focus?: Path): void;
	open(name: string): Promise<void>;
	save(): Promise<void>;
	create(name: string, text: string): Promise<void>;
	notify(text: string, error?: boolean): void;
}

export type EditorApi = EditorState & EditorActions;

const LAST_FILE_KEY = "gyakusai:editor:file";
const EMPTY_IDS: Ids = {
	characters: [],
	evidence: [],
	scenes: [],
	places: [],
	flags: [],
};

const sameList = (a: string[], b: string[]) =>
	a.length === b.length && a.every((x, i) => x === b[i]);

/** 中身が同じなら前の配列を使う（選択肢の一覧を持つ部品を描き直さないため） */
function deriveIds(data: Data | null, prev: Ids, parts: PartInfo[]): Ids {
	const next: Ids = {
		characters: recordKeys(data?.characters),
		evidence: recordKeys(data?.evidence),
		scenes: parts.flatMap((p) => p.scenes),
		places: parts.flatMap((p) => p.places),
		flags: recordKeys(data?.flags),
	};
	let changed = false;
	for (const k of Object.keys(next) as (keyof Ids)[]) {
		if (sameList(next[k], prev[k])) next[k] = prev[k];
		else changed = true;
	}
	return changed ? next : prev;
}

function deriveTree(
	data: Data | null,
	prev: TreePart[],
	parts: PartInfo[],
): TreePart[] {
	const rec = (v: unknown) =>
		typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
	const next = parts.map((p) => {
		const base = rec(
			p.index === null ? data?.scenes : rec(rec(data?.parts)[p.index]).scenes,
		);
		const places =
			p.index === null ? {} : rec(rec(rec(data?.parts)[p.index]).places);
		return {
			...p,
			testimony: p.scenes.map((id) => isTestimony(base[id])),
			placeNames: p.places.map((id) => String(rec(places[id]).name ?? "")),
		};
	});
	return JSON.stringify(next) === JSON.stringify(prev) ? prev : next;
}

export class EditorStore {
	private session: DocSession | null = null;
	private history: History<Entry> = createHistory();
	private savedVersion = 0;
	private listeners = new Set<() => void>();
	private started = false;
	/** YAML の直接編集で、まだ反映していない入力を反映する（元に戻す・保存の前に呼ぶ） */
	flushPending: (() => void) | null = null;

	state: EditorState = {
		files: [],
		file: null,
		data: null,
		parseError: null,
		version: 0,
		dirty: false,
		size: 0,
		canUndo: false,
		canRedo: false,
		selection: { kind: "meta" },
		focus: null,
		message: null,
		ids: EMPTY_IDS,
		flagValues: {},
		tree: [],
	};

	subscribe = (fn: () => void) => {
		this.listeners.add(fn);
		return () => {
			this.listeners.delete(fn);
		};
	};

	private set(patch: Partial<EditorState>): void {
		this.state = { ...this.state, ...patch };
		for (const fn of this.listeners) fn();
	}

	/** 内容が変わった後に、それに付いてくる状態をまとめて作り直す */
	private refresh(patch: Partial<EditorState> = {}): void {
		const s = this.session;
		const data = s?.data ?? null;
		const prev = this.state;
		const parts = data === prev.data ? null : listParts(data);
		const derived: Partial<EditorState> =
			parts === null
				? {}
				: {
						ids: deriveIds(data, prev.ids, parts),
						tree: deriveTree(data, prev.tree, parts),
						flagValues: (data?.flags ?? {}) as Record<string, FlagValue>,
					};
		let selection = patch.selection ?? prev.selection;
		// 消した・名前を変えた項目を選んだままにしない
		if (data && !selectionExists(data, selection)) selection = { kind: "meta" };
		const version = s?.id ?? 0;
		this.set({
			...derived,
			...patch,
			selection,
			data,
			parseError: s?.error ?? null,
			version,
			dirty: s !== null && version !== this.savedVersion,
			canUndo: canUndo(this.history),
			canRedo: canRedo(this.history),
		});
	}

	private record(entry: Entry | null, coalesceKey: string | undefined): void {
		if (!entry) return;
		this.history = push(
			this.history,
			entry,
			coalesceKey ?? null,
			Date.now(),
			mergeEntries,
		);
		this.refresh();
	}

	// アクションは分割代入して使えるよう、すべてアロー関数にする
	readonly actions: EditorActions = {
		edit: (ops, coalesceKey) => {
			if (ops.length === 0 || !this.session) return false;
			try {
				this.record(this.session.edit(ops), coalesceKey);
				return true;
			} catch (e) {
				this.actions.notify((e as Error).message, true);
				return false;
			}
		},
		setText: (text, coalesceKey) => {
			if (!this.session) return;
			this.record(this.session.replaceText(text), coalesceKey);
		},
		getText: () => this.session?.text() ?? "",
		undo: () => {
			this.flushPending?.();
			const r = undo(this.history);
			if (!r || !this.session) return;
			this.session.undo(r.entry);
			this.history = r.history;
			this.refresh();
		},
		redo: () => {
			this.flushPending?.();
			const r = redo(this.history);
			if (!r || !this.session) return;
			this.session.redo(r.entry);
			this.history = r.history;
			this.refresh();
		},
		select: (selection, focus) => {
			this.set({
				selection,
				focus: focus ? { path: focus, serial: Date.now() } : null,
			});
		},
		open: async (name) => {
			try {
				const text = await readCase(name);
				const started = performance.now();
				this.session = new DocSession(text);
				performance.measure("editor:open", { start: started });
				this.history = createHistory();
				this.savedVersion = this.session.id;
				this.refresh({
					file: name,
					size: text.length,
					selection: { kind: "meta" },
					focus: null,
				});
				try {
					localStorage.setItem(LAST_FILE_KEY, name);
				} catch {
					/* 保存できなくてもよい */
				}
			} catch (e) {
				this.actions.notify(
					`読み込めませんでした: ${(e as Error).message}`,
					true,
				);
			}
		},
		save: async () => {
			this.flushPending?.();
			const { file } = this.state;
			const s = this.session;
			if (!file || !s) return;
			const version = s.id;
			try {
				const text = s.text();
				await writeCase(file, text);
				if (this.session !== s) return;
				this.savedVersion = version;
				// 保存したテキストを、以後の書き出しの基準にする（保存中にさらに編集していなければ）
				if (s.id === version) s.markSaved(text);
				this.refresh();
				this.actions.notify(`${file} を保存しました`);
			} catch (e) {
				this.actions.notify(
					`保存できませんでした: ${(e as Error).message}`,
					true,
				);
			}
		},
		create: async (name, text) => {
			try {
				await writeCase(name, text);
				this.set({ files: await listCases() });
				await this.actions.open(name);
			} catch (e) {
				this.actions.notify(`作れませんでした: ${(e as Error).message}`, true);
			}
		},
		notify: (text, error = false) => this.set({ message: { text, error } }),
	};

	/** 今の内容のテキストが、書き出しなしですぐに得られるか */
	textReady(): boolean {
		return this.session?.textReady() ?? false;
	}

	clearMessage(m: EditorState["message"]): void {
		if (this.state.message === m) this.set({ message: null });
	}

	/** 起動時: 一覧を読み、前回の章（なければ最初の章）を開く */
	async start(): Promise<void> {
		// 開発時の StrictMode では effect が 2 回走るが、大きな章を 2 回読まないようにする
		if (this.started) return;
		this.started = true;
		try {
			const list = await listCases();
			this.set({ files: list });
			let last: string | null = null;
			try {
				last = localStorage.getItem(LAST_FILE_KEY);
			} catch {
				/* なくてもよい */
			}
			const first = last && list.includes(last) ? last : list[0];
			if (first) await this.actions.open(first);
		} catch (e) {
			this.actions.notify(
				`章の一覧を読めませんでした: ${(e as Error).message}`,
				true,
			);
		}
	}

	/** イベントの中などで使う、今の状態とアクションをまとめたもの（描き直しのきっかけにはならない） */
	api(): EditorApi {
		return { ...this.state, ...this.actions };
	}
}
