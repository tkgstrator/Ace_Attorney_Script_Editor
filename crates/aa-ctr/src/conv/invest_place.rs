//! 場所の台本から 1 つの場所を作る（tools/convert/ctr/invest.ts の build）。

use super::block::char_id;
use super::games::spot_label;
use super::gmd::{arg, tokenize, Entry, Token};
use super::{Conv, Hub, Meta, Step, Topics};
use regex::Regex;
use serde_json::{json, Map, Value};
use std::rc::Rc;

/// 場所に来たときのラベル（L_EVENT_CHECK、L_START、それ以外の順）
fn entry_label(entries: &[Entry]) -> Option<usize> {
    let skip = Regex::new(r"^(LABEL_0000|L_DTC_END|L_LOAD.*|L_INIT)$").expect("re");
    for l in ["L_EVENT_CHECK", "L_START"] {
        if let Some(k) = entries.iter().position(|e| e.label() == l) {
            return Some(k);
        }
    }
    entries
        .iter()
        .position(|e| !e.label().is_empty() && !skip.is_match(e.label()))
}

fn idx_of(entries: &[Entry], label: &str) -> Option<usize> {
    entries.iter().position(|e| e.label() == label)
}

/// 話題番号 t → 版ラベル l の集まり
fn variants(cmds: &[&Token]) -> Vec<(i64, Vec<i64>)> {
    let mut v: Vec<(i64, Vec<i64>)> = Vec::new();
    let mut add = |t: i64, l: Option<i64>| {
        let k = match v.iter().position(|(n, _)| *n == t) {
            Some(k) => k,
            None => {
                v.push((t, vec![]));
                v.len() - 1
            }
        };
        if let Some(l) = l {
            if !v[k].1.contains(&l) {
                v[k].1.push(l);
            }
        }
    };
    for c in cmds {
        let a = c.args();
        match c.name() {
            Some("E377") => add(arg(a, 1), Some(arg(a, 2))),
            Some("E378") => {
                add(arg(a, 2), Some(arg(a, 3)));
                add(arg(a, 1), None);
            }
            _ => {}
        }
    }
    v
}

pub(super) struct PlaceData {
    pub(crate) id: String,
    pub(crate) file: String,
    pub(crate) short: String,
    pub(crate) entries: Rc<Vec<Entry>>,
    pub(crate) hub: Rc<Hub>,
    pub(crate) moves: Vec<String>,
    pub(crate) cmds: Vec<Token>,
    pub(crate) variants: Vec<(i64, Vec<i64>)>,
    pub(crate) topic: Rc<Topics>,
}

impl Conv {
    pub(super) fn build_place(
        &self,
        id: &str,
        file: &str,
        short: &str,
        entries: &Rc<Vec<Entry>>,
        hub_base: &Rc<Hub>,
        moves: &[String],
    ) -> (Value, Meta) {
        let blocks: Vec<Vec<Token>> = entries.iter().map(|e| tokenize(&e.text)).collect();
        let cmds: Vec<Token> = blocks
            .iter()
            .flatten()
            .filter(|t| t.name().is_some())
            .cloned()
            .collect();
        let refs: Vec<&Token> = cmds.iter().collect();
        let vars = variants(&refs);
        let topic = Rc::new(Topics {
            id: id.to_string(),
            variants: vars.clone(),
        });
        let hub = Rc::new(Hub {
            chap: hub_base.chap,
            scene: hub_base.scene,
            end: hub_base.end.clone(),
            topics: Some(topic.clone()),
        });
        let d = PlaceData {
            id: id.to_string(),
            file: file.to_string(),
            short: short.to_string(),
            entries: entries.clone(),
            hub,
            moves: moves.to_vec(),
            cmds,
            variants: vars,
            topic,
        };
        self.build_place_data(&d, &blocks)
    }

