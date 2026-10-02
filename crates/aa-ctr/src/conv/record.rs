//! 法廷記録。名前・説明は msg_cmn の evidence_*・cast_*、番号の表は code.bin、持ち物の増減は _sceNN_preset。
//! 台本には法廷記録を増やす命令が無いので、preset の地点（<E750 話 章 番号>）の後に書かれた増減を、その地点のファイルの
//! 終わりで行うことにする。形式の説明は tools/convert/ctr/record.ts の先頭を参照。

use super::gmd::{read_gmd_text, tokenize, Entry, Token};
use super::tables::CodeTables;
use super::Step;
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::Path;

pub struct Record {
    /// 番号 → 証拠品 ID（item0_02_1 など）
    pub evidence_ids: Vec<Option<String>>,
    /// 番号 → 人物 ID（cast201_1_c → p201）
    pub profile_ids: Vec<Option<String>>,
    pub evidence: Map<String, Value>,
    pub profiles: Map<String, Value>,
}

fn strip_tags(s: &str) -> String {
    let a = Regex::new(r"<RT>[^<]*</RT>")
        .expect("re")
        .replace_all(s, "");
    Regex::new(r"</?[A-Z]+[^>]*>")
        .expect("re")
        .replace_all(&a, "")
        .trim()
        .to_string()
}

/// 番号のずれる人だけここに書く。cast204 は版によってミミ（0・1）とキキ（2）の別人
fn profile_id(num: &str, ver: &str) -> String {
    match (
        format!("cast{num}_{ver}").as_str(),
        format!("cast{num}").as_str(),
    ) {
        ("cast204_0" | "cast204_1", _) => "p222".into(),
        ("cast204_2", _) => "p204".into(),
        (_, "cast001") => "p002".into(),
        (_, "cast112") => "p100".into(),
        _ => format!("p{num}"),
    }
}

pub fn load_record(cmn: &Path, tables: &CodeTables) -> crate::Result<Record> {
    let ev_names = read_gmd_text(&cmn.join("evidence_name_00_jpn.txt"))?;
    let ev_caps = read_gmd_text(&cmn.join("evidence_caption_00_jpn.txt"))?;
    let cast_names = read_gmd_text(&cmn.join("cast_name_00_jpn.txt"))?;
    let cast_caps = read_gmd_text(&cmn.join("cast_caption_00_jpn.txt"))?;
    let ev_re = Regex::new(r"^(item[0-9]+_[0-9]+_[0-9]+)_c$").expect("re");
    let cast_re = Regex::new(r"^cast([0-9]+)f?_([0-9]+)_c$").expect("re");
    let age_re = Regex::new(r"\(([0-9]+)\)").expect("re");
    let size_re = Regex::new(r"<SIZE[^>]*>.*?</SIZE>").expect("re");
    let tail_re = Regex::new(r"\s*\([^)]*\)\s*$").expect("re");
    let mut r = Record {
        evidence_ids: vec![],
        profile_ids: vec![],
        evidence: Map::new(),
        profiles: Map::new(),
    };
    for t in &tables.evidence {
        let cap = t.and_then(|t| ev_caps.get(t.caption));
        let id = cap
            .and_then(|c| ev_re.captures(c.label()))
            .map(|m| m[1].to_string());
        r.evidence_ids.push(id.clone());
        if let (Some(id), Some(t), Some(cap)) = (id, t, cap) {
            if !r.evidence.contains_key(&id) {
                let name = ev_names.get(t.name).map_or(id.clone(), |e| e.text.clone());
                r.evidence
                    .insert(id, json!({"name": name, "description": cap.text}));
            }
        }
    }
    for t in &tables.profiles {
        let cap = t.and_then(|t| cast_caps.get(t.caption));
        let id = cap
            .and_then(|c| cast_re.captures(c.label()))
            .map(|m| profile_id(&m[1], &m[2]));
        r.profile_ids.push(id.clone());
        let (Some(id), Some(t), Some(cap)) = (id, t, cap) else {
            continue;
        };
        if r.profiles.contains_key(&id) {
            continue;
        }
        let raw = cast_names.get(t.name).map_or("", |e| e.text.as_str());
        let age = age_re.captures(raw).and_then(|m| m[1].parse::<i64>().ok());
        let cut = size_re.replace(raw, "");
        let cut = tail_re.replace(&cut, "");
        let mut p = Map::new();
        p.insert("name".into(), json!(strip_tags(&cut)));
        if let Some(a) = age {
            p.insert("age".into(), json!(a));
        }
        p.insert("description".into(), json!(cap.text));
        r.profiles.insert(id, Value::Object(p));
    }
    Ok(r)
}

/// ファイル（c003_0061 など）→ そのファイルの終わりで行う法廷記録の増減
pub fn load_gains(preset: &Path, r: &Record) -> crate::Result<HashMap<String, Vec<Step>>> {
    let mut out: HashMap<String, Vec<Step>> = HashMap::new();
    let mut cur: Option<String> = None;
    let id = |kind: i64, idx: i64| -> Option<String> {
        let list = if kind == 0 {
            &r.evidence_ids
        } else {
            &r.profile_ids
        };
        usize::try_from(idx)
            .ok()
            .and_then(|i| list.get(i))
            .cloned()
            .flatten()
    };
    let key = |kind: i64, on: bool| match (kind == 0, on) {
        (true, true) => "give",
        (false, true) => "giveProfile",
        (true, false) => "take",
        (false, false) => "takeProfile",
    };
    let entries: Vec<Entry> = read_gmd_text(preset)?;
    for e in &entries {
        for t in tokenize(&e.text) {
            let Token::Cmd { name, args: a, .. } = &t else {
                continue;
            };
            match name.as_str() {
                "E750" => {
                    let k = format!(
                        "c{:0>3}_{:0>4}",
                        a.get(1).copied().unwrap_or(-1),
                        a.get(2).copied().unwrap_or(-1)
                    );
                    out.entry(k.clone()).or_default();
                    cur = Some(k);
                }
                "E751" if cur.is_some() => {
                    if let Some(x) = id(a[0], a[1]) {
                        out.get_mut(cur.as_ref().expect("cur"))
                            .expect("entry")
                            .push(json!({ key(a[0], true): x }));
                    }
                }
                "E756" if cur.is_some() => {
                    if let (Some(from), Some(to)) = (id(a[0], a[1]), id(a[0], a[2])) {
                        if from != to {
                            let v = out.get_mut(cur.as_ref().expect("cur")).expect("entry");
                            v.push(json!({ key(a[0], false): from }));
                            v.push(json!({ key(a[0], true): to }));
                        }
                    }
                }
                _ => {}
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_ids_follow_the_alias_table() {
        assert_eq!(profile_id("112", "0"), "p100");
        assert_eq!(profile_id("204", "2"), "p204");
        assert_eq!(profile_id("204", "1"), "p222");
        assert_eq!(profile_id("201", "0"), "p201");
    }

    #[test]
    fn strips_ruby_and_tags() {
        assert_eq!(
            strip_tags("<RUBY><RB>成歩堂</RB><RT>なるほどう</RT> <RB>龍一</RB></RUBY>"),
            "成歩堂 龍一"
        );
    }
}
