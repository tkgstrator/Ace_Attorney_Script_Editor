//! 台本 1 ファイル（_sceNN_cXXX_YYYY）を、シーンの集まりにする（tools/convert/ctr/file.ts の Rust 版）。
//! ラベル 1 つが 1 シーン（入口のラベルはファイル名、ほかは ファイル名_ラベル）。尋問のあるファイルでは、
//! 尋問の入口のラベルを証言シーンにし、ゆさぶり・外れ・最後の証言の後など尋問の中から飛ぶラベルはその場に展開する。

use super::block::{char_id, convert_block, flag_name, plain, Ctx, NameEntry, State};
use super::exam::{find_exam, reachable_from, referenced_labels, Exam};
use super::games::SeanceGo;
use super::gmd::{tokenize, Entry, Token};
use super::{Conv, Step};
use regex::Regex;
use serde_json::{json, Map, Value};
use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};

pub struct FileResult {
    /// (シーン ID, 中身)。入口のラベルが先頭
    pub scenes: Vec<(String, Value)>,
    pub gameover: Option<String>,
    /// 元の台本のほかのブロックから飛び先にされているラベルのシーン ID
    pub orig_ref: Vec<String>,
}

/// L_INIT・L_LOAD（と L_LOAD_nn。読み込み時の準備）は変換しない
pub fn skip_label(l: Option<&str>) -> bool {
    match l {
        None | Some("") => true,
        Some(l) => Regex::new(r"^L_(INIT|LOAD)(_[0-9]+)?$")
            .expect("re")
            .is_match(l),
    }
}

/// ファイルの入口のラベル。飛ばさない最初のラベル
pub fn main_label(entries: &[Entry]) -> String {
    entries
        .iter()
        .find(|e| !skip_label(e.label.as_deref()))
        .map(|e| e.label().to_string())
        .unwrap_or_else(|| "L_MAIN".into())
}

pub fn scene_id(file: &str, label: &str, main: &str) -> String {
    if label == main {
        file.to_string()
    } else {
        format!(
            "{file}_{}",
            label.strip_prefix("L_").unwrap_or(label).to_lowercase()
        )
    }
}

fn testimony_title(blocks: &[Vec<Token>]) -> Option<String> {
    for tokens in blocks {
        let Some(i) = tokens.iter().position(|t| t.is_cmd("E205")) else {
            continue;
        };
        let end = tokens
            .iter()
            .enumerate()
            .position(|(k, t)| k > i && t.is_cmd("E206"));
        let slice = &tokens[i..end.unwrap_or(tokens.len())];
        let text: String = slice
            .iter()
            .filter_map(|t| {
                if let Token::Text(s) = t {
                    Some(s.as_str())
                } else {
                    None
                }
            })
            .collect();
        let text = text.trim();
        return if text.is_empty() {
            None
        } else {
            Some(text.to_string())
        };
    }
    None
}

/// 肢を並べて（<E221> <E222 文 ラベル>…）<E223> を出さずに <E004 n> で飛ぶブロック → n で出す肢
fn find_choices_at(blocks: &[Vec<Token>]) -> HashMap<i64, Vec<(i64, i64)>> {
    let mut out = HashMap::new();
    for tokens in blocks {
        let mut list: Vec<(i64, i64)> = Vec::new();
        for t in tokens {
            let Token::Cmd { name, args, .. } = t else {
                continue;
            };
            match name.as_str() {
                "E221" | "E223" => list.clear(),
                "E222" => list.push((args[0], args[1])),
                "E004" if !list.is_empty() => {
                    out.insert(args[0], std::mem::take(&mut list));
                }
                _ => {}
            }
        }
    }
    out
}

/// ファイルの中で求める法廷記録（<E244 ラベル 種類 番号>・<E225/E226/E255 種類 番号 ラベル>）が増減に含まれるか
fn needs_gain(blocks: &[Vec<Token>], gains: &[Step], conv: &Conv) -> bool {
    let given: HashSet<&str> = gains
        .iter()
        .flat_map(|g| {
            ["give", "giveProfile"]
                .into_iter()
                .filter_map(move |k| g.get(k).and_then(Value::as_str))
        })
        .collect();
    let re = Regex::new(r"^(E22[56]|E255)$").expect("re");
    for tokens in blocks {
        for t in tokens {
            let Token::Cmd { name, args, .. } = t else {
                continue;
            };
            let (kind, idx) = if name == "E244" {
                (args.get(1), args.get(2))
            } else if re.is_match(name) {
                (args.first(), args.get(1))
            } else {
                (None, None)
            };
            if let (Some(&k), Some(&i)) = (kind, idx) {
                if conv
                    .record_id(k, i)
                    .is_some_and(|id| given.contains(id.as_str()))
                {
                    return true;
                }
            }
        }
    }
    false
}

