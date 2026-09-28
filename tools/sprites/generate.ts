// Codex CLI の組み込み画像生成で、ドット絵の元画像を作る。
//   bun tools/sprites/generate.ts                 # まだ無いものをすべて（種類ごとに並列）
//   bun tools/sprites/generate.ts evidence        # 種類を指定
//   bun tools/sprites/generate.ts --dry-run       # 実行せずに指示文だけ表示
// 画像生成は Codex の利用枠を消費する（通常のやり取りより 3〜5 倍速く減る）。
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ITEMS, KIND_RULES, STYLE, rawPath, type Item, type Kind } from './manifest.ts';

const ROOT = resolve(import.meta.dir, '../..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const kinds = args.filter((a) => !a.startsWith('--')) as Kind[];

/** 人物は、基本の絵に加えて口を開けた絵（口パク用）も作る */
const TALK_SUFFIX = '-talk';

function missing(item: Item): { base: boolean; talk: boolean } {
  const base = !existsSync(resolve(ROOT, rawPath(item)));
  const talk = item.kind === 'character' && !existsSync(resolve(ROOT, rawPath(item, TALK_SUFFIX)));
  return { base, talk };
}

function promptFor(kind: Kind, items: Item[]): string {
  const lines = [
    `Use your built-in image generation tool (the imagegen skill, built-in image_gen; NOT the CLI fallback) to create the images listed below.`,
    `Make one separate image_gen call per image. After each call, copy the generated PNG to the given path inside this workspace (create folders as needed).`,
    `Check with ImageMagick (magick identify -format '%[channels]') that transparent images really have an alpha channel; if not, regenerate once.`,
    `Do not create or modify any other files. At the end, list each output path.`,
    '',
    STYLE,
    KIND_RULES[kind],
    '',
  ];
  for (const item of items) {
    const m = missing(item);
    const refs = (item.refs ?? []).filter((r) => existsSync(resolve(ROOT, r)));
    const refNote = refs.length
      ? ` Reference image(s) for camera angle, scale and style (attached): ${refs.join(', ')}.`
      : '';
    if (m.base) lines.push(`- ${rawPath(item)}: ${item.subject}.${refNote}`);
    if (m.talk) {
      lines.push(
        `- ${rawPath(item, TALK_SUFFIX)}: an EDIT of the image at ${rawPath(item)} (generate that one first and load it with view_image if needed).` +
          ' Change ONLY the mouth so it is open as if talking; keep the pose, face, colors, size, position and transparent background exactly the same.',
      );
    }
  }
  return lines.join('\n');
}

async function run(kind: Kind, items: Item[]): Promise<number> {
  const prompt = promptFor(kind, items);
  if (dryRun) {
    console.log(`\n==== ${kind} ====\n${prompt}`);
    return 0;
  }
  for (const item of items) mkdirSync(resolve(ROOT, dirname(rawPath(item))), { recursive: true });
  const log = resolve(ROOT, `assets/generated/logs/${kind}.log`);
  mkdirSync(dirname(log), { recursive: true });
  console.log(`[${kind}] 生成を開始（${items.length} 件）。ログ: ${log}`);
  // 参考画像は -i で添付する（存在するものだけ）
  const refs = [...new Set(items.flatMap((i) => i.refs ?? []))].filter((r) =>
    existsSync(resolve(ROOT, r)),
  );
  const attach = refs.flatMap((r) => ['-i', resolve(ROOT, r)]);
  const proc = Bun.spawn(
    [
      'codex',
      'exec',
      '--skip-git-repo-check',
      '-s',
      'workspace-write',
      '-C',
      ROOT,
      ...attach,
      '--',
      prompt,
    ],
    {
      stdout: Bun.file(log),
      stderr: Bun.file(log.replace(/\.log$/, '.err.log')),
      stdin: 'ignore',
    },
  );
  const code = await proc.exited;
  const left = items
    .filter((i) => {
      const m = missing(i);
      return m.base || m.talk;
    })
    .map((i) => i.id);
  console.log(
    `[${kind}] 終了（コード ${code}）${left.length ? `。まだ無いもの: ${left.join(', ')}` : '。すべてそろいました'}`,
  );
  return code;
}

const groups = new Map<Kind, Item[]>();
for (const item of ITEMS) {
  if (kinds.length && !kinds.includes(item.kind)) continue;
  const m = missing(item);
  if (!m.base && !m.talk) continue;
  groups.set(item.kind, [...(groups.get(item.kind) ?? []), item]);
}
if (groups.size === 0) {
  console.log('生成が必要な画像はありません。');
} else {
  const codes = await Promise.all([...groups].map(([kind, items]) => run(kind, items)));
  process.exit(codes.some((c) => c !== 0) ? 1 : 0);
}
