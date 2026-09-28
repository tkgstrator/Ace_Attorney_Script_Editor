//! 法廷の表のパートごとの組み立てと court.json の書き出し（tbl_court.py の parse_part 以降）

use std::collections::{BTreeMap, HashMap, HashSet};

use super::*;

fn parse_part(secs: &[Vec<u16>], labels: &BTreeMap<usize, [u32; 2]>, table: &[Row], chars: &HashMap<u16, String>, kinds: &HashMap<u16, &str>) -> Json {
    let ds: Vec<Ops> = secs.iter().map(|s| decode(s)).collect();
    let mut used: HashSet<usize> = HashSet::new();
    let presents = |sec: i64, used: &mut HashSet<usize>| -> Json {
        let mut out = Vec::new();
        for (i, r) in table.iter().enumerate() {
            if r.section == sec && !r.dead {
                used.insert(i);
                out.push(Json::obj().with("item", r.item).with("kind", *kinds.get(&r.item).unwrap_or(&"?")).with("goto", r.goto)
                    .with("flag", r.flag).with("box_closed", r.box_closed));
            }
        }
        Json::Arr(out)
    };
    let (mut testimonies, mut crosses, mut requests): (Vec<Json>, Vec<Json>, Vec<Json>) = (vec![], vec![], vec![]);
    let mut testimony_secs: Vec<usize> = Vec::new();
    for (k, d) in ds.iter().enumerate() {
        if has(d, 40, Some(1)) {
            let end = (k..ds.len()).find(|&j| has(&ds[j], 40, Some(0))).unwrap_or(k);
            testimonies.push(Json::obj().with("section", k).with("title", title(d, chars))
                .with("statements", ((k + 1)..=end).collect::<Vec<_>>()).with("end", end));
            testimony_secs.push(k);
        }
        if has(d, 41, Some(1)) {
            let after = first(d, 111).and_then(|a| a.first().copied()).map(|v| v as i64 - 128);
            let mut stm = Vec::new();
            for j in region(&ds, k) {
                let p = first(&ds[j], 15);
                let press = p.as_ref().and_then(|p| p.first().copied()).filter(|&v| v >= 128).map(|v| v as usize - 128);
                let nxt = j + 1;
                stm.push(Json::obj()
                    .with("section", j)
                    .with("text", colored_text(&ds[j], chars, Some(3)))
                    .with("press", press)
                    .with("press_box_closed", p.as_ref().map(|p| p.get(1).copied().unwrap_or(0) != 0))
                    .with("press_return", press.filter(|&v| v < ds.len()).and_then(|v| press_end(&ds[v])))
                    .with("present", presents(j as i64, &mut used))
                    .with("if_flags", flags53(&ds[j]))
                    .with("next", nxt)
                    .with("next_route", ds.get(nxt).and_then(connector)));
            }
            let src = testimony_secs.iter().rfind(|&&s| s < k).copied();
            let after_ret = after.filter(|&v| v < ds.len() as i64).and_then(|v| py_at(&ds, v)).and_then(press_end);
            crosses.push(Json::obj().with("section", k).with("title", title(d, chars)).with("testimony", src)
                .with("after_last", after).with("statements", stm).with("after_last_return", after_ret));
        }
        for op in [17u16, 33, 116] {
            if (op != 116 && has(d, op, None)) || (op == 116 && has(d, 116, Some(11))) {
                let w = k + 1;
                let opj = if op != 116 { Json::from(op) } else { Json::from("ds_116_11") };
                requests.push(Json::obj()
                    .with("section", k)
                    .with("op", opj)
                    .with("life_gauge", op == 33)
                    .with("prompt", tail_chars(&colored_text(d, chars, None), 60))
                    .with("correct", presents(k as i64, &mut used))
                    .with("wrong", w)
                    .with("wrong_penalty", ds.get(w).map(|x| penalty(x, labels)))
                    .with("wrong_return", ds.get(w).and_then(press_end)));
            }
        }
    }
    let others: Vec<Json> = table.iter().enumerate().filter(|(i, _)| !used.contains(i))
        .map(|(_, r)| r.json().with("kind", *kinds.get(&r.item).unwrap_or(&"?"))).collect();
    let op43: Vec<usize> = ds.iter().enumerate().filter(|(_, d)| has(d, 43, None)).map(|(k, _)| k).collect();
    Json::obj().with("testimonies", testimonies).with("cross_examinations", crosses).with("present_requests", requests)
        .with("present_other", others).with("sections_with_penalty", op43).with("labels", labels_json(labels))
}

