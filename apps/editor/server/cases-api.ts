// 開発サーバーに、章（YAML ファイル）を読み書きする API を足す Vite プラグイン。
//   GET /api/cases              → ["sample/clocktower.yaml", "official/ep1.yaml", ...]
//   GET /api/cases/:root/:name  → ファイルの中身（text/plain）
//   PUT /api/cases/:root/:name  → 本文でファイルを上書き（なければ作る）
// root は置き場所の名前（sample: サンプルのシナリオ、official: 元の台本から変換した章など）。
// 扱うのは、各置き場所の直下にある「英数字・_・-・. だけの名前で .yaml で終わる」ファイルだけ。
import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, dirname, join, resolve } from "node:path";
import type { Plugin } from "vite";

const NAME = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*\.yaml$/;
/** 変換した公式の章は数 MB になるので、余裕を持たせる */
const MAX_BYTES = 32 * 1024 * 1024;

/** ディレクトリの外を指さない、正しいファイル名なら絶対パスを返す */
export function resolveCaseFile(dir: string, name: string): string | null {
	if (!NAME.test(name) || name.includes("..")) return null;
	const root = resolve(dir);
	const file = resolve(root, name);
	if (dirname(file) !== root || basename(file) !== name) return null;
	return file;
}

function send(
	res: ServerResponse,
	status: number,
	body: string,
	type = "text/plain; charset=utf-8",
) {
	res.statusCode = status;
	res.setHeader("Content-Type", type);
	res.setHeader("Cache-Control", "no-store");
	res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((ok, ng) => {
		const chunks: Buffer[] = [];
		let size = 0;
		req.on("data", (c: Buffer) => {
			size += c.length;
			if (size > MAX_BYTES) {
				ng(new Error("大きすぎます"));
				req.destroy();
				return;
			}
			chunks.push(c);
		});
		req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
		req.on("error", ng);
	});
}

/** 「置き場所/ファイル名」を、置き場所の外を指さない絶対パスにする */
export function resolveEntry(
	roots: Record<string, string>,
	name: string,
): string | null {
	const [root, file, ...rest] = name.split("/");
	if (!root || !file || rest.length > 0 || !Object.hasOwn(roots, root))
		return null;
	return resolveCaseFile(roots[root]!, file);
}

export function casesApi(roots: Record<string, string>): Plugin {
	return {
		name: "gyakusai-cases-api",
		configureServer(server) {
			server.middlewares.use("/api/cases", (req, res) => {
				void handle(roots, req, res).catch((e) =>
					send(res, 500, `エラー: ${(e as Error).message}`),
				);
			});
		},
	};
}

async function handle(
	roots: Record<string, string>,
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	// connect がマウント先（/api/cases）を取り除いた残りが req.url に入る
	const url = new URL(req.url ?? "/", "http://localhost");
	const name = decodeURIComponent(url.pathname.replace(/^\/+/, ""));

	if (name === "") {
		if (req.method !== "GET") return send(res, 405, "使えないメソッドです");
		const files: string[] = [];
		for (const [root, dir] of Object.entries(roots)) {
			const list = await readdir(dir).catch(() => [] as string[]); // 置き場所が無ければ（公式の章を変換していなければ）飛ばす
			files.push(
				...list
					.filter((f) => NAME.test(f))
					.sort()
					.map((f) => `${root}/${f}`),
			);
		}
		return send(
			res,
			200,
			JSON.stringify(files),
			"application/json; charset=utf-8",
		);
	}

	const file = resolveEntry(roots, name);
	if (!file) return send(res, 400, `ファイル名が正しくありません: ${name}`);

	if (req.method === "GET") {
		try {
			return send(
				res,
				200,
				await readFile(file, "utf8"),
				"text/yaml; charset=utf-8",
			);
		} catch {
			return send(res, 404, `ありません: ${name}`);
		}
	}
	if (req.method === "PUT") {
		const body = await readBody(req);
		// 書きかけのファイルが残らないよう、一時ファイルに書いてから置き換える
		const tmp = join(dirname(file), `.${basename(file)}.${process.pid}.tmp`);
		await writeFile(tmp, body, "utf8");
		await rename(tmp, file);
		return send(res, 200, "ok");
	}
	return send(res, 405, "使えないメソッドです");
}
