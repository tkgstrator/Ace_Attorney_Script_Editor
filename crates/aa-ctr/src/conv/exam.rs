//! 尋問（証言シーン）と、ラベルの参照。1 つのファイルに 1 つの尋問があり、ラベルの番号で組み立ててある。
//!   <E240>                                 尋問の定義を始める
//!   <E241 隠す フラグ 証言 ゆさぶり 正解 外れ>   証言 1 つ（ラベルの番号）。隠すが 1 なら <E245 証言> まで出さない
//!   <E414 隠す フラグ 証言 正解 外れ>          ゆさぶれない証言。正解の行き先は <E244> のラベル
//!   <E244 ラベル 種類 番号>                  正解のラベルへ行く法廷記録（種類 0 証拠品・1 人物ファイル）
//!   <E242 ラベル>                            最後の証言を過ぎたとき
//!   <E243>                                  尋問を始める（このブロックのラベルが尋問の入口）
//! <E248> を含むブロック（L_EXAM_RESET）と入口へ飛ぶと、尋問に戻る。

use super::gmd::{arg, Token};
use std::collections::{HashSet, VecDeque};

pub struct Statement {
    pub hidden: bool,
    pub flag: i64,
    pub msg: i64,
    /// ゆさぶったときのラベル。ゆさぶれない証言（<E414>）は None
    pub press: Option<i64>,
    pub correct: i64,
    pub wrong: i64,
}

pub struct Exam {
    /// <E243> のあるブロック
    pub start: usize,
    pub statements: Vec<Statement>,
    pub follow: Option<i64>,
    /// ラベル → (種類, 番号)。最初に出たラベルの順
    pub answers: Vec<(i64, (i64, i64))>,
    /// 飛ぶと尋問に戻るラベル
    pub resume: HashSet<usize>,
}

impl Exam {
    pub fn answer(&self, label: i64) -> Option<(i64, i64)> {
        self.answers.iter().find(|a| a.0 == label).map(|a| a.1)
    }
}

pub fn find_exam(blocks: &[Vec<Token>]) -> Option<Exam> {
    let mut start: Option<usize> = None;
    let mut statements: Vec<Statement> = Vec::new();
    let mut answers: Vec<(i64, (i64, i64))> = Vec::new();
    let mut resume = HashSet::new();
    let mut follow = None;
    for (i, tokens) in blocks.iter().enumerate() {
        for t in tokens {
            let Token::Cmd { name, args: a, .. } = t else {
                continue;
            };
            match name.as_str() {
                "E243" => {
                    start = Some(i);
                    resume.insert(i);
                }
                "E248" => {
                    resume.insert(i);
                }
                "E242" => follow = Some(arg(a, 0)),
                "E244" => {
                    let v = (arg(a, 1), arg(a, 2));
                    match answers.iter_mut().find(|x| x.0 == arg(a, 0)) {
                        Some(x) => x.1 = v,
                        None => answers.push((arg(a, 0), v)),
                    }
                }
                "E414" => statements.push(Statement {
                    hidden: arg(a, 0) == 1,
                    flag: arg(a, 1),
                    msg: arg(a, 2),
                    press: None,
                    correct: -1,
                    wrong: arg(a, 4),
                }),
                "E241" => statements.push(Statement {
                    hidden: arg(a, 0) == 1,
                    flag: arg(a, 1),
                    msg: arg(a, 2),
                    press: Some(arg(a, 3)),
                    correct: arg(a, 4),
                    wrong: arg(a, 5),
                }),
                _ => {}
            }
        }
    }
    // <E414> の正解は、<E244> で結んだラベル（複数あれば最初のもの）
    if let Some(label) = answers.first().map(|a| a.0) {
        for st in statements.iter_mut().filter(|s| s.correct == -1) {
            st.correct = label;
        }
    }
    let start = start?;
    if statements.is_empty() {
        return None;
    }
    Some(Exam {
        start,
        statements,
        follow,
        answers,
        resume,
    })
}

/// 命令が行き先にしているラベルの番号
pub fn jump_targets(name: &str, a: &[i64]) -> Vec<i64> {
    let take = |from: usize, to: usize| -> Vec<i64> {
        a.iter()
            .skip(from)
            .take(to.saturating_sub(from))
            .copied()
            .collect()
    };
    match name {
        // 飛ぶ・呼ぶ・尋問の最後の証言の後・つきつけの正解・映像の指し示しの正解・箱の成功と失敗
        "E004" | "E026" | "E242" | "E244" | "E567" | "E573" | "E574" => take(0, 1),
        // フラグなら飛ぶ
        "E030" => take(3, 4),
        // 選択肢・探偵パートへ・並べたフラグがそろったら
        "E222" | "E393" | "E050" => take(1, 2),
        // つきつけの正解の飛び先・3D で調べる所
        "E225" | "E327" => take(2, 3),
        // 証言（証言・ゆさぶり・正解・外れ）
        "E241" => take(2, 6),
        // みぬく（開始・成功・やめる・外れ）
        "E177" => take(0, 4),
        // 乱数
        "E249" | "E022" => a.to_vec(),
        _ => vec![],
    }
}

/// ブロックの並びが行き先にしているラベルの番号の集まり
pub fn referenced_labels(blocks: &[Vec<Token>]) -> Vec<i64> {
    let mut out: Vec<i64> = Vec::new();
    for b in blocks {
        for t in b {
            if let Token::Cmd { name, args, .. } = t {
                for n in jump_targets(name, args) {
                    if !out.contains(&n) {
                        out.push(n);
                    }
                }
            }
        }
    }
    out
}

/// 入口のラベルから、飛ぶ・呼ぶ・選ぶ命令だけでたどれるラベルの番号の集まり（入口自身を含む）
pub fn reachable_from(blocks: &[Vec<Token>], entry: usize) -> HashSet<usize> {
    let mut seen = HashSet::new();
    let mut todo: VecDeque<i64> = VecDeque::new();
    todo.push_back(entry as i64);
    while let Some(n) = todo.pop_back() {
        let Ok(n) = usize::try_from(n) else { continue };
        if seen.contains(&n) || n >= blocks.len() {
            continue;
        }
        seen.insert(n);
        for t in &blocks[n] {
            if let Token::Cmd { name, args, .. } = t {
                todo.extend(jump_targets(name, args));
            }
        }
    }
    seen
}

#[cfg(test)]
mod tests {
    use super::super::gmd::tokenize;
    use super::*;

    #[test]
    fn finds_statements_answers_and_resume() {
        let blocks = vec![
            tokenize("<E240><E241 0 0 5 9 12 13><E414 1 3 6 0 14><E244 12 0 4><E242 8>"),
            tokenize("<E243>"),
        ];
        let e = find_exam(&blocks).unwrap();
        assert_eq!(e.start, 1);
        assert_eq!(e.statements.len(), 2);
        assert_eq!(e.statements[1].press, None);
        assert_eq!(e.statements[1].correct, 12);
        assert!(e.statements[1].hidden);
        assert_eq!(e.follow, Some(8));
        assert_eq!(e.answer(12), Some((0, 4)));
        assert!(e.resume.contains(&1));
    }

    #[test]
    fn jump_targets_pick_the_right_arguments() {
        assert_eq!(jump_targets("E030", &[1, 2, 1, 7]), vec![7]);
        assert_eq!(jump_targets("E222", &[30, 4]), vec![4]);
        assert_eq!(
            jump_targets("E241", &[0, 0, 5, 9, 12, 13]),
            vec![5, 9, 12, 13]
        );
        assert!(jump_targets("E999", &[1]).is_empty());
    }
}
