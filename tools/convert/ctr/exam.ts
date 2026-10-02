// 3DS 版（逆転裁判6）の尋問（証言シーン）。1 つのファイルに 1 つの尋問があり、ラベルの番号で組み立ててある。
//   <E240>                               尋問の定義を始める
//   <E241 隠す フラグ 証言 ゆさぶり 正解 外れ>  証言 1 つ（ラベルの番号）。隠すが 1 なら、<E245 証言> まで出さない
//   <E244 ラベル 種類 番号>                正解のラベルへ行く法廷記録（種類 0 証拠品・1 人物ファイル）
//   <E242 ラベル>                          最後の証言を過ぎたとき
//   <E414 隠す フラグ 証言 正解 外れ>         ゆさぶれない証言（4 話の KS_P1 など）。正解の行き先は <E244> のラベル
//   <E243>                                尋問を始める（このブロックのラベルが尋問の入口）
// <E248> を含むブロック（L_EXAM_RESET）と入口へ飛ぶと、尋問に戻る。
import type { Token } from './gmd.ts';

export type Statement = {
  hidden: boolean;
  flag: number;
  msg: number;
  /** ゆさぶったときのラベル。ゆさぶれない証言（<E414>）は null */
  press: number | null;
  correct: number;
  wrong: number;
};

export type Exam = {
  /** <E243> のあるブロック */
  start: number;
  statements: Statement[];
  follow: number | null;
  answers: Map<number, { kind: number; idx: number }>;
  /** 飛ぶと尋問に戻るラベル */
  resume: Set<number>;
};

export function findExam(blocks: Token[][]): Exam | null {
  let start = -1;
  const statements: Statement[] = [];
  const answers = new Map<number, { kind: number; idx: number }>();
  const resume = new Set<number>();
  let follow: number | null = null;
  blocks.forEach((tokens, i) => {
    for (const t of tokens) {
      if (t.kind !== 'cmd') continue;
      const a = t.args;
      if (t.name === 'E243') {
        start = i;
        resume.add(i);
      } else if (t.name === 'E248') resume.add(i);
      else if (t.name === 'E242') follow = a[0]!;
      else if (t.name === 'E244') answers.set(a[0]!, { kind: a[1]!, idx: a[2]! });
      else if (t.name === 'E414')
        statements.push({
          hidden: a[0] === 1,
          flag: a[1]!,
          msg: a[2]!,
          press: null,
          correct: -1,
          wrong: a[4]!,
        });
      else if (t.name === 'E241')
        statements.push({
          hidden: a[0] === 1,
          flag: a[1]!,
          msg: a[2]!,
          press: a[3]!,
          correct: a[4]!,
          wrong: a[5]!,
        });
    }
  });
  // <E414> の正解は、<E244> で結んだラベル（複数あれば最初のもの）
  const answerLabel = [...answers.keys()][0];
  if (answerLabel !== undefined)
    for (const st of statements) if (st.correct === -1) st.correct = answerLabel;
  return start < 0 || statements.length === 0
    ? null
    : { start, statements, follow, answers, resume };
}
