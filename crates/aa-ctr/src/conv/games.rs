//! 正解が台本の外にある遊び（絵の 1 点を指し示す・証拠品を 3D で調べる・霊媒ビジョン・みぬく）。
//! 表は tools/rom/mt_xfs.py で JSON にしたもの（tables/・hit/）と、台本の文（script/）を読む。読み方の説明と、
//! 正解を決めた根拠は tools/convert/ctr/games.ts・games-kokoro.ts の先頭にある。

use super::gmd::{read_gmd_text, Entry};
use super::Step;
use regex::Regex;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub struct Games {
    /// assets/extracted-rs/aa6
    pub root: PathBuf,
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

fn flag_name(bank: i64, id: i64) -> String {
    format!("f{bank}_{id}")
}

/// UTF-16 の単位で先頭から n 個（JS の slice(0, n) に合わせる）
fn slice16(s: &str, n: usize) -> String {
    let mut used = 0;
    let mut out = String::new();
    for c in s.chars() {
        used += c.len_utf16();
        if used > n {
            break;
        }
        out.push(c);
    }
    out
}

fn get_path(v: &Value, po: usize) -> Option<String> {
    v["mParamArray"]["mpArray"].get(po)?["path"]
        .as_str()
        .map(str::to_string)
}

/// テクスチャのパス（UI\2_doc\22_evtcut\tex\event0_02_0_BM_HQ_NOMIP）→ 絵のキー（evtcut_event0_02_0）
fn image_key(path: &str) -> String {
    let last = path.rsplit('\\').next().unwrap_or(path);
    let re = Regex::new(r"(_HD)?_BM.*$").expect("re");
    format!("evtcut_{}", re.replace(last, ""))
}

impl Games {
    /// 絵の 1 点を指し示す遊びを pick にする。po は <E306 番号 1 …> の最初の番号。絵の無いもの・表が無いときは None
    pub fn point_out(&self, po: i64) -> Option<Step> {
        let po = usize::try_from(po).ok()?;
        let table = read_json(&self.root.join("tables/APP_PARAM_POINTOUT.prp.json"))?;
        let cuts = read_json(&self.root.join("tables/APP_PARAM_EVENTCUT.prp.json"))?;
        let path = get_path(&table, po).filter(|p| !p.is_empty())?;
        let hit = self
            .root
            .join("hit")
            .join(format!("{}.h2d.json", path.rsplit('\\').next()?));
        let h = read_json(&hit)?;
        let cut = get_path(&cuts, usize::try_from(h["イベントカット"].as_i64()?).ok()?)
            .filter(|p| !p.is_empty())?;
        let bank = h["フラグ種類"].as_i64().unwrap_or(-1);
        let mut areas: Vec<Value> = Vec::new();
        for a in h["アタリ"].as_array()? {
            let flag = a["アタリフラグ"].as_i64().unwrap_or(-1);
            if flag < 0 {
                continue;
            }
            let r: Vec<i64> = a["アタリ領域"]
                .as_array()?
                .iter()
                .map(|x| x.as_i64().unwrap_or(0))
                .collect();
            areas.push(json!({
                "area": [r[0], r[1], r[2] - r[0], r[3] - r[1]],
                "then": [{"set": {flag_name(bank, flag): true}}],
            }));
        }
        // 外れ（範囲の外）も選べて、フラグを立てずに次へ進む
        areas.push(json!({"area": [0, 0, 512, 256], "then": []}));
        Some(json!({"pick": "", "images": [image_key(&cut)], "areas": areas}))
    }

    /// point_out で立てるフラグ
    pub fn point_out_flags(&self, po: i64) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        if let Some(p) = self.point_out(po) {
            for a in p["areas"].as_array().into_iter().flatten() {
                for s in a["then"].as_array().into_iter().flatten() {
                    for k in s["set"].as_object().into_iter().flat_map(|m| m.keys()) {
                        if !out.contains(k) {
                            out.push(k.clone());
                        }
                    }
                }
            }
        }
        out
    }

    /// 霊媒ビジョンを「託宣を選ぶ → 感覚を選ぶ」の選択肢にする（tools/convert/ctr/games.ts の seance）。分からなければ None
    pub fn seance(&self, ep: i64, round: i64, go: &SeanceGo, kind: i64) -> Option<Vec<Step>> {
        let file = self.root.join(format!(
            "script/arc/archive/spirit_jpn/msg/spirit{ep}{kind}_jpn.txt"
        ));
        let key = format!("{ep}{kind}");
        let senses = senses(&format!("{key}:{round}")).or_else(|| senses(&key))?;
        if !file.exists() {
            return None;
        }
        let mut lines: Vec<(i64, String)> = Vec::new();
        let mut changed: Vec<i64> = Vec::new();
        let re = Regex::new(r"^AST_([0-9]+)_([0-9]+)_([0-9]+)$").expect("re");
        for e in read_gmd_text(&file).ok()? {
            let Some(m) = re.captures(e.label()) else {
                continue;
            };
            if m[1].parse::<i64>().ok()? != round {
                continue;
            }
            let line: i64 = m[2].parse().ok()?;
            if &m[3] == "0" {
                let text = e.text.replace('\n', "");
                match lines.iter_mut().find(|l| l.0 == line) {
                    Some(l) => l.1 = text,
                    None => lines.push((line, text)),
                }
            } else if !changed.contains(&line) {
                changed.push(line);
            }
        }
        let (answer_line, answer_sense) = answer(&format!("{key}:{round}"));
        let answer_sense = answer_sense?;
        let line = answer_line.or_else(|| (changed.len() == 1).then(|| changed[0]))?;
        if !lines.iter().any(|l| l.0 == line) {
            return None;
        }
        let pick_sense = json!({"choice": senses.iter().map(|s| {
            json!({"text": s, "then": if *s == answer_sense { &go.main2 } else { &go.fail_sense }})
        }).collect::<Vec<_>>()});
        lines.sort_by_key(|l| l.0);
        Some(vec![json!({"choice": lines.iter().map(|(k, text)| {
            json!({"text": text, "then": if *k == line { json!([pick_sense]) } else { json!(go.fail_oracle) }})
        }).collect::<Vec<_>>()})])
    }

    /// みぬくを「証言の行を選ぶ」選択肢にする（games-kokoro.ts の perceive）。sce は話の番号 - 1、file は c102_0040 など
    pub fn perceive(&self, sce: i64, file: &str, ok: &[Step], ng: &[Step]) -> Option<Step> {
        let (msg, part, line) = perceive_answer(&format!("{sce}/{file}"))?;
        let path = self
            .root
            .join(format!("script/arc/archive/{msg}_jpn/msg/{msg}_jpn.txt"));
        if !path.exists() {
            return None;
        }
        let re = Regex::new(r"^TEXT_([0-9]+)_([0-9]+)$").expect("re");
        let clean = |s: &str| {
            Regex::new(r"<[^>]*>")
                .expect("re")
                .replace_all(s, "")
                .split_whitespace()
                .collect::<String>()
        };
        let mut lines: Vec<(i64, String)> = Vec::new();
        for e in read_gmd_text(&path).ok()? {
            let Some(m) = re.captures(e.label()) else {
                continue;
            };
            let c = clean(&e.text);
            if m[1].parse::<i64>().ok()? == part && !c.is_empty() {
                lines.push((m[2].parse().ok()?, c));
            }
        }
        if !lines.iter().any(|l| l.0 == line) {
            return None;
        }
        Some(json!({"choice": lines.iter().map(|(n, text)| {
            json!({"text": format!("「{text}」の感情"), "then": if *n == line { ok } else { ng }})
        }).collect::<Vec<_>>()}))
    }
}

