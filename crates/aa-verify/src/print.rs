// コマンドの出力: 報告を、項目（軽いチェック）・編ごとに分けて並べる。
use aa_verify::actions::NO_PART;
use aa_verify::model::Model;
use aa_verify::partsearch::{part_table, PartStat};
use aa_verify::report::Finding;

/// 報告の編の見出し（シーンの編。編の外・シーンのない報告は「全体」）
fn part_label(m: &Model, table: &[u16], f: &Finding) -> (usize, String) {
    let Some(i) = f.scene.as_deref().and_then(|s| m.scene_index(s)) else {
        return (0, "全体".into());
    };
    match table[i as usize] {
        NO_PART => (usize::MAX, "編の外（詳しく調べるシーンなど）".into()),
        p => {
            let part = &m.parts[p as usize];
            (
                p as usize + 1,
                format!(
                    "{}（{}{}）",
                    part.id,
                    part.kind,
                    if part.title.is_empty() {
                        String::new()
                    } else {
                        format!("・{}", part.title)
                    }
                ),
            )
        }
    }
}

fn line(file: &str, f: &Finding, tag: &str, trace: bool) {
    println!(
        "{file}:{} {}{tag}: {}",
        f.scene.as_deref().unwrap_or(""),
        if f.error { "エラー" } else { "警告" },
        f.message
    );
    if let (true, Some(p)) = (trace, &f.path) {
        println!("    再現手順: {p}");
    }
}

/// 編ごとに分けて出す
fn by_part(m: &Model, file: &str, list: &[&Finding], tag: &str, indent: &str, trace: bool) {
    let table = part_table(m);
    let mut keyed: Vec<(usize, String, &Finding)> = list
        .iter()
        .map(|f| {
            let (k, l) = part_label(m, &table, f);
            (k, l, *f)
        })
        .collect();
    keyed.sort_by_key(|(k, _, _)| *k);
    let mut last = None;
    for (k, label, f) in keyed {
        if last != Some(k) {
            println!("{indent}■ {label}");
            last = Some(k);
        }
        line(file, f, tag, trace);
    }
}

/// 軽いチェックの報告（項目ごと、その中で編ごと）
pub fn light(m: &Model, file: &str, findings: &[Finding], sec: f64) {
    use aa_verify::light::{KIND_EVIDENCE, KIND_FLAG, KIND_REACH};
    let items = [
        (KIND_EVIDENCE, "1. つきつけの証拠品を持てるか"),
        (KIND_REACH, "2. シーン・場所に着けるか"),
        (KIND_FLAG, "3. 条件のフラグを立てられるか（満たせない条件）"),
    ];
    for (kind, title) in items {
        let list: Vec<&Finding> = findings.iter().filter(|f| f.kind == Some(kind)).collect();
        println!("== {title}: {} 件", list.len());
        by_part(m, file, &list, "（軽いチェック）", "  ", false);
    }
    println!("{file}: 軽いチェック {}（状態を区別しない近似。見落とし・誤検知がありえます。網羅的に調べるには --complete）（{sec:.2} 秒）",
        if findings.is_empty() { "OK" } else { "問題あり" });
}

/// 網羅的な探索の報告（編ごと）と、編ごとの状態の数
pub fn complete(
    m: &Model,
    file: &str,
    findings: &[Finding],
    parts: &[PartStat],
    per_scene: &[u32],
    trace: bool,
) {
    let list: Vec<&Finding> = findings.iter().collect();
    by_part(m, file, &list, "", "", trace);
    if parts.is_empty() {
        return;
    }
    println!("編ごとの状態の数（まとまり: 行き来のある編は一緒に調べる）:");
    let table = part_table(m);
    for p in parts {
        println!(
            "  {}: 状態 {}、入り口 {}、解析 {} 回、{:.1} 秒",
            p.id, p.states, p.entries, p.versions, p.sec
        );
        if p.id.contains('+') {
            for (i, part) in m.parts.iter().enumerate() {
                if !p.id.split('+').any(|x| x == part.id) {
                    continue;
                }
                let n: u64 = (0..m.scenes.len())
                    .filter(|&s| table[s] == i as u16)
                    .map(|s| u64::from(per_scene[s]))
                    .sum();
                println!("    {}: 状態 {n}", part.id);
            }
        }
    }
}
