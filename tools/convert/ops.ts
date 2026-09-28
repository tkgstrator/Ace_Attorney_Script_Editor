// 流れを変えない命令（演出・人物・背景・音・法廷記録など）の変換。
import type { Context } from './context.ts';
import {
  BG_NONE,
  bgKey,
  charArg,
  DEFAULT_FLASH,
  fadeOf,
  flagArg,
  isStandKey,
  nameArg,
  native,
  recordArg,
  SHOUT_FRAMES,
  shoutKind,
} from './mapping.ts';
import { dsEffect } from './ops-ds.ts';
import type { How } from './stats.ts';
import type { CmdOp, Step } from './types.ts';
import type { Writer } from './writer.ts';

/** 変換の手（section.ts が作る）。put = ステップ、putInline = 文中にできれば文中コマンド */
export interface Hands {
  w: Writer;
  put(s: Step, how?: How): void;
  putInline(cmd: string, s: Step): void;
  /** 次に出る名前の番号（吹き出しの主を決める） */
  nextSpeaker(): number;
}

/** 何もしない命令（nop・引数を読み飛ばすだけのもの） */
const IGNORED = new Set([
  0, 37, 96, 97, 98, 99, 100, 102, 103, 108, 109, 110, 112, 113, 114, 115, 124, 125, 126, 127,
]);

/** 状態を覚えておく（BGM の再開に使う） */
export interface Memory {
  bgm: string | null;
  char: { id: string; talk: number; idle: number } | null;
  ds107: number[];
  /** 出ている重ね絵（47）→ 自分で消えるまでの背景の切り替えの回数（60〜143 は 1 回目、144〜183 は 2 回目で消える） */
  overlays: Map<number, number>;
  /** 62 で決めた、写真の一点を指す問題の番号 */
  point: number | null;
}
export const newMemory = (): Memory => ({
  bgm: null,
  char: null,
  ds107: [0, 0, 0],
  overlays: new Map(),
  point: null,
});

/** 背景を替える前に、そこで自分で消える重ね絵を消す */
function expireOverlays(h: Hands, mem: Memory) {
  for (const [n, left] of [...mem.overlays]) {
    if (left <= 1) {
      h.put({ overlay: n, off: true }, 'structure');
      mem.overlays.delete(n);
    } else mem.overlays.set(n, left - 1);
  }
}

