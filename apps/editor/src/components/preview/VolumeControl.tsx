// プレビューの音量とミュート。音（getAudio）は章を切り替えても作り直しても同じものなので、ここで全体の音量を変える。
// 値はこのブラウザに覚えておく
import { Volume1, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { getAudio } from '@/preview/assets.ts';

interface Sound {
  /** 0〜100 */
  volume: number;
  muted: boolean;
}

const KEY = 'gyakusai:editor:sound';
const DEFAULT: Sound = { volume: 100, muted: false };

function load(): Sound {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Sound> | null;
    const volume = typeof v?.volume === 'number' ? Math.min(100, Math.max(0, v.volume)) : 100;
    return { volume, muted: v?.muted === true };
  } catch {
    return DEFAULT;
  }
}

export function VolumeControl() {
  const [sound, setSound] = useState(load);
  useEffect(() => {
    const audio = getAudio();
    audio.setVolume?.(sound.volume / 100);
    audio.setMuted?.(sound.muted);
    try {
      localStorage.setItem(KEY, JSON.stringify(sound));
    } catch {
      /* 覚えられなくてもよい */
    }
  }, [sound]);

  const silent = sound.muted || sound.volume === 0;
  const Icon = silent ? VolumeX : sound.volume < 50 ? Volume1 : Volume2;
  return (
    <fieldset
      className="m-0 ml-auto flex min-w-0 items-center gap-1.5 border-0 p-0"
      aria-label="音量"
      // 矢印キーでスライダーを動かしても、ゲーム（window でキーを聞いている）の操作にしない
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label="ミュート"
        aria-pressed={sound.muted}
        title={sound.muted ? '音を戻す' : '音を消す'}
        onClick={() => setSound((s) => ({ ...s, muted: !s.muted }))}
        className={cn(
          'rounded p-1 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          silent ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        <Icon className="size-4" aria-hidden />
      </button>
      <Slider
        className="w-20"
        aria-label="音量"
        min={0}
        max={100}
        step={5}
        value={[sound.volume]}
        onValueChange={([v]) => setSound((s) => ({ volume: v ?? s.volume, muted: false }))}
        title={`音量 ${sound.volume}%`}
      />
      <span className="w-8 text-right text-[11px] text-muted-foreground tabular-nums" aria-hidden>
        {sound.muted ? '消音' : `${sound.volume}%`}
      </span>
    </fieldset>
  );
}
