// DS 版のスクリーンショットと、同じ文章をこちらの画面で出したものを並べる（文字の大きさ・字間の確認用）。
import { Engine } from '@gyakusai/core';
import { loadFonts, Player } from '@gyakusai/runtime';
import { loadScenario } from '@gyakusai/script';
import ds2 from '../../../assets/samples/ds/top/dialogue/20260927_11-16-05.865.png?url';
import ds1 from '../../../assets/samples/ds/top/dialogue/20260927_11-16-52.974.png?url';
import ds3 from '../../../assets/samples/ds/top/dialogue/20260927_11-17-20.424.png?url';
import { loadDsFont } from './ds-font.ts';

const CASES = [
  {
    image: ds1,
    name: 'ナルホド',
    text: 'ぼくの名前は成歩堂　龍一\n（なるほどうりゅういち）。',
  },
  {
    image: ds2,
    name: 'ナルホド',
    text: 'こ、こんなにドキドキするの、\n小学校の学級裁判のとき以来です。',
  },
  {
    image: ds3,
    name: 'サイバンカン',
    text: 'これより、矢張　政志の\n法廷を開廷します。',
  },
];

await loadFonts();
const fonts = await loadDsFont();
const black = document.createElement('canvas');
black.width = 256;
black.height = 192;
black.getContext('2d')!.fillRect(0, 0, 256, 192);

const rows = document.getElementById('rows')!;
for (const c of CASES) {
  const yaml = `
id: compare
title: compare
characters:
  p: { name: ${JSON.stringify(c.name)} }
evidence: {}
start: { scene: s }
scenes:
  s:
    - say: p
      text: ${JSON.stringify(c.text)}
    - end: true
`;
  const { scenario, diagnostics } = loadScenario(yaml);
  if (!scenario) throw new Error(diagnostics.map((d) => d.message).join('\n'));
  const figure = (label: string, el: HTMLElement) => {
    const f = document.createElement('figure');
    const cap = document.createElement('figcaption');
    cap.textContent = label;
    f.append(el, cap);
    return f;
  };
  const img = new Image();
  img.src = c.image;
  const canvas = document.createElement('canvas');
  new Player({
    canvas,
    engine: new Engine(scenario),
    assets: { background: () => black },
    ...fonts,
  });
  const row = document.createElement('div');
  row.className = 'row';
  row.append(figure('DS 版', img), figure('逆裁', canvas));
  rows.append(row);
}
