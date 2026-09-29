// 集計をすべて流し、結果を docs/writing/numbers/*.md と docs/characters/*.md に書き出す。最後に手書きの部分の数を確かめる。
// 使い方: bun tools/analysis/all.ts
// 材料は手元の assets/extracted/**/converted/ep*.yaml（配布しないもの）。出力には数と、語尾などの数文字の断片だけが入る。

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const here = import.meta.dir;
const out = join(here, '../../docs/writing/numbers');
mkdirSync(out, { recursive: true });

const HEADER =
  '<!-- tools/analysis/all.ts が作る。手で直さない。材料は変換済みの公式シナリオ（手元だけにあるもの） -->\n\n';

for (const name of ['volume', 'effects', 'patterns', 'structure', 'openings', 'typography']) {
  const p = Bun.spawnSync(['bun', join(here, `${name}.ts`)], { stderr: 'inherit' });
  if (p.exitCode !== 0) throw new Error(`${name}.ts が失敗した`);
  writeFileSync(join(out, `${name}.md`), HEADER + p.stdout.toString());
  console.error(`書いた: docs/writing/numbers/${name}.md`);
}

const c = Bun.spawnSync(['bun', join(here, 'characters.ts')], { stderr: 'inherit' });
if (c.exitCode !== 0) throw new Error('characters.ts が失敗した');

// 手書きの部分の数が自動の部分と食い違っていないかを確かめる（食い違いは表示するだけで、止めない）
const chk = Bun.spawnSync(['bun', join(here, 'check-characters.ts')], {
  stdout: 'inherit',
  stderr: 'inherit',
});
if (chk.exitCode !== 0)
  console.error('docs/characters の手書きの部分に、自動の部分と合わない数がある（上の一覧）');
