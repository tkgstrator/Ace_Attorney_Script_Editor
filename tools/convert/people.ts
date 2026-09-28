// 人物 ID を決める（名前の番号・人物の番号・法廷記録の人物ファイル → ID）。
// 対応表（character-ids.json）を先に引き、無ければ番号から仮の ID を作って警告する。
import { RESERVED_KEYS } from '../../packages/script/src/schema.ts';
import { lookupId } from './character-ids.ts';
import type { Context } from './context.ts';
import { parseProfileName, slug } from './tables.ts';

/** 人物 ID の元の番号を記録する（index.ts の --ids で一覧にする） */
function note(ctx: Context, id: string, src: string): string {
  let set = ctx.shared.idSources.get(id);
  if (!set) {
    set = new Set();
    ctx.shared.idSources.set(id, set);
  }
  set.add(src);
  return id;
}

/** 名前の番号 → 人物 ID（表に無ければ英語の名札から。重なれば _番号、名札の英語が無ければ c番号） */
function idForName(ctx: Context, n: number): string {
  const ids = ctx.shared.nameIds;
  let id = ids.get(n);
  if (id) return id;
  id = lookupId(ctx.t.ids, 'names', n, ctx.shared.idWarnings) ?? undefined;
  if (!id) {
    const base = slug(ctx.t.names.find((x) => x.id === n)?.text.en ?? '');
    const taken = new Set([...ids.values(), ...ctx.shared.profileIds.values()]);
    id = !base ? `c${n}` : taken.has(base) || RESERVED_KEYS.has(base) ? `${base}_${n}` : base;
  }
  ids.set(n, id);
  return note(ctx, id, `name:${n}`);
}

/** 名前の番号（14）→ 人物 ID（0 = null）。初めてなら名札と文字送りの音を決める */
export function speakerId(ctx: Context, n: number): string | null {
  if (n === 0) return null;
  const id = idForName(ctx, n);
  if (!ctx.characters.has(id)) {
    const tag = ctx.t.names.find((x) => x.id === n)?.text[ctx.entry.lang] ?? '';
    ctx.characters.set(id, { name: tag, blip: ctx.t.blipKinds[n] === 1 ? 'female' : 'male' });
  }
  return id;
}

/**
 * 人物の番号（30）→ 人物 ID。対応表の chars にあればその ID、無ければ名前の番号の人物と同じ ID。
 * 名札の無い人物で表にも無ければ c番号（警告）
 */
export function characterId(ctx: Context, k: number): string {
  const c = ctx.t.chars[String(k)];
  let id = lookupId(ctx.t.ids, 'chars', k, ctx.shared.idWarnings, { warn: false });
  if (!id) {
    const n = c?.name_id ?? k;
    if (n !== 0 && (ctx.t.names.find((x) => x.id === n)?.text.ja ?? '') !== '')
      return speakerId(ctx, n)!;
    id = lookupId(ctx.t.ids, 'chars', k, ctx.shared.idWarnings) ?? `c${k}`;
  }
  // 名札は、人物の名前の番号の名札（大写しの顔などの絵の確かめに使う）
  const tag = ctx.t.names.find((x) => x.id === (c?.name_id ?? k))?.text[ctx.entry.lang];
  if (!ctx.characters.has(id)) ctx.characters.set(id, { name: c?.name ?? tag ?? '' });
  return note(ctx, id, `char:${k}`);
}

/** 人物ファイルの持ち主（表の ID・名前の番号・人物の番号・英語の名前の絵・どれでもない） */
type Owner =
  | { id: string }
  | { name: number }
  | { char: number }
  | { img: number; en: string }
  | { rec: number };

/** 人物ファイルの持ち主を決める（ID は作らない） */
function ownerOf(ctx: Context, rec: number): Owner {
  const fixed = ctx.t.ids?.profiles[String(rec)];
  if (fixed) return { id: fixed };
  const link = ctx.t.profiles?.[String(rec)];
  if (link) {
    const n = link.name_id;
    const tag = ctx.t.names.find((x) => x.id === n)?.text;
    if (n === null || !tag || tag.ja === '') return { img: link.name_image, en: link.name_en };
    // 同じ名札の名前の番号がいくつもあれば（ヤハリの 15 と 29 など）、いちばん短い ID（接尾辞の無いもの）の番号に
    // まとめる。対応表が無ければ、章の中で名札の ID を先に取った番号
    const same = ctx.t.names.filter((x) => x.text.ja === tag.ja && x.text.en === tag.en);
    const table = ctx.t.ids?.names;
    const owner = table
      ? same
          .filter((x) => table[String(x.id)] !== undefined)
          .sort(
            (a, b) => table[String(a.id)]!.length - table[String(b.id)]!.length || a.id - b.id,
          )[0]
      : same.find((x) => ctx.shared.nameIds.get(x.id) === slug(tag.en));
    return { name: owner?.id ?? n };
  }
  const text = ctx.recordText(rec);
  const p = text ? parseProfileName(text.name) : { name: '' };
  const bare = (x: string) => x.replace(/\s/g, '');
  const k = Object.entries(ctx.t.chars).find(
    ([, c]) => c.name && bare(c.name) === bare(p.name),
  )?.[0];
  return k !== undefined ? { char: Number(k) } : { rec };
}

