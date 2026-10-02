// 逆転裁判6 の台詞の途中にある命令（文字送り・色・BGM）。
import type { Ctx } from './convert.ts';

const bgmId = (n: number) => `bgm${String(n).padStart(3, '0')}`;

export const SKIP = new Set([
  'E293',
  // 探偵パートの場所の準備（場所は invest.ts が組み立てる）
  'E369',
  'E370',
  'E371',
  'E372',
  'E373',
  'E374',
  'E375',
  'E376',
  'E379',
  'E380',
  'E382',
  'E383',
  'E311',
  'E313',
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

function count(ctx: Ctx, key: string) {
  ctx.stats.set(key, (ctx.stats.get(key) ?? 0) + 1);
}

/** 台詞の中の命令 → 文中の演出（[wait 8] など）。空文字は何もしない */
export function inline(ctx: Ctx, name: string, args: number[]): string {
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

export const plain = (s: string) => s.replace(/\[(?!\[)[^\]]*\]/g, '').replace(/\[\[/g, '[');
