// 3DS 版（逆転裁判6）の台本を、シナリオ YAML（1 つの章）に変換する。命令の意味は docs/3ds.md の「台本の命令」。
// 会話・選択肢・ラベル間の移動・フラグ・呼び出し（<E033>・<E026>）・台本の番号表での移動（<E031>）・尋問（証言シーン）・
// つきつけ・法廷記録の増減まで。対応していない命令は native で残す。近似にしているもの:
// - 話の順: 物語のファイル（_sceNN_cXXX_YYYY）をファイル名の順につなぐ（ゲームは台本の番号表と探偵パートの進み具合で決める）
// - 探偵パート（<E393>）: 探索編の場所にする（invest.ts）。調べる所の位置は 3D の部品で取れないので、画面を縦に切った帯で選ばせる
// - 霊媒ビジョン・指し示す・みぬく・箱の仕掛けなど台本の外の遊び: 解けたものとして成功の先へ（file.ts）
//
// 先に aa-ctr で台本を文章にしておく（assets/extracted-rs/aa6/script/、配布しない）:
//   target/release/aa-ctr assets/roms/0004000000166A00_v00.trim.3ds --keys assets/roms/aes_keys.txt --out assets/extracted-rs/aa6
// 変換:
//   bun tools/convert/ctr/index.ts --episode 1 [--title 題] [--out ファイル] [--stats]   # → assets/extracted/aa6/converted/ep1.yaml
//
// 話 N の台本は romfs/script/_output/_sce{N-1}_c*_jpn。法廷記録の番号表はゲーム本体（exefs/code.bin、code-tables.ts）から読む。
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { toYaml } from '../index.ts';
import { makeCall } from './calls.ts';
import { loadCodeTables } from './code-tables.ts';
import { charId, type NameEntry, type Step } from './convert.ts';
import { convertFile, type Shared } from './file.ts';
import { labelMap, readGmdText } from './gmd.ts';
import { makeInvest } from './invest.ts';
import { dropUnreadSets, readNames } from './prune.ts';
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
  const { call, block, load } = makeCall(
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
  const invest = makeInvest({
    bgScripts: loadScriptIds(join(TABLE, 'APP_PARAM_ID_SCRIPT_BG.prp')),
    bgNames: new Map(
      readGmdText(join(cmn, 'bg_jpn.txt')).flatMap((e) => (e.label ? [[e.label, e.text]] : [])),
    ),
    chrScripts: loadScriptIds(join(TABLE, 'APP_PARAM_ID_SCRIPT_CHR.prp')),
    topicName: topicNames(dir, sce),
    load,
    block,
    shared: () => shared,
    flagPossible: flagPossible(dir, files.map(shortOf)),
  });
  const shared: Shared = {
    ep: ep - 1,
    call,
    investigate: invest.investigate,
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
  const scenes: Record<string, any> = {};
  // ゲームオーバーの場面（L_GAMEOVER）はファイルごとにある（負けの判決の台詞が違う）が、シナリオのゲームオーバーは
  // 1 つ。ファイルの最初で gameover_at に何番目かを入れ、ゲームオーバーの場面でその番号のものへ分ける
  const gameovers: string[] = [];
  const origRef = new Set<string>();
  const called = new Set<string>();
  files.forEach((f, i) => {
    const r = convertFile(readGmdText(join(dir, f)), short[i]!, short[i + 1] ?? null, shared);
    for (const [id, s] of r.scenes) scenes[id] = s;
    for (const id of r.origRef) origRef.add(id);
    for (const n of r.called) called.add(n);
    const first = r.scenes[0]?.[1];
    if (r.gameover && Array.isArray(first)) {
      gameovers.push(r.gameover);
      first.unshift({ set: { gameover_at: gameovers.length } });
    }
  });
  let gameover: string | null = null;
  if (gameovers.length > 0) {
    gameover = 'gameover_by_file';
    scenes[gameover] = gameovers.map((to, i) => ({
      if: `gameover_at == ${i + 1}`,
      // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
      then: [{ goto: to }],
    }));
    scenes[gameover].push({ goto: gameovers[0]! });
  }

  dropRedundant(
    scenes,
    [scenes, invest.places, invest.scenes],
    [short[0]!, gameover],
    origRef,
    called,
  );

  if (args.includes('--dead')) {
    // どこからも goto されずに残ったシーン（ゲーム本体の仕組みで入るものなど）を見る
    const text = JSON.stringify([scenes, invest.places, invest.scenes]);
    for (const id of Object.keys(scenes))
      if (id !== short[0] && id !== gameover && !text.includes(`"goto":"${id}"`))
        console.log(`dead\t${id}`);
  }

  // 書くだけで、どの条件からも読まれないフラグは、フラグの定義ごと落とす
  const trees = [scenes, invest.places, invest.scenes];
  const read = readNames(trees);
  dropUnreadSets(trees, read);
  const flagNames = [...shared.flags].filter((f) => read.has(f));

  // 法廷記録で使う証拠品・人物だけを載せる
  const text = JSON.stringify([scenes, invest.places, invest.scenes]);
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
    flags: {
      ...Object.fromEntries(flagNames.sort().map((f) => [f, false])),
      ...(gameover ? { gameover_at: 0 } : {}),
    },
    start: { scene: short[0], evidence: [], profiles: [] },
    ...(gameover ? { gameover } : {}),
    ...(Object.keys(invest.places).length
      ? {
          parts: [
            { id: 'story', kind: 'trial', title: '物語', scenes },
            {
              id: 'investigation',
              kind: 'investigation',
              title: '探偵パート',
              ...(Object.keys(invest.scenes).length ? { scenes: invest.scenes } : {}),
              places: invest.places,
            },
          ],
        }
      : { scenes }),
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

/**
 * 台本の他の場面の写しや、変換で置き換えた遊びの中身で、どこからも移らない場面を落とす。落とすのは次のものだけ
 * （どれも移ってくる道が無い場面に限る。繰り返して、落とした場面からだけ移っていた場面も落とす）:
 * - 中身が空の場面（読み込みだけの L_PO_INIT など）
 * - 霊媒ビジョンの中身（L_SPIRIT_CHECK・HINT・NO_HINT・RETRY。託宣と感覚の選択肢・解けたものに置き換えた遊びの輪）
 */
function dropRedundant(
  scenes: Record<string, any>,
  where: Record<string, any>[],
  roots: (string | null)[],
  origRef: Set<string>,
  called: Set<string>,
): void {
  // 出力からは goto されないシーンを落とす: 中身が空のもの、霊媒ビジョンの内部の輪、そして元の台本からは飛び先にされていた
  // （= 呼び出し・尋問・選択肢の中に展開されて、単独では要らなくなった）ものの写し。飛び先にされていないもの
  // （ゲーム本体の仕組みで入るもの）は落とさない
  // 立ち絵を出し入れするだけの命令（台詞・流れ・フラグ・法廷記録は変えない）。ゲーム本体が場所の切り替えで呼ぶ後始末
  const DISPLAY = new Set([
    'E118',
    'E119',
    'E120',
    'E121',
    'E140',
    'E141',
    'E142',
    'E144',
    'E145',
    'E147',
    'E149',
    'E152',
    'E153',
    'E157',
    'E158',
    'E088',
    'E525',
    'E526',
    'E527',
  ]);
  const body = (id: string): unknown[] | null => {
    const s = scenes[id];
    if (!Array.isArray(s)) return null;
    // 終わりの goto（次へ進むだけ）は内容に数えない
    return s.length > 0 && 'goto' in s[s.length - 1] ? s.slice(0, -1) : s;
  };
  const displayOnly = (id: string) => {
    const b = body(id);
    // 終わりの E039 が持つ法廷記録の増減は、ファイルの本筋の終わりにもある写しなので数えない
    const glue = (x: any) => ['give', 'giveProfile', 'take', 'takeProfile'].some((k) => k in x);
    return (
      b !== null &&
      b.some((x: any) => DISPLAY.has(x.native)) &&
      b.every((x: any) => DISPLAY.has(x.native) || glue(x))
    );
  };
  const copyOf = (id: string) => {
    const b = body(id);
    if (b === null || b.length === 0) return false;
    const key = JSON.stringify(b);
    return Object.keys(scenes).some(
      (o) => o !== id && text.includes(`"goto":"${o}"`) && JSON.stringify(body(o)) === key,
    );
  };
  const candidate = (id: string) =>
    (Array.isArray(scenes[id]) && (scenes[id].length === 0 || body(id)!.length === 0)) ||
    displayOnly(id) ||
    copyOf(id) ||
    /_spirit_(check|hint|no_hint|retry)(_\d+)?$/.test(id) ||
    origRef.has(id) ||
    // X_END の X が出力に無く、X_END自身も飛び先にされていない（ゲーム本体が X の後に続けて入る組の、X ごと使われない側）
    (/_end$/.test(id) && !scenes[id.replace(/_end$/, '')]) ||
    [...called].some((n) => id.endsWith(`_${n}`));
  let text = '';
  for (;;) {
    text = JSON.stringify(where);
    const gone = Object.keys(scenes).filter(
      (id) => candidate(id) && !roots.includes(id) && !text.includes(`"goto":"${id}"`),
    );
    if (gone.length === 0) return;
    for (const id of gone) delete scenes[id];
  }
}

/**
 * 進み具合のフラグ（<E028 バンク 番号>）が、物語のファイル file の探偵パートで立ちうるか。
 * 立てるのが（この話の）これより後の物語のファイルだけなら立たない。物語のファイルの外（場所・人物の台本、ほかの話、
 * 共通の台本）でも立てるもの、どこでも立てないもの（ゲーム本体が立てるかもしれない）は立ちうるとする
 */
function flagPossible(dir: string, story: string[]): (flag: string, file: string) => boolean {
  const first = new Map<string, number>();
  const other = new Set<string>();
  for (const f of readdirSync(dir)) {
    const idx = story.findIndex((s) => f.endsWith(`_${s}_jpn.txt`));
    for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/<E028 (\d+) (\d+)>/g)) {
      const flag = `f${m[1]}_${m[2]}`;
      if (idx < 0) other.add(flag);
      else first.set(flag, Math.min(first.get(flag) ?? idx, idx));
    }
  }
  return (flag, file) => {
    const at = first.get(flag);
    return at === undefined || other.has(flag) || at <= story.indexOf(file);
  };
}

/**
 * 話題の番号 → 名前。話題の名前は topic_sceNN の並びで、その話で使う最小の番号が先頭
 * （<E377 人 話題 ラベル>・<E378 人 旧 新 ラベル> の話題を、場所の台本から集めて求める）
 */
function topicNames(dir: string, sce: string): (id: number) => string | null {
  const ids: number[] = [];
  for (const f of readdirSync(dir).filter((f) => f.startsWith(`_${sce}_bg`))) {
    const text = readFileSync(join(dir, f), 'utf8');
    for (const m of text.matchAll(/<E377 \d+ (\d+) /g)) ids.push(Number(m[1]));
    for (const m of text.matchAll(/<E378 \d+ (\d+) (\d+) /g)) ids.push(Number(m[1]), Number(m[2]));
  }
  const path = join(SCRIPT, `romfs/msg/topic_${sce}_jpn.txt`);
  const base = Math.min(...ids);
  if (ids.length === 0 || !existsSync(path)) return () => null;
  const entries = readGmdText(path);
  return (id) => {
    const t = entries[id - base]?.text;
    return t && t !== 'Invalid Message' ? t : null;
  };
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
