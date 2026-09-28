// 章の基本情報（id・タイトル・操作する人物・ライフ・既定の反応・開始・ゲームオーバー）と、編の設定

import { useMemo } from 'react';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { extraRecordKeys } from '@/model/form-keys.ts';
import { partPath } from '@/model/paths.ts';
import { idList, profileIds } from '@/model/steps.ts';
import { PART_LABELS } from '@/model/structure.ts';
import { useActions, useData, useIds } from '@/state/editor-store.tsx';
import { ExtraFields } from './ExtraFields.tsx';
import {
  Field,
  IdChips,
  IdSelect,
  NumberInput,
  Section,
  TextInput,
  useCharacterLabels,
  useEvidenceLabels,
  useSetter,
} from './fields.tsx';
import { OptionalSteps } from './steps/flow-fields.tsx';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Rec) : {};

export function MetaEditor() {
  const data = useData();
  const ids = useIds();
  const { set, setOptional } = useSetter();
  const chars = useCharacterLabels();
  const evLabels = useEvidenceLabels();
  const d = rec(data);
  const start = rec(d.start);
  const profiles = useMemo(() => profileIds(d.characters), [d.characters]);
  const defaults = rec(d.defaults);
  return (
    <div className="space-y-8">
      <h2 className="text-lg font-semibold">基本情報</h2>
      <div className="grid grid-cols-2 gap-3">
        <Field label="章の ID">
          <TextInput path={['id']} value={d.id} mono />
        </Field>
        <Field label="タイトル">
          <TextInput path={['title']} value={d.title} />
        </Field>
        <Field label="操作する弁護士（player）">
          <IdSelect
            path={['player']}
            value={d.player}
            options={ids.characters}
            labels={chars}
            noneLabel="（指定なし）"
            onChange={(v) => setOptional(['player'], v ?? undefined)}
          />
        </Field>
        <Field label="ライフの最大値（既定 10）">
          <NumberInput path={['life']} value={d.life} optional min={1} />
        </Field>
      </div>

      <Section title="開始">
        <div className="grid grid-cols-2 gap-3">
          <Field label="最初のシーン">
            <IdSelect
              path={['start', 'scene']}
              value={start.scene}
              options={ids.scenes}
              onChange={(v) => v && set(['start', 'scene'], v)}
            />
          </Field>
          <Field label="ライフが尽きたときのシーン（gameover）">
            <IdSelect
              path={['gameover']}
              value={d.gameover}
              options={ids.scenes}
              noneLabel="（指定なし）"
              onChange={(v) => setOptional(['gameover'], v ?? undefined)}
            />
          </Field>
        </div>
        <Field label="最初から持っている証拠品">
          <IdChips
            path={['start', 'evidence']}
            aria-label="最初から持っている証拠品"
            value={idList(start.evidence)}
            options={ids.evidence}
            labels={evLabels}
            onChange={(v) => setOptional(['start', 'evidence'], v.length ? v : undefined)}
          />
        </Field>
        <Field label="最初から人物ファイルに載っている人物（何も選ばなければ、人物ファイルのある全員）">
          <IdChips
            path={['start', 'profiles']}
            aria-label="最初から人物ファイルに載っている人物"
            value={idList(start.profiles)}
            options={profiles}
            labels={chars}
            onChange={(v) => setOptional(['start', 'profiles'], v.length ? v : undefined)}
          />
        </Field>
      </Section>

      <Section title="既定の反応">
        <Field label="penalty: true のときに減るライフ（既定 2）" className="w-60">
          <NumberInput path={['defaults', 'penalty']} value={defaults.penalty} optional min={1} />
        </Field>
        <ExtraFields
          path={['defaults']}
          value={defaults}
          keys={extraRecordKeys(defaults, ['penalty', 'wrongPresent'])}
        />
        <OptionalSteps
          path={['defaults', 'wrongPresent']}
          value={defaults.wrongPresent}
          label="見当違いの証拠品をつきつけたとき（{evidence} に証拠品名が入る）"
          addLabel="既定の反応を追加"
        />
      </Section>
    </div>
  );
}

export function PartEditor({ index }: { index: number }) {
  const data = useData();
  const { edit } = useActions();
  const part = rec(((d) => (Array.isArray(d.parts) ? d.parts[index] : undefined))(rec(data)));
  const path = partPath(index);
  const scenes = Object.keys(rec(part.scenes));
  const places = Object.keys(rec(part.places));
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">編の設定</h2>
      <div className="grid grid-cols-3 gap-3">
        <Field label="種類">
          <NativeSelect
            size="sm"
            className="h-8 w-full"
            value={String(part.kind)}
            onChange={(e) => edit([{ op: 'set', path: [...path, 'kind'], value: e.target.value }])}
          >
            {Object.entries(PART_LABELS).map(([k, l]) => (
              <NativeSelectOption key={k} value={k}>
                {l}（{k}）
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field label="ID">
          <TextInput path={[...path, 'id']} value={part.id} mono />
        </Field>
        <Field label="タイトル">
          <TextInput path={[...path, 'title']} value={part.title} />
        </Field>
      </div>
      <p className="text-sm text-muted-foreground">
        シーン {scenes.length} 個{part.kind === 'investigation' ? `・場所 ${places.length} 個` : ''}
        。 シーン・場所は左の一覧から追加・編集できます。
        {part.kind === 'trial' &&
          places.length > 0 &&
          ' 裁判編に場所がありますが、場所は探索編でだけ使います。'}
      </p>
    </div>
  );
}
