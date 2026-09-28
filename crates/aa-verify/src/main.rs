// 整合性チェックのコマンド。
//   aa-verify [--complete] [--limit 状態の数] [--json] <シナリオ.yaml | IR.json> ...
//   aa-verify replay <IR.json>   （標準入力の操作の列を実行し、各歩の状態を 1 行ずつ出す。TS 版との差分テスト用）
// YAML を渡したときは、bun で packages/script/src/export-ir.ts を呼んで IR にする。
use aa_verify::{load::load, verify_complete, CompleteOptions, DEFAULT_LIMIT};
use std::path::{Path, PathBuf};
use std::process::{exit, Command};
use std::time::Instant;

mod print;
mod replay;

fn usage() -> ! {
    eprintln!("使い方: aa-verify [--complete] [--limit 状態の数] [--json] <シナリオ.yaml | IR.json> ...");
    eprintln!("  既定は軽いチェック（状態を区別しない近似。すぐ終わる）。--complete で網羅的な探索（TS 版の verify と同じ報告）");
    eprintln!("  --complete と使うもの:");
    eprintln!("    --confirm-traps  詰みを見つけたら、その場面から TS 版と同じ見分け方で探索し直して確かめる");
    eprintln!("    --trace          詰みの場面までの再現手順（エンジンの操作の列）も出す（--json では常に path に入る）");
    eprintln!("    --ts-exact       TS 版と同じ状態の見分け方（状態の数まで TS 版と一致。比べる用）");
    eprintln!("    --whole          編ごとに分けずに調べる / --no-liveness  生きている変数だけをキーに入れる工夫をやめる（確かめ用）");
    eprintln!("  確かめ用: aa-verify replay <IR.json>（標準入力の操作を 1 歩ずつ実行）/ paths <IR.json> [個数] / why <IR> <フラグ> <シーン>");
    exit(2);
}

/// リポジトリの根（packages/script/src/export-ir.ts のある所）を、今の場所と実行ファイルの場所から探す
fn repo_root() -> Option<PathBuf> {
    let starts = [std::env::current_dir().ok(), std::env::current_exe().ok()];
    for s in starts.into_iter().flatten() {
        for d in s.ancestors() {
            if d.join("packages/script/src/export-ir.ts").exists() { return Some(d.to_path_buf()); }
        }
    }
    None
}

/// ファイルを IR の JSON のテキストとして読む（YAML なら bun で変換する）
fn read_ir(file: &str) -> Result<String, String> {
    if file.ends_with(".json") {
        return std::fs::read_to_string(file).map_err(|e| format!("{file} を読めません: {e}"));
    }
    let root = repo_root().ok_or("packages/script/src/export-ir.ts が見つかりません（IR の JSON を渡してください）")?;
    let out = Command::new("bun").arg(root.join("packages/script/src/export-ir.ts")).arg(Path::new(file))
        .output().map_err(|e| format!("bun を起動できません: {e}"))?;
    if !out.status.success() { return Err(String::from_utf8_lossy(&out.stderr).into_owned()); }
    String::from_utf8(out.stdout).map_err(|e| e.to_string())
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("why") {
        // 確かめ用: aa-verify why <IR.json> <変数> <シーン> … 変数がそのシーンの入り口で生きている理由
        let m = load(&read_ir(&args[1]).unwrap()).unwrap();
        let flow = aa_verify::flow::analyze(&m, aa_verify::flow::FlowOptions { all: false, evidence: true });
        let s = m.scene_index(&args[3]).unwrap() as usize;
        let node = if flow.menu[s] != u32::MAX { flow.menu[s] } else if flow.testimony[s] != u32::MAX { flow.testimony[s] } else { flow.base[s] };
        let f = m.flag_index(&args[2]).unwrap();
        let v = flow.vars.iter().position(|x| *x == aa_verify::flow::Var::Flag(f)).unwrap() as u32;
        match flow.explain(v, node) {
            Some(p) => { let names: Vec<String> = p.iter().map(|&n| flow.node_name(&m, n)).collect(); println!("{}", names.join(" → ")); }
            None => println!("生きていない"),
        }
        exit(0);
    }
    if args.first().map(String::as_str) == Some("paths") {
        // 差分テスト用: aa-verify paths <IR.json> [個数]
        let Some(file) = args.get(1) else { usage() };
        let count = args.get(2).and_then(|v| v.parse().ok()).unwrap_or(100);
        exit(replay::paths(file, count));
    }
    if args.first().map(String::as_str) == Some("replay") {
        let Some(file) = args.get(1) else { usage() };
        exit(replay::main(file));
    }
    let (mut complete, mut json, mut liveness, mut limit, mut ts_exact, mut parts) = (false, false, true, DEFAULT_LIMIT, false, true);
    let (mut confirm, mut trace) = (None, false);
    let mut files = vec![];
    let mut it = args.into_iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--complete" => complete = true,
            "--json" => json = true,
            "--no-liveness" => liveness = false,
            "--ts-exact" => ts_exact = true,
            "--whole" => parts = false,
            "--confirm-traps" => confirm = Some(DEFAULT_LIMIT),
            "--trace" => trace = true,
            "--limit" => limit = it.next().and_then(|v| v.parse().ok()).unwrap_or_else(|| usage()),
            _ if a.starts_with("--limit=") => limit = a[8..].parse().unwrap_or_else(|_| usage()),
            _ if a.starts_with("--") => usage(),
            _ => files.push(a),
        }
    }
    if files.is_empty() { usage(); }
    let mut failed = false;
    for file in &files {
        let model = match read_ir(file).and_then(|t| load(&t)) {
            Ok(m) => m,
            Err(e) => { eprintln!("{file}: {e}"); failed = true; continue; }
        };
        let started = Instant::now();
        if !complete {
            let r = aa_verify::light::check(&model);
            let sec = started.elapsed().as_secs_f64();
            failed |= r.iter().any(|f| f.error);
            if json {
                println!("{}", serde_json::json!({ "file": file, "mode": "light", "sec": sec, "findings": aa_verify::report::findings_json(&r) }));
                continue;
            }
            print::light(&model, file, &r, sec);
            continue;
        }
        let progress: Option<Box<dyn Fn(usize, usize)>> = if json { None } else {
            Some(Box::new(|done, found| eprintln!("  … 展開 {done}・発見 {found}")))
        };
        let r = match verify_complete(&model, CompleteOptions { limit, liveness, ts_exact, parts, confirm, progress }) {
            Ok(r) => r,
            Err(e) => { eprintln!("{file}: {e}"); failed = true; continue; }
        };
        let sec = started.elapsed().as_secs_f64();
        failed |= r.findings.iter().any(|f| f.error);
        if json {
            println!("{}", serde_json::json!({
                "file": file, "mode": "complete", "states": r.states, "truncated": r.truncated, "sec": sec,
                "peakPending": r.peak_pending, "peakPendingBytes": r.peak_pending_bytes, "findings": aa_verify::report::findings_json(&r.findings),
                "parts": r.parts.iter().map(|p| serde_json::json!({ "id": p.id, "states": p.states, "entries": p.entries, "versions": p.versions, "sec": p.sec })).collect::<Vec<_>>(),
            }));
            continue;
        }
        print::complete(&model, file, &r.findings, &r.parts, &r.per_scene, trace);
        println!("{file}: {}（シーン {}、証拠品 {}、フラグ {}、調べた状態 {}、{sec:.1} 秒）", if r.findings.is_empty() { "OK" } else { "問題あり" },
            model.scenes.len(), model.evidence.len(), model.declared_flags, r.states);
    }
    exit(i32::from(failed));
}
