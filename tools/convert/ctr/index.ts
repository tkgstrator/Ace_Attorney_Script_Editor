// 3DS 版（逆転裁判6）の台本を、シナリオ YAML（1 つの章）に変換する。
// 会話・選択肢・ラベル間の移動・フラグ・尋問（証言シーン）・法廷記録の増減まで。探偵パートの場所（調べる・移動する）は
// まだで、対応していない命令は native で残す。命令の意味は docs/3ds.md の「台本の命令」。
//
// 先に aa-ctr で台本を文章にしておく（assets/extracted-rs/aa6/script/、配布しない）:
//   target/release/aa-ctr assets/roms/0004000000166A00_v00.trim.3ds --keys assets/roms/aes_keys.txt --out assets/extracted-rs/aa6
// 変換:
//   bun tools/convert/ctr/index.ts --episode 1 [--title 題] [--out ファイル] [--stats]   # → assets/extracted/aa6/converted/ep1.yaml
//
// 話 N の台本は romfs/script/_output/_sce{N-1}_c*_jpn（ファイル名の順に続く）。
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { toYaml } from '../index.ts';
import { charId, type NameEntry, type Step } from './convert.ts';
import { convertFile, type Shared } from './file.ts';
import { labelMap, readGmdText } from './gmd.ts';
import { loadGains, loadRecord } from './record.ts';

const ROOT = join(import.meta.dir, '../../..');
const SCRIPT = join(ROOT, 'assets/extracted-rs/aa6/script');

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
}

function main() {
  const args = process.argv.slice(2);
  const ep = Number(arg(args, '--episode'));
  if (!Number.isInteger(ep) || ep < 1) {
    console.error(
      '使い方: bun tools/convert/ctr/index.ts --episode <話> [--title 題] [--out ファイル] [--stats]',
    );
    process.exit(2);
  }
  const sce = `sce${String(ep - 1).padStart(2, '0')}`;
  const dir = join(SCRIPT, 'romfs/script/_output');
  const files = readdirSync(dir)
    .filter((f) => f.startsWith(`_${sce}_c`) && f.endsWith('_jpn.txt'))
    .sort();
  if (files.length === 0) {
    console.error(`${dir} に _${sce}_c*_jpn.txt がありません（先に aa-ctr で台本を書き出す）`);
    process.exit(1);
  }

  const cmn = join(SCRIPT, 'arc/archive/msg_cmn_jpn/msg');
  const names: NameEntry[] = readGmdText(join(cmn, 'name_jpn.txt')).map((e) => ({
    label: e.label ?? '',
    name: e.text,
  }));
  const common = readGmdText(join(cmn, 'choice_common_jpn.txt'));
  const own = labelMap(readGmdText(join(SCRIPT, `romfs/msg/choice_${sce}_jpn.txt`)));
  // 12 未満は共通の選択肢（もう一度聞く・はい・いいえ など）、12 以上はその話の CHOICE{話}_{番号 - 12}
  const choiceText = (id: number) =>
    (id < 12 ? common[id]?.text : own.get(`CHOICE${ep - 1}_${String(id - 12).padStart(2, '0')}`)) ??
    `（選択肢 ${id}）`;
  const record = loadRecord(cmn);

  const short = files.map((f) => f.replace(`_${sce}_`, '').replace('_jpn.txt', ''));
  const shared: Shared = {
    names,
    choiceText,
    recordId: (kind, idx) =>
      (kind === 0 ? record.evidenceIds[idx] : record.profileIds[idx]) ?? null,
    gains: loadGains(join(dir, `_${sce}_preset_jpn.txt`), record),
    flags: new Set(),
    usedNames: new Set(),
    stats: new Map(),
  };
  const scenes: Record<string, unknown> = {};
  let gameover: string | null = null;
  files.forEach((f, i) => {
    const r = convertFile(readGmdText(join(dir, f)), short[i]!, short[i + 1] ?? null, shared);
    for (const [id, s] of r.scenes) scenes[id] = s;
    gameover ??= r.gameover;
  });

  // 法廷記録で使う証拠品・人物だけを載せる
  const text = JSON.stringify(scenes);
  const evidence = Object.fromEntries(
    Object.entries(record.evidence).filter(([id]) => text.includes(`"${id}"`)),
  );
  const profiles = Object.entries(record.profiles).filter(([id]) => text.includes(`"${id}"`));
  const characters: Record<string, Record<string, unknown>> = {};
  for (const n of [...shared.usedNames].sort((a, b) => a - b))
    characters[charId(names[n]!)] ??= { name: names[n]!.name };
  for (const [id, p] of profiles)
    characters[id] = { ...(characters[id] ?? { name: p.name }), profile: p };

  const id = `ep${ep}`;
  const titles = labelMap(readGmdText(join(cmn, 'title_jpn.txt')));
  const scenario = {
    id,
    title: arg(args, '--title') ?? titles.get(`SCE_TITLE0${ep - 1}`) ?? `第${ep}話`,
    player: charId(names[0]!),
    life: 100,
    defaults: { penalty: 20, autoShow: false, autoPause: false },
    characters,
    evidence,
    flags: Object.fromEntries([...shared.flags].sort().map((f) => [f, false])),
    start: { scene: short[0], evidence: [], profiles: [] },
    ...(gameover ? { gameover } : {}),
    scenes,
  };
  const out = arg(args, '--out') ?? join(ROOT, 'assets/extracted/aa6/converted', `${id}.yaml`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, toYaml(scenario));
  const natives = [...shared.stats].sort((a, b) => b[1] - a[1]);
  const total = natives.reduce((a, [, n]) => a + n, 0);
  console.log(
    `${out}: ファイル ${files.length}、シーン ${Object.keys(scenes).length}、人物 ${Object.keys(characters).length}、` +
      `証拠品 ${Object.keys(evidence).length}、フラグ ${shared.flags.size}、native ${total}`,
  );
  if (args.includes('--stats')) for (const [k, n] of natives) console.log(`${n}\t${k}`);
}

if (import.meta.main) main();
