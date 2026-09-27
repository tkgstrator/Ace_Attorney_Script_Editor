// YAML のコンパイル（loadScenario）を UI とは別のスレッドで動かす。大きな章では 1〜2 秒かかるため
import { loadScenario, type CompileResult } from '@gyakusai/script';

export interface CompileRequest {
  id: number;
  text: string;
}

export type CompileResponse =
  | { id: number; ok: true; result: CompileResult; ms: number }
  | { id: number; ok: false; error: string };

self.onmessage = (e: MessageEvent<CompileRequest>) => {
  const { id, text } = e.data;
  const started = performance.now();
  let res: CompileResponse;
  try {
    res = { id, ok: true, result: loadScenario(text), ms: performance.now() - started };
  } catch (err) {
    res = { id, ok: false, error: (err as Error).message };
  }
  self.postMessage(res);
};