pub struct SeanceGo {
    pub main2: Vec<Step>,
    pub fail_oracle: Vec<Step>,
    pub fail_sense: Vec<Step>,
}

const VISUAL: &str = "視覚";

/// 霊媒ビジョンの正解（台本の後の台詞・ヒントから決めたもの）。(行, 感覚)。行が None の回は、託宣が書き換わる行が 1 つだけのもの
fn answer(key: &str) -> (Option<i64>, Option<String>) {
    let (line, sense) = match key {
        "00:1" => (Some(2), "痛み"),
        "00:2" => (Some(3), "儀式の歌"),
        "20:1" => (None, "鈴の音"),
        "20:2" | "20:3" => (Some(3), VISUAL),
        "21:1" => (Some(2), VISUAL),
        "21:2" => (Some(1), "重い"),
        _ => return (None, None),
    };
    (line, Some(sense.to_string()))
}

fn senses(key: &str) -> Option<Vec<String>> {
    let v: &[&str] = match key {
        "00" => &["儀式の歌", "少年の声", "お香の匂い", "痛み"],
        "20" => &["足音", "風の音", "鈴の音", "水の音", VISUAL],
        "20:3" => &[
            "足音",
            "風の音",
            "鈴の音",
            "水の音",
            "冷たい",
            "固い",
            "お香の匂い",
            VISUAL,
        ],
        "21" => &["ギンギルの匂い", "トリサマンのテーマ", "重い", VISUAL],
        _ => return None,
    };
    Some(v.iter().map(|s| s.to_string()).collect())
}

