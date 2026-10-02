//! 探偵パートの最初の場所（game+0x68）（tbl_invest_start.py）。出力: tables/invest_start.json
//!
//! 各パートの始めの関数は、場所・話題の表を写したあと `mov r0, #N` → `strb r0, [r4, #0x68]` で最初の場所を決める。

use super::armdis::disasm;
use super::capstone_text::parse_int0;
use crate::bytes::Result;
use crate::json::Json;
use crate::nds::Arm9;

const T_INIT: u32 = 0x020b443c;
const NOP: u32 = 0x0202884c;
const PARTS: u32 = 35;

/// arm9.py の disasm(func, 80, stop_at_ret=True) と同じ範囲の (ニーモニック, 引数)。読めない語は None
fn listing(a9: &Arm9, func: u32) -> Result<Vec<Option<(String, String)>>> {
    let mut out = Vec::new();
    for k in 0..80 {
        let pc = func + 4 * k;
        let ins = disasm(a9.u32(pc)?, pc);
        let ret = match &ins {
            Some((mn, ops)) => {
                (mn == "bx" && ops == "lr")
                    || (mn.starts_with("pop") && ops.contains("pc"))
                    || (mn.starts_with("ldm") && ops.contains("pc") && ops.contains("sp"))
            }
            None => false,
        };
        out.push(ins);
        if ret {
            break;
        }
    }
    Ok(out)
}

/// 「r0」のような r と数字だけのレジスター名か
fn is_rn(s: &str) -> bool {
    s.len() > 1 && s.starts_with('r') && s[1..].chars().all(|c| c.is_ascii_digit())
}

fn start_place(a9: &Arm9, func: u32) -> Result<Option<i64>> {
    let mut last_mov: Vec<(String, i64)> = Vec::new();
    for (mn, ops) in listing(a9, func)?.into_iter().flatten() {
        // re.search(r'mov\s+(r\d+), #(0x[0-9a-f]+|\d+)$', line)
        if mn == "mov" {
            if let Some((r, v)) = ops.split_once(", #") {
                let ok = v.strip_prefix("0x").map_or(
                    !v.is_empty() && v.chars().all(|c| c.is_ascii_digit()),
                    |h| !h.is_empty() && h.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')),
                );
                if is_rn(r) && ok {
                    let v = parse_int0(v).unwrap_or(0);
                    match last_mov.iter_mut().find(|(k, _)| *k == r) {
                        Some(e) => e.1 = v,
                        None => last_mov.push((r.to_string(), v)),
                    }
                }
            }
        }
        // re.search(r'strb\s+(r\d+), \[r\d+, #0x68\]', line)
        if mn == "strb" {
            if let Some((r, m)) = ops.split_once(", [") {
                if is_rn(r) && m.split_once(", #0x68]").is_some_and(|(b, _)| is_rn(b)) {
                    if let Some((_, v)) = last_mov.iter().find(|(k, _)| k == r) {
                        return Ok(Some(*v));
                    }
                }
            }
        }
    }
    Ok(None)
}

/// tables/invest_start.json の中身
pub fn export(a9: &Arm9) -> Result<String> {
    let mut res = Json::obj();
    for part in 0..PARTS {
        let init = a9.u32(T_INIT + part * 4)?;
        if init == NOP {
            continue;
        }
        if let Some(n) = start_place(a9, init)? {
            res.set(part.to_string(), n);
        }
    }
    let doc = Json::obj()
        .with(
            "_about",
            "探偵パートの最初の場所（game+0x68）。tools/rom/tbl_invest_start.py",
        )
        .with("start", res);
    Ok(doc.dumps() + "\n")
}
