//! 場所の話題と、到達不能な枝を落とした places の組み立て。

use super::prune::{prune, set_true};
use super::Step;
use super::{Conv, TalkMeta, Topics};
use serde_json::{json, Map, Value};
use std::collections::HashSet;

impl Conv {
    pub(super) fn build_talk(
        &self,
        topic: &Topics,
        variants: &[(i64, Vec<i64>)],
        run: &dyn Fn(usize) -> Vec<Step>,
    ) -> (Vec<Value>, Vec<TalkMeta>) {
        let mut talk: Vec<Value> = Vec::new();
        let mut meta: Vec<TalkMeta> = Vec::new();
        for &(t, ref ls) in variants {
            let name = self.topic_name(t).unwrap_or_else(|| format!("話題 {t}"));
            let mut sorted = ls.clone();
            sorted.sort();
            for &l in &sorted {
                self.st.add_flag(&topic.flag(t, l));
            }
            // 同じ話題の版（差し替えで入れ替わる）は 1 つの項目にまとめる
            let flag = sorted
                .iter()
                .map(|&l| topic.flag(t, l))
                .collect::<Vec<_>>()
                .join(" or ");
            let chain = |rest: &[i64]| -> Vec<Step> {
                let mut out = vec![];
                for (i, &l) in rest.iter().enumerate() {
                    let then = run(l as usize);
                    if i + 1 == rest.len() {
                        out.extend(then);
                    } else {
                        out.push(json!({"if": topic.flag(t, l), "then": then}));
                    }
                }
                out
            };
            let then = chain(&sorted);
            let id = format!("{}_talk{t}", topic.id);
            meta.push(TalkMeta {
                id: id.clone(),
                flag: format!("({flag})"),
            });
            talk.push(json!({"id": id, "topic": name, "when": flag, "then": then}));
        }
        (talk, meta)
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn pruned_place(
        &self,
        d: &super::invest_place::PlaceData,
        enter: Vec<Step>,
        examine: Vec<Value>,
        present: Map<String, Value>,
        wrong: Option<Vec<Step>>,
        talk: Vec<Value>,
        talk_meta: Vec<TalkMeta>,
        person: Option<&str>,
    ) -> (Value, Vec<TalkMeta>) {
        // この探偵パートでは立たないフラグの枝（と、そのせいで選べない話題）を落とす
        let local = std::cell::RefCell::new(HashSet::<String>::new());
        let possible = |f: &str| {
            if f.starts_with('f') && f.contains('_') {
                self.flag_possible(f, &d.file)
            } else if f.starts_with(&format!("{}_t", d.id)) {
                local.borrow().contains(f)
            } else {
                true
            }
        };
        let (cur_enter, cur_examine, cur_present, cur_wrong, cur_thens) = loop {
            let cur_enter = prune(&json!(enter), &possible)
                .as_array()
                .cloned()
                .unwrap_or_default();
            let cur_examine = prune(&json!(examine), &possible)
                .as_array()
                .cloned()
                .unwrap_or_default();
            let cur_present = prune(&Value::Object(present.clone()), &possible)
                .as_object()
                .cloned()
                .unwrap_or_default();
            let cur_wrong = wrong.as_ref().map(|w| {
                prune(&json!(w), &possible)
                    .as_array()
                    .cloned()
                    .unwrap_or_default()
            });
            let cur_thens: Vec<Vec<Step>> = talk
                .iter()
                .map(|t| {
                    prune(&t["then"], &possible)
                        .as_array()
                        .cloned()
                        .unwrap_or_default()
                })
                .collect();
            let mut found = HashSet::new();
            let open: Vec<Value> = cur_thens
                .iter()
                .enumerate()
                .filter(|(i, _)| {
                    talk[*i]["when"]
                        .as_str()
                        .unwrap_or("")
                        .split(" or ")
                        .any(|f| local.borrow().contains(f))
                })
                .map(|(_, x)| json!(x))
                .collect();
            for x in [
                &json!(cur_enter),
                &json!(cur_examine),
                &Value::Object(cur_present.clone()),
                &json!(cur_wrong.clone().unwrap_or_default()),
                &json!(open),
            ] {
                set_true(x, &mut found);
            }
            let mut changed = false;
            for f in found {
                if f.starts_with(&format!("{}_t", d.id)) && local.borrow_mut().insert(f) {
                    changed = true;
                }
            }
            if !changed {
                break (cur_enter, cur_examine, cur_present, cur_wrong, cur_thens);
            }
        };
        let mut kept_talk = Vec::new();
        let mut kept_meta = Vec::new();
        for (i, t) in talk.iter().enumerate() {
            if !t["when"]
                .as_str()
                .unwrap_or("")
                .split(" or ")
                .any(|f| local.borrow().contains(f))
            {
                continue;
            }
            let mut t = t.clone();
            t["then"] = json!(cur_thens[i]);
            kept_talk.push(t);
            kept_meta.push(talk_meta[i].clone());
        }
        let bg = regex::Regex::new(r"_bg([0-9]+)_")
            .expect("re")
            .captures(&d.short)
            .map(|m| m[1].to_string())
            .unwrap_or_else(|| "0000".into());
        let mut p = Map::new();
        p.insert(
            "name".into(),
            json!(self
                .bg_names
                .get(&format!("BG{bg}"))
                .cloned()
                .unwrap_or_else(|| format!("場所 {bg}"))),
        );
        p.insert("background".into(), json!(format!("bg{bg}")));
        if let Some(person) = person {
            p.insert("person".into(), json!(person));
        }
        if !cur_enter.is_empty() {
            p.insert("enter".into(), json!(cur_enter));
        }
        if !cur_examine.is_empty() {
            p.insert("examine".into(), json!(cur_examine));
        }
        if !kept_talk.is_empty() {
            p.insert("talk".into(), json!(kept_talk));
        }
        if !cur_present.is_empty() {
            p.insert("present".into(), Value::Object(cur_present));
        }
        if let Some(w) = cur_wrong.filter(|w| !w.is_empty()) {
            p.insert("presentWrong".into(), json!(w));
        }
        if !d.moves.is_empty() {
            p.insert("move".into(), json!(d.moves));
        }
        (Value::Object(p), kept_meta)
    }
}
