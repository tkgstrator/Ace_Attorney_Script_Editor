// 3DS 版（逆転裁判6）の台本の 1 ブロック（ラベル 1 つ分の文）を、シナリオのステップにする。
// 命令の意味は台本の前後から推測したもの（docs/3ds.md の「台本の命令」を参照）。分からない命令は native で残す。
import type { Token } from './gmd.ts';

export type Step = Record<string, unknown>;

export type NameEntry = { label: string; name: string };

export type Ctx = {
  /** 名前欄の表（msg_cmn の name_jpn）。<E041 役 名前> の名前がこの番号 */
  names: NameEntry[];
  /** 選択肢の文（<E222 番号 飛び先> の番号 → 文） */
  choiceText: (id: number) => string;
  /** 同じファイルの n 番目のラベルへ飛ぶ（goto か、尋問の中ならその場に展開したステップ） */
  jump: (n: number) => Step[];
  /** <E039>（このファイルの終わり）で行うこと（法廷記録の増減と次のファイルへの goto） */
  end: () => Step[];
  /** <E245 証言>: 隠れた証言を出すフラグ（無ければ null） */
  reveal: (msg: number) => string | null;
  /** 肢の無い <E223>（霊媒ビジョンなど、ゲーム側の遊びを始める）の代わり */
  game: () => Step[];
  /** ほかのブロックで並べた選択肢の肢（<E222>… <E004 n> の後、n のブロックの <E223> で出す） */
  choicesAt: (label: number | null) => { id: number; to: number }[];
  /** <E031 話 番号>: 話（0 始まり）の台本の番号表の N 番の台本へ飛ぶ。別の話なら話の終わり */
  script: (sce: number, idx: number) => Step[];
  /** <E033 話 番号 ラベル>: その台本のラベルを呼んで戻る（呼ばれたブロックを展開したステップ） */
  call: (sce: number, idx: number, label: string | null) => Step[];
  /** <E026 n>: 同じ台本のラベル n を呼んで戻る（展開したステップ） */
  callLocal: (n: number) => Step[];
  /** 探偵パートの近似の中で展開しているとき、その入口の物語のファイルの章・シーン（<E052> で見る） */
  hub?: { chap: number; scene: number };
  /** <E394>: 探偵パートを終える */
  endInvest: () => Step[];
  /** 探偵パートの入口（L_DTC_START）の代わりのステップ（end は L_DTC_END への goto） */
  investigate: (chap: number, scene: number, end: Step[]) => Step[];
  /** <E393 ? ラベル>: ここで探偵パートに入り、終わるとラベルへ（L_DTC_START の無い形） */
  freeRoam: (label: number) => Step[];
  /** 法廷記録の番号 → 証拠品 ID（種類 0）・人物 ID（種類 1） */
  recordId: (kind: number, idx: number) => string | null;
  flags: Set<string>;
  usedNames: Set<number>;
  stats: Map<string, number>;
};

/** 表示にも流れにも関係しない命令（行番号・区切り・字の配置の印・吹き出しの準備など） */
const SKIP = new Set([
  'E293',
  'E800',
  'E063',
  'RDFG',
  'MCRS',
  'MCRE',
  'E795',
  'E796',
  'E042',
  'E001',
  'E220',
  'E248',
  'E283',
]);

const COLORS: Record<string, string> = { E005: 'white', E006: 'red', E007: 'blue', E008: 'green' };

/** 名前欄の NAME201_0 → p201（人物ファイルの cast201 と同じ番号） */
export function charId(e: NameEntry): string {
  return e.label.toLowerCase().replace(/^name/, 'p').replace(/_0$/, '');
}

export function bgmId(n: number): string {
  return `bgm${String(n).padStart(3, '0')}`;
}

export const flagName = (bank: number, id: number) => `f${bank}_${id}`;

function count(ctx: Ctx, key: string) {
  ctx.stats.set(key, (ctx.stats.get(key) ?? 0) + 1);
}

