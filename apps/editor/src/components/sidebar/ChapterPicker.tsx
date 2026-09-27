// 章（サンプルのシナリオと、元の台本から変換した公式の章の YAML ファイル）を選ぶ・作る
import { FilePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { caseLabel } from '@/model/case-roots.ts';
import { isValidId } from '@/model/paths.ts';
import { newChapterYaml } from '@/model/structure.ts';
import { useActions, useEditorState } from '@/state/editor-store.tsx';
import { ask } from '../dialogs.tsx';

export function ChapterPicker() {
  const files = useEditorState(s => s.files);
  const file = useEditorState(s => s.file);
  const dirty = useEditorState(s => s.dirty);
  const { open, create } = useActions();

  const confirmDiscard = async () =>
    !dirty || (await ask({ title: '保存していない変更があります', description: '変更を捨てて別の章を開きますか？', okLabel: '捨てて開く', danger: true })) !== null;

  const onNew = async () => {
    const r = await ask({
      title: '新しい章',
      description: 'apps/player/cases/ に YAML ファイルを作ります。',
      fields: [
        {
          name: 'id', label: '章の ID（ファイル名になる）', placeholder: 'case2',
          validate: v => (!isValidId(v) ? 'ID は英字・数字・_ で、先頭は英字か _ にしてください' : files.includes(`sample/${v}.yaml`) ? '同じ名前のファイルがあります' : null),
        },
        { name: 'title', label: 'タイトル', initial: '新しい事件', validate: v => (v ? null : 'タイトルを入れてください') },
      ],
    });
    if (!r || !(await confirmDiscard())) return;
    await create(`sample/${r.values.id}.yaml`, newChapterYaml(r.values.id!, r.values.title!));
  };

  return (
    <div className="space-y-1 border-b p-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground">章</span>
        {dirty && <span className="size-2 rounded-full bg-amber-500" title="保存していない変更があります" />}
        <Button variant="ghost" size="sm" className="ml-auto h-6 text-xs" onClick={() => void onNew()}>
          <FilePlus /> 新規
        </Button>
      </div>
      <NativeSelect
        className="w-full" value={file ?? ''} aria-label="章"
        onChange={async e => {
          const name = e.target.value;
          if (name && name !== file && (await confirmDiscard())) await open(name);
        }}
      >
        {file === null && <NativeSelectOption value="">（章がありません）</NativeSelectOption>}
        {files.map(f => <NativeSelectOption key={f} value={f}>{caseLabel(f)}</NativeSelectOption>)}
      </NativeSelect>
    </div>
  );
}
