//! 試聴用の index.html（sseq_audition.py）。ひな形は data/static.json の audition_page。

use crate::json::{py_repr, Json};
use crate::statics;

/// html.escape(s, quote=True)
fn esc(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => o.push_str("&amp;"),
            '<' => o.push_str("&lt;"),
            '>' => o.push_str("&gt;"),
            '"' => o.push_str("&quot;"),
            '\'' => o.push_str("&#x27;"),
            c => o.push(c),
        }
    }
    o
}

/// Python の float の // と %（正の値だけを考える）
fn py_divmod(x: f64, y: f64) -> (f64, f64) {
    let m = x % y;
    let mut div = (x - m) / y;
    let (m, div2) = if m != 0.0 && ((y < 0.0) != (m < 0.0)) {
        (m + y, div - 1.0)
    } else {
        (m, div)
    };
    div = div2;
    let mut fd = div.floor();
    if div - fd > 0.5 {
        fd += 1.0;
    }
    (fd, m)
}

fn fmt_time(sec: Option<f64>) -> String {
    match sec {
        Some(s) if s.is_finite() => {
            let (d, m) = py_divmod(s, 60.0);
            format!("{}:{:06.3}", d as i64, m)
        }
        _ => "-".into(),
    }
}

/// Python の f'{x:.1e}'
fn fmt_e1(x: f64) -> String {
    let s = format!("{x:.1e}");
    let (m, e) = s.split_once('e').unwrap();
    let e: i32 = e.parse().unwrap();
    format!("{m}e{}{:02}", if e < 0 { '-' } else { '+' }, e.abs())
}

fn f(e: &Json, k: &str) -> Option<f64> {
    match e.get(k) {
        Some(Json::Float(x)) => Some(*x),
        Some(Json::Int(i)) => Some(*i as f64),
        _ => None,
    }
}

fn s<'a>(e: &'a Json, k: &str) -> &'a str {
    e.get(k).and_then(Json::as_str).unwrap_or("")
}

/// 数の Python の str()
fn num(e: &Json, k: &str) -> String {
    match e.get(k) {
        Some(Json::Float(x)) => py_repr(*x),
        Some(Json::Int(i)) => i.to_string(),
        _ => String::new(),
    }
}

fn truthy(v: Option<&Json>) -> bool {
    match v {
        None | Some(Json::Null) => false,
        Some(Json::Bool(b)) => *b,
        Some(Json::Int(i)) => *i != 0,
        Some(Json::Float(x)) => *x != 0.0,
        Some(Json::Str(t)) => !t.is_empty(),
        Some(Json::Arr(a)) => !a.is_empty(),
        Some(Json::Obj(m)) => !m.is_empty(),
    }
}

fn notes(e: &Json) -> Vec<String> {
    let mut n = Vec::new();
    if f(e, "duration").is_some_and(|d| d <= 0.02) {
        n.push("音符の無い空のシーケンス".to_string());
    }
    if truthy(e.get("usesRandom")) {
        n.push("乱数あり（実機と同じにはならない）".into());
    }
    if truthy(e.get("capped")) {
        n.push("鳴り続ける音（ゲームが止める）。上限で打ち切り".into());
    }
    if truthy(e.get("missingWaves")) {
        n.push("波形が無い音あり".into());
    }
    let clipped = e
        .get("check")
        .and_then(|c| c.get("clipped"))
        .and_then(Json::as_i64)
        .unwrap_or(0);
    if clipped != 0 {
        n.push(format!("クリップ {clipped} サンプル"));
    }
    if let Some(Json::Obj(u)) = e.get("scriptUses") {
        if !u.is_empty() {
            let mut v: Vec<(String, String)> = u
                .iter()
                .map(|(k, x)| {
                    (
                        k.clone(),
                        match x {
                            Json::Int(i) => i.to_string(),
                            _ => String::new(),
                        },
                    )
                })
                .collect();
            v.sort();
            n.push(format!(
                "台本: {}",
                v.iter()
                    .map(|(k, x)| format!("{k} {x} 回"))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
    }
    n
}

pub fn page(items: &[Json]) -> String {
    let mut rows = Vec::new();
    for e in items {
        let lp = e.get("loop").filter(|l| !matches!(l, Json::Null));
        let wav = s(e, "wav");
        let src = e
            .get("ogg")
            .and_then(Json::as_str)
            .filter(|x| !x.is_empty())
            .unwrap_or(wav);
        let seam = lp.and_then(|l| f(l, "seamRms"));
        let seam_s = seam.filter(|x| x.is_finite()).map_or(String::new(), fmt_e1);
        let btn = lp.map_or(String::new(), |l| {
            format!("<button class=\"lp\" data-src=\"{}\" data-ls=\"{}\" data-le=\"{}\">ループ再生</button>", esc(wav), num(l, "start"), num(l, "end"))
        });
        rows.push(format!(
            "<tr data-cat=\"{}\"><td>{}</td><td><b>{}</b><div class=\"sub\">{} / 音量 {}</div></td><td>{}</td><td>{}</td><td>{}</td><td>{}</td><td><audio controls preload=\"none\" src=\"{}\"></audio> {} <a href=\"{}\">wav</a></td><td class=\"sub\">{}</td></tr>",
            s(e, "category"),
            num(e, "sdatIndex"),
            esc(s(e, "name")),
            esc(s(e, "bankName")),
            num(e, "volume"),
            fmt_time(f(e, "duration")),
            lp.map_or("-".into(), |l| fmt_time(f(l, "start"))),
            lp.map_or("-".into(), |l| fmt_time(f(l, "end"))),
            seam_s,
            esc(src),
            btn,
            esc(wav),
            esc(&notes(e).join("、")),
        ));
    }
    let tpl = statics::get("audition_page").as_str().unwrap_or("");
    tpl.replace("%ROWS%", &rows.join("\n"))
        .replace("%COUNT%", &items.len().to_string())
}
