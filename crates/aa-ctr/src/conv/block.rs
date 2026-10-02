//! 台本の 1 ブロック（ラベル 1 つ分の文）をシナリオのステップにする（tools/convert/ctr/convert.ts の Rust 版）。
//! 命令の意味は docs/3ds.md の「台本の命令」。分からない命令は native で残す。

use super::gmd::{arg, Token};
use super::Step;
use regex::Regex;
use serde_json::{json, Map, Value};
use std::cell::RefCell;
use std::collections::{BTreeSet, HashMap, HashSet};

#[derive(Clone, Debug)]
pub struct NameEntry {
    pub label: String,
    pub name: String,
}

/// 変換の間に増えていく状態（フラグ・使った人物・命令の数）
#[derive(Default)]
pub struct State {
    pub flags: RefCell<HashSet<String>>,
    pub used_names: RefCell<BTreeSet<usize>>,
    pub stats: RefCell<HashMap<String, usize>>,
}

impl State {
    pub fn count(&self, key: String) {
        *self.stats.borrow_mut().entry(key).or_default() += 1;
    }
    pub fn add_flag(&self, f: &str) {
        self.flags.borrow_mut().insert(f.to_string());
    }
}

/// ブロックを変換するときに、呼び出し側が持っている状況（ファイル・呼び出し・探偵パートで中身が違う）
pub trait Ctx {
    fn state(&self) -> &State;
    fn names(&self) -> &[NameEntry];
    fn choice_text(&self, id: i64) -> String;
    /// 同じファイルの n 番目のラベルへ飛ぶ（goto か、その場に展開したステップ）
    fn jump(&self, n: i64) -> Vec<Step>;
    /// <E039>（このファイルの終わり）で行うこと
    fn end(&self) -> Vec<Step>;
    fn reveal(&self, msg: i64) -> Option<String>;
    fn game(&self) -> Vec<Step>;
    fn point_out(&self, self_label: Option<usize>) -> Option<Step>;
    fn spot_name(&self, label: i64, spot: i64) -> String;
    fn choices_at(&self, label: Option<usize>) -> Vec<(i64, i64)>;
    fn script(&self, sce: i64, idx: i64) -> Vec<Step>;
    fn call(&self, sce: i64, idx: i64, label: Option<&str>) -> Vec<Step>;
    fn call_local(&self, n: i64) -> Vec<Step>;
    /// 探偵パートの近似の中で展開しているとき、その入口の物語のファイルの章・シーン
    fn hub(&self) -> Option<(i64, i64)>;
    fn perceive_choice(&self) -> bool;
    fn end_invest(&self) -> Vec<Step>;
    fn free_roam(&self, place: i64, end_label: i64) -> Vec<Step>;
    fn map_place(&self, place: i64);
    fn end_flag(&self, flag: &str);
    fn topics(&self, swap: bool, args: &[i64]) -> Vec<Step>;
    fn record_id(&self, kind: i64, idx: i64) -> Option<String>;
}

/// 表示にも流れにも関係しない命令（行番号・区切り・字の配置の印・吹き出しの準備・探偵パートの場所の準備など）
const SKIP: &[&str] = &[
    "E293", "E369", "E370", "E371", "E372", "E373", "E374", "E375", "E376", "E379", "E380", "E382",
    "E383", "E311", "E313", "E800", "E063", "RDFG", "MCRS", "MCRE", "E795", "E796", "E042", "E001",
    "E220", "E248", "E283",
];

fn color(name: &str) -> Option<&'static str> {
    match name {
        "E005" => Some("white"),
        "E006" => Some("red"),
        "E007" => Some("blue"),
        "E008" => Some("green"),
        _ => None,
    }
}

/// 名前欄の NAME201_0 → p201（人物ファイルの cast201 と同じ番号）
pub fn char_id(e: &NameEntry) -> String {
    let l = e.label.to_lowercase();
    let l = match l.strip_prefix("name") {
        Some(rest) => format!("p{rest}"),
        None => l,
    };
    l.strip_suffix("_0").map_or(l.clone(), str::to_string)
}

pub fn bgm_id(n: i64) -> String {
    format!("bgm{n:0>3}")
}

pub fn flag_name(bank: i64, id: i64) -> String {
    format!("f{bank}_{id}")
}

/// 台詞の中の命令 → 文中の演出（[wait 8] など）。空文字は何もしない
pub(super) fn inline(ctx: &dyn Ctx, name: &str, args: &[i64]) -> String {
    if SKIP.contains(&name) || name == "CNTR" {
        return String::new();
    }
    match name {
        "E003" => return format!("[wait {}]", arg(args, 0)),
        "E025" => return format!("[speed {}]", arg(args, 0)),
        "E604" => return format!("[bgm {}]", bgm_id(arg(args, 0))),
        "E605" => return "[bgm null]".into(),
        _ => {}
    }
    if let Some(c) = color(name) {
        return format!("[color {c}]");
    }
    ctx.state().count(format!("文中 {name}"));
    // 文中の native の引数は 0 以上の数だけ書ける（負の数のある命令は名前だけ残す）
    let mut parts = vec![name.to_string()];
    if !args.iter().any(|&a| a < 0) {
        parts.extend(args.iter().map(i64::to_string));
    }
    format!("[native {}]", parts.join(" "))
}

/// `[` で始まる演出の記法を取り除く（`[[` は文字の `[`）
pub fn plain(s: &str) -> String {
    let cs: Vec<char> = s.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < cs.len() {
        if cs[i] == '[' && cs.get(i + 1) != Some(&'[') {
            if let Some(j) = cs[i + 1..].iter().position(|&c| c == ']') {
                i += j + 2;
                continue;
            }
        }
        out.push(cs[i]);
        i += 1;
    }
    out.replace("[[", "[")
}

pub(super) struct Line {
    pub(super) speaker: Option<i64>,
    pub(super) parts: Vec<String>,
    pub(super) centered: bool,
    pub(super) green: bool,
}

pub(super) fn native(name: &str, args: &[i64]) -> Step {
    json!({"native": name, "args": args})
}

#[path = "block_control.rs"]
mod control;
#[path = "block_convert.rs"]
mod convert;
use control::control;
pub use convert::convert_block;