    fn build_place_data(&self, d: &PlaceData, blocks: &[Vec<Token>]) -> (Value, Meta) {
        let run = |k: usize| self.block(&d.short, &d.entries, k, Some(&d.hub));
        let start = entry_label(&d.entries);
        // ゲームは来たあとで L_TOPIC_INIT（あれば）を実行して話題を並べ直す
        let topic_init = idx_of(&d.entries, "L_TOPIC_INIT");
        let enter: Vec<Step> = start.into_iter().chain(topic_init).flat_map(&run).collect();

        // 調べる所: 部品ごとの <E313> を、ラベルで束ねて画面の帯にする
        let mut spots: Vec<(i64, i64)> = vec![];
        for c in &d.cmds {
            if c.is_cmd("E313") {
                let (label, spot) = (arg(c.args(), 2), arg(c.args(), 1));
                if !spots.iter().any(|x| x.0 == label) {
                    spots.push((label, spot));
                }
            }
        }
        let cols = spots.len().max(1);
        let examine: Vec<Value> = spots
            .iter()
            .enumerate()
            .map(|(i, &(label, spot))| {
                json!({
                    "id": format!("{}_inv{label}", d.id),
                    "name": spot_label(&d.entries, label, spot),
                    "area": [(256 * i / cols) as i64, 0, (256 / cols) as i64, 192],
                    "then": usize::try_from(label).ok().map_or(vec![], &run),
                })
            })
            .collect();

        // つきつけ: L_THRUST_nn のブロックの要求（<E224>）を、場所のつきつけにまとめる
        let mut present = Map::new();
        let mut wrong: Option<Vec<Step>> = None;
        for (k, e) in d.entries.iter().enumerate() {
            if !e.label().starts_with("L_THRUST") || e.label().ends_with("_OK") {
                continue;
            }
            let steps = run(k);
            let Some(demand) = steps.iter().find(|s| s.get("demand").is_some()) else {
                continue;
            };
            if let Some(p) = demand.get("present").and_then(Value::as_object) {
                for (key, v) in p {
                    if !present.contains_key(key) {
                        present.insert(key.clone(), v.clone());
                    }
                }
            }
            if wrong.is_none() {
                wrong = demand
                    .get("wrong")
                    .and_then(Value::as_array)
                    .cloned()
                    .or(Some(vec![]));
            }
        }

        let (talk, talk_meta) = self.build_talk(&d.topic, &d.variants, &run);
        let person = self.place_person(&d.cmds, &talk, &enter);
        let hook = Regex::new(r"^(LABEL_0000|L_FLAG_CHECK|L_DTC_END|L_EVENT.*)$").expect("re");
        let real_end =
            d.entries.iter().enumerate().any(|(k, e)| {
                !hook.is_match(e.label()) && blocks[k].iter().any(|t| t.is_cmd("E394"))
            });
        let zero = idx_of(&d.entries, "LABEL_0000");
        let end_k = zero.or_else(|| idx_of(&d.entries, "L_DTC_END"));
        let done_k = end_k.filter(|_| {
            d.entries.iter().enumerate().any(|(k, e)| {
                hook.is_match(e.label()) && blocks[k].iter().any(|t| t.is_cmd("E394"))
            })
        });
        let (place, kept) = self.pruned_place(
            d,
            enter,
            examine,
            present,
            wrong,
            talk,
            talk_meta,
            person.as_deref(),
        );
        (
            place,
            Meta {
                place_id: d.id.clone(),
                short: d.short.clone(),
                entries: d.entries.clone(),
                hub: d.hub.clone(),
                talk: kept,
                real_end,
                done_k,
                psyche: idx_of(&d.entries, "L_PSYCO_START").is_some(),
            },
        )
    }

    fn place_person(&self, cmds: &[Token], talk: &[Value], enter: &[Step]) -> Option<String> {
        // 人物: 話題で呼ぶ人物の台本（<E033 11 番号 …>、chr0105 → p105）。名前欄の表にいる人だけ
        let chr = cmds
            .iter()
            .filter(|c| c.is_cmd("E033") && c.args().first() == Some(&11))
            .find_map(|c| {
                usize::try_from(arg(c.args(), 1))
                    .ok()
                    .and_then(|i| self.chr_scripts.get(i))
                    .and_then(|x| x.as_deref())
                    .and_then(|x| {
                        Regex::new(r"_chr([0-9]+)_")
                            .expect("re")
                            .captures(x)
                            .map(|m| m[1].to_string())
                    })
            });
        let spoken = serde_json::to_string(&(talk, enter)).ok().and_then(|s| {
            Regex::new(r#""(p[0-9]{3})":"#)
                .expect("re")
                .captures(&s)
                .map(|m| m[1].to_string())
        });
        let pid = chr
            .map(|n| format!("p{:0>3}", n.parse::<i64>().unwrap_or(0)))
            .or(spoken)?;
        let person_idx = self.names.iter().position(|n| char_id(n) == pid)?;
        self.st.used_names.borrow_mut().insert(person_idx);
        Some(pid)
    }
}
