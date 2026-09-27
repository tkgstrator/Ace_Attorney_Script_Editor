// サンプル事件（apps/player/cases/clocktower.yaml を IR にしたもの）での、整合性チェックのテスト。
// TS 版との一致は packages/script/src/rust-verify.test.ts と crates/aa-verify/scripts/*.ts で確かめる。
use aa_verify::{load::load, verify_complete, CompleteOptions};

fn model(name: &str) -> aa_verify::model::Model {
    let text = std::fs::read_to_string(format!("{}/tests/data/{name}", env!("CARGO_MANIFEST_DIR")))
        .unwrap();
    load(&text).unwrap()
}

fn complete(m: &aa_verify::model::Model, ts_exact: bool) -> aa_verify::CompleteResult {
    verify_complete(
        m,
        CompleteOptions {
            limit: 100_000,
            liveness: true,
            ts_exact,
            parts: true,
            confirm: Some(100_000),
            progress: None,
        },
    )
    .unwrap()
}

#[test]
fn サンプル事件には問題がない() {
    let m = model("clocktower.json");
    let exact = complete(&m, true);
    assert!(exact.findings.is_empty());
    // TS 版と同じ見分け方なら、状態の数も TS 版と同じ
    assert_eq!(exact.states, 31);
    assert!(complete(&m, false).findings.is_empty());
    assert!(aa_verify::light::check(&m).is_empty());
}

#[test]
fn 手に入らない証拠品をつきつけで求めると詰みになる() {
    // 置時計（clock）を手に入れる所を消し、法廷へ行く条件から外したもの
    let m = model("clocktower-noclock.json");
    for ts_exact in [true, false] {
        let r = complete(&m, ts_exact);
        let msgs: Vec<&str> = r.findings.iter().map(|f| f.message.as_str()).collect();
        assert!(msgs.contains(&"どう遊んでもクリア（end）にたどり着けません"));
        assert!(msgs
            .iter()
            .any(|x| x.starts_with("詰み: つきつけの要求") && x.contains("置時計")));
    }
    let light = aa_verify::light::check(&m);
    assert!(light.iter().any(|f| f.error
        && f.kind == Some(aa_verify::light::KIND_EVIDENCE)
        && f.message.contains("置時計")));
}