export function simpleOp(o: CmdOp, ctx: Context, h: Hands, mem: Memory, section: number): void {
  const { w } = h;
  const a = o.args;
  const st = ctx.stats;
  if (IGNORED.has(o.op)) {
    st.hit(o.name, 'ignored');
    return;
  }
  switch (o.op) {
    case 1: // 改行
      if (w.inline('\n')) st.hit(o.name, 'inline');
      else st.hit(o.name, 'ignored');
      return;
    case 3:
      w.color(a[0]!);
      return;
    case 11:
      w.speed(a[0] === 255 ? 3 : a[0]!);
      return;
    case 12:
      w.wait(a[0]! & 0xff);
      return;
    case 78: // 黙る動きにして待つ
      st.gap('口を閉じて待つ（78 wait_idle）を普通の待ちにした', section);
      w.wait(a[0]!);
      st.hit(o.name, 'approx');
      return;
    case 14: {
      const n = nameArg(a[0]!);
      if (w.open && n !== w.st.speaker) st.gap('台詞の途中で名前が変わる（14 name）', section);
      w.st.speaker = n;
      w.st.blip = ctx.t.blipKinds[n] ?? 0;
      ctx.speaker(n);
      if (a[0]! & 0xff) h.put(native(o.name, a));
      else st.hit(o.name, 'structure');
      return;
    }
    case 29: {
      // 背景のスクロール: (向き << 8) | 速さ。0 左・1 右・2 上・3 下
      const dir = a[0]! >> 8,
        v = a[0]! & 0xff;
      h.put({ scroll: dir < 2 ? { x: dir === 0 ? -v : v } : { y: dir === 2 ? -v : v } });
      return;
    }
    case 62:
      mem.point = a[0]!;
      st.hit(o.name, 'structure');
      return;
    case 48:
      w.blip(a[0]!);
      return;
    case 66:
      w.blip(null, a[0] === 1);
      return;
    case 93: // 揃え: 1（中央）は日時・場所の表示（card）で表す。2（1 行の特別な位置）は未対応
      w.st.align = a[0]!;
      if (a[0] === 2) h.put(native(o.name, a), 'native');
      else st.hit(o.name, 'structure');
      return;
    case 39:
      h.put({ shake: a[0]! || true, ...(a[1] ? { strength: Math.min(2, a[1]) } : {}) });
      return;
    case 6: {
      if (a[1] === 0) {
        h.put(native(o.name, a));
        return;
      }
      h.put({ se: ctx.sound(a[0]!) });
      return;
    }
    case 5:
      if (a[0] === 255) {
        h.put({ bgmPause: false, ...(a[1] ? { frames: a[1] } : {}) });
        return;
      } // 一時停止中の曲の再開
      mem.bgm = ctx.sound(a[0]!);
      h.put({ bgm: mem.bgm, ...(a[1] ? { frames: a[1] } : {}) });
      return;
    case 34:
      h.put({ bgmPause: true, ...(a[1] ? { frames: a[1] } : {}) });
      return; // 消していって一時停止
    case 35:
      h.put({ bgmPause: a[1] === 0 });
      return;
    case 18: {
      const f = fadeOf(a, w.cover);
      if (f.kind === 'flash') {
        h.put(f.frames === DEFAULT_FLASH ? { flash: true } : { flash: true, frames: f.frames });
        return;
      }
      if (f.kind === 'native') {
        h.put(native(o.name, a));
        return;
      }
      // 元のフェードは止まらない（後の wait と重なる）
      h.put({
        fade: f.dir,
        ...(f.color === 'white' ? { color: 'white' } : {}),
        frames: f.frames,
        nowait: true,
      });
      w.cover = f.dir === 'out' ? f.color : null;
      return;
    }
    case 28: // 文字の枠: 0 出す、1 / 4 隠す、3 探偵のメニュー（section.ts）
      if (a[0] === 0 || a[0] === 1 || a[0] === 4) {
        h.put({ textbox: a[0] === 0 });
        return;
      }
      if (a[0] === 3 && ctx.inv) {
        st.hit(o.name, 'structure');
        return;
      }
      h.put(native(o.name, a));
      return;
    case 38:
      h.put({ ui: { record: a[0] === 0 } });
      return;
    case 67:
      h.put({ ui: { life: a[0] === 1 } });
      return;
    case 30: {
      if (a[0] === 0) {
        h.put({ show: null });
        mem.char = null;
        if (ctx.inv) h.put({ set: { [ctx.personFlag()]: 0 } }, 'structure');
        return;
      }
      const c = charArg(a[0]!);
      const id = ctx.character(c.id);
      mem.char = { id, talk: a[1]!, idle: a[2]! };
      h.put({ show: id, talk: a[1]!, ...(a[2] !== a[1] ? { idle: a[2]! } : {}) });
      // 探偵パートでは、今出ている人物（話す・つきつけるの相手）を覚える
      if (ctx.inv) h.put({ set: { [ctx.personFlag()]: c.id } }, 'structure');
      if (c.left || c.right || c.flip) {
        st.gap('人物の位置・反転（30 char の 0x8000/0x4000/0x2000）', section);
        h.put(native('char_flags', [a[0]! & 0xe000]), 'native');
      }
      return;
    }
    case 26: {
      // 法廷の視点の流し (組, 向き, 人物, 動き)
      const [g = 0, dir = 0, who = 0, anim = 0] = a;
      const c = charArg(who);
      h.put({
        pan: 2 * g + (dir & 1),
        to: who ? ctx.character(c.id) : null,
        ...(who ? { talk: anim, idle: anim } : {}),
      });
      return;
    }
    case 27: {
      expireOverlays(h, mem);
      const b = bgKey(a[0]!);
      h.put({ location: b.key });
      if (mem.char && a[0] !== BG_NONE && isStandKey(b.key)) ctx.voteStand(mem.char.id, b.key);
      if (b.alt) h.put(native('bg_alt', [a[0]!]), 'native');
      return;
    }
    case 77: {
      // 背景 + 手前の層（面会室のガラス）
      expireOverlays(h, mem);
      const b = bgKey(a[0]!);
      h.put({ location: b.key }, 'approx');
      h.put(native(o.name, a), 'native');
      return;
    }
    case 19:
      h.put({
        showEvidence: ctx.evidenceId(a[0]! & 0xff),
        ...(a[0]! >> 8 ? { side: 'right' } : {}),
      });
      return;
    case 95: // 色の効果: 3 = 白黒へ（回想の始まり）、4 = 元へ。ほかは未対応
      if (a[0] === 3 || a[0] === 4) h.put({ palette: a[0] === 3 ? 'grayscale' : 'normal' });
      else h.put(native(o.name, a));
      return;
    case 49: {
      // 人物の半透明のフェード: 1 出す / 4 消す（下位 8 ビット）、16 × 間隔 フレーム
      const kind = a[0]! & 0xff,
        frames = 16 * Math.max(1, a[1]!);
      if (a[0]! >> 8) {
        h.put(native(o.name, a));
        return;
      } // 別の部品
      if (kind & 4) {
        h.put({ show: null, frames });
        return;
      }
      if (kind & 1 && mem.char) {
        const c = mem.char;
        h.put({ show: c.id, talk: c.talk, ...(c.idle !== c.talk ? { idle: c.idle } : {}), frames });
        return;
      }
      h.put(native(o.name, a));
      return;
    }
    case 20:
      h.put({ showEvidence: null });
      return;
    case 118:
      // 第 5 話だけで使う、下画面（3D で調べる画面など）の茜の顔の小窓（番号 0〜14 = 表情）。証拠品ではないので出さない
      ctx.stats.hit(o.name, 'ignored');
      ctx.stats.gap('茜の顔の小窓（118 ds_show_item、第 5 話の下画面）を出さない', section);
      return;
    case 23:
    case 24: {
      const r = recordArg(a[0]!);
      if (r.kind === 'profile') {
        h.put({ [o.op === 23 ? 'giveProfile' : 'takeProfile']: ctx.profile(r.id) });
        return;
      }
      h.put({ [o.op === 23 ? 'give' : 'take']: ctx.evidenceId(r.id) });
      if (!r.notice && o.op === 23) st.gap('証拠品を黙って加える（23 の bit14 なし）', section);
      return;
    }
    case 25: {
      // 新しい方は古い方と同じ一覧（証拠品 / 人物ファイル）に入る（bit15 は古い方だけに付く）
      const from = recordArg(a[0]!),
        to = { ...recordArg(a[1]!), kind: recordArg(a[0]!).kind };
      const id = (r: typeof from) =>
        r.kind === 'profile' ? ctx.profile(r.id) : ctx.evidenceId(r.id);
      h.put({ [from.kind === 'profile' ? 'takeProfile' : 'take']: id(from) });
      h.put({ [to.kind === 'profile' ? 'giveProfile' : 'give']: id(to) });
      st.gap('法廷記録の入れ替えで並びを保つ（25 record_swap）', section);
      return;
    }
    case 16: {
      const f = flagArg(a[0]!);
      h.put({ set: { [ctx.fname(f.group, f.index)]: f.value } });
      return;
    }
    case 43:
      h.put({ penalty: 1 });
      return;
    case 51: {
      // 移動先の書き換え → その場所の行き先の版
      if (!ctx.inv) {
        h.put(native(o.name, a));
        return;
      }
      const [p, ...d] = a;
      const dest = d.filter((x) => x !== 255).join();
      const k = (ctx.moveVersions.get(p!) ?? []).findIndex((v) => v.join() === dest);
      h.put({ set: { [ctx.flag(`${ctx.gpfx}mv_${p}`, 0)]: Math.max(0, k) } });
      return;
    }
    case 55: // 話題の項目の有効・無効
      if (!ctx.inv) {
        h.put(native(o.name, a));
        return;
      }
      h.put({
        set: {
          [ctx.flag(
            `${ctx.gpfx}talk_${a[0]}`,
            !!ctx.inv.talk.find((t: { id: number }) => t.id === a[0])?.active,
          )]: a[1] === 1,
        },
      });
      return;
    case 50: // 場所の背景の書き換え
      st.gap('場所の背景を途中で変える（50 place_byte）', section);
      h.put(native(o.name, a));
      return;
    case 47: {
      const k = shoutKind(a[0]!);
      if (k && a[1] === 1) {
        const by = ctx.speaker(h.nextSpeaker());
        h.put({ shout: k, ...(by ? { by } : {}) });
        w.absorb = SHOUT_FRAMES;
        return;
      }
      if (k && a[1] === 0) {
        st.hit(o.name, 'structure');
        return;
      } // 吹き出しは自分で消える
      // 重ね絵（法廷の全景・木槌など）
      const n = a[0]!;
      if (a[1] === 1) {
        h.put({ overlay: n });
        if (n >= 60 && n <= 143) mem.overlays.set(n, 1);
        else if (n >= 144 && n <= 183) mem.overlays.set(n, 2);
      } else {
        h.put({ overlay: n, off: true });
        mem.overlays.delete(n);
      }
      return;
    }
    case 68: // 判決の文字
      h.put({ banner: a[0] === 0 ? '無罪' : '有罪' }, 'approx');
      h.put(native(o.name, a), 'native');
      return;
    case 107:
      mem.ds107 = [...a];
      st.hit(o.name, 'structure');
      return;
    case 105:
      dsEffect(o, ctx, h, mem, section);
      return;
    default:
      h.put(native(o.name, a));
  }
}