/// 英語の項目で、尋問・要求の区画の命令（15/21/17/33/41/111）が同じか確かめる
fn check_en(jp: &[Vec<u16>], en: &[Vec<u16>], part: &Json) -> Vec<String> {
    const KEYS: [u16; 8] = [15, 17, 21, 33, 41, 69, 111, 121];
    let sec_of = |j: &Json| j.get("section").and_then(Json::as_i64).unwrap_or(0) as usize;
    let arr = |j: Option<&Json>| match j {
        Some(Json::Arr(a)) => a.clone(),
        _ => Vec::new(),
    };
    let crosses = arr(part.get("cross_examinations"));
    let mut secs: Vec<usize> = crosses.iter().map(sec_of).collect();
    for c in &crosses {
        secs.extend(arr(c.get("statements")).iter().map(sec_of));
    }
    secs.extend(arr(part.get("present_requests")).iter().map(sec_of));
    let pick = |s: &[u16]| -> Vec<Tok> { decode(s).into_iter().filter(|t| t.op().is_some_and(|o| KEYS.contains(&o))).collect() };
    secs.into_iter().filter(|&k| Some(pick(&jp[k])) != en.get(k).map(|s| pick(s))).map(|k| format!("§{k}")).collect()
}

fn common_wrong(ents: &[Vec<u16>], chars: &HashMap<u16, String>) -> Json {
    let (secs, labels) = split(&ents[COMMON_ITEM]);
    let mut out = Vec::new();
    for k in COMMON_WRONG {
        let d = decode(&secs[k]);
        let mut j = Json::obj().with("section", k);
        if let Json::Obj(m) = penalty(&d, &labels) {
            for (kk, v) in m {
                j.set(kk, v);
            }
        }
        let modes: Vec<u16> = d.iter().filter_map(|t| match t {
            Tok::Op(41, a) => Some(a.first().copied().unwrap_or(0)),
            _ => None,
        }).collect();
        let first_line = colored_text(&d, chars, None).split('\n').next().unwrap_or("").to_string();
        out.push(j.with("court_mode", modes).with("first_line", first_line));
    }
    Json::Arr(out)
}

/// Python の repr(list of str)
fn py_list_repr(v: &[String]) -> String {
    format!("[{}]", v.iter().map(|s| format!("'{s}'")).collect::<Vec<_>>().join(", "))
}

/// tables/court.json の中身
pub fn export(ents: &[Vec<u16>], a: &Arm9, chars: &HashMap<u16, String>) -> Result<String> {
    let kinds = item_kinds(ents);
    let (mut parts, mut warn) = (Vec::new(), Vec::new());
    for part in 0..N_PARTS {
        let (jp, labels) = split(&ents[2 * part]);
        let (en, _) = split(&ents[2 * part + 1]);
        let table = read_present(a, part)?;
        let go = a.u16(GAMEOVER_TABLE + 2 * part as u32)?;
        let info = parse_part(&jp, &labels, &table, chars, &kinds);
        let bad = check_en(&jp, &en, &info);
        if !bad.is_empty() {
            warn.push(format!("part {part}: 英語で違う区画 {}", py_list_repr(&bad)));
        }
        let mut p = Json::obj()
            .with("part", part)
            .with("items", vec![2 * part, 2 * part + 1])
            .with("gameover_section", (go != 0).then(|| go as i64 - 128))
            .with("present_table_addr", format!("{:#x}", a.u32(PRESENT_TABLE + 4 * part as u32)?))
            .with("present_table", table.iter().map(Row::json).collect::<Vec<_>>());
        if let Json::Obj(m) = info {
            for (k, v) in m {
                p.set(k, v);
            }
        }
        parts.push(p);
    }
    let doc = Json::obj()
        .with("_doc", statics::get("court_doc").clone())
        .with("life_max", 5)
        .with("common_item", COMMON_ITEM)
        .with("common_wrong", common_wrong(ents, chars))
        .with("parts", parts)
        .with("warnings", warn);
    Ok(doc.dumps() + "\n")
}
