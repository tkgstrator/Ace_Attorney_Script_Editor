// ROM から取り出した DS 版の絵（assets/extracted/、手元用・配布しない）で表示する。位置合わせの確認用。
// 取り出していなければ使えない（isOfficialAvailable が false）。
//
// 背景は DS 版の画面と点の単位で一致したものを立ち位置に当てる（検察側は弁護側の左右反転）。
// 人物は anim.tsv の原点（キャラクターの基準点）を画面の中央 (128, 96) に合わせると DS 版と一致する。
// そのため、各コマを 256×192 の画面の大きさのキャンバスに置き直して返す（Player は下端・中央に合わせて描く）。
import type { Assets, ShoutKind } from "@gyakusai/runtime";

const ROOT = "../../../assets/extracted/data/tail";
const bgUrls = import.meta.glob(
	"../../../assets/extracted/data/tail/bg/bg00[3458]_*.png",
	{ eager: true, query: "?url", import: "default" },
) as Record<string, string>;
// 法廷の 4 立ち位置以外の背景（面会室・事務所など）。DS 版の背景の番号（bgKey が作る「bgNN」）で引く
const anyBgUrls = import.meta.glob(
	"../../../assets/extracted/data/tail/{bg,bg_fixed}/*.png",
	{ eager: true, query: "?url", import: "default" },
) as Record<string, string>;
const bgTableGlob = import.meta.glob(
	"../../../assets/extracted/tables/bg_render.json",
	{ import: "default" },
);
const frameUrls = import.meta.glob(
	"../../../assets/extracted/data/tail/chars/2202220/{000,018,019,053,157,159,163}/f*.png",
	{ eager: true, query: "?url", import: "default" },
) as Record<string, string>;
const deskUrls = import.meta.glob(
	"../../../assets/extracted/data/desks/*.png",
	{ eager: true, query: "?url", import: "default" },
) as Record<string, string>;
const animTsv = import.meta.glob(
	"../../../assets/extracted/data/tail/chars/2202220/{000,018,019,053}/anim.tsv",
	{ eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

/** 立ち位置 → 背景の番号（検察側の bg004 は弁護側の bg003 の左右反転。裁判長の机は背景に描かれている） */
const BACKGROUNDS: Record<string, string> = {
	defense: "bg003",
	prosecution: "bg004",
	witness: "bg005",
	judge: "bg008",
};
/** サンプルの人物 → DS 版のアニメーション番号（成歩堂・御剣・ヤマノ・裁判長の通常の姿） */
const CHARACTERS: Record<string, string> = {
	naruse: "000",
	himuro: "019",
	torii: "053",
	judge: "018",
};

/** 吹き出し → DS 版のアニメーション番号（画面全体の 1 コマ。日本語版の文字） */
const SHOUTS: Record<ShoutKind, string> = {
	objection: "157",
	hold: "159",
	takethat: "163",
};

const SCREEN = { w: 256, h: 192, cx: 128, cy: 96 };

export const isOfficialAvailable = () =>
	Object.keys(bgUrls).length > 0 && Object.keys(animTsv).length > 0;

interface Anim {
	frames: HTMLCanvasElement[];
	seq: { frame: number; ticks: number }[];
	total: number;
}

function load(url: string): Promise<HTMLImageElement> {
	return new Promise((ok, ng) => {
		const img = new Image();
		img.onload = () => ok(img);
		img.onerror = () => ng(new Error(`画像を読み込めません: ${url}`));
		img.src = url;
	});
}

function canvas(w: number, h: number) {
	const c = document.createElement("canvas");
	c.width = w;
	c.height = h;
	return c;
}

/** anim.tsv（「# 原点…: 画像の (x, y)」、見出し、「コマ<TAB>長さ」の行）を読む */
function parseTsv(text: string) {
	const [, ox, oy] = text.match(/\((-?\d+), (-?\d+)\)/)!.map(Number) as [
		number,
		number,
		number,
	];
	const seq = text
		.split("\n")
		.slice(2)
		.filter((l) => l.includes("\t"))
		.map((l) => {
			const [name, ticks] = l.split("\t") as [string, string];
			return { name, ticks: Number(ticks) };
		});
	return { ox, oy, seq };
}

async function loadAnim(id: string): Promise<Anim | undefined> {
	const dir = `${ROOT}/chars/2202220/${id}/`;
	const tsv = animTsv[`${dir}anim.tsv`];
	if (!tsv) return undefined;
	const { ox, oy, seq } = parseTsv(tsv);
	const names = [...new Set(seq.map((s) => s.name))].filter(
		(n) => frameUrls[dir + n],
	);
	const frames = await Promise.all(
		names.map(async (n) => {
			const img = await load(frameUrls[dir + n]!);
			const c = canvas(SCREEN.w, SCREEN.h);
			c.getContext("2d")!.drawImage(img, SCREEN.cx - ox, SCREEN.cy - oy);
			return c;
		}),
	);
	// 長さ 0xFF（255）は「そのコマで止まる」の意味なので、ほどほどの長さにして繰り返す
	const s = seq
		.filter((x) => names.includes(x.name))
		.map((x) => ({
			frame: names.indexOf(x.name),
			ticks: x.ticks >= 255 ? 120 : x.ticks,
		}));
	return { frames, seq: s, total: s.reduce((a, x) => a + x.ticks, 0) };
}

/** 今の時刻で見せるコマ（1/60 秒単位で繰り返す） */
function frameAt(anim: Anim): HTMLCanvasElement {
	let t = Math.floor(performance.now() / (1000 / 60)) % Math.max(1, anim.total);
	for (const s of anim.seq) {
		if (t < s.ticks) return anim.frames[s.frame]!;
		t -= s.ticks;
	}
	return anim.frames[0]!;
}

interface BgRow {
	id: number;
	png: string | null;
	png_fixed?: string;
}
let bgTable: Promise<Map<number, string>> | null = null;

/** tables/bg_render.json から「背景の番号 → 画像 URL」を作る（面会室など、立ち位置に無い背景用） */
function loadBgTable(): Promise<Map<number, string>> {
	return (bgTable ??= (async () => {
		const get = Object.values(bgTableGlob)[0];
		const rows = get
			? ((await get()) as { backgrounds: BgRow[] }).backgrounds
			: [];
		const map = new Map<number, string>();
		for (const r of rows) {
			const rel = r.png_fixed ?? r.png;
			const url = rel
				? Object.entries(anyBgUrls).find(([p]) => p.endsWith(rel))?.[1]
				: undefined;
			if (url) map.set(r.id, url);
		}
		return map;
	})());
}

const numberedBg = new Map<string, HTMLImageElement | null>();
/** 'bgNN'（bgKey が番号だけの背景に作るキー）を遅延読み込みで解決する。読み込み中は undefined を返し、次の描画で拾う */
function numberedBackground(key: string): HTMLImageElement | undefined {
	const m = /^bg(\d+)$/.exec(key);
	if (!m) return undefined;
	if (numberedBg.has(key)) return numberedBg.get(key) ?? undefined;
	numberedBg.set(key, null);
	void (async () => {
		const url = (await loadBgTable()).get(Number(m[1]));
		if (url) numberedBg.set(key, await load(url));
	})();
	return undefined;
}

export async function loadOfficialAssets(fallback: Assets): Promise<Assets> {
	const backgrounds = new Map<string, CanvasImageSource>();
	await Promise.all(
		Object.entries(BACKGROUNDS).map(async ([stand, num]) => {
			const url = Object.entries(bgUrls).find(([p]) =>
				p.includes(`/${num}_`),
			)?.[1];
			if (url) backgrounds.set(stand, await load(url));
		}),
	);
	// 机（256×192 の画面上の位置に置いた透明 PNG。tools/rom/ex_desks.py が作る）
	const desks = new Map<string, HTMLImageElement>();
	await Promise.all(
		Object.entries(deskUrls).map(async ([path, url]) => {
			desks.set(
				path.replace(/^.*\//, "").replace(/\.png$/, ""),
				await load(url),
			);
		}),
	);
	const anims = new Map<string, Anim>();
	await Promise.all(
		Object.entries(CHARACTERS).map(async ([who, id]) => {
			const a = await loadAnim(id);
			if (a) anims.set(who, a);
		}),
	);
	const shouts = new Map<string, HTMLImageElement>();
	await Promise.all(
		Object.entries(SHOUTS).map(async ([kind, id]) => {
			const url = frameUrls[`${ROOT}/chars/2202220/${id}/f00.png`];
			if (url) shouts.set(kind, await load(url));
		}),
	);
	return {
		...fallback,
		shout: (kind) => shouts.get(kind) ?? fallback.shout?.(kind),
		background: (key) =>
			backgrounds.get(key) ??
			numberedBackground(key) ??
			fallback.background?.(key),
		foreground: (key) => desks.get(key),
		portrait: (id, frame) => {
			const a = anims.get(id);
			return a ? frameAt(a) : fallback.portrait?.(id, frame);
		},
	};
}
