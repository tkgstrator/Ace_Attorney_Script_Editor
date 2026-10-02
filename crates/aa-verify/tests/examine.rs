// 横長の背景の場所の「調べる」（範囲は背景の座標）のテスト
// （packages/script/src/fixtures/wide-examine.yaml を IR にしたもの）。TS 版との一致は rust-verify.test.ts で確かめる。
use aa_verify::actions::examine_points;
use aa_verify::{load::load, verify_complete, CompleteOptions};

fn model() -> aa_verify::model::Model {
    let text = std::fs::read_to_string(format!(
        "{}/tests/data/wide-examine.json",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap();
    load(&text).unwrap()
}

#[test]
fn 画面の幅より右の範囲も試す点に入る() {
    let m = model();
    let place = m.scenes.iter().find_map(|s| s.place()).unwrap();
    let pts = examine_points(place);
    assert!(pts.iter().any(|&(x, _)| x >= 400 && x < 460));
    // 範囲の右・下の端より外の点は試さない
    assert!(pts.iter().all(|&(x, y)| x < 460 && y < 192));
}

#[test]
fn 右にだけある話を進める所に着ける() {
    let m = model();
    for ts_exact in [true, false] {
        let r = verify_complete(
            &m,
            CompleteOptions {
                limit: 100_000,
                liveness: true,
                ts_exact,
                parts: true,
                confirm: Some(100_000),
                progress: None,
            },
        )
        .unwrap();
        assert!(
            r.findings.is_empty(),
            "{:?}",
            r.findings.iter().map(|f| &f.message).collect::<Vec<_>>()
        );
    }
}
