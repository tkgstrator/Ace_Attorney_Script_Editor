//! ゲーム本体（exefs/code.bin、BLZ 圧縮）の法廷記録の表と、台本の番号表（romfs/table/APP_PARAM_ID_SCRIPT_*.prp）。
//! 形式は tools/convert/ctr/code-tables.ts・scripts.ts の先頭を参照。

use crate::{u16le, u32le};
use regex::bytes::Regex;
use std::path::Path;

const BASE: usize = 0x100000;

/// 3DS の .code の BLZ（後ろから読む LZ）を展開する
pub fn blz(src: &[u8]) -> Vec<u8> {
    let n = src.len();
    let enc_and_hdr = u32le(src, n - 8);
    let inc = u32le(src, n - 4) as usize;
    let hdr = src[n - 5] as usize;
    let enc_len = (enc_and_hdr & 0xff_ffff) as usize;
    let mut out = vec![0u8; n + inc];
    out[..n].copy_from_slice(src);
    let mut s = n - hdr;
    let mut d = out.len();
    let end = n - enc_len;
    while s > end {
        s -= 1;
        let mut flags = out[s] as u32;
        let mut i = 0;
        while i < 8 && s > end {
            if flags & 0x80 != 0 {
                s -= 2;
                let w = out[s] as usize | ((out[s + 1] as usize) << 8);
                let cnt = ((w >> 12) & 0xf) + 3;
                let disp = (w & 0xfff) + 3;
                for _ in 0..cnt {
                    out[d - 1] = out[d - 1 + disp];
                    d -= 1;
                }
            } else {
                d -= 1;
                s -= 1;
                out[d] = out[s];
            }
            i += 1;
            flags <<= 1;
        }
    }
    out
}

/// ptr を指す u32 が stride ごとに並ぶ、いちばん長い並びの位置（u32 の番号）
fn longest_run(words: &[u32], ptr: u32, stride: usize) -> Vec<usize> {
    let mut best: Vec<usize> = Vec::new();
    let mut cur: Vec<usize> = Vec::new();
    for (i, &w) in words.iter().enumerate() {
        if w != ptr {
            continue;
        }
        if cur.last().is_some_and(|&l| i - l == stride / 4) {
            cur.push(i);
        } else {
            cur = vec![i];
        }
        if cur.len() > best.len() {
            best = cur.clone();
        }
    }
    best
}

#[derive(Clone, Copy, Debug)]
pub struct RecordItem {
    /// 名前・説明文の GMD の中の位置
    pub name: usize,
    pub caption: usize,
}

pub struct CodeTables {
    /// 番号 → 項目（0 番は無い）
    pub evidence: Vec<Option<RecordItem>>,
    pub profiles: Vec<Option<RecordItem>>,
}

pub fn load_code_tables(code_bin: &Path) -> crate::Result<CodeTables> {
    let raw = std::fs::read(code_bin).map_err(|e| format!("{}: {e}", code_bin.display()))?;
    let code = blz(&raw);
    let words: Vec<u32> = code
        .chunks_exact(4)
        .map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect();
    let va = |s: &str| -> crate::Result<u32> {
        let needle = [s.as_bytes(), &[0]].concat();
        let i = code
            .windows(needle.len())
            .position(|w| w == needle.as_slice())
            .ok_or(format!("code.bin に {s} がない"))?;
        Ok((BASE + i) as u32)
    };
    let ev = longest_run(&words, va("msg\\evidence_name_00_jpn")?, 40);
    let pr = longest_run(&words, va("msg\\cast_name_00_jpn")?, 32);
    let item = |w: usize| {
        Some(RecordItem {
            name: words[w + 1] as usize,
            caption: words[w + 3] as usize,
        })
    };
    Ok(CodeTables {
        evidence: std::iter::once(None)
            .chain(ev.iter().map(|&w| item(w)))
            .collect(),
        profiles: std::iter::once(None)
            .chain(pr.iter().map(|&w| item(w)))
            .collect(),
    })
}

/// 番号 → 台本の名前（sce02_c200_0100。空の項目は None）
pub fn load_script_ids(path: &Path) -> crate::Result<Vec<Option<String>>> {
    let b = std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let mut heads: Vec<(usize, usize)> = Vec::new();
    let mut i = 0;
    while i + 12 <= b.len() {
        if b[i] == 5 && b[i + 1] == 0 && u32le(&b, i + 8) == 1 && b[i + 7] == 0 && b[i + 6] == 0 {
            heads.push((i, u16le(&b, i + 2) as usize));
        }
        i += 1;
    }
    let re = Regex::new(r"sce[0-9][0-9]_[A-Za-z0-9_]+").expect("script name regex");
    let mut out: Vec<Option<String>> = Vec::new();
    for (k, &(at, obj)) in heads.iter().enumerate() {
        let seg = &b[at..heads.get(k + 1).map_or(b.len(), |h| h.0)];
        let names: Vec<String> = re
            .find_iter(seg)
            .map(|m| String::from_utf8_lossy(m.as_bytes()).into_owned())
            .collect();
        if obj < 2 {
            continue;
        }
        if out.len() < obj - 1 {
            out.resize(obj - 1, None);
        }
        out[obj - 2] = names.get(1).or(names.first()).cloned();
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn longest_run_takes_the_longest_evenly_spaced_run() {
        let mut w = vec![0u32; 40];
        for i in [1, 3, 5, 20, 22, 24, 26] {
            w[i] = 9;
        }
        assert_eq!(longest_run(&w, 9, 8), vec![20, 22, 24, 26]);
    }

    #[test]
    fn script_ids_read_the_second_name_of_each_item() {
        let mut b = vec![0u8; 2];
        for (obj, names) in [
            (2u16, "sce01_c001_0000\0sce01_c001_0001"),
            (4, "sce01_c002_0000"),
        ] {
            b.extend_from_slice(&[5, 0]);
            b.extend_from_slice(&obj.to_le_bytes());
            b.extend_from_slice(&[0, 0, 0, 0]);
            b.extend_from_slice(&1u32.to_le_bytes());
            b.extend_from_slice(names.as_bytes());
        }
        let p = std::env::temp_dir().join("aa-ctr-test-script.prp");
        std::fs::write(&p, &b).unwrap();
        let ids = load_script_ids(&p).unwrap();
        assert_eq!(ids[0].as_deref(), Some("sce01_c001_0001"));
        assert_eq!(ids[1], None);
        assert_eq!(ids[2].as_deref(), Some("sce01_c002_0000"));
    }
}
