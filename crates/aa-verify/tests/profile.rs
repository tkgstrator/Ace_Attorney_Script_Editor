// 人物ファイルのつきつけと、法廷記録を開ける場面ならいつでも詳しく調べる操作のテスト
// （packages/script/src/fixtures/profile-inspect.yaml を IR にしたもの）。TS 版との一致は rust-verify.test.ts で確かめる。
use aa_verify::engine::Engine;
use aa_verify::{load::load, verify_complete, CompleteOptions};

fn model(name: &str) -> aa_verify::model::Model {
    let text = std::fs::read_to_string(format!("{}/tests/data/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap();
    load(&text).unwrap()
}

fn complete(m: &aa_verify::model::Model, ts_exact: bool) -> aa_verify::CompleteResult {
    verify_complete(m, CompleteOptions { limit: 100_000, liveness: true, ts_exact, parts: true, confirm: Some(100_000), progress: None }).unwrap()
}

fn item(m: &aa_verify::model::Model, id: &str, profile: bool) -> u32 {
    m.evidence.iter().position(|e| e.id == id && e.profile == profile).unwrap() as u32
}

#[test]
fn 人物ファイルは証拠品の後ろに並べ最初の中身を持つ() {
    let m = model("profile-inspect.json");
    let tomoe = item(&m, "tomoe", true);
    assert!(m.evidence[tomoe as usize].profile);
    assert!(m.profile_points);
    let e = Engine::new(&m).unwrap();
    assert!(e.s.holds(tomoe));
    assert!(!e.s.holds(item(&m, "ema", true)));
}

#[test]
fn 人物ファイルと詳しく調べる操作を含む章に問題はない() {
    let m = model("profile-inspect.json");
    let exact = complete(&m, true);
    assert!(exact.findings.is_empty());
    // TS 版と同じ見分け方なら、状態の数も TS 版と同じ
    assert_eq!(exact.states, 135);
    assert!(complete(&m, false).findings.is_empty());
    assert!(aa_verify::light::check(&m).is_empty());
}

#[test]
fn 手に入らない人物ファイルをつきつけで求めると詰みになる() {
    let m = model("profile-inspect-noema.json");
    for ts_exact in [true, false] {
        let r = complete(&m, ts_exact);
        assert!(r.findings.iter().any(|f| f.message.starts_with("詰み: つきつけの要求") && f.message.contains("茜")));
    }
    let light = aa_verify::light::check(&m);
    assert!(light.iter().any(|f| f.error && f.kind == Some(aa_verify::light::KIND_EVIDENCE) && f.message.contains("giveProfile")));
}
