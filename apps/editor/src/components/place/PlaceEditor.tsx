// 探索編の「場所」の編集
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { extraRecordKeys } from '@/model/form-keys.ts';
import { pathKey } from '@/model/paths.ts';
import type { Path } from '@/model/yaml-doc.ts';
import { useActions, useIds } from '@/state/editor-store.tsx';
import { ExtraFields } from '../ExtraFields.tsx';
import {
  CondInput,
  Field,
  IdSelect,
  Section,
  TextInput,
  useCharacterLabels,
  useSetter,
} from '../fields.tsx';
import { OptionalSteps } from '../steps/flow-fields.tsx';
import { PresentMap } from '../steps/PresentMap.tsx';
import { IconButton } from '../steps/StepCard.tsx';
import { useRows } from '../use-rows.ts';
import { type Area, AreaCanvas } from './AreaCanvas.tsx';
import { asArea, ExamineList, MoveList, TalkList } from './place-lists.tsx';

type Rec = Record<string, unknown>;

export function PlaceEditor({ path, id, place }: { path: Path; id: string; place: Rec }) {
  const { edit } = useActions();
  const { setOptional } = useSetter();
  const [selected, setSelected] = useState<number | null>(null);
  const examine = Array.isArray(place.examine) ? (place.examine as Rec[]) : [];
  const talk = Array.isArray(place.talk) ? (place.talk as Rec[]) : [];
  const move = Array.isArray(place.move) ? place.move : [];
  const background =
    typeof place.background === 'string' && place.background ? place.background : id;

  const createArea = (area: Area) => {
    edit([
      {
        op: 'insert',
        path: [...path, 'examine'],
        // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
        value: { name: `範囲 ${examine.length + 1}`, area, then: [] },
      },
    ]);
    setSelected(examine.length);
  };

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3">
        <Field label="場所の名前（「移動する」などに出る）">
          <TextInput path={[...path, 'name']} value={place.name} />
        </Field>
        <Field label="背景のキー（省略すると場所の ID）">
          <Input
            className="h-8 font-mono text-xs"
            data-path={pathKey([...path, 'background'])}
            value={typeof place.background === 'string' ? place.background : ''}
            placeholder={id}
            onChange={(e) => setOptional([...path, 'background'], e.target.value, true)}
          />
        </Field>
      </div>

      <Section title="いる人物">
        <PersonEditor path={[...path, 'person']} value={place.person} />
      </Section>

      <Section title="入ったとき">
        <OptionalSteps
          path={[...path, 'enter']}
          value={place.enter}
          label="enter: この場所に来るたびに実行（初回だけなら if: not visited(ID)）"
          addLabel="入ったときの処理を追加"
        />
      </Section>

      <Section title={`調べる（${examine.length}）`}>
        <p className="text-xs text-muted-foreground">
          背景の上をドラッグすると新しい範囲を描きます。範囲はドラッグで移動、右下の角で大きさを変えられます。重なっているときは先に書いたものが優先です。座標は背景の座標で、横長の背景は全体を縮めて表示します（点線は画面の幅。ゲームでは調べる間に背景をスクロールします）。
        </p>
        <AreaCanvas
          background={background}
          items={examine.map((e, i) => ({
            area: asArea(e.area),
            label:
              typeof e.name === 'string'
                ? e.name
                : typeof e.id === 'string'
                  ? e.id
                  : `範囲 ${i + 1}`,
          }))}
          selected={selected}
          onSelect={setSelected}
          onChange={(i, area) =>
            edit([{ op: 'set', path: [...path, 'examine', i, 'area'], value: area }])
          }
          onCreate={createArea}
        />
        <ExamineList
          path={[...path, 'examine']}
          items={examine}
          selected={selected}
          onSelect={setSelected}
        />
        <Button
          variant="outline"
          size="sm"
          className="h-7"
          onClick={() => createArea([96, 64, 64, 64])}
        >
          <Plus /> 範囲を追加
        </Button>
        <OptionalSteps
          path={[...path, 'examineDefault']}
          value={place.examineDefault}
          label="何もない所を調べたとき"
          addLabel="何もない所を調べたときの反応を追加"
        />
      </Section>

      <Section title={`話す（${talk.length}）`}>
        <TalkList path={[...path, 'talk']} items={talk} />
      </Section>

      <Section title="つきつける">
        <PresentMap path={[...path, 'present']} value={place.present} profiles />
        <OptionalSteps
          path={[...path, 'presentWrong']}
          value={place.presentWrong}
          label="ほかの証拠品・人物ファイルをつきつけたとき"
          addLabel="ほかの証拠品への反応を追加"
        />
      </Section>

      <Section title="移動する">
        <MoveList path={[...path, 'move']} items={move} self={id} />
      </Section>
      <ExtraFields
        path={path}
        value={place}
        keys={extraRecordKeys(place, [
          'name',
          'background',
          'person',
          'enter',
          'examine',
          'examineDefault',
          'talk',
          'present',
          'presentWrong',
          'move',
        ])}
      />
    </div>
  );
}

/** 人物: 1 人（ID）か、条件つきの一覧（when が真の最初の人物） */
function PersonEditor({ path, value }: { path: Path; value: unknown }) {
  const ids = useIds();
  const { edit } = useActions();
  const { set, setOptional } = useSetter();
  const labels = useCharacterLabels();
  if (!Array.isArray(value)) {
    return (
      <div className="flex items-center gap-2">
        <IdSelect
          value={value}
          options={ids.characters}
          labels={labels}
          noneLabel="（誰もいない）"
          aria-label="いる人物"
          onChange={(v) => setOptional(path, v ?? undefined)}
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground"
          onClick={() =>
            set(path, [
              { id: typeof value === 'string' ? value : (ids.characters[0] ?? 'character') },
            ])
          }
        >
          条件で切り替える
        </Button>
      </div>
    );
  }
  return <PersonRows path={path} rows={value as Rec[]} />;
}

function PersonRows({ path, rows }: { path: Path; rows: Rec[] }) {
  const ids = useIds();
  const { edit } = useActions();
  const { set, setOptional } = useSetter();
  const labels = useCharacterLabels();
  const keyed = useRows(rows);
  return (
    <div className="space-y-1">
      {keyed.items.map((r, i) => (
        <div
          key={keyed.keys[i]}
          className="flex items-center gap-1"
          data-path={pathKey([...path, i])}
        >
          <IdSelect
            path={[...path, i, 'id']}
            value={r.id}
            options={ids.characters}
            labels={labels}
            onChange={(v) => v && set([...path, i, 'id'], v)}
            aria-label={`いる人物 ${i + 1}`}
          />
          <CondInput
            path={[...path, i, 'when']}
            value={r.when}
            optional
            placeholder="いる条件（省略すると常に）"
            aria-label={`いる人物 ${i + 1} の条件`}
          />
          <IconButton
            title={`いる人物 ${i + 1} を消す`}
            className="hover:text-destructive"
            onClick={() => edit([{ op: 'delete', path: [...path, i] }])}
          >
            <Trash2 />
          </IconButton>
        </div>
      ))}
      <div className="flex gap-1">
        <Button
          variant="outline"
          size="sm"
          className="h-7"
          onClick={() =>
            edit([
              { op: 'insert', path, value: { id: ids.characters[0] ?? 'character', when: 'true' } },
            ])
          }
        >
          <Plus /> 人物を追加
        </Button>
        {rows.length <= 1 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={() => setOptional(path, rows[0]?.id)}
          >
            1 人だけにする
          </Button>
        )}
      </div>
    </div>
  );
}