/// 証言のブロックから（話す人の番号, 文）
fn statement_line(tokens: &[Token], steps: &[Step]) -> (Option<i64>, String) {
    let who = tokens
        .iter()
        .rev()
        .find(|t| t.is_cmd("E260") || t.is_cmd("E041"));
    let speech = steps.iter().rev().find(|s| {
        let Some(o) = s.as_object() else { return false };
        o.len() == 1
            && o.iter()
                .next()
                .is_some_and(|(k, v)| v.is_string() && k != "card")
    });
    let text = speech
        .and_then(|s| s.as_object())
        .and_then(|o| o.values().next())
        .and_then(Value::as_str)
        .unwrap_or("");
    (
        who.and_then(|w| w.args().get(1).copied()),
        text.replace("[color green]", ""),
    )
}

pub struct FileConv<'a> {
    pub conv: &'a Conv,
    pub entries: &'a [Entry],
    pub file: String,
    pub next: Option<String>,
    blocks: Vec<Vec<Token>>,
    exam: Option<Exam>,
    entry: String,
    testimony: Option<String>,
    reveal_flag: HashMap<i64, String>,
    choices_at: HashMap<i64, Vec<(i64, i64)>>,
    at_end: Vec<Step>,
    inlined: RefCell<HashSet<usize>>,
    calling: RefCell<HashSet<i64>>,
    map_places: RefCell<Vec<i64>>,
    end_flags: RefCell<Vec<String>>,
    pending: RefCell<VecDeque<usize>>,
    file_re: Regex,
}

/// このファイルの中の変換の状況。stack は尋問の中で展開しているラベルの並び（シーンとして変換するときは None）
pub struct FCtx<'a, 'b> {
    pub f: &'b FileConv<'a>,
    pub stack: Option<Vec<usize>>,
}

impl<'a> FileConv<'a> {
    fn label_of(&self, n: i64) -> Option<&str> {
        usize::try_from(n)
            .ok()
            .and_then(|i| self.entries.get(i))
            .and_then(|e| e.label.as_deref())
            .filter(|l| !l.is_empty())
    }
    fn id_of(&self, label: &str) -> String {
        scene_id(&self.file, label, &self.entry)
    }
    fn push_pending(&self, n: usize) {
        self.pending.borrow_mut().push_back(n);
    }
    fn index_of(&self, label: &str) -> Option<usize> {
        self.entries
            .iter()
            .position(|e| e.label.as_deref() == Some(label))
    }

    /// 外れの先（ng）がある遊びは、正解する / はずれる の選択肢にする。ない遊びは解けたものとして先へ進む
    fn solved(&self, game: &str, to: &[&str], ng: Option<&str>) -> Vec<Step> {
        let native = json!({"native": game, "args": []});
        let Some(k) = self.entries.iter().position(|e| to.contains(&e.label())) else {
            return vec![native];
        };
        self.push_pending(k);
        let miss = ng.and_then(|n| self.index_of(n));
        let ok = json!([{"goto": self.id_of(self.entries[k].label())}]);
        let Some(miss) = miss else {
            return vec![native, ok[0].clone()];
        };
        self.push_pending(miss);
        let ng_id = self.id_of(ng.expect("ng"));
        vec![
            native,
            json!({"choice": [{"text": "正解する", "then": ok}, {"text": "はずれる", "then": [{"goto": ng_id}]}]}),
        ]
    }

    fn go(&self, label: &str) -> Vec<Step> {
        match self.index_of(label) {
            Some(k) => {
                self.push_pending(k);
                vec![json!({"goto": self.id_of(label)})]
            }
            None => vec![],
        }
    }

    /// L_PO_START(_n) の遊びの番号: 同じ組の L_PO_INIT(_n) の <E306 番号 …>
    fn point_out_index(&self, self_label: Option<usize>) -> Option<i64> {
        let init = self
            .label_of(self_label.map_or(-1, |s| s as i64))?
            .replacen("START", "INIT", 1);
        let k = self.index_of(&init)?;
        self.blocks[k]
            .iter()
            .find(|t| t.is_cmd("E306"))
            .and_then(|t| t.args().first().copied())
    }

