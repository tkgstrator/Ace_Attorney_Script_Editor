// 法廷記録の比較ページ（record-compare.html）で並べる、DS 版の下画面のスクリーンショットと、そのときの記録の状態。
// 証拠品・人物は第 1 話（はじめての逆転）のもの。アイコンは tables/evidence.json の番号（e<番号> / r<番号>）で引く。

const shots = import.meta.glob(
  '../../../assets/samples/ds/bottom/{evidence-list,evidence-detail,profile-list,profile-detail,evidence-present}/*.png',
  { query: '?url', import: 'default', eager: true },
) as Record<string, string>;

export interface RecordCase {
  /** assets/samples/ds/bottom/ からのパス */
  file: string;
  url: string;
  tab: 'evidence' | 'profile';
  /** 記録に入っている証拠品・人物（並び順） */
  evidence: string[];
  profiles: string[];
  /** 選んでいる項目の番号 */
  sel: number;
  detail: boolean;
  /** つきつけられる場面（尋問・「つきつけろ」）で開いたもの */
  present?: boolean;
  note?: string;
}

const E2 = ['e23', 'e6'];
const E4 = ['e23', 'e6', 'e7', 'e8'];
const E5 = ['e23', 'e6', 'e7', 'e8', 'e9'];
const P4 = ['mia', 'butz', 'cindy_stone', 'payne'];
const P5 = [...P4, 'sahwit'];
const NO_SWITCH =
  'DS 版は証拠品を入手した直後などに「人物ファイル」のタブを出さない（こちらは常に出す）';

type Row = [
  file: string,
  tab: 'evidence' | 'profile',
  evidence: string[],
  profiles: string[],
  sel: number,
  detail: boolean,
  extra?: Partial<RecordCase>,
];
const ROWS: Row[] = [
  ['evidence-list/20260927_11-17-52.368.png', 'evidence', E2, P4, 0, false],
  [
    'evidence-list/20260927_11-18-55.260.png',
    'evidence',
    ['e23', 'e6', 'e7'],
    P4,
    2,
    false,
    { note: NO_SWITCH },
  ],
  ['evidence-list/20260927_11-20-47.538.png', 'evidence', E4, P4, 3, false, { note: NO_SWITCH }],
  ['evidence-list/20260927_11-23-32.176.png', 'evidence', E4, P4, 1, false, { note: NO_SWITCH }],
  ['evidence-list/20260927_11-24-36.762.png', 'evidence', E5, P4, 4, false, { note: NO_SWITCH }],
  ['evidence-list/20260927_12-18-58.247.png', 'evidence', E5, P5, 0, false],
  ['evidence-list/20260927_12-19-47.448.png', 'evidence', E5, P5, 0, false],
  ['evidence-detail/20260927_11-18-01.219.png', 'evidence', E2, P4, 0, true],
  ['evidence-detail/20260927_11-23-21.647.png', 'evidence', E4, P4, 2, true],
  ['evidence-detail/20260927_11-23-24.257.png', 'evidence', E4, P4, 3, true],
  ['evidence-detail/20260927_11-23-28.891.png', 'evidence', E4, P4, 1, true],
  ['evidence-detail/20260927_12-19-11.238.png', 'evidence', E5, P5, 0, true],
  ['evidence-detail/20260927_12-19-14.080.png', 'evidence', E5, P5, 1, true],
  ['evidence-detail/20260927_12-19-16.330.png', 'evidence', E5, P5, 2, true],
  ['evidence-detail/20260927_12-19-19.086.png', 'evidence', E5, P5, 3, true],
  ['evidence-detail/20260927_12-19-22.693.png', 'evidence', E5, P5, 4, true],
  ['profile-list/20260927_11-18-08.762.png', 'profile', E2, P4, 0, false],
  [
    'profile-list/20260927_12-19-44.436.png',
    'profile',
    E5,
    P5,
    0,
    false,
    { note: 'DS 版は選択の枠が点滅で消えている瞬間' },
  ],
  ['profile-detail/20260927_11-18-05.553.png', 'profile', E2, P4, 0, true],
  ['profile-detail/20260927_11-18-15.222.png', 'profile', E2, P4, 3, true],
  ['profile-detail/20260927_12-19-26.096.png', 'profile', E5, P5, 0, true],
  ['profile-detail/20260927_12-19-28.685.png', 'profile', E5, P5, 1, true],
  ['profile-detail/20260927_12-19-31.218.png', 'profile', E5, P5, 2, true],
  ['profile-detail/20260927_12-19-34.069.png', 'profile', E5, P5, 3, true],
  ['profile-detail/20260927_12-19-37.075.png', 'profile', E5, P5, 4, true],
  [
    'evidence-present/20260927_11-26-47.376.png',
    'evidence',
    E4,
    P4,
    1,
    true,
    { present: true, note: '右上の「Y ((•))」（マイクで「くらえ！」と言える印）は描かない' },
  ],
];

export const RECORD_CASES: RecordCase[] = ROWS.map(
  ([file, tab, evidence, profiles, sel, detail, extra]) => ({
    file,
    tab,
    evidence,
    profiles,
    sel,
    detail,
    ...extra,
    url: Object.entries(shots).find(([k]) => k.endsWith(file))?.[1] ?? '',
  }),
).filter((c) => c.url);

/** 比較用の事件（第 1 話の証拠品と人物ファイルだけを持つ） */
export function compareScenario(c: RecordCase): string {
  const lines = c.present
    ? [
        '    - demand: 証拠品をつきつけろ',
        '      present:',
        '        e6:',
        '          - p: これだ！',
        '    - end: true',
      ]
    : ['    - p: 法廷記録を開く', '    - end: true'];
  return `
id: record_compare
title: record_compare
characters:
  p: { name: ナルホド }
  mia: { name: チヒロ, profile: { name: 綾里　千尋, age: 27, icon: r0, description: "綾里法律事務所の所長。\\nぼくの上司で、\\nヤリ手の弁護士。" } }
  butz: { name: ヤハリ, profile: { name: 矢張　政志, age: 23, icon: r2, description: "この事件の被告人。\\nぼくの同級生で、\\nにくめないヤツだ。" } }
  cindy_stone: { name: 高日 美佳, profile: { name: 高日　美佳, age: 22, icon: r3, description: "事件の被害者。\\nマンションで一人暮らし\\nしていた、モデルさん。" } }
  payne: { name: アウチ, profile: { name: 亜内　武文, age: 52, icon: r5, description: "この事件の担当検事。\\n押しが弱く、なんとなく\\nパッとしない男。" } }
  sahwit: { name: ヤマノ, profile: { name: 山野　星雄, age: 44, icon: r4, description: "死体の第一発見者。\\n新聞勧誘員で、現場で\\n矢張を目撃している。" } }
evidence:
  e6: { name: 高日美佳の解剖記録, description: "死亡時刻は、7月31日\\n午後4時以降5時まで。\\n鈍器による一撃で失血死。" }
  e7: { name: 置　物, description: "《考える人》の形を\\nかたどった置物。\\nかなり重い。" }
  e8: { name: パスポート, description: "事件の前日7月30日に\\nニューヨークから帰国\\nしているようだ。" }
  e9: { name: 停電記録, description: "事件当日の午後1時から\\n6時過ぎまで、現場の\\nマンションは停電だった。" }
  e23: { name: 弁護士バッジ, description: "これがないと、\\n誰もぼくを弁護士と\\nみとめてくれない。" }
start:
  scene: s
  evidence: [${c.evidence.join(', ')}]
  profiles: [${c.profiles.join(', ')}]
scenes:
  s:
${lines.join('\n')}
`;
}
