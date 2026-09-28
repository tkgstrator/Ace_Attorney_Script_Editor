// 整合性チェックで、展開を待つ状態を小さな文字列に詰めて持つ（深さ優先で待つ状態が多くなっても、メモリを食わないように）。
// フラグは決まった並びの値だけにし（真偽は 1 文字）、visited・seen は ID の番号の文字にする。
import type { CompiledScenario, GameState, Value } from '@gyakusai/core';

const SEP = '\u0001';

export interface Packer {
  pack(s: GameState): string;
  unpack(text: string): GameState;
}

export function packer(sc: CompiledScenario): Packer {
  // フラグの並び（初めの値のあるもの。ほかのフラグが後から入ったときは、名前ごと残す）
  const flagNames = Object.keys(sc.flags);
  // visited・seen に入りうる ID（シーン・場所の ID と、調べる所・話題の ID）
  const ids = [...Object.keys(sc.scenes)];
  for (const scene of Object.values(sc.scenes))
    if (scene.kind === 'place') for (const x of [...scene.examine, ...scene.talk]) ids.push(x.id);
  const idIndex = new Map(ids.map((id, i) => [id, i]));
  const encIds = (list: string[]) =>
    list
      .map((id) => {
        const i = idIndex.get(id);
        return i === undefined ? SEP + id + SEP : String.fromCharCode(0x100 + i);
      })
      .join('');
  const decIds = (text: string) => {
    const out: string[] = [];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === SEP) {
        const j = text.indexOf(SEP, i + 1);
        out.push(text.slice(i + 1, j));
        i = j;
      } else out.push(ids[text.charCodeAt(i) - 0x100]!);
    }
    return out;
  };

  return {
    pack(s) {
      let flags = '';
      for (const n of flagNames) {
        const v = s.flags[n];
        flags += v === true ? 'T' : v === false ? 'F' : SEP + JSON.stringify(v ?? null) + SEP;
      }
      const extra = Object.keys(s.flags).filter((n) => !(n in sc.flags));
      const rest = {
        ...s,
        flags: undefined,
        visited: encIds(s.visited),
        seen: encIds(s.seen),
        extra: extra.map((n) => [n, s.flags[n]]),
      };
      return flags + SEP + SEP + JSON.stringify(rest);
    },
    unpack(text) {
      const cut = text.indexOf(SEP + SEP + '{');
      const flagText = text.slice(0, cut);
      const rest = JSON.parse(text.slice(cut + 2)) as GameState & {
        visited: string;
        seen: string;
        extra: [string, Value][];
      };
      const flags: Record<string, Value> = {};
      let at = 0;
      for (const n of flagNames) {
        const c = flagText[at];
        if (c === 'T' || c === 'F') {
          flags[n] = c === 'T';
          at++;
          continue;
        }
        const end = flagText.indexOf(SEP, at + 1);
        const v = JSON.parse(flagText.slice(at + 1, end)) as Value | null;
        if (v !== null) flags[n] = v;
        at = end + 1;
      }
      for (const [n, v] of rest.extra) flags[n] = v;
      const { extra: _, ...state } = rest;
      return {
        ...state,
        flags,
        visited: decIds(rest.visited),
        seen: decIds(rest.seen),
      } as GameState;
    },
  };
}