    /// 霊媒ビジョン（<E530 回> のあるファイル）を託宣と感覚の選択肢にする。正解が分からなければ None
    fn seance_steps(&self) -> Option<Vec<Step>> {
        let cmds: Vec<&Token> = self
            .blocks
            .iter()
            .flatten()
            .filter(|t| t.name().is_some())
            .collect();
        let round = cmds.iter().find(|t| t.is_cmd("E530"))?;
        let kind = cmds.iter().find(|t| t.is_cmd("E528"));
        let check = self.go("L_SPIRIT_CHECK");
        let or_check = |label: &str| {
            let v = self.go(label);
            if v.is_empty() {
                check.clone()
            } else {
                v
            }
        };
        let go = SeanceGo {
            main2: self.go("L_MAIN2"),
            fail_oracle: or_check("L_FAIL_ORACLE"),
            fail_sense: or_check("L_FAIL_SENSE"),
        };
        let kind = kind.map_or(0, |k| (k.args().first().copied().unwrap_or(0) - 1).max(0));
        self.conv
            .games
            .seance(self.conv.ep, round.args()[0], &go, kind)
    }

    /// 指し示す遊びで当たりが読めないとき、L_PO_CHECK の <E030 バンク 番号 値 ラベル> が分ける結果ごとに選択肢にする
    fn po_by_flags(&self, start: &str) -> Option<Vec<Step>> {
        let check = start.replacen("START", "CHECK", 1);
        let ci = self.index_of(&check)?;
        let conds: Vec<&Token> = self.blocks[ci]
            .iter()
            .filter(|t| t.is_cmd("E030"))
            .collect();
        if conds.is_empty() {
            return None;
        }
        self.push_pending(ci);
        let back = json!([{"goto": self.id_of(&check)}]);
        let mut opts: Vec<Value> = Vec::new();
        for (i, t) in conds.iter().enumerate() {
            let a = t.args();
            let f = flag_name(a[0], a[1]);
            self.conv.st.add_flag(&f);
            let text = if i == 0 {
                "正解する".to_string()
            } else {
                let to = self.label_of(a[3]).map_or(a[3].to_string(), str::to_string);
                format!("ほかを選ぶ（{to}）")
            };
            let mut then = vec![json!({"set": {f: a[2] == 1}})];
            then.extend(back.as_array().expect("array").clone());
            opts.push(json!({"text": text, "then": then}));
        }
        opts.push(json!({"text": "はずれる", "then": back}));
        Some(vec![
            json!({"native": "point_out", "args": []}),
            json!({"choice": opts}),
        ])
    }

    /// 指し示す遊びの成功の先は、L_PO_CHECK(_n) の最初の <E030 … ラベル>
    fn po_success(&self, start: &str) -> Option<String> {
        let ci = self.index_of(&start.replacen("START", "CHECK", 1))?;
        let t = self.blocks[ci].iter().find(|t| t.is_cmd("E030"))?;
        self.label_of(*t.args().get(3)?).map(str::to_string)
    }

    /// 台本の外の遊びの入口: (遊び, 正解のラベル, 外れのラベル)
    fn loop_game(&self, label: &str) -> Option<(&'static str, String, Option<String>)> {
        let table: [(&str, &str, &str, Option<&str>); 5] = [
            (
                r"^KS_(P[0-9]+_)?START$",
                "KS_${1}OK",
                "perceive",
                Some("KS_${1}NG"),
            ),
            (
                r"^L_POM_([0-9]+)_PLAY$",
                "L_POM_${1}_CORRECT",
                "point_out_movie",
                None,
            ),
            (
                r"^L_PO_START_([0-9]+)$",
                "L_PO_OK",
                "point_out",
                Some("L_PO_CHECK_${1}"),
            ),
            (r"^L_BOX_PLAY$", "L_BOX_SUCCESS", "puzzle_box", None),
            (
                r"^L_FORCE_MINUKU_START$",
                "L_FORCE_MINUKU_OK",
                "perceive",
                None,
            ),
        ];
        for (re, to, game, ng) in table {
            let re = Regex::new(re).expect("re");
            if re.is_match(label) {
                let to = re.replace(label, to).into_owned();
                return Some((game, to, ng.map(|n| re.replace(label, n).into_owned())));
            }
        }
        None
    }
}

#[path = "file_convert.rs"]
mod convert;
#[path = "file_ctx.rs"]
mod ctx;
pub use convert::convert_file;
