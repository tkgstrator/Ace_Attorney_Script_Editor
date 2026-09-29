// 画面の枠に収まらない文を見つける（cli.ts の --check-fit）。
// packages/runtime の測り方を写している: フォントは等幅で、半角の英数字・記号も全角と同じ 1 字分を使う
// （runtime/src/text.ts の toFullWidth）。文中コマンド（[wait 8] など）は字数に入らない。
// 折り返しは runtime/src/text.ts の wrap() と同じく、1 行の字数を超える字で改行し、行頭に来てはいけない字
// （。、」！？‥ など）は前の行にぶら下げる。runtime は canvas で測るので、ここでは字数で近似する。
// 上限の出どころ（runtime/src の layout.ts・widgets.ts・record-card.ts・player.ts）は docs/writing/text-length.md。
import { plainText } from '@gyakusai/core';
import type { Diagnostic, Path } from './compile.ts';

/** 枠ごとの上限（字）。DS 版のフォントで遊ぶときの値 */
export const FIT = {
  /** 台詞・証言の文・日時の表示・つきつけの要求の問い: 1 行の字数と 1 ページの行数 */
  lineChars: 16,
  pageLines: 2,
  /** 選択肢・移動先・話題のボタン: ふつうの字で収まる字数と、詰めた字でも収まる字数 */
  buttonChars: 15,
  buttonMaxChars: 17,
  /** 話題のボタン: 話した印・ロックの印と重ならない字数 */
  topicChars: 13,
  /** 証言の題（前後に「〜」が付く。1 行だけ） */
  testimonyTitle: 16,
  /** 大きな文字（banner。2 倍の大きさで 1 行だけ） */
  banner: 9,
  /** 法廷記録の詳細・証拠品を加えたときの窓の名前 */
  recordName: 10,
  /** 証拠品・人物ファイルの説明: 1 行の字数と行数（4 行目からは出ない） */
  descChars: 12,
  descLines: 3,
  /** 探偵パートの左上の場所の名前 */
  placeLabel: 17,
  /** 範囲を選ぶ・人物を選ぶの案内（1 行目だけ出る） */
  prompt: 17,
  /** 名札（小さい字。画面の幅を超える） */
  nameTag: 24,
} as const;

// runtime/src/text.ts の NO_LINE_START と同じもの（手動で同期する）
const NO_LINE_START = '。、，．」』）！？ー…‥ぁぃぅぇぉっゃゅょァィゥェォッャュョ';

/** 表示される文字（文中コマンドと {フラグ} を除く） */
function shown(text: string): string {
  return plainText(text).replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, '');
}

/** runtime の wrap() と同じ折り返し（1 字 = 1 字分。行頭に来ない字はぶら下げる） */
export function wrapLines(text: string, perLine: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const ch of para) {
      if (line && [...line].length + 1 > perLine && !NO_LINE_START.includes(ch)) {
        out.push(line);
        line = ch;
      } else line += ch;
    }
    out.push(line);
  }
  return out;
}

const len = (s: string) => [...s].length;
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * raw（YAML を読み込んだ直後の JS 値）の中で、枠に収まらない文を警告にする。
 * どれも動きは止めない（台詞は自動でページが分かれ、ほかははみ出すか切れる）ので、警告にとどめる。
 */
