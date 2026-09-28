// プレビューの「調べる」の目印（元のゲームにはない手助け）の切り替え。値はこのブラウザに覚えておく
import type { Player } from '@gyakusai/runtime';
import { useEffect, useId, useState } from 'react';
import { Switch } from '@/components/ui/switch';

const KEY = 'gyakusai:editor:examineMarkers';

function load(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

/** player: 今のプレビューの Player（まだ無ければ null。できたら、覚えておいた値を当てる） */
export function ExamineMarkersToggle({ player }: { player: Player | null }) {
  const id = useId();
  const [on, setOn] = useState(load);
  useEffect(() => {
    if (player) player.examineMarkers = on;
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch {
      /* 覚えられなくてもよい */
    }
  }, [player, on]);
  return (
    <span
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      title="探偵パートの「調べる」で、調べられる所に目印を出します（まだ調べていない所はひし形、調べた所はチェック）。元のゲームにはない表示です"
    >
      <Switch id={id} checked={on} onCheckedChange={setOn} />
      <label htmlFor={id}>調べる所の目印</label>
    </span>
  );
}
