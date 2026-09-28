// 証言（testimony）シーンの編集: タイトル・証人・証言の一覧（ゆさぶり・つきつけ）・after / loop / wrong
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { extraRecordKeys } from '@/model/form-keys.ts';
import { pathKey, uniqueId } from '@/model/paths.ts';
import type { Path } from '@/model/yaml-doc.ts';
import { useActions, useIds } from '@/state/editor-store.tsx';
import { ExtraFields } from './ExtraFields.tsx';
import {
  CondInput,
  Field,
  IdSelect,
  Section,
  TextInput,
  useCharacterLabels,
  useSetter,
} from './fields.tsx';
import { Nested, OptionalSteps } from './steps/flow-fields.tsx';
import { PresentMap } from './steps/PresentMap.tsx';
import { IconButton } from './steps/StepCard.tsx';
import { useRows } from './use-rows.ts';

type Rec = Record<string, unknown>;

export function TestimonyEditor({ path, scene }: { path: Path; scene: Rec }) {
  const ids = useIds();
  const { edit } = useActions();
  const { set } = useSetter();
  const labels = useCharacterLabels();
  const statements = Array.isArray(scene.statements) ? (scene.statements as Rec[]) : [];
  const rows = useRows(statements);
  const listPath = [...path, 'statements'];
  const addStatement = () => {
    const id = uniqueId(
      `s${statements.length + 1}`,
      statements.map((s) => String(s.id ?? '')),
    );
    edit([{ op: 'insert', path: listPath, value: { id, text: '' } }]);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <Field label="証言のタイトル">
          <TextInput
            path={[...path, 'testimony']}
            value={scene.testimony}
            aria-label="証言のタイトル"
          />
        </Field>
        <Field label="証人">
          <IdSelect
            path={[...path, 'witness']}
            value={scene.witness}
            options={ids.characters}
            labels={labels}
            onChange={(v) => v && set([...path, 'witness'], v)}
            aria-label="証人"
          />
        </Field>
      </div>

      <Section
        title={`証言（${statements.length}）`}
        actions={
          <Button size="sm" variant="outline" className="h-7" onClick={addStatement}>
            <Plus /> 証言を追加
          </Button>
        }
      >
        <div className="space-y-3">
          {rows.items.map((st, i) => {
            const p = [...listPath, i];
            return (
              <div
                key={rows.keys[i]}
                className="rounded-lg border bg-card p-3 shadow-xs"
                data-path={pathKey(p)}
              >
                <div className="flex items-center gap-2">
                  <span className="whitespace-nowrap text-sm font-semibold text-orange-600">
                    証言 {i + 1}
                  </span>
                  <TextInput
                    path={[...p, 'id']}
                    value={st.id}
                    optional
                    mono
                    className="w-32"
                    placeholder="ID（推奨）"
                    aria-label={`証言 ${i + 1} の ID`}
                  />
                  <CondInput
                    path={[...p, 'when']}
                    value={st.when}
                    optional
                    placeholder="現れる条件（隠し証言）"
                    aria-label={`証言 ${i + 1} が現れる条件`}
                  />
                  <div className="ml-auto flex">
                    <IconButton
                      title="上へ"
                      disabled={i === 0}
                      onClick={() => edit([{ op: 'move', path: listPath, from: i, to: i - 1 }])}
                    >
                      <ArrowUp />
                    </IconButton>
                    <IconButton
                      title="下へ"
                      disabled={i === statements.length - 1}
                      onClick={() => edit([{ op: 'move', path: listPath, from: i, to: i + 1 }])}
                    >
                      <ArrowDown />
                    </IconButton>
                    <IconButton
                      title="証言を消す"
                      className="hover:text-destructive"
                      onClick={() => edit([{ op: 'delete', path: p }])}
                    >
                      <Trash2 />
                    </IconButton>
                  </div>
                </div>
                <TextInput
                  multiline
                  path={[...p, 'text']}
                  value={st.text}
                  className="mt-2 text-orange-700"
                  placeholder="証言の文"
                  aria-label={`証言 ${i + 1} の文`}
                />
                <div className="mt-2 space-y-2">
                  <div className="flex flex-wrap gap-x-2">
                    <OptionalSteps
                      path={[...p, 'before']}
                      value={st.before}
                      label="before: 尋問でこの証言を出す前（人物の動き・背景・音など、止まらない命令）"
                      addLabel="出す前の命令を追加"
                    />
                  </div>
                  <div>
                    <OptionalSteps
                      path={[...p, 'press']}
                      value={st.press}
                      label="ゆさぶったとき"
                      addLabel="ゆさぶりを追加"
                    />
                  </div>
                  <div>
                    {st.present === undefined ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[11px] text-muted-foreground"
                        onClick={() => set([...p, 'present'], {})}
                      >
                        <Plus /> つきつけを追加
                      </Button>
                    ) : (
                      <Nested
                        label="つきつけたとき"
                        path={[...p, 'present']}
                        actions={
                          <IconButton
                            title="つきつけを消す"
                            className="hover:text-destructive"
                            onClick={() => edit([{ op: 'delete', path: [...p, 'present'] }])}
                          >
                            <Trash2 />
                          </IconButton>
                        }
                      >
                        <PresentMap path={[...p, 'present']} value={st.present} />
                      </Nested>
                    )}
                  </div>
                </div>
                <ExtraFields
                  path={p}
                  value={st}
                  keys={extraRecordKeys(st, ['id', 'text', 'when', 'press', 'before', 'present'])}
                />
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="証言を聞く場面・証言の後・尋問のくり返し">
        <div className="space-y-2">
          <OptionalSteps
            path={[...path, 'reading']}
            value={scene.reading}
            label="reading: 証言を最初に聞く場面（書けば、証言の文の代わりにこれを見せる）"
            addLabel="reading を追加"
          />
          <OptionalSteps
            path={[...path, 'after']}
            value={scene.after}
            label="after: 証言を聞き終えてから尋問に入るまで"
            addLabel="after を追加"
          />
          <OptionalSteps
            path={[...path, 'loop']}
            value={scene.loop}
            label="loop: 尋問で最後の証言を過ぎたとき"
            addLabel="loop を追加"
          />
          <OptionalSteps
            path={[...path, 'wrong']}
            value={scene.wrong}
            label="wrong: 見当違いの証拠品をつきつけたとき"
            addLabel="wrong を追加（既定の反応を上書き）"
          />
        </div>
      </Section>
      <ExtraFields
        path={path}
        value={scene}
        keys={extraRecordKeys(scene, [
          'testimony',
          'witness',
          'statements',
          'reading',
          'after',
          'loop',
          'wrong',
        ])}
      />
    </div>
  );
}