/// みぬくの正解（msg, 部, 行）。キーは「話の番号 - 1/ファイル」
fn perceive_answer(key: &str) -> Option<(&'static str, i64, i64)> {
    Some(match key {
        "1/c102_0040" => ("kokoro_0100", 0, 5),
        "3/c004_0010" => ("kokoro_0300", 0, 3),
        "3/c004_0030" => ("kokoro_0300", 1, 3),
        "3/c004_0070" => ("kokoro_0300", 2, 6),
        "3/c004_0090" => ("kokoro_0300", 3, 6),
        "3/c005_0050" => ("kokoro_0301", 0, 1),
        "3/c005_0130" => ("kokoro_0301", 2, 5),
        _ => return None,
    })
}

/// 3D で調べる所の選択肢の文。そのブロックの最初の台詞、無ければ <E026 n> の先の台詞、どちらも無ければ「調べる所 N」
pub fn spot_label(entries: &[Entry], label: i64, spot: i64) -> String {
    let first_re = Regex::new(r"(?s)<E795>(.*?)<E796>").expect("re");
    let tag_re = Regex::new(r"<[^>]*>").expect("re");
    let ws_re = Regex::new(r"[\s　]").expect("re");
    let tail_re = Regex::new(r"[‥。）]+$").expect("re");
    let first_line = |text: &str| -> String {
        let first = first_re
            .captures(text)
            .map_or("", |m| m.get(1).map_or("", |x| x.as_str()));
        let line = ws_re
            .replace_all(&tag_re.replace_all(first, ""), "")
            .into_owned();
        let line = line.strip_prefix('（').unwrap_or(&line);
        slice16(&tail_re.replace(line, ""), 16)
    };
    let text = usize::try_from(label)
        .ok()
        .and_then(|l| entries.get(l))
        .map_or("", |e| e.text.as_str());
    let call = Regex::new(r"<E026 ([0-9]+)>").expect("re");
    let a = first_line(text);
    if !a.is_empty() {
        return a;
    }
    if let Some(m) = call.captures(text) {
        let n: usize = m[1].parse().unwrap_or(usize::MAX);
        let b = first_line(entries.get(n).map_or("", |e| e.text.as_str()));
        if !b.is_empty() {
            return b;
        }
    }
    format!("調べる所 {spot}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(t: &str) -> Entry {
        Entry {
            label: None,
            text: t.into(),
        }
    }

    #[test]
    fn spot_labels_come_from_the_first_line_or_the_called_block() {
        let e = vec![
            entry("<E795>（こじあけられてしまった箱のフタか‥‥）<E796>"),
            entry("<E026 0>"),
            entry(""),
        ];
        assert_eq!(spot_label(&e, 0, 1), "こじあけられてしまった箱のフタか");
        assert_eq!(spot_label(&e, 1, 1), "こじあけられてしまった箱のフタか");
        assert_eq!(spot_label(&e, 2, 7), "調べる所 7");
    }

    #[test]
    fn image_key_drops_the_texture_suffix() {
        assert_eq!(
            image_key(r"UI\2_doc\22_evtcut\tex\event0_02_0_BM_HQ_NOMIP"),
            "evtcut_event0_02_0"
        );
        assert_eq!(image_key(r"UI\tex\event1_HD_BM_NOMIP"), "evtcut_event1");
    }
}