export function checkTextFit(raw: unknown): Diagnostic[] {
  const out: Diagnostic[] = [];
  if (!isObj(raw)) return out;
  const warn = (path: Path, message: string) => out.push({ severity: 'warning', path, message });
  const speakers = new Set(isObj(raw.characters) ? Object.keys(raw.characters) : []);

  const page = (text: unknown, path: Path, what: string) => {
    if (typeof text !== 'string') return;
    const n = wrapLines(shown(text), FIT.lineChars).length;
    if (n > FIT.pageLines)
      warn(
        path,
        `${what}が ${n} 行で、${Math.ceil(n / FIT.pageLines)} ページに分かれます（1 ページは ${FIT.lineChars} 字 × ${FIT.pageLines} 行）`,
      );
  };
  const oneLine = (text: unknown, path: Path, max: number, what: string, effect: string) => {
    if (typeof text !== 'string') return;
    const n = len(shown(text));
    if (n > max) warn(path, `${what}が ${n} 字で、${max} 字を超えます（${effect}）`);
  };
  const button = (text: unknown, path: Path, what: string) =>
    oneLine(text, path, FIT.buttonMaxChars, what, 'ボタンからはみ出します');
  const description = (text: unknown, path: Path, what: string) => {
    if (typeof text !== 'string') return;
    const n = wrapLines(shown(text), FIT.descChars).length;
    if (n > FIT.descLines)
      warn(
        path,
        `${what}が ${n} 行で、${FIT.descLines + 1} 行目から表示されません（1 行 ${FIT.descChars} 字 × ${FIT.descLines} 行）`,
      );
  };

  // 人物・証拠品
  if (isObj(raw.characters))
    for (const [id, c] of Object.entries(raw.characters)) {
      if (!isObj(c)) continue;
      oneLine(
        c.name,
        ['characters', id, 'name'],
        FIT.nameTag,
        '名札の名前',
        '画面からはみ出します',
      );
      if (isObj(c.profile)) {
        const p = c.profile;
        const name = typeof p.name === 'string' ? p.name : c.name;
        const age = typeof p.age === 'number' ? `（${p.age}）` : '';
        if (typeof name === 'string')
          oneLine(
            name + age,
            ['characters', id, 'profile'],
            FIT.recordName,
            '人物ファイルの名前（年齢を含む）',
            '名前の帯からはみ出します',
          );
        description(
          p.description,
          ['characters', id, 'profile', 'description'],
          '人物ファイルの説明',
        );
      }
    }
  if (isObj(raw.evidence))
    for (const [id, e] of Object.entries(raw.evidence)) {
      if (!isObj(e)) continue;
      oneLine(
        e.name,
        ['evidence', id, 'name'],
        FIT.recordName,
        '証拠品の名前',
        '名前の帯からはみ出します',
      );
      description(e.description, ['evidence', id, 'description'], '証拠品の説明');
    }

  /** ステップの並び（then・else・press など、入れ子もたどる） */
  function steps(arr: unknown, path: Path): void {
    if (!Array.isArray(arr)) return;
    arr.forEach((s, i) => {
      if (isObj(s)) step(s, [...path, i]);
    });
  }

  function step(s: Record<string, unknown>, path: Path): void {
    for (const [k, v] of Object.entries(s)) {
      const p = [...path, k];
      if (speakers.has(k) && typeof v === 'string') page(v, p, '台詞');
      else if (k === 'say') page(s.text, [...path, 'text'], '台詞');
      else if (k === 'narrate') page(v, p, 'ナレーション');
      else if (k === 'card') page(v, p, '日時・場所の表示');
      else if (k === 'demand') page(v, p, 'つきつけの要求の問い');
      else if (k === 'banner')
        oneLine(v, p, FIT.banner, '大きな文字', '1 行で、画面の両端で切れます');
      else if (k === 'pick' || k === 'nominate')
        oneLine(v, p, FIT.prompt, '案内', '2 行目からは表示されません');
      else if (k === 'choice' && Array.isArray(v))
        v.forEach((c, i) => {
          if (!isObj(c)) return;
          button(c.text, [...p, i, 'text'], '選択肢');
          steps(c.then, [...p, i, 'then']);
        });
      else if (k === 'areas' && Array.isArray(v))
        v.forEach((a, i) => {
          if (isObj(a)) steps(a.then, [...p, i, 'then']);
        });
      else if (Array.isArray(v)) steps(v, p);
      else if (isObj(v)) for (const [kk, vv] of Object.entries(v)) steps(vv, [...p, kk]);
    }
  }

  function scene(v: unknown, path: Path): void {
    if (Array.isArray(v)) {
      steps(v, path);
      return;
    }
    if (!isObj(v)) return;
    oneLine(
      v.testimony,
      [...path, 'testimony'],
      FIT.testimonyTitle,
      '証言の題',
      '画面の両端で切れます',
    );
    if (Array.isArray(v.statements))
      v.statements.forEach((st, i) => {
        if (!isObj(st)) return;
        const sp = [...path, 'statements', i];
        page(st.text, [...sp, 'text'], '証言の文');
        for (const k of ['before', 'press']) steps(st[k], [...sp, k]);
        if (isObj(st.present))
          for (const [kk, vv] of Object.entries(st.present)) steps(vv, [...sp, 'present', kk]);
      });
    for (const k of ['reading', 'after', 'loop', 'wrong']) steps(v[k], [...path, k]);
  }

  function place(v: unknown, path: Path): void {
    if (!isObj(v)) return;
    button(v.name, [...path, 'name'], '場所の名前（移動する）');
    oneLine(
      v.name,
      [...path, 'name'],
      FIT.placeLabel,
      '場所の名前（左上）',
      '法廷記録のボタンと重なります',
    );
    if (Array.isArray(v.talk))
      v.talk.forEach((t, i) => {
        if (!isObj(t)) return;
        oneLine(
          t.topic,
          [...path, 'talk', i, 'topic'],
          FIT.topicChars,
          '話題',
          '話した印と重なります',
        );
        steps(t.then, [...path, 'talk', i, 'then']);
      });
    if (Array.isArray(v.examine))
      v.examine.forEach((e, i) => {
        if (isObj(e)) steps(e.then, [...path, 'examine', i, 'then']);
      });
    for (const k of ['enter', 'examineDefault', 'presentWrong']) steps(v[k], [...path, k]);
    if (isObj(v.present))
      for (const [kk, vv] of Object.entries(v.present)) steps(vv, [...path, 'present', kk]);
  }

  const groups: { scenes?: unknown; places?: unknown; path: Path }[] = [
    { scenes: raw.scenes, path: [] },
  ];
  if (Array.isArray(raw.parts))
    raw.parts.forEach((p, i) => {
      if (isObj(p)) groups.push({ scenes: p.scenes, places: p.places, path: ['parts', i] });
    });
  for (const g of groups) {
    if (isObj(g.scenes))
      for (const [id, v] of Object.entries(g.scenes)) scene(v, [...g.path, 'scenes', id]);
    if (isObj(g.places))
      for (const [id, v] of Object.entries(g.places)) place(v, [...g.path, 'places', id]);
  }
  return out;
}
