// 証言（testimony）シーンの編集: タイトル・証人・証言の一覧（ゆさぶり・つきつけ）・after / loop / wrong
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { uniqueId } from '@/model/paths.ts';
import type { Path } from '@/model/yaml-doc.ts';
import { useActions, useIds } from '@/state/editor-store.tsx';
import { CondInput, Field, IdSelect, Section, TextInput, useCharacterLabels, useSetter } from './fields.tsx';
import { OptionalSteps } from './steps/flow-fields.tsx';
import { PresentMap } from './steps/PresentMap.tsx';
import { IconButton } from './steps/StepCard.tsx';

type Rec = Record<string, unknown>;

export function TestimonyEditor({ path, scene }: { path: Path; scene: Rec }) {
  const ids = useIds();
  const { edit } = useActions();
  const { set } = useSetter();
  const labels = useCharacterLabels();
  const statements = Array.isArray(scene.statements) ? scene.statements as Rec[] : [];
  const listPath = [...path, 'statements'];
  const addStatement = () => {
    const id = uniqueId(`s${statements.length + 1}`, statements.map(s => String(s.id ?? '')));
    edit([{ op: 'insert', path: listPath, value: { id, text: '' } }]);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <Field label="証言のタイトル"><TextInput path={[...path, 'testimony']} value={scene.testimony} /></Field>
        <Field label="証人">
          <IdSelect value={scene.witness} options={ids.characters} labels={labels} onChange={v => v && set([...path, 'witness'], v)} aria-label="証人" />
        </Field>
      </div>

      <Section title={`証言（${statements.length}）`} actions={<Button size="sm" variant="outline" className="h-7" onClick={addStatement}><Plus /> 証言を追加</Button>}>
        <div className="space-y-3">
          {statements.map((st, i) => {
            const p = [...listPath, i];
            return (
              <div key={i} className="rounded-lg border bg-card p-3 shadow-xs" data-path={JSON.stringify(p)}>
                <div className="flex items-center gap-2">
                  <span className="whitespace-nowrap text-sm font-semibold text-orange-600">証言 {i + 1}</span>
                  <TextInput path={[...p, 'id']} value={st.id} optional mono className="w-32" placeholder="ID（推奨）" aria-label="証言の ID" />
                  <CondInput path={[...p, 'when']} value={st.when} optional placeholder="現れる条件（隠し証言）" aria-label="現れる条件" />
                  <div className="ml-auto flex">
                    <IconButton title="上へ" disabled={i === 0} onClick={() => edit([{ op: 'move', path: listPath, from: i, to: i - 1 }])}><ArrowUp /></IconButton>
                    <IconButton title="下へ" disabled={i === statements.length - 1} onClick={() => edit([{ op: 'move', path: listPath, from: i, to: i + 1 }])}><ArrowDown /></IconButton>
                    <IconButton title="証言を消す" className="hover:text-destructive" onClick={() => edit([{ op: 'delete', path: p }])}><Trash2 /></IconButton>
                  </div>
                </div>
                <TextInput multiline path={[...p, 'text']} value={st.text} className="mt-2 text-orange-700" placeholder="証言の文" aria-label="証言の文" />
                <div className="mt-2 space-y-2">
                  <div>
                    <OptionalSteps path={[...p, 'press']} value={st.press} label="ゆさぶったとき" addLabel="ゆさぶりを追加" />
                  </div>
                  <div>
                    {st.present === undefined
                      ? (
                        <Button variant="ghost" size="sm" className="h-6 text-[11px] text-muted-foreground" onClick={() => set([...p, 'present'], {})}>
                          <Plus /> つきつけを追加
                        </Button>
                      )
                      : (
                        <div className="border-l-2 border-muted pl-2">
                          <div className="mb-1 flex items-center text-[11px] font-medium text-muted-foreground">
                            つきつけたとき
                            <IconButton title="つきつけを消す" className="ml-auto hover:text-destructive" onClick={() => edit([{ op: 'delete', path: [...p, 'present'] }])}><Trash2 /></IconButton>
                          </div>
                          <PresentMap path={[...p, 'present']} value={st.present} />
                        </div>
                      )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="証言の後・尋問のくり返し">
        <div className="space-y-2">
          <OptionalSteps path={[...path, 'after']} value={scene.after} label="after: 証言を聞き終えてから尋問に入るまで" addLabel="after を追加" />
          <OptionalSteps path={[...path, 'loop']} value={scene.loop} label="loop: 尋問で最後の証言を過ぎたとき" addLabel="loop を追加" />
          <OptionalSteps path={[...path, 'wrong']} value={scene.wrong} label="wrong: 見当違いの証拠品をつきつけたとき" addLabel="wrong を追加（既定の反応を上書き）" />
        </div>
      </Section>
    </div>
  );
}
