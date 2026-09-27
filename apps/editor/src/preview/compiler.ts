// コンパイル用の Web Worker（compile.worker.ts）を 1 つ持ち、頼んだ順に結果を返す
import type { CompileResult } from '@gyakusai/script';
import type { CompileRequest, CompileResponse } from './compile.worker.ts';

export class Compiler {
  private worker: Worker | null = null;
  private serial = 0;
  private waiting = new Map<number, { resolve: (r: CompileResult) => void; reject: (e: Error) => void }>();

  compile(text: string): Promise<CompileResult> {
    if (!this.worker) {
      const w = new Worker(new URL('./compile.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<CompileResponse>) => {
        const r = e.data;
        const p = this.waiting.get(r.id);
        this.waiting.delete(r.id);
        if (r.ok) p?.resolve(r.result);
        else p?.reject(new Error(r.error));
      };
      w.onerror = e => {
        for (const p of this.waiting.values()) p.reject(new Error(e.message || 'コンパイル中にエラーが起きました'));
        this.waiting.clear();
        this.dispose();
      };
      this.worker = w;
    }
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.worker!.postMessage({ id, text } satisfies CompileRequest);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
