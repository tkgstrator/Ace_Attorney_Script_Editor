// 画面全体の配置: 左に一覧、真ん中に編集、右にプレビュー（たためる）。上にツールバー

import type { CompileResult } from "@gyakusai/script";
import {
	PanelRightClose,
	PanelRightOpen,
	Redo2,
	Save,
	Undo2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DialogHost } from "@/components/dialogs.tsx";
import { MainPane } from "@/components/MainPane.tsx";
import { type PlayRequest, Preview } from "@/components/preview/Preview.tsx";
import {
	type IssueCounts,
	Sidebar,
	selectionKey,
} from "@/components/sidebar/Sidebar.tsx";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { casePath } from "@/model/case-roots.ts";
import { selectionFromPath } from "@/model/paths.ts";
import { Compiler } from "@/preview/compiler.ts";
import { useEditorState, useEditorStore } from "@/state/editor-store.tsx";

const isMac = navigator.platform.toLowerCase().includes("mac");
const MOD = isMac ? "⌘" : "Ctrl+";

/** これより小さい章は、編集のたびに（少し待って）自動でコンパイルし直す。大きな章は「再読み込み」を押したときだけ */
export const AUTO_COMPILE_LIMIT = 400_000;
const AUTO_COMPILE_DELAY = 300;

interface Compiled {
	version: number;
	text: string;
	result: CompileResult;
}

