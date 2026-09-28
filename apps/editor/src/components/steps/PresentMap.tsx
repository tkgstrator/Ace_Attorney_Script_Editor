// 「証拠品 ID（か人物 ID）→ ステップ列」のマップ（つきつけ）の編集。demand・証言・場所で使う。
// profiles: 人物ファイルも選べる表（demand・場所。証言では証拠品だけ）
import { Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { pathKey } from '@/model/paths.ts';
import { presentKeyOptions, profileIds } from '@/model/steps.ts';
import type { Path } from '@/model/yaml-doc.ts';
import { useActions, useEditorState, useIds } from '@/state/editor-store.tsx';
import { IdSelect, useCharacterLabels, useEvidenceLabels } from '../fields.tsx';
import { IconButton } from './StepCard.tsx';
import { StepList } from './StepList.tsx';

export function PresentMap({
  path,
  value,
  label = 'つきつけ',
  profiles = false,
}: {
  path: Path;
  value: unknown;
  label?: string;
  profiles?: boolean;
}) {
  const ids = useIds();
  const { edit } = useActions();
  const evidenceLabels = useEvidenceLabels();
  const characterLabels = useCharacterLabels();
  const characters = useEditorState((s) => s.data?.characters);
  const map =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const keys = Object.keys(map);
  const all = useMemo(
    () => presentKeyOptions(ids.evidence, profileIds(characters), profiles),
    [ids.evidence, characters, profiles],
  );
  const unused = all.filter((k) => !keys.includes(k.id));
  // 種類と表示名を一緒に出す（人物ファイルは「人物: 名前」）
  const labels = useMemo(
    () =>
      Object.fromEntries(
        all.map((o) => [
          o.id,
          o.kind === 'profile'
            ? `人物: ${characterLabels[o.id] ?? o.id}`
            : `証拠品: ${evidenceLabels[o.id] ?? o.id}`,
        ]),
      ),
    [all, characterLabels, evidenceLabels],
  );
  const kindOf = (id: string) => all.find((k) => k.id === id)?.kind;
  return (
    <div className="space-y-2">
      {keys.map((k) => (
        <div
          key={k}
          className="rounded-md border border-dashed border-amber-400/70 p-2"
          data-path={pathKey([...path, k])}
        >
          <div className="mb-1 flex items-center gap-1">
            <span className="text-xs text-muted-foreground">
              {label}
              {kindOf(k) === 'profile' ? '（人物ファイル）' : ''}:
            </span>
            <IdSelect
              value={k}
              options={all.map((o) => o.id)}
              labels={labels}
              aria-label={profiles ? `${label}の証拠品・人物` : `${label}の証拠品`}
              onChange={(to) => {
                if (to && to !== k) edit([{ op: 'renameKey', path, from: k, to }]);
              }}
            />
            <IconButton
              title={`${labels[k] ?? k} を消す`}
              className="ml-auto hover:text-destructive"
              onClick={() => edit([{ op: 'delete', path: [...path, k] }])}
            >
              <Trash2 />
            </IconButton>
          </div>
          <StepList path={[...path, k]} steps={map[k]} />
        </div>
      ))}
      {unused.length > 0 && (
        <NativeSelect
          size="sm"
          className="h-7 w-56 text-xs"
          value=""
          aria-label={profiles ? 'つきつける証拠品・人物を追加' : 'つきつける証拠品を追加'}
          onChange={(e) => {
            if (e.target.value) edit([{ op: 'set', path: [...path, e.target.value], value: [] }]);
          }}
        >
          <NativeSelectOption value="">
            ＋ {label}の{profiles ? '証拠品・人物' : '証拠品'}を追加…
          </NativeSelectOption>
          {unused.map((o) => (
            <NativeSelectOption key={o.id} value={o.id}>
              {labels[o.id] ?? o.id}（{o.id}）
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )}
    </div>
  );
}
