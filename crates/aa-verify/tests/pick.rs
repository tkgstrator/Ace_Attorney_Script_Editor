// pick（絵の上の範囲を選ぶ）のテスト（packages/script/src/fixtures/pick.yaml を IR にしたもの）。
// TS 版との一致は rust-verify.test.ts で確かめる。
use aa_verify::actions::{actions, Act, Prep};
use aa_verify::engine::{BeatKind, Engine};
use aa_verify::{load::load, verify_complete, CompleteOptions};

fn model() -> aa_verify::model::Model {
    let text = std::fs::read_to_string(format!("{}/tests/data/pick.json", env!("CARGO_MANIFEST_DIR"))).unwrap();
    load(&text).unwrap()
}

#[test]
fn 範囲と範囲の外とやめるを選べるものの順に試す() {
    let m = model();
    let prep = Prep::new(&m);
    let mut e = Engine::new(&m).unwrap();
    assert_eq!(e.beat().unwrap(), BeatKind::Pick);
    // 手袋の跡の指・範囲の外・やめる（扉の指紋は、まだ選べない）
    assert_eq!(actions(&e, &prep, None).unwrap(), vec![Act::Pick(0), Act::Pick(1), Act::Pick(2)]);
    assert!(e.advance().is_err());
    // 範囲の外の後は、台詞を読んでから同じ pick に戻る
    e.pick(1).unwrap();
    assert_eq!(e.beat().unwrap(), BeatKind::Line);
    e.advance().unwrap();
    assert_eq!(e.beat().unwrap(), BeatKind::Pick);
    e.pick(0).unwrap();
    e.advance().unwrap();
    // 条件で扉の指紋に替わる
    assert_eq!(actions(&e, &prep, None).unwrap(), vec![Act::Pick(0), Act::Pick(1), Act::Pick(2)]);
    e.pick(0).unwrap();
    assert_eq!(e.beat().unwrap(), BeatKind::Demand);
    assert_eq!(Act::Pick(2).describe(&m, &e), "k2");
}

#[test]
fn やめると抜け出せない所を詰みとして見つける() {
    let m = model();
    for ts_exact in [true, false] {
        let r = verify_complete(&m, CompleteOptions { limit: 100_000, liveness: true, ts_exact, parts: true, confirm: Some(100_000), progress: None }).unwrap();
        assert!(r.findings.iter().any(|f| f.message.starts_with("詰み")), "{:?}", r.findings.iter().map(|f| &f.message).collect::<Vec<_>>());
    }
}
