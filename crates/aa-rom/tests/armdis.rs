//! armdis（capstone と同じ文字列を出す小さな逆アセンブラー）を capstone の出力と比べる。
//!
//! capstone の出力（TSV: 番地, 語, ニーモニック, 引数）を環境変数 AA_CS_TSV で渡す。無ければ何もしない。
//! 作り方: uv run tools/rom/capstone_dump_rs.py <rom.nds> <作業フォルダー>（cs_all.tsv と trace.tsv）

use aa_rom::tables::armdis::disasm;

#[test]
fn matches_capstone() {
    let Ok(path) = std::env::var("AA_CS_TSV") else { return };
    let text = std::fs::read_to_string(path).unwrap();
    let (mut ok, mut bad, mut skip) = (0, 0, 0);
    let mut shown = 0;
    for line in text.lines() {
        let c: Vec<&str> = line.split('\t').collect();
        let addr = u32::from_str_radix(c[0], 16).unwrap();
        let w = u32::from_str_radix(c[1], 16).unwrap();
        let (mn, ops) = (c[2], c.get(3).copied().unwrap_or(""));
        match disasm(w, addr) {
            None if mn == ".word" => ok += 1,
            None => skip += 1,
            Some((m, o)) if m == mn && o == ops => ok += 1,
            Some((m, o)) => {
                bad += 1;
                if shown < 400 {
                    shown += 1;
                    eprintln!("{addr:08x} {w:08x}: capstone `{mn} {ops}` / armdis `{m} {o}`");
                }
            }
        }
    }
    eprintln!("一致 {ok}、不一致 {bad}、扱わない {skip}");
    assert_eq!(bad, 0);
}

/// Python の記号実行が通った命令（AA_TRACE_TSV: 番地, 語, Arm9.disasm の 1 行）がすべて扱えて一致すること
#[test]
fn covers_traced() {
    let Ok(path) = std::env::var("AA_TRACE_TSV") else { return };
    let text = std::fs::read_to_string(path).unwrap();
    let mut n = 0;
    for line in text.lines() {
        let c: Vec<&str> = line.split('\t').collect();
        let addr = u32::from_str_radix(c[0], 16).unwrap();
        let w = u32::from_str_radix(c[1], 16).unwrap();
        let body = c[2].split_once(": ").unwrap().1;
        let body = body.split("   ;").next().unwrap();
        let (mn, ops) = body.split_once(' ').map(|(a, b)| (a, b.trim())).unwrap_or((body, ""));
        let got = disasm(w, addr).unwrap_or_else(|| panic!("{addr:08x} {w:08x} を扱えない: {body}"));
        assert_eq!((got.0.as_str(), got.1.as_str()), (mn, ops), "{addr:08x}");
        n += 1;
    }
    eprintln!("記号実行で通る命令 {n} 個がすべて一致");
}
