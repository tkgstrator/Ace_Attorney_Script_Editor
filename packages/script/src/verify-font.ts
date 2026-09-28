// DS 版のドット絵フォント（tools/rom で ROM から取り出したもの）に存在しない文字を見つける。
// あくまで「そのまま描けるか」のハードなチェック。docs/katakana.md の対応表はカタカナが好まれる
// という演出上の好みで、字自体は存在することが多いので混同しないこと（詳しくは docs/katakana.md）。
// PixelMplus（既定のフォールバックフォント）を使う分にはこの制約はない。
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { plainText } from '@gyakusai/core';
import { z } from 'zod';
import type { Diagnostic, Path } from './compile.ts';

// tools/rom/charset.py の LAYOUT・ALIASES と同じもの（手動で同期する）
const LAYOUT =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!?' +
  'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん' +
  'がぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽ' +
  'ぁぃぅぇぉゃゅょっ' +
  'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン' +
  'ガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポ' +
  'ァィゥェォャュョッヴ' +
  '．☞「」（）『』“”▼▲：、，＋／＊’ー・。％‥～《》＆☆♪　‐″［］＄＃＞＜＝■éá；';
const ALIASES: Record<string, string> = {
  '…': '‥',
  '―': 'ー',
  '—': 'ー',
  '〜': '～',
  '!': '！',
  '?': '？',
};

const KANJI_FILE = fileURLToPath(new URL('../../../docs/available-kanji.txt', import.meta.url));
const STYLE_FILE = fileURLToPath(new URL('./katakana-style.json', import.meta.url));

const StyleEntrySchema = z.strictObject({
  kanji: z.string(),
  katakana: z.string(),
  tier: z.enum(['always', 'usual', 'sometimes']),
});
const StyleFileSchema = z.array(StyleEntrySchema);
type StyleEntry = z.infer<typeof StyleEntrySchema>;

let cache: { chars: Set<string>; style: StyleEntry[] } | null = null;

/** 遅延読み込み（呼ばれるまで docs/available-kanji.txt を読まない）。無ければチェックしない */
function load(): { chars: Set<string>; style: StyleEntry[] } | null {
  if (cache) return cache;
  if (!existsSync(KANJI_FILE)) return null;
  const kanji = readFileSync(KANJI_FILE, 'utf8').replace(/\n/g, '');
  const chars = new Set([...LAYOUT, ...kanji]);
  // 半角の印字可能文字（0x20〜0x7E）は常に使えるものとする。schema.ts の Id（英数字・_）や
  // Cond（条件式。==・and など）は台詞ではなく参照・式なので、そもそも見た目に出ない
  for (let code = 0x20; code <= 0x7e; code++) chars.add(String.fromCodePoint(code));
  chars.add('\n');
  chars.add('\r'); // YAML の複数行文字列の改行（グリフではなく折り返しなので対象外）
  // 半角英数字・記号は全角でも引ける（tools/rom/build_font.py の「半角の英数字・記号は
  // 全角でも引けるようにする」と同じ）
  for (const c of [...chars]) {
    const code = c.codePointAt(0)!;
    if (code >= 0x21 && code <= 0x7e) chars.add(String.fromCodePoint(code + 0xfee0));
  }
  const style: StyleEntry[] = existsSync(STYLE_FILE)
    ? StyleFileSchema.parse(JSON.parse(readFileSync(STYLE_FILE, 'utf8')))
    : [];
  cache = { chars, style };
  return cache;
}

function suggestionsFor(text: string, missing: string, style: StyleEntry[]): StyleEntry[] {
  return style.filter((e) => e.kanji.includes(missing) && text.includes(e.kanji));
}

const TIER_NOTE: Record<StyleEntry['tier'], string> = {
  always: '',
  usual: '（場面によっては漢字のままの方が自然なこともある）',
  sometimes: '（このゲームでは普段は漢字で書かれる語。強調したいときのカタカナ表記）',
};

function describe(missing: string, matches: StyleEntry[]): string {
  if (matches.length === 0)
    return `文字「${missing}」は DS 版フォントにありません。言い換えてください（対応する候補なし）`;
  const options = matches.map((m) => `${m.kanji}→${m.katakana}${TIER_NOTE[m.tier]}`).join(' / ');
  return `文字「${missing}」は DS 版フォントにありません。言い換え候補: ${options}`;
}

/**
 * raw（YAML を読み込んだ直後の JS 値。compile() に渡すのと同じもの）の中の文字列を
 * すべて調べ、DS 版フォントに無い文字を診断として返す。PixelMplus で表示する分には
 * 関係ない制約なので、使うかどうかは呼び出し側（cli.ts の --check-font）が決める。
 */
export function checkFontGlyphs(raw: unknown): Diagnostic[] {
  const data = load();
  if (!data) return [];
  const { chars, style } = data;
  const diagnostics: Diagnostic[] = [];

  function visitString(text: string, path: Path): void {
    // {flagName} は実行時に値へ差し替わる（compile.ts の INTERPOLATION と同じ書き方）ので、
    // 表示される文字ではない。中身を見ずに取り除く
    const plain = plainText(text).replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, '');
    const seen = new Set<string>();
    for (const ch of plain) {
      const c = ALIASES[ch] ?? ch;
      if (chars.has(c) || seen.has(c)) continue;
      seen.add(c);
      diagnostics.push({
        severity: 'error',
        path,
        message: describe(c, suggestionsFor(plain, c, style)),
      });
    }
  }

  function visit(value: unknown, path: Path): void {
    if (typeof value === 'string') visitString(value, path);
    else if (Array.isArray(value)) value.forEach((v, i) => visit(v, [...path, i]));
    else if (value && typeof value === 'object')
      for (const [k, v] of Object.entries(value)) visit(v, [...path, k]);
  }

  visit(raw, []);
  return diagnostics;
}
