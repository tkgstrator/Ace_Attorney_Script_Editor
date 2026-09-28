// 整合性チェック（verifyScenario）を UI とは別のスレッドで動かす。重いので、テキストを受け取ってここでコンパイルから行う
import { loadScenario, verifyScenario, type VerifyResult } from '@gyakusai/script';

export interface VerifyRequest {
  id: number;
  text: string;
}

export type VerifyResponse =
  /** 途中経過（調べた状態の数） */
  | { id: number; progress: number }
  | { id: number; ok: true; result: VerifyResult; ms: number }
  | { id: number; ok: false; error: string };

self.onmessage = (e: MessageEvent<VerifyRequest>) => {
  const { id, text } = e.data;
  const started = performance.now();
  let res: VerifyResponse;
  try {
    const { scenario } = loadScenario(text);
    if (!scenario)
      res = { id, ok: false, error: 'コンパイルに失敗しているため、チェックできません' };
    else {
      const onProgress = (states: number) =>
        self.postMessage({ id, progress: states } satisfies VerifyResponse);
      const result = verifyScenario(scenario, { onProgress, progressEvery: 20_000 });
      res = { id, ok: true, result, ms: performance.now() - started };
    }
  } catch (err) {
    res = { id, ok: false, error: (err as Error).message };
  }
  self.postMessage(res);
};
