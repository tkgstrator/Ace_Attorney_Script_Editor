// プレビューのゲームの下のボタン。再読み込み（続きから）・最初から・「ここから再生」で選んだ所から・状態を保ってシーンへ移る。
// どれも、何をどこから始め直すかをツールチップで示す
import type { CompiledScenario, PlayTarget } from '@gyakusai/core';
import { Loader2, Play, RefreshCw, RotateCcw, SkipForward } from 'lucide-react';
import { type ReactElement, useId } from 'react';
import { Button } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** どこから遊び直すか */
export type Restart =
  /** 今の場面・状態のまま、新しい内容で続ける */
  | { kind: 'continue' }
  /** 最初から（状態も初期） */
  | { kind: 'start' }
  /** シーンの頭から（状態は初期） */
  | { kind: 'scene'; scene: string }
  /** 状態を保ったまま、シーンの頭から */
  | { kind: 'jump'; scene: string }
  /**
   * 編集画面で選んだ位置から（ステップ・証言・場所の「ここから再生」）。fresh: 最初の状態で（既定は状態を保つ）。
   * exact: 選んだステップそのものか（false なら、それを含む所）。base: 位置を決めたときの内容（編集の後は合わせ直す）
   */
  | {
      kind: 'at';
      target: PlayTarget;
      fresh: boolean;
      label: string;
      exact: boolean;
      base: CompiledScenario;
    };

/** 「ここから再生」で最後に選んだ所（もう一度そこから遊ぶボタンにする） */
export interface From {
  label: string;
  how: Extract<Restart, { kind: 'scene' | 'at' }>;
}

interface Props {
  compiling: boolean;
  /** 最後の編集より前の内容で遊んでいるか */
  stale: boolean;
  /** 「ここから再生」で最後に選んだ所 */
  from: From | null;
  /** 移れるシーン（コンパイル結果の順） */
  scenes: string[];
  auto: boolean;
  onAuto: (on: boolean) => void;
  large: boolean;
  onReload: (how: Restart) => void;
}

function Tip({ text, children }: { text: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="max-w-64">{text}</TooltipContent>
    </Tooltip>
  );
}

export function PlayControls({
  compiling,
  stale,
  from,
  scenes,
  auto,
  onAuto,
  large,
  onReload,
}: Props) {
  const autoId = useId();
  const jumpId = useId();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tip text="今の内容でコンパイルし直して、遊んでいた場面の続きから遊びます。フラグ・証拠品・ライフなどはそのまま（台詞の途中なら、その台詞の最初から）">
        <Button
          size="sm"
          variant={stale ? 'default' : 'outline'}
          className="h-7 text-xs"
          disabled={compiling}
          onClick={() => onReload({ kind: 'continue' })}
        >
          {compiling ? <Loader2 className="animate-spin" /> : <RefreshCw />} 再読み込み
        </Button>
      </Tip>
      <Tip text="今の内容でコンパイルし直して、章の最初から遊びます（フラグ・証拠品なども最初の状態）">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={compiling}
          onClick={() => onReload({ kind: 'start' })}
        >
          <RotateCcw /> 最初から
        </Button>
      </Tip>
      {from && (
        <Tip
          text={
            from.how.kind === 'scene'
              ? `今の内容でコンパイルし直して、シーン「${from.label}」の頭から遊びます（フラグ・証拠品などは最初の状態）`
              : `今の内容でコンパイルし直して、${from.label} からもう一度遊びます（${from.how.fresh ? 'フラグ・証拠品などは最初の状態' : 'フラグ・証拠品などは今の状態のまま'}）`
          }
        >
          <Button
            size="sm"
            variant="outline"
            className="h-7 max-w-48 text-xs"
            disabled={compiling}
            onClick={() => onReload(from.how)}
          >
            <Play /> <span className="truncate">{from.label} から</span>
          </Button>
        </Tip>
      )}
      {scenes.length > 1 && (
        <Tip text="フラグ・証拠品・ライフなどを今のまま保って、選んだシーンの頭へ移ります（今の内容でコンパイルし直します）">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <SkipForward className="size-3.5" aria-hidden />
            <label htmlFor={jumpId} className="sr-only">
              状態を保ってシーンへ移る
            </label>
            <NativeSelect
              id={jumpId}
              size="sm"
              className="h-7 max-w-40 py-0 text-xs"
              value=""
              disabled={compiling}
              onChange={(e) => {
                if (e.target.value) onReload({ kind: 'jump', scene: e.target.value });
              }}
            >
              <NativeSelectOption value="">状態を保って移る…</NativeSelectOption>
              {scenes.map((id) => (
                <NativeSelectOption key={id} value={id}>
                  {id}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </span>
        </Tip>
      )}
      <span
        className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground"
        title={
          large
            ? '大きな章では、コンパイルは「再読み込み」を押したときだけ行います。コンパイルしたら、続きから遊べるように作り直します'
            : '打ち終わってコンパイルしたら、遊んでいた場面の続きから作り直します'
        }
      >
        <Switch id={autoId} checked={auto} onCheckedChange={onAuto} />
        <label htmlFor={autoId}>
          {large ? 'コンパイルしたら作り直す' : '編集したら再読み込み'}
        </label>
      </span>
    </div>
  );
}