/** 台詞の中の命令 → 文中の演出（[wait 8] など）。空文字は何もしない */
function inline(ctx: Ctx, name: string, args: number[]): string {
  if (SKIP.has(name) || name === 'CNTR') return '';
  if (name === 'E003') return `[wait ${args[0]}]`;
  if (name === 'E025') return `[speed ${args[0]}]`;
  if (COLORS[name]) return `[color ${COLORS[name]}]`;
  if (name === 'E604') return `[bgm ${bgmId(args[0]!)}]`;
  if (name === 'E605') return '[bgm null]';
  count(ctx, `文中 ${name}`);
  // 文中の native の引数は 0 以上の数だけ書ける（負の数のある命令は名前だけ残す）
  return `[native ${[name, ...(args.some((a) => a < 0) ? [] : args)].join(' ')}]`;
}

type Line = { speaker: number | null; parts: string[]; centered: boolean; green: boolean };

export const plain = (s: string) => s.replace(/\[(?!\[)[^\]]*\]/g, '').replace(/\[\[/g, '[');

/** 流れ・フラグ・法廷記録の命令。当てはまらなければ null */
function control(ctx: Ctx, name: string, args: number[]): Step[] | null {
  switch (name) {
    case 'E004':
      return ctx.jump(args[0]!);
    case 'E039':
      return ctx.end();
    case 'E031':
      return ctx.script(args[0]!, args[1]!);
    case 'E393':
      return ctx.freeRoam(args[1]!);
    case 'E394':
      return ctx.endInvest();
    case 'E026':
      return ctx.callLocal(args[0]!);
    case 'E052':
      if (!ctx.hub) return null;
      return args[1] === ctx.hub.chap && args[2] === ctx.hub.scene ? ctx.jump(args[3]!) : [];
    case 'E028':
    case 'E029': {
      const f = flagName(args[0]!, args[1]!);
      ctx.flags.add(f);
      return [{ set: { [f]: name === 'E028' } }];
    }
    case 'E030': {
      const f = flagName(args[0]!, args[1]!);
      ctx.flags.add(f);
      // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
      return [{ if: args[2] ? f : `not ${f}`, then: ctx.jump(args[3]!) }];
    }
    case 'E245': {
      const f = ctx.reveal(args[0]!);
      return f ? [{ set: { [f]: true } }] : null;
    }
    case 'E249':
      return [{ random: args.map((n) => ctx.jump(n)) }];
    case 'E060': {
      const id = ctx.recordId(args[0]!, args[1]!);
      return id && args[0] === 0 ? [{ showEvidence: id }] : null;
    }
    case 'E061':
      return [{ showEvidence: null }];
    case 'E279':
      return [{ lifeRisk: args[0] }];
    case 'E284':
      return [{ penalty: args[0] }];
    case 'E285':
      return [{ gameover: true }];
    case 'E003':
      return [{ wait: args[0] }];
    case 'E604':
      return [{ bgm: bgmId(args[0]!) }];
    case 'E605':
      return [{ bgm: null }];
  }
  return null;
}

/**
 * self は変換するブロックのラベルの番号。つきつけの要求（<E224>）の外れの後にある、自分への <E004> を落とすのに使う。
 *   問いかけの台詞 <E027> <E224 1 0> <E225 種類 番号 ラベル>… 外れのときの台詞… <E004 自分>
 */
export function convertBlock(tokens: Token[], ctx: Ctx, self: number | null = null): Step[] {
  const steps: Step[] = [];
  let line: Line | null = null;
  let choice: { id: number; to: number }[] | null = null;
  let demand: { step: Step; present: Record<string, Step[]>; wrongFrom: number } | null = null;
  let spots: { text: string; then: Step[] }[] = [];
  let spotsFrom = 0;
  let conds: string[] = [];

  const finish = (auto: boolean) => {
    if (!line) return;
    const text = line.parts.join('').replace(/\n+$/, '');
    const l = line;
    line = null;
    if (!plain(text).trim()) return;
    if (l.centered && l.green) {
      steps.push({ card: plain(text) });
      return;
    }
    const who = l.speaker === null ? undefined : ctx.names[l.speaker];
    const id = who?.name.trim() ? charId(who) : null;
    if (id) ctx.usedNames.add(l.speaker!);
    if (auto) steps.push({ say: id, text, auto: true });
    else steps.push(id ? { [id]: text } : { narrate: text });
  };

  for (const t of tokens) {
    if (t.kind === 'text') {
      if (!line) {
        if (!t.text.trim()) continue;
        line = { speaker: null, parts: [], centered: false, green: false };
      }
      line.parts.push(t.text.replace(/\[/g, '[['));
      continue;
    }
    const { name, args } = t;
    if (name === 'E033' && !line) {
      steps.push(...ctx.call(args[0]!, args[1]!, t.label ?? null));
      continue;
    }
    switch (name) {
      case 'E041':
      case 'E260':
        finish(false);
        line = { speaker: args[1] ?? null, parts: [], centered: false, green: false };
        continue;
      case 'E023':
      case 'PAGE':
        finish(false);
        continue;
      case 'E024':
      case 'E027':
      case 'E206':
        finish(true);
        continue;
    }
    if (line) {
      if (name === 'CNTR') line.centered = true;
      if (name === 'E008') line.green = true;
      line.parts.push(inline(ctx, name, args));
      continue;
    }
    if (SKIP.has(name)) continue;
    if (name === 'E221') {
      choice = [];
      continue;
    }
    if (name === 'E222') {
      choice?.push({ id: args[0]!, to: args[1]! });
      continue;
    }
    if (name === 'E223') {
      const opts = (choice?.length ? choice : ctx.choicesAt(self)).map((o) => ({
        text: ctx.choiceText(o.id),
        // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
        then: ctx.jump(o.to),
      }));
      steps.push(...(opts.length ? [{ choice: opts }] : ctx.game()));
      choice = null;
      continue;
    }
    if (name === 'E224') {
      const q = steps.at(-1);
      const asked = q && 'say' in q ? steps.pop()! : null;
      const present: Record<string, Step[]> = {};
      const step: Step = {
        demand: asked ? plain(String(asked.text)).replace(/\n/g, '') : '',
        ...(asked?.say ? { by: asked.say } : {}),
        present,
      };
      steps.push(step);
      demand = { step, present, wrongFrom: steps.length };
      continue;
    }
    // 指紋の照合（<E561> で人物を選ばせ、<E226 種類 番号 ラベル> が正解。外れは自分に戻る）もつきつけ要求にする
    if (name === 'E226' && !demand) {
      const present: Record<string, Step[]> = {};
      const step: Step = { demand: '照合する相手を選ぶ', present };
      steps.push(step);
      demand = { step, present, wrongFrom: steps.length };
    }
    if ((name === 'E225' || name === 'E226' || name === 'E255') && demand) {
      const id = ctx.recordId(args[0]!, args[1]!);
      if (id) demand.present[id] = ctx.jump(args[2]!);
      demand.wrongFrom = steps.length;
      continue;
    }
    if (name === 'E004' && demand && args[0] === self) continue;
    // 証拠品を 3D で調べる（<E293>、<E327 2 所 ラベル>… <E004 自分>）。当たりの範囲は台本に無いので、所ごとの選択肢にする
    // 所を並べた後に台詞があれば、それはほかの所を調べたとき（外れ）
    if (name === 'E327') {
      if (!spots.length) spotsFrom = steps.length;
      // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
      spots.push({ text: `調べる所 ${args[1]}`, then: ctx.jump(args[2]!) });
      continue;
    }
    if (name === 'E004' && spots.length) {
      const miss = steps.splice(spotsFrom);
      const back = args[0] === self;
      const missThen = [...miss, ...(back ? [] : ctx.jump(args[0]!))];
      // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
      const other = miss.length || !back ? [{ text: 'ほかの所', then: missThen }] : [];
      steps.push({ native: 'examine3d', args: [] }, { choice: [...spots, ...other] });
      if (back) steps.push(...ctx.jump(self));
      spots = [];
      continue;
    }
    // <E051 a b>… で条件のフラグを並べ、<E050 値 ラベル> ですべてが値なら飛ぶ
    if (name === 'E051') {
      const f = flagName(args[0]!, args[1]!);
      ctx.flags.add(f);
      conds.push(f);
      continue;
    }
    if (name === 'E050' && conds.length) {
      const cond = conds.map((f) => (args[0] ? f : `not ${f}`)).join(' and ');
      // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
      steps.push({ if: cond, then: ctx.jump(args[1]!) });
      conds = [];
      continue;
    }
    const done = control(ctx, name, args);
    if (done) {
      steps.push(...done);
      continue;
    }
    count(ctx, `ステップ ${name}`);
    steps.push({ native: name, args });
  }
  finish(false);
  if (demand) demand.step.wrong = steps.splice(demand.wrongFrom);
  return steps;
}
