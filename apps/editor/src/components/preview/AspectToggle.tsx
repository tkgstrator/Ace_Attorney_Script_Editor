// プレビューの画面の幅（4:3 / 16:9）の切り替え。値はこのブラウザに覚えておく（既定 4:3）
import type { Aspect } from '@gyakusai/runtime';
import { cn } from '@/lib/utils';
import { setAspect, useAspect } from '@/preview/aspect.ts';

const OPTIONS: [Aspect, string][] = [
  ['4:3', 'DS 版と同じ 256×192 ドット'],
  ['16:9', '342×192 ドット（部品は左右・中央に寄せ、背景と立ち絵は中央に置く）'],
];

export function AspectToggle() {
  const aspect = useAspect();
  return (
    <fieldset className="flex items-center gap-0.5 text-xs">
      <legend className="sr-only">画面の幅</legend>
      <span className="mr-1 text-muted-foreground">画面:</span>
      {OPTIONS.map(([a, title]) => (
        <button
          key={a}
          type="button"
          title={title}
          aria-pressed={aspect === a}
          onClick={() => setAspect(a)}
          className={cn(
            'rounded-full border px-2 py-0.5 tabular-nums',
            aspect === a
              ? 'border-primary bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent',
          )}
        >
          {a}
        </button>
      ))}
    </fieldset>
  );
}
