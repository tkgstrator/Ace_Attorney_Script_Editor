// 「ここから再生」の頼み方。編集画面のボタン（シーン・ステップ・証言・場所）から App を通してプレビューへ渡す
import { createContext, useContext } from 'react';
import type { Path } from '@/model/yaml-doc.ts';

export type PlayFrom =
  /** シーンの頭から（フラグ・証拠品などは最初の状態） */
  | { kind: 'scene'; scene: string }
  /**
   * 編集画面の位置（ステップ・証言・場所のパス）から。label はプレビューに出す名前。
   * fresh: 最初の状態で（既定は、今プレビューで遊んでいる状態を保つ）
   */
  | { kind: 'path'; path: Path; label: string; fresh: boolean };

const PlayFromContext = createContext<(req: PlayFrom) => void>(() => {});

export const PlayFromProvider = PlayFromContext.Provider;

/** 「ここから再生」を頼む関数（プレビューを出し、今の内容でコンパイルしてから遊ぶ） */
export const usePlayFrom = () => useContext(PlayFromContext);