export function App() {
	const store = useEditorStore();
	const file = useEditorState((s) => s.file);
	const dirty = useEditorState((s) => s.dirty);
	const message = useEditorState((s) => s.message);
	const version = useEditorState((s) => s.version);
	const size = useEditorState((s) => s.size);
	const canUndo = useEditorState((s) => s.canUndo);
	const canRedo = useEditorState((s) => s.canRedo);
	const api = store.actions;
	const [showPreview, setShowPreview] = useState(true);
	const [play, setPlay] = useState<PlayRequest>({ scene: null, serial: 0 });
	const [compiled, setCompiled] = useState<Compiled | null>(null);
	const [compiling, setCompiling] = useState(0);
	const compiler = useRef<Compiler | null>(null);
	const latest = useRef(compiled);
	latest.current = compiled;
	/** コンパイル中のもの（同じ版を二重に頼まない） */
	const inflight = useRef<{
		file: string;
		version: number;
		promise: Promise<Compiled | null>;
	} | null>(null);
	useEffect(() => () => compiler.current?.dispose(), []);

	/** 今の内容をコンパイルする（前にコンパイルした内容と同じなら、それを使う） */
	const recompile = useCallback((): Promise<Compiled | null> => {
		const { version: v, file: f } = store.state;
		if (!f) return Promise.resolve(null);
		if (latest.current?.version === v) return Promise.resolve(latest.current);
		if (inflight.current?.file === f && inflight.current.version === v)
			return inflight.current.promise;
		const promise = (async () => {
			setCompiling((n) => n + 1);
			try {
				const started = performance.now();
				const text = store.actions.getText();
				performance.measure("editor:stringify", { start: started });
				compiler.current ??= new Compiler();
				const result = await compiler.current.compile(text);
				const c = { version: v, text, result };
				// 待っている間に別の章を開いていたら捨てる。Worker は頼んだ順に返すので、同じ章なら最後に届いたものがいちばん新しい
				if (store.state.file !== f) return null;
				latest.current = c;
				setCompiled(c);
				return c;
			} catch (e) {
				api.notify(`コンパイルできませんでした: ${(e as Error).message}`, true);
				return null;
			} finally {
				setCompiling((n) => n - 1);
				if (inflight.current?.file === f && inflight.current.version === v)
					inflight.current = null;
			}
		})();
		inflight.current = { file: f, version: v, promise };
		return promise;
	}, [store, api]);

	// 小さな章は編集のたびに自動で。大きな章でも、テキストを作り直さずに済むとき（開いた直後・保存の後・元に戻して
	// 前と同じ内容になったとき）は自動で。compiled も見るのは、コンパイル中に内容が変わった場合にやり直すため
	useEffect(() => {
		if (!file) return;
		const small = size <= AUTO_COMPILE_LIMIT;
		if (!small && !store.textReady()) return;
		const t = setTimeout(
			() => void recompile(),
			small ? AUTO_COMPILE_DELAY : 0,
		);
		return () => clearTimeout(t);
	}, [file, version, size, dirty, compiled, store, recompile]);

	// 別の章を開いたら、前の章の結果は捨てる
	useEffect(() => {
		setCompiled(null);
		latest.current = null;
	}, [file]);

	const result = compiled?.result ?? null;
	const stale = compiled !== null && compiled.version !== version;
	const issues = useMemo<IssueCounts>(() => {
		const m: IssueCounts = new Map();
		for (const d of result?.diagnostics ?? []) {
			const t = selectionFromPath(d.path);
			if (!t) continue;
			const k = selectionKey(t.selection);
			const c = m.get(k) ?? { errors: 0, warnings: 0 };
			if (d.severity === "error") c.errors++;
			else c.warnings++;
			m.set(k, c);
		}
		return m;
	}, [result]);

	const reload = useCallback(
		async () => (await recompile())?.result ?? null,
		[recompile],
	);
	const onPlay = useCallback(
		(scene: string) => {
			setShowPreview(true);
			void recompile().then(() =>
				setPlay((p) => ({ scene, serial: p.serial + 1 })),
			);
		},
		[recompile],
	);

	// キー操作: 保存・元に戻す・やり直す。入力欄の外で押したキーはプレビューに渡さない
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const mod = e.metaKey || e.ctrlKey;
			const k = e.key.toLowerCase();
			if (mod && k === "s") {
				e.preventDefault();
				void api.save();
				return;
			}
			if (mod && k === "z" && !e.shiftKey) {
				e.preventDefault();
				api.undo();
				return;
			}
			if (mod && ((k === "z" && e.shiftKey) || k === "y")) {
				e.preventDefault();
				api.redo();
				return;
			}
			if (e.target === document.body) e.stopPropagation();
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [api]);

	// 保存していない変更があるときは、閉じる前に確認する
	useEffect(() => {
		const onUnload = (e: BeforeUnloadEvent) => {
			if (dirty) e.preventDefault();
		};
		window.addEventListener("beforeunload", onUnload);
		return () => window.removeEventListener("beforeunload", onUnload);
	}, [dirty]);

	useEffect(() => {
		document.title = `${dirty ? "● " : ""}${file ?? ""} | 逆裁エディタ`;
	}, [file, dirty]);

	return (
		<div className="flex h-full flex-col">
			<header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
				<span className="font-semibold">逆裁エディタ</span>
				<span className="font-mono text-xs text-muted-foreground">
					{file ? casePath(file) : ""}
				</span>
				{dirty && <span className="text-xs text-amber-600">● 未保存</span>}
				<div className="ml-auto flex items-center gap-1">
					<Button
						variant="ghost"
						size="sm"
						className="h-8"
						disabled={!canUndo}
						onClick={api.undo}
						title={`元に戻す（${MOD}Z）`}
					>
						<Undo2 />
					</Button>
					<Button
						variant="ghost"
						size="sm"
						className="h-8"
						disabled={!canRedo}
						onClick={api.redo}
						title={`やり直す（${MOD}Shift+Z）`}
					>
						<Redo2 />
					</Button>
					<Button
						size="sm"
						className="h-8"
						disabled={!dirty}
						onClick={() => void api.save()}
						title={`保存（${MOD}S）`}
					>
						<Save /> 保存
					</Button>
					<Button
						variant="ghost"
						size="sm"
						className="h-8"
						onClick={() => setShowPreview(!showPreview)}
						title="プレビューの表示・非表示"
					>
						{showPreview ? <PanelRightClose /> : <PanelRightOpen />}
					</Button>
				</div>
			</header>
			<div className="flex min-h-0 flex-1">
				<Sidebar issues={issues} />
				<MainPane onPlay={onPlay} />
				<aside
					className={cn(
						"w-[440px] shrink-0 border-l bg-muted/20",
						!showPreview && "hidden",
					)}
				>
					<Preview
						result={result}
						source={result?.scenario ? compiled!.text : null}
						play={play}
						stale={stale}
						compiling={compiling > 0}
						onReload={reload}
						large={size > AUTO_COMPILE_LIMIT}
					/>
				</aside>
			</div>
			{message && (
				<div
					className={cn(
						"fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md px-4 py-2 text-sm text-white shadow-lg",
						message.error ? "bg-destructive" : "bg-zinc-800",
					)}
				>
					{message.text}
				</div>
			)}
			<DialogHost />
		</div>
	);
}
