// 逆転裁判6 の台本のうち、流れ・フラグ・法廷記録を変える命令。
import { type Ctx, flagName, type Step } from './convert.ts';

const bgmId = (n: number) => `bgm${String(n).padStart(3, '0')}`;

/** 当てはまらなければ null */
export function control(ctx: Ctx, name: string, args: number[]): Step[] | null {
  switch (name) {
    case 'E004':
      return ctx.jump(args[0]!);
    case 'E039':
      return ctx.end();
    case 'E031':
      return ctx.script(args[0]!, args[1]!);
    case 'E393':
      return ctx.freeRoam(args[0]!, args[1]!);
    case 'E392': {
      const f = flagName(args[0]!, args[1]!);
      ctx.flags.add(f);
      ctx.endFlag(f);
      return [];
    }
    case 'E386':
      ctx.mapPlace(args[1]!);
      return [];
    case 'E377':
    case 'E378':
      return ctx.topics(name === 'E378', args);
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
    // <E022 使う ラベル …>: 使う（1）ラベルの中から選ぶ。最後の「0 ラベル」は 1 つ前と同じ行き先の番兵。
    // 尋問の外れの反応（L_TUKI_NG00〜02）の選び方で、E249 と同じ
    case 'E022': {
      const to: number[] = [];
      for (let i = 0; i + 1 < args.length; i += 2)
        if (args[i] === 1 && !to.includes(args[i + 1]!)) to.push(args[i + 1]!);
      return to.length ? [{ random: to.map((n) => ctx.jump(n)) }] : null;
    }
    // 法廷記録に加える（<E107 種類 番号 ?>。続く <E103 番号> が「ファイルした」の知らせ）/ 差し替える（<E106 種類 旧 新>）。
    // <E101> は章の始めの持ち物を外す命令と思われるが、ファイル名の順につなぐ近似では取り直せず詰むので native に残す
    case 'E107': {
      const id = ctx.recordId(args[0]!, args[1]!);
      return id ? [{ [args[0] === 0 ? 'give' : 'giveProfile']: id }] : [];
    }
    case 'E103':
      return [];
    case 'E106': {
      const [from, to] = [ctx.recordId(args[0]!, args[1]!), ctx.recordId(args[0]!, args[2]!)];
      if (!from || !to || from === to) return [];
      return args[0] === 0
        ? [{ take: from }, { give: to }]
        : [{ takeProfile: from }, { giveProfile: to }];
    }
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
