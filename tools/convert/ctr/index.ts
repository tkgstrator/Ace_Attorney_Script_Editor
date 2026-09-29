// 3DS 版（逆転裁判6）の台本を、シナリオ YAML（1 つの章）に変換する。命令の意味は docs/3ds.md の「台本の命令」。
// 会話・選択肢・ラベル間の移動・フラグ・呼び出し（<E033>・<E026>）・台本の番号表での移動（<E031>）・尋問（証言シーン）・
// つきつけ・法廷記録の増減まで。対応していない命令は native で残す。近似にしているもの:
// - 話の順: 物語のファイル（_sceNN_cXXX_YYYY）をファイル名の順につなぐ（ゲームは台本の番号表と探偵パートの進み具合で決める）
// - 探偵パート（L_DTC_START・<E393>）: 場所の台本の出来事のうち、その場面を <E052> で指すものを展開する（calls.ts）。
//   場所を回る・話す・調べる・人物につきつける、は入らない
// - 霊媒ビジョン・指し示す・みぬく・箱の仕掛けなど台本の外の遊び: 解けたものとして成功の先へ（file.ts）
//
// 先に aa-ctr で台本を文章にしておく（assets/extracted-rs/aa6/script/、配布しない）:
//   target/release/aa-ctr assets/roms/0004000000166A00_v00.trim.3ds --keys assets/roms/aes_keys.txt --out assets/extracted-rs/aa6
// 変換:
//   bun tools/convert/ctr/index.ts --episode 1 [--title 題] [--out ファイル] [--stats]   # → assets/extracted/aa6/converted/ep1.yaml
//
// 話 N の台本は romfs/script/_output/_sce{N-1}_c*_jpn。法廷記録の番号表はゲーム本体（exefs/code.bin、code-tables.ts）から読む。
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { toYaml } from '../index.ts';
import { makeCall } from './calls.ts';
import { loadCodeTables } from './code-tables.ts';
import { charId, type NameEntry, type Step } from './convert.ts';
import { convertFile, type Shared } from './file.ts';
import { labelMap, readGmdText } from './gmd.ts';
import { loadGains, loadRecord } from './record.ts';
import { loadScriptIds, SCRIPT_TABLE } from './scripts.ts';

const ROOT = join(import.meta.dir, '../../..');
const SCRIPT = join(ROOT, 'assets/extracted-rs/aa6/script');
const TABLE = join(ROOT, 'assets/extracted-rs/aa6/romfs/table');

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
  // L_INIT・L_LOAD だけで本文の無いファイル（4 話の c000_0030 など）はつながないで飛ばす
  const all = readdirSync(dir)
    .filter((f) => f.startsWith(`_${sce}_`) && /_c\d{3}_\d{4}_jpn\.txt$/.test(f))
    .sort();
  const files = all.filter((f) =>
    readGmdText(join(dir, f)).some((e) => e.label && !/^L_(INIT|LOAD)$/.test(e.label)),
  );
  const shortOf = (f: string) => f.replace(`_${sce}_`, '').replace('_jpn.txt', '');
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
  // 選択肢の文の番号は全話の通し番号（12 未満は共通の選択肢）。その話の表の枠（途中の空きも 1 枠）が
  // 通し番号に順に並ぶので、その話の台本で使う最小の番号を、表の最初の有効な項目に合わせる
  const own = readGmdText(join(SCRIPT, `romfs/msg/choice_${sce}_jpn.txt`));
  const used = files.flatMap((f) =>
    [...readFileSync(join(dir, f), 'utf8').matchAll(/<E222 (\d+)/g)].map((m) => Number(m[1])),
  );
  const base = Math.min(...used.filter((n) => n >= 12));
  const first = own.findIndex((e) => e.label?.startsWith('CHOICE'));
  const choiceText = (id: number) =>
    (id < 12
      ? common[id]?.text
      : own[first + id - base]?.label
        ? own[first + id - base]!.text
        : undefined) ?? `（選択肢 ${id}）`;
  const record = loadRecord(
    cmn,
    loadCodeTables(join(ROOT, 'assets/extracted-rs/aa6/exefs/code.bin')),
  );
  const scriptIds = loadScriptIds(
    join(TABLE, `APP_PARAM_ID_SCRIPT_${String(ep - 1).padStart(2, '0')}.prp`),
  );

  const short = files.map((f) => f.replace(`_${sce}_`, '').replace('_jpn.txt', ''));
  const { call, investigate } = makeCall(
    {
      sceIdx: ep - 1,
      sce,
      tables: new Map([
        [ep - 1, scriptIds],
        ...Object.entries(SCRIPT_TABLE).map(
          ([n, t]) =>
            [Number(n), loadScriptIds(join(TABLE, `APP_PARAM_ID_SCRIPT_${t}.prp`))] as const,
        ),
      ]),
      dir,
      converted: new Set(short),
    },
    () => shared,
  );
  const shared: Shared = {
    call,
    investigate,
    names,
    choiceText,
    recordId: (kind, idx) =>
      (kind === 0 ? record.evidenceIds[idx] : record.profileIds[idx]) ?? null,
    gains: moveSkippedGains(
      loadGains(join(dir, `_${sce}_preset_jpn.txt`), record),
      all.map(shortOf),
      new Set(files.map(shortOf)),
    ),
    script: (to, idx) => {
      const target = to === ep - 1 ? scriptIds[idx]?.replace(`${sce}_`, '') : undefined;
      if (to !== ep - 1) return [{ end: true }];
      return target && short.includes(target)
        ? [{ goto: target }]
        : [{ native: 'E031', args: [to, idx] }];
    },
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
  // 操作する弁護士は、成歩堂・王泥喜・心音のうち台詞のいちばん多い人（4 話は心音）
  const lines = (id: string) => text.split(`"${id}":`).length - 1;
  const player = ['p000', 'p002', 'p003'].reduce((a, b) => (lines(b) > lines(a) ? b : a));
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
    player,
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

/** つながないファイルの法廷記録の増減を、その前の（無ければ後の）つなぐファイルに移す */
function moveSkippedGains(gains: Map<string, Step[]>, all: string[], kept: Set<string>) {
  all.forEach((f, i) => {
    const g = gains.get(f);
    if (kept.has(f) || !g) return;
    const to =
      all.slice(0, i).findLast((x) => kept.has(x)) ?? all.slice(i).find((x) => kept.has(x));
    if (to) gains.set(to, [...(gains.get(to) ?? []), ...g]);
  });
  return gains;
}

if (import.meta.main) main();
