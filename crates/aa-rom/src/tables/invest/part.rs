//! パートごとの組み立てと investigation.json の書き出し（tbl_invest.py の part_json 以降）

use std::collections::BTreeSet;

use super::*;

fn part_json(
    a9: &Arm9,
    part: u32,
    bgmap: &BTreeMap<i64, Option<String>>,
    r: &Refs,
) -> Result<Json> {
    let init = a9.u32(T_INIT + part * 4)?;
    let mut j = Json::obj()
        .with("part", part)
        .with("item", format!("{:03}", part * 2))
        .with(
            "kind",
            if init == NOP {
                "court"
            } else {
                "investigation"
            },
        );
    j.set(
        "initial_record",
        parse_record(a9, a9.u32(T_RECORD + part * 4)?)?,
    );
    let cp = a9.u32(T_COURT_PRESENT + part * 4)?;
    j.set(
        "court_present",
        Json::obj()
            .with("table", format!("{cp:#x}"))
            .with("entries", parse_court_present(a9, cp)?),
    );
    if init == NOP {
        return Ok(j);
    }
    let cps = copies(a9, init, part as i64)?;
    let missing = || crate::Error(format!("パート {part} の表の写しが見つかりません"));
    let &(src, n) = cps.get(&PLACES_RAM).ok_or_else(missing)?;
    let places = parse_places(a9.read(src as u32, n as usize)?);
    let &(tsrc, tn) = cps.get(&TALK_RAM).ok_or_else(missing)?;
    j.set(
        "init",
        Json::obj()
            .with("func", format!("{init:#x}"))
            .with("places_src", format!("{src:#x}"))
            .with("talk_src", format!("{tsrc:#x}")),
    );
    let mut exam = Json::obj();
    let (arrive, frame) = (a9.u32(T_ARRIVE + part * 4)?, a9.u32(T_FRAME + part * 4)?);
    j.set(
        "hooks",
        Json::obj()
            .with("arrive", format!("{arrive:#x}"))
            .with("frame", format!("{frame:#x}")),
    );
    let mut pl_json = Vec::new();
    for (id, bg, dest) in places {
        let mut p = Json::obj().with("id", id).with("bg", bg).with("dest", dest);
        let name = if id < N_PLACE_TEX {
            tex(r, PLACE_TEX[0], id, TEX_STEP).with("ocr", Json::Null)
        } else {
            Json::Null
        };
        p.set("name", name);
        p.set("bg_file", bgmap.get(&(bg as i64)).cloned().flatten());
        let on_enter = if arrive != NOP {
            conv_paths(a9, run(a9, arrive, id as i64, part as i64)?, &mut exam)?
        } else {
            vec![]
        };
        let fr = if frame != NOP {
            conv_paths(a9, run(a9, frame, id as i64, part as i64)?, &mut exam)?
        } else {
            vec![]
        };
        let every: Vec<Json> = fr
            .into_iter()
            .filter(|x| !matches!(x.get("do"), Some(Json::Arr(a)) if a.is_empty()))
            .collect();
        // 第 5 話: 着いたときに読み込む台本のパートが変わる（load_part）
        let mut lp: BTreeSet<i64> = BTreeSet::new();
        for x in &on_enter {
            if let Some(Json::Arr(dos)) = x.get("do") {
                for a in dos {
                    if let Some(v) = a.get("load_part").and_then(Json::as_i64) {
                        lp.insert(v);
                    }
                }
            }
        }
        let items: Vec<String> = if lp.is_empty() {
            vec![format!("{:03}", part * 2)]
        } else {
            lp.iter().map(|v| format!("{:03}", v * 2)).collect()
        };
        p.set("on_enter", on_enter);
        p.set("every_frame", every);
        p.set("script_items", items);
        pl_json.push(p);
    }
    j.set("places", pl_json);
    let mut talk = parse_talk(a9.read(tsrc as u32, tn as usize)?);
    for t in &mut talk {
        if let Some(Json::Arr(topics)) = t.get("topics").cloned() {
            let topics: Vec<Json> = topics
                .into_iter()
                .map(|x| x.with("name_ocr", Json::Null))
                .collect();
            t.set("topics", topics);
        }
    }
    j.set("talk", talk);
    let pa = a9.u32(T_PRESENT + part * 4)?;
    j.set(
        "present",
        Json::obj()
            .with("table", format!("{pa:#x}"))
            .with("entries", parse_present(a9, pa)?),
    );
    j.set("examine_tables", exam);
    Ok(j)
}

/// 62 op62 k → 0x020aafd0 + k*0x2c: 4 点 × 2（当たり A, B）, u16 区画 A, B, 外れ
fn court_point(a9: &Arm9, n: u32) -> Result<Vec<Json>> {
    let mut out = Vec::new();
    for k in 0..n {
        let d = a9.read(COURT_POINT + k * 0x2c, 0x2c)?;
        let h = |o: usize| i16::from_le_bytes([d[o], d[o + 1]]);
        let quad = |base: usize| -> Vec<Json> {
            (0..4)
                .map(|i| Json::from(vec![h(base + 4 * i), h(base + 4 * i + 2)]))
                .collect()
        };
        let u = |o: usize| u16::from_le_bytes([d[o], d[o + 1]]) as i64;
        out.push(
            Json::obj()
                .with("id", k)
                .with("quad_a", quad(0))
                .with("section_a", sec(Some(u(32))))
                .with("quad_b", quad(16))
                .with("section_b", sec(Some(u(34))))
                .with("miss", sec(Some(u(36)))),
        );
    }
    Ok(out)
}

/// tables/investigation.json の中身
pub fn export(a9: &Arm9, r: &Refs) -> Result<String> {
    let bgmap = read_bgmap(r.bg_map, r.prefix);
    let names_of = |base: [usize; 2], n: usize, step: usize| -> Vec<Json> {
        (0..n)
            .map(|i| {
                Json::obj()
                    .with("id", i)
                    .with("ja", tex(r, base[0], i, step))
                    .with("en", tex(r, base[1], i, step))
            })
            .collect()
    };
    let names = Json::obj()
        .with("places", names_of(PLACE_TEX, N_PLACE_TEX, TEX_STEP))
        .with("topics", names_of(TOPIC_TEX, N_TOPIC_TEX, TEX_STEP))
        .with("thumbs", names_of(THUMB_TEX, 29, THUMB_STEP));
    let mut parts = Vec::new();
    for p in 0..PARTS {
        parts.push(part_json(a9, p, &bgmap, r)?);
    }
    let doc = Json::obj()
        .with("about", statics::get("invest_about").clone())
        .with("rules", statics::get("invest_rules").clone())
        .with("names", names)
        .with("court_point", court_point(a9, 13)?)
        .with("parts", parts);
    Ok(doc.dumps())
}
