//! 3DS 版（逆転裁判6）の台本を、シナリオ YAML（1 つの章）に変換する。tools/convert/ctr/（TypeScript）の Rust 版で、
//! 同じ結果（YAML として同じ意味）を出す。命令の意味は docs/3ds.md の「台本の命令」。
//!
//! 入力は aa-ctr の script 手順の出力（`<out>/script/`）と、tools/rom/mt_xfs.py が作る表（`<out>/tables/`・`<out>/hit/`）、
//! ROM から取り出した `<out>/romfs/table/`・`<out>/exefs/code.bin`。

pub mod block;
pub mod calls;
pub mod compare;
pub mod exam;
pub mod file;
pub mod games;
pub mod gmd;
pub mod index;
pub mod invest;
#[path = "invest_done.rs"]
mod invest_done;
#[path = "invest_place.rs"]
mod invest_place;
#[path = "invest_talk.rs"]
mod invest_talk;
pub mod prune;
pub mod record;
pub mod reduce;
pub mod tables;
pub mod yaml;

use block::{NameEntry, State};
use gmd::Entry;
use serde_json::{Map, Value};
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::rc::Rc;

pub type Step = Value;

/// 探偵パートの場所の話題。話題の番号 → 版（<E377>・<E378> で出てくるラベルの番号）
pub struct Topics {
    pub id: String,
    pub variants: Vec<(i64, Vec<i64>)>,
}

/// 探偵パートの入口（<E052> で見る物語のファイルの章・シーン）と、<E394> の行き先
pub struct Hub {
    pub chap: i64,
    pub scene: i64,
    pub end: Vec<Step>,
    pub topics: Option<Rc<Topics>>,
}

#[derive(Clone)]
pub struct TalkMeta {
    pub id: String,
    pub flag: String,
}

/// 場所を組み立てた後に、探偵パートの終わりの判定（<E392>）を足すための手がかり
pub struct Meta {
    pub place_id: String,
    pub short: String,
    pub entries: Rc<Vec<Entry>>,
    pub hub: Rc<Hub>,
    pub talk: Vec<TalkMeta>,
    pub real_end: bool,
    pub done_k: Option<usize>,
    pub psyche: bool,
}

pub struct Conv {
    /// 話の番号（1 始まり）と、台本の番号（0 始まり）
    pub episode: i64,
    pub ep: i64,
    pub sce: String,
    /// script/romfs/script/_output
    pub dir: PathBuf,
    pub script_root: PathBuf,
    pub names: Vec<NameEntry>,
    pub common: Vec<Entry>,
    pub own: Vec<Entry>,
    pub own_first: Option<usize>,
    pub choice_base: Option<i64>,
    pub record: record::Record,
    pub gains: HashMap<String, Vec<Step>>,
    pub script_ids: Vec<Option<String>>,
    /// 表の番号（今の話・11 人物・12 場所）→ 台本の名前の並び
    pub tables: HashMap<i64, Vec<Option<String>>>,
    pub short: Vec<String>,
    pub converted: HashSet<String>,
    pub bg_scripts: Vec<Option<String>>,
    pub chr_scripts: Vec<Option<String>>,
    pub bg_names: HashMap<String, String>,
    pub topic_base: Option<i64>,
    pub topic_entries: Vec<Entry>,
    pub flag_first: HashMap<String, usize>,
    pub flag_other: HashSet<String>,
    pub story: Vec<String>,
    pub games: games::Games,
    pub st: State,
    pub called: RefCell<HashSet<String>>,
    pub active: RefCell<HashSet<String>>,
    pub cache: RefCell<HashMap<String, Option<Rc<Vec<Entry>>>>>,
    pub places: RefCell<Map<String, Value>>,
    pub inv_scenes: RefCell<Map<String, Value>>,
    pub meta: RefCell<HashMap<String, Meta>>,
}

impl Conv {
    pub fn record_id(&self, kind: i64, idx: i64) -> Option<String> {
        let list = if kind == 0 {
            &self.record.evidence_ids
        } else {
            &self.record.profile_ids
        };
        usize::try_from(idx)
            .ok()
            .and_then(|i| list.get(i))
            .cloned()
            .flatten()
    }

    /// 選択肢の文（<E222 番号 飛び先> の番号 → 文）。12 未満は共通、以上はその話の表の枠に順に並ぶ
    pub fn choice_text(&self, id: i64) -> String {
        let text = if id < 12 {
            usize::try_from(id)
                .ok()
                .and_then(|i| self.common.get(i))
                .map(|e| e.text.clone())
        } else {
            match (self.own_first, self.choice_base) {
                (Some(first), Some(base)) => usize::try_from(first as i64 + id - base)
                    .ok()
                    .and_then(|i| self.own.get(i))
                    .filter(|e| !e.label().is_empty())
                    .map(|e| e.text.clone()),
                _ => None,
            }
        };
        text.unwrap_or_else(|| format!("（選択肢 {id}）"))
    }
}
