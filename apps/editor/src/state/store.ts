// エディタ全体の状態（開いている章・履歴・選択中の項目）を持つ入れ物。React の外に置き、
// 画面の部品は useEditorState で必要な所だけを見る（1 文字打つたびに全部を描き直さないため）。
//
// 章の中身は DocSession（読み込んだ YAML の Document）が持ち、編集はそこへ直接当てる。
// 履歴には書き換えの記録（Entry）を積む。テキストは保存などで必要になったときだけ作る。
import { type Data, DocSession, type Entry, mergeEntries } from '@/model/doc-session.ts';
import {
  canRedo,
  canUndo,
  createHistory,
  type History,
  push,
  redo,
  undo,
} from '@/model/history.ts';
import {
  listParts,
  type PartInfo,
  type Selection,
  selectionExists,
  selectionFromPath,
  selectionLabel,
} from '@/model/paths.ts';
import type { Op, Path } from '@/model/yaml-doc.ts';
import { listCases, readCase, writeCase } from './api.ts';
import { deriveIds, deriveTree } from './derive.ts';

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
  /** 開いた項目の中で、見せたい場所（診断・検索から開いたとき）。line は YAML の直接編集の行 */
  focus: { path: Path; serial: number; line?: number } | null;
  /** 参照先を開く前にいた場所（「元の場所へ戻る」用。新しいものが最後） */
  backStack: { selection: Selection; path: Path | null }[];
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
  select(sel: Selection, focus?: Path, line?: number): void;
  /** 参照先（goto の行き先など）を開く。from は今いる場所（戻るときにそこを見せる） */
  jump(sel: Selection, from?: Path): void;
  /** jump する前の場所へ戻る */
  back(): void;
  open(name: string): Promise<void>;
  save(): Promise<void>;
  create(name: string, text: string): Promise<void>;
  notify(text: string, error?: boolean): void;
}

export type EditorApi = EditorState & EditorActions;

/**
 * 画面の中の、まだ章に反映していない入力（YAML の欄・ID の欄など）。
 * 保存・元に戻すの前に flush で反映する。反映できない（入力が正しくない）ときは、理由を返す
 */
export interface Draft {
  flush(): string | null;
  /** 反映できないときにフォーカスを移す欄 */
  element(): HTMLElement | null;
}

const LAST_FILE_KEY = 'gyakusai:editor:file';
const EMPTY_IDS: Ids = {
  characters: [],
  evidence: [],
  scenes: [],
  places: [],
  flags: [],
};

export class EditorStore {
  private session: DocSession | null = null;
  private history: History<Entry> = createHistory();
  private savedVersion = 0;
  private listeners = new Set<() => void>();
  private started = false;
  private serial = 0;
  private drafts = new Set<Draft>();

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
    selection: { kind: 'meta' },
    focus: null,
    backStack: [],
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
    if (data && !selectionExists(data, selection)) selection = { kind: 'meta' };
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

  /** 未反映の入力を登録する（戻り値で登録を外す） */
  registerDraft(d: Draft): () => void {
    this.drafts.add(d);
    return () => {
      this.drafts.delete(d);
    };
  }

  /**
   * 未反映の入力をすべて反映する。反映できないものがあれば、その欄にフォーカスして理由を知らせ、false を返す
   * （strict でなければ、反映できないものは残したまま true）
   */
  flushDrafts(strict: boolean): boolean {
    for (const d of [...this.drafts]) {
      const error = d.flush();
      if (error && strict) {
        const el = d.element();
        el?.scrollIntoView({ block: 'center' });
        el?.focus();
        this.actions.notify(`確定できない入力があります: ${error}`, true);
        return false;
      }
    }
    return true;
  }

  /** 元に戻した・やり直した所が今の画面と違えば、そこを開いて知らせる */
  private reveal(entry: Entry, verb: string): void {
    const scope = entry.swap ? null : entry.scopes[0];
    const t = scope ? selectionFromPath(scope) : null;
    if (!t || JSON.stringify(t.selection) === JSON.stringify(this.state.selection)) {
      this.actions.notify(verb);
      return;
    }
    this.actions.select(t.selection, t.focus);
    this.actions.notify(`${verb}（${selectionLabel(t.selection)}）`);
  }

  private record(entry: Entry | null, coalesceKey: string | undefined): void {
    if (!entry) return;
    this.history = push(this.history, entry, coalesceKey ?? null, Date.now(), mergeEntries);
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
    getText: () => this.session?.text() ?? '',
    undo: () => {
      this.flushDrafts(false);
      const r = undo(this.history);
      if (!r || !this.session) return;
      this.session.undo(r.entry);
      this.history = r.history;
      this.refresh();
      this.reveal(r.entry, '元に戻しました');
    },
    redo: () => {
      this.flushDrafts(false);
      const r = redo(this.history);
      if (!r || !this.session) return;
      this.session.redo(r.entry);
      this.history = r.history;
      this.refresh();
      this.reveal(r.entry, 'やり直しました');
    },
    select: (selection, focus, line) => {
      this.set({
        selection,
        focus: focus || line ? { path: focus ?? [], serial: ++this.serial, line } : null,
      });
    },
    jump: (selection, from) => {
      const stack = [
        ...this.state.backStack,
        { selection: this.state.selection, path: from ?? null },
      ];
      this.set({ backStack: stack.slice(-30) });
      this.actions.select(selection);
    },
    back: () => {
      const last = this.state.backStack.at(-1);
      if (!last) return;
      this.set({ backStack: this.state.backStack.slice(0, -1) });
      this.actions.select(last.selection, last.path ?? undefined);
    },
    open: async (name) => {
      this.flushDrafts(false);
      try {
        const text = await readCase(name);
        const started = performance.now();
        this.session = new DocSession(text);
        performance.measure('editor:open', { start: started });
        this.history = createHistory();
        this.savedVersion = this.session.id;
        this.refresh({
          file: name,
          size: text.length,
          selection: { kind: 'meta' },
          focus: null,
          backStack: [],
        });
        try {
          localStorage.setItem(LAST_FILE_KEY, name);
        } catch {
          /* 保存できなくてもよい */
        }
      } catch (e) {
        this.actions.notify(`読み込めませんでした: ${(e as Error).message}`, true);
      }
    },
    save: async () => {
      if (!this.flushDrafts(true)) return;
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
        this.actions.notify(`保存できませんでした: ${(e as Error).message}`, true);
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

  clearMessage(m: EditorState['message']): void {
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
      this.actions.notify(`章の一覧を読めませんでした: ${(e as Error).message}`, true);
    }
  }

  /** イベントの中などで使う、今の状態とアクションをまとめたもの（描き直しのきっかけにはならない） */
  api(): EditorApi {
    return { ...this.state, ...this.actions };
  }
}
