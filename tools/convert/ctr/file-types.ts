// 台本 1 ファイルの変換器が使う型。
import type { Ctx, Step } from './convert.ts';

export type Shared = Omit<
  Ctx,
  | 'jump'
  | 'end'
  | 'reveal'
  | 'game'
  | 'choicesAt'
  | 'endInvest'
  | 'callLocal'
  | 'freeRoam'
  | 'pointOut'
  | 'spotName'
  | 'endFlag'
> & {
  /** ファイル → その終わりで行う法廷記録の増減 */
  gains: Map<string, Step[]>;
  /** 話の番号 - 1（sce00 → 0） */
  ep: number;
  /** 探偵パートの入口を探索編にする */
  investigate: (
    file: string,
    hub: { chap: number; scene: number },
    end: Step[],
    place: number,
    others: number[],
    endFlags: string[],
  ) => Step[];
};

export type FileResult = {
  scenes: [string, Step[] | Record<string, unknown>][];
  gameover: string | null;
  /** 元の台本のほかのブロックから飛び先にされているラベルのシーン ID */
  origRef: string[];
};
