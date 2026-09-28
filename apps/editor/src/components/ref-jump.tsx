// 参照先（シーン・場所）を開くボタン。開く前の場所は「元の場所へ戻る」で戻れる
import { CornerDownRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { selectionForNodeIn } from '@/model/paths.ts';
import type { Path } from '@/model/yaml-doc.ts';
import { useActions, useEditorState } from '@/state/editor-store.tsx';

export function RefJump({ id, from }: { id: unknown; from: Path }) {
  const tree = useEditorState((s) => s.tree);
  const { jump } = useActions();
  const target = typeof id === 'string' ? selectionForNodeIn(tree, id) : null;
  if (!target) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-xs text-muted-foreground"
      title={`「${String(id)}」を開く（上の「元の場所へ戻る」で戻れます）`}
      onClick={() => jump(target, from)}
    >
      <CornerDownRight /> 開く
    </Button>
  );
}
