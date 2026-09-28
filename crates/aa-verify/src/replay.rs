// 差分テスト用: 標準入力の操作の列（1 行に 1 つ。書き方は actions.rs の Act::describe）を、1 歩ずつエンジンで実行し、
// 各歩の後の状態（シーン・pc・mode・フラグ・証拠品・visited・seen）を JSON で 1 行ずつ出す。
// 操作は step でまとめず、エンジンの操作 1 つずつ（TS 側の packages/script の差分テストと同じ単位）。
use aa_verify::engine::Engine;
use aa_verify::expr::JsVal;
use aa_verify::load::load;
use aa_verify::model::{FVal, Model};
use aa_verify::state::Mode;
use std::io::BufRead;

pub fn snapshot(e: &Engine) -> serde_json::Value {
    let m = e.m;
    let mut flags = serde_json::Map::new();
    for (i, v) in e.s.flags.iter().enumerate() {
        let j = match *v {
            FVal::Undef => continue,
            FVal::Bool(b) => b.into(),
            FVal::Num(n) => serde_json::json!(n),
            FVal::Str(_) => JsVal::from_flag(*v, m).string().into(),
        };
        flags.insert(m.flag_names[i].clone(), j);
    }
    let mut visited: Vec<String> = e.s.visited.iter().map(|i| m.scenes.get(i as usize).map_or_else(|| "?".into(), |s| s.id.clone())).collect();
    visited.sort();
    let mut seen: Vec<String> = e.s.seen.iter().map(|i| m.seen_ids[i as usize].clone()).collect();
    seen.sort();
    serde_json::json!({
        "scene": m.scene_name(e.s.scene), "pc": e.s.pc,
        "mode": match e.s.mode { Mode::Run => "run", Mode::Testimony => "testimony", Mode::Investigate => "investigate" },
        "flags": flags,
        "evidence": e.s.evidence.iter().filter(|&&x| !m.is_profile(x)).map(|&x| m.evidence[x as usize].id.clone()).collect::<Vec<_>>(),
        "profiles": e.s.evidence.iter().filter(|&&x| m.is_profile(x)).map(|&x| m.evidence[x as usize].id.clone()).collect::<Vec<_>>(),
        "recordLocked": e.s.record_locked,
        "visited": visited, "seen": seen,
    })
}

/// 操作の書き方から操作を行う
fn apply(e: &mut Engine, m: &Model, a: &str) -> Result<(), String> {
    let (c, rest) = a.split_at(1);
    let item = |id: &str, profile: bool| m.evidence.iter().position(|x| x.id == id && x.profile == profile).map(|i| i as u32)
        .ok_or(format!("未知の証拠品 {id}"));
    let ev = |id: &str| item(id, false);
    match c {
        "a" => e.advance(),
        "p" => e.press(),
        "g" => e.give_up(),
        "c" => e.choose(rest.parse().map_err(|_| "番号")?),
        "v" => e.present(ev(rest)?),
        "r" => e.present(item(rest, true)?),
        "e" => {
            let (x, y) = rest.split_once(',').ok_or("座標")?;
            e.examine(x.parse().map_err(|_| "x")?, y.parse().map_err(|_| "y")?)
        }
        "m" => e.move_to(m.scene_index(rest).unwrap_or(u32::MAX)),
        "t" => {
            let p = e.place()?;
            let i = p.talk.iter().position(|t| m.seen_ids[t.seen as usize] == rest).ok_or("未知の話題")?;
            e.talk(i)
        }
        "i" => match rest.split_once(':') {
            Some((id, n)) => { e.inspect(ev(id)?)?; e.choose(n.parse().map_err(|_| "番号")?) }
            None => e.inspect(ev(rest)?),
        },
        _ => Err(format!("未知の操作 {a}")),
    }
}

pub fn main(file: &str) -> i32 {
    let mut m = match std::fs::read_to_string(file).map_err(|e| e.to_string()).and_then(|t| load(&t)) {
        Ok(m) => m,
        Err(e) => { eprintln!("{e}"); return 1; }
    };
    m.max_life = aa_verify::IMMORTAL;
    let mut e = match Engine::new(&m) {
        Ok(e) => e,
        Err(err) => { println!("{}", serde_json::json!({ "error": err })); return 0; }
    };
    println!("{}", snapshot(&e));
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        let a = line.trim();
        if a.is_empty() { continue; }
        match apply(&mut e, &m, a) {
            Ok(()) => println!("{}", snapshot(&e)),
            Err(err) => { println!("{}", serde_json::json!({ "error": err })); return 0; }
        }
    }
    0
}

/// 網羅的な探索で見つけた状態までの操作の列と、着いた状態を 1 行ずつ出す
pub fn paths(file: &str, count: usize) -> i32 {
    let m = match std::fs::read_to_string(file).map_err(|e| e.to_string()).and_then(|t| load(&t)) {
        Ok(m) => m,
        Err(e) => { eprintln!("{e}"); return 1; }
    };
    let list = match aa_verify::sample_paths(&m, count, aa_verify::DEFAULT_LIMIT * 4) {
        Ok(l) => l,
        Err(e) => { eprintln!("{e}"); return 1; }
    };
    let mut mm = m.clone();
    mm.max_life = aa_verify::IMMORTAL;
    for (ops, s) in list {
        let e = Engine::load(&mm, s);
        println!("{}", serde_json::json!({ "ops": ops, "state": snapshot(&e) }));
    }
    0
}
