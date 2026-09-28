// サイコ・ロック（勾玉で挑む・やめる・錠を壊す）のテスト
// （packages/script/src/fixtures/psyche-lock.yaml を IR にしたもの）。TS 版との一致は rust-verify.test.ts で確かめる。
use aa_verify::actions::Act;
use aa_verify::engine::{BeatKind, Engine};
use aa_verify::{load::load, verify_complete, CompleteOptions};

fn model() -> aa_verify::model::Model {
    let text = std::fs::read_to_string(format!("{}/tests/data/psyche-lock.json", env!("CARGO_MANIFEST_DIR"))).unwrap();
    load(&text).unwrap()
}

fn ev(m: &aa_verify::model::Model, id: &str) -> u32 {
    m.evidence.iter().position(|e| e.id == id).unwrap() as u32
}

/// 台詞を読み飛ばす
fn skip(e: &mut Engine) -> BeatKind {
    for _ in 0..1000 {
        let b = e.beat().unwrap();
        if b != BeatKind::Line && b != BeatKind::Shout { return b; }
        e.advance().unwrap();
    }
    panic!("止まりません");
}

#[test]
fn 勾玉で挑みやめると探偵メニューへ戻る() {
    let m = model();
    let mut e = Engine::new(&m).unwrap();
    assert_eq!(skip(&mut e), BeatKind::Investigate);
    e.present(ev(&m, "magatama")).unwrap();
    assert_eq!(skip(&mut e), BeatKind::Demand);
    Act::GiveUp.run(&mut e).unwrap();
    assert_eq!(skip(&mut e), BeatKind::Investigate);
}

#[test]
fn 錠を全部壊すと話題から先へ進める() {
    let m = model();
    let mut e = Engine::new(&m).unwrap();
    skip(&mut e);
    e.present(ev(&m, "magatama")).unwrap();
    skip(&mut e);
    e.present(ev(&m, "news")).unwrap();
    skip(&mut e);
    e.present(ev(&m, "photo")).unwrap();
    assert_eq!(skip(&mut e), BeatKind::Investigate);
    e.talk(0).unwrap();
    assert_eq!(skip(&mut e), BeatKind::End);
}

#[test]
fn 詰みもたどり着かないシーンもない() {
    let m = model();
    let r = verify_complete(&m, CompleteOptions { limit: 100_000, liveness: true, ts_exact: false, parts: true, confirm: Some(100_000), progress: None }).unwrap();
    assert!(r.findings.is_empty(), "{:?}", r.findings.iter().map(|f| &f.message).collect::<Vec<_>>());
}

fn model23() -> aa_verify::model::Model {
    let text = std::fs::read_to_string(format!("{}/tests/data/lock23.json", env!("CARGO_MANIFEST_DIR"))).unwrap();
    load(&text).unwrap()
}

/// 人物ファイル（証拠品の番号の並びで、profile のもの）
fn profile(m: &aa_verify::model::Model, id: &str) -> u32 {
    m.evidence.iter().position(|e| e.id == id && e.profile).unwrap() as u32
}

#[test]
fn 選択肢のquit_lockで挑戦をやめる() {
    let m = model23();
    let mut e = Engine::new(&m).unwrap();
    assert_eq!(skip(&mut e), BeatKind::Investigate);
    e.present(ev(&m, "magatama")).unwrap();
    assert_eq!(skip(&mut e), BeatKind::Choice);
    e.choose(2).unwrap();
    assert_eq!(skip(&mut e), BeatKind::Investigate);
}

#[test]
fn 尋問で人物ファイルをつきつけられる() {
    let m = model23();
    let r = verify_complete(&m, CompleteOptions { limit: 100_000, liveness: true, ts_exact: false, parts: true, confirm: Some(100_000), progress: None }).unwrap();
    assert!(r.findings.is_empty(), "{:?}", r.findings.iter().map(|f| &f.message).collect::<Vec<_>>());
    let mut e = Engine::new(&m).unwrap();
    skip(&mut e);
    e.present(ev(&m, "magatama")).unwrap();
    skip(&mut e);
    e.choose(0).unwrap();
    skip(&mut e);
    e.talk(0).unwrap();
    for _ in 0..50 {
        if skip(&mut e) == (BeatKind::Statement { cross: true }) && e.present(profile(&m, "larry")).is_ok() { break; }
        e.advance().unwrap();
    }
    assert_eq!(skip(&mut e), BeatKind::End);
}

#[test]
fn ロックを外さないままクリアできると報告する() {
    // psyche-lock.yaml の話題の中身を、解除を待たないようにしたもの（if: unlocked or not unlocked）
    let text = std::fs::read_to_string(format!("{}/tests/data/psyche-lock-open.json", env!("CARGO_MANIFEST_DIR"))).unwrap();
    let m = load(&text).unwrap();
    let r = verify_complete(&m, CompleteOptions { limit: 100_000, liveness: true, ts_exact: false, parts: true, confirm: None, progress: None }).unwrap();
    let msgs: Vec<&String> = r.findings.iter().map(|f| &f.message).collect();
    assert_eq!(msgs, vec!["サイコ・ロック「lock0」を外さないまま、クリア（end）にたどり着けます（ロックが先へ進むのを止めていません）"]);
    assert!(r.findings[0].error);
}
