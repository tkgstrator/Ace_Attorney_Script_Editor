// 列の行に、並べ替え・追加の後も変わらないキーを付ける（model/row-keys.ts）
import { useRef } from 'react';
import { type Rows, reconcileRows } from '@/model/row-keys.ts';

export function useRows<T>(list: readonly T[]): Rows<T> {
  const ref = useRef<Rows<T> | null>(null);
  ref.current = reconcileRows(ref.current, list);
  return ref.current;
}