/** 持ち主の ID を、作らずに求める（決まっていなければ番号入りの仮の鍵）。同じ人物の人物ファイルを数えるのに使う */
function ownerKey(ctx: Context, o: Owner): string {
  const ids = ctx.t.ids;
  if ('id' in o) return o.id;
  if ('name' in o)
    return ids?.names[String(o.name)] ?? ctx.shared.nameIds.get(o.name) ?? `#n${o.name}`;
  if ('char' in o) {
    const fixed = ids?.chars[String(o.char)];
    if (fixed) return fixed;
    const n = ctx.t.chars[String(o.char)]?.name_id ?? o.char;
    if (n !== 0 && (ctx.t.names.find((x) => x.id === n)?.text.ja ?? '') !== '')
      return ownerKey(ctx, { name: n });
    return `#c${o.char}`;
  }
  if ('img' in o) return ctx.shared.profileIds.get(o.img) ?? `#i${o.img}`;
  return `#r${o.rec}`;
}

/** 持ち主の人物 ID（初めてなら作る。表に無ければ警告して仮の ID） */
function ownerId(ctx: Context, rec: number, o: Owner): string {
  if ('id' in o) {
    // 話し手の ID なら、話し手として作る（名札と文字送りの音を、人物ファイルの氏名より先に決める）
    const n = Object.entries(ctx.t.ids?.names ?? {}).find(([, v]) => v === o.id)?.[0];
    if (n !== undefined) speakerId(ctx, Number(n));
    return note(ctx, o.id, `profile:${rec}`);
  }
  if ('name' in o) return speakerId(ctx, o.name)!;
  if ('char' in o) return characterId(ctx, o.char);
  const warned = lookupId(ctx.t.ids, 'profiles', rec, ctx.shared.idWarnings);
  if (warned) return note(ctx, warned, `profile:${rec}`);
  if ('rec' in o) return note(ctx, `r${rec}`, `profile:${rec}`);
  // 2・3 で台詞の無い人物: 英語の名前から（同じ名前の絵の人物ファイルは同じ ID）
  const ids = ctx.shared.profileIds;
  let id = ids.get(o.img);
  if (!id) {
    const base = slug(o.en);
    const taken = new Set([...ctx.shared.nameIds.values(), ...ids.values()]);
    id = !base ? `r${rec}` : taken.has(base) || RESERVED_KEYS.has(base) ? `${base}_r${rec}` : base;
    ids.set(o.img, id);
  }
  return note(ctx, id, `profile:${rec}`);
}

/**
 * 法廷記録の人物ファイル → 人物 ID（人物の profile も書く）。持ち主は、対応表の profiles、2・3 は tables/profiles.json
 * （英語の名前と名札の対応）の話し手、蘇る逆転は氏名が chars.json と一致する人物。
 * 同じ人物の人物ファイルが章の中にいくつもあれば（説明が書き換わった版）、番号の小さいものから 人物 ID、人物 ID_v2、…
 */
export function profileId(ctx: Context, rec: number): string {
  const text = ctx.recordText(rec);
  const p = text ? parseProfileName(text.name) : { name: `人物ファイル ${rec}` };
  const owner = ownerOf(ctx, rec);
  const key = ownerKey(ctx, owner);
  const same = [...ctx.shared.chapterRecords]
    .filter(
      (r) =>
        r === rec || (ctx.shared.profileRecords.has(r) && ownerKey(ctx, ownerOf(ctx, r)) === key),
    )
    .sort((a, b) => a - b);
  const version = Math.max(0, same.indexOf(rec));
  const base = ownerId(ctx, rec, owner);
  const id = version ? note(ctx, `${base}_v${version + 1}`, `profile:${rec}`) : base;
  const ch = (version ? undefined : ctx.characters.get(id)) ?? { name: p.name };
  const name = 'char' in owner ? (ctx.t.chars[String(owner.char)]?.name ?? p.name) : p.name;
  ch.profile = {
    name,
    ...(p.age !== undefined ? { age: p.age } : {}),
    description: text?.desc ?? '',
    icon: `r${rec}`,
  };
  ctx.characters.set(id, ch);
  return id;
}
