// セーブデータの保存先。ゲームは SaveStore だけを使い、実際の保存先（ブラウザの localStorage、
// 実行ファイルにしたときのファイルなど）は差し替えられるようにする。
import type { Snapshot } from '@gyakusai/core';

export interface SaveStore {
  load(slot: string): Promise<Snapshot | null>;
  save(slot: string, data: Snapshot): Promise<void>;
  remove(slot: string): Promise<void>;
}

export class SaveError extends Error {}

/** 読み込んだ値がセーブデータの形か確かめる（別の章のものならエラー） */
export function parseSnapshot(value: unknown, scenarioId?: string): Snapshot {
  const v = value as Partial<Snapshot> | null;
  if (
    !v ||
    typeof v !== 'object' ||
    v.version !== 1 ||
    typeof v.scenario !== 'string' ||
    typeof v.state !== 'object' ||
    !v.state
  ) {
    throw new SaveError('セーブデータの形ではありません');
  }
  if (scenarioId !== undefined && v.scenario !== scenarioId)
    throw new SaveError(`別の章のセーブデータです（${v.scenario}）`);
  return v as Snapshot;
}

/**
 * ブラウザの localStorage に保存する。キーは「prefix:slot」。
 * プライベートウィンドウなどで使えないときは、書き込みで SaveError になる
 */
export function localStorageStore(prefix: string): SaveStore {
  const key = (slot: string) => `${prefix}:${slot}`;
  return {
    async load(slot) {
      let raw: string | null;
      try {
        raw = localStorage.getItem(key(slot));
      } catch {
        return null;
      }
      return raw ? parseSnapshot(JSON.parse(raw)) : null;
    },
    async save(slot, data) {
      try {
        localStorage.setItem(key(slot), JSON.stringify(data));
      } catch {
        throw new SaveError('ブラウザの保存領域が使えません');
      }
    },
    async remove(slot) {
      try {
        localStorage.removeItem(key(slot));
      } catch {
        /* 使えなければ消すものもない */
      }
    },
  };
}

/** セーブデータを JSON ファイルとして書き出す（ダウンロード） */
export function downloadSnapshot(data: Snapshot, fileName = `${data.scenario}.save.json`): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** ファイルを選ばせてセーブデータを読み込む（選ばなければ null） */
export function pickSnapshotFile(scenarioId?: string): Promise<Snapshot | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      try {
        resolve(parseSnapshot(JSON.parse(await file.text()), scenarioId));
      } catch (e) {
        reject(e instanceof SaveError ? e : new SaveError('JSON として読めません'));
      }
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
