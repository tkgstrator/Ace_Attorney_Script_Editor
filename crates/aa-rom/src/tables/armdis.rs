//! ARM（32 ビット命令）の小さな逆アセンブラー。capstone 5 と同じ文字列（ニーモニック, 引数）を出す。
//!
//! 探偵パートの記号実行（invest_sym.rs）が Python 版（capstone の文字列を読む）と同じ動きをするように、
//! よく使う命令（データ処理・分岐・ロード/ストア・ロード/ストア多重・乗算・svc）だけを扱う。
//! 扱えない命令は None を返す（capstone との一致は crates/aa-rom/tests で確かめる）。

const COND: [&str; 15] = [
    "eq", "ne", "hs", "lo", "mi", "pl", "vs", "vc", "hi", "ls", "ge", "lt", "gt", "le", "",
];
const REGS: [&str; 16] = [
    "r0", "r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "sb", "sl", "fp", "ip", "sp", "lr", "pc",
];
const DP: [&str; 16] = [
    "and", "eor", "sub", "rsb", "add", "adc", "sbc", "rsc", "tst", "teq", "cmp", "cmn", "orr",
    "mov", "bic", "mvn",
];
const SHIFT: [&str; 4] = ["lsl", "lsr", "asr", "ror"];

fn reg(r: u32) -> &'static str {
    REGS[(r & 15) as usize]
}

/// capstone の即値の書き方（9 より大きければ 16 進）
fn imm(v: i64) -> String {
    if v >= 0 {
        if v > 9 {
            format!("#0x{v:x}")
        } else {
            format!("#{v}")
        }
    } else if v < -9 {
        format!("#-0x{:x}", -v)
    } else {
        format!("#-{}", -v)
    }
}

/// 即値のシフト量（lsr/asr の 0 は 32）
fn shift_amount(ty: u32, amt: u32) -> u32 {
    if amt == 0 && (ty == 1 || ty == 2) {
        32
    } else {
        amt
    }
}

/// レジスター + 即値シフト（", lsl #2" の部分。シフト量は 10 進）
fn so_reg_imm(rm: u32, ty: u32, amt: u32) -> String {
    if ty == 0 && amt == 0 {
        return reg(rm).to_string();
    }
    if ty == 3 && amt == 0 {
        return format!("{}, rrx", reg(rm));
    }
    format!(
        "{}, {} #{}",
        reg(rm),
        SHIFT[ty as usize],
        shift_amount(ty, amt)
    )
}

fn reglist(list: u32) -> String {
    let v: Vec<&str> = (0..16).filter(|i| list & (1 << i) != 0).map(reg).collect();
    format!("{{{}}}", v.join(", "))
}

/// 1 命令を (ニーモニック, 引数) にする。扱えない命令は None
pub fn disasm(w: u32, addr: u32) -> Option<(String, String)> {
    let c = w >> 28;
    if c == 0xF {
        // 無条件の命令（blx #imm だけ扱う）
        if (w >> 25) & 7 == 5 {
            let off = (((w & 0xFF_FFFF) << 8) as i32 >> 6) + (((w >> 24) & 1) << 1) as i32;
            let t = (addr as i64 + 8 + off as i64) as u32;
            return Some(("blx".into(), format!("#0x{t:x}")));
        }
        return None;
    }
    let cc = COND[c as usize];
    let op = (w >> 25) & 7;
    match op {
        0 | 1 => data_or_misc(w, cc),
        2 | 3 => {
            if op == 3 && w & 0x10 != 0 {
                return None; // メディア命令・未定義
            }
            Some(single(w, cc))
        }
        4 => multi(w, cc),
        5 => {
            let off = ((w & 0xFF_FFFF) << 8) as i32 >> 6;
            let t = (addr as i64 + 8 + off as i64) as u32;
            let m = if w & (1 << 24) != 0 { "bl" } else { "b" };
            Some((format!("{m}{cc}"), format!("#0x{t:x}")))
        }
        7 if (w >> 24) & 1 == 1 => Some((format!("svc{cc}"), imm((w & 0xFF_FFFF) as i64))),
        _ => None,
    }
}

fn data_or_misc(w: u32, cc: &str) -> Option<(String, String)> {
    let i = (w >> 25) & 1;
    // bx / blx（レジスター）
    if w & 0x0FFF_FFF0 == 0x012F_FF10 {
        return Some((format!("bx{cc}"), reg(w).into()));
    }
    if w & 0x0FFF_FFF0 == 0x012F_FF30 {
        return Some((format!("blx{cc}"), reg(w).into()));
    }
    if i == 0 && (w >> 4) & 0x9 == 0x9 {
        // 乗算・ロード/ストア（ハーフワードなど）
        if (w >> 5) & 3 == 0 {
            return multiply(w, cc);
        }
        return halfword(w, cc);
    }
    let opc = (w >> 21) & 15;
    let s = (w >> 20) & 1;
    if (8..=11).contains(&opc) && s == 0 {
        return None; // mrs/msr など
    }
    if i == 0 && (w >> 4) & 1 == 1 && (w >> 7) & 1 == 1 {
        return None;
    }
    let (rn, rd) = ((w >> 16) & 15, (w >> 12) & 15);
    if (opc == 13 || opc == 15) && rn != 0 {
        return None; // capstone は .word にする
    }
    if i == 0 && (w >> 4) & 1 == 1 && [rd, rn, w & 15, (w >> 8) & 15].contains(&15) {
        return None; // レジスターでシフトする形に pc は使えない
    }
    let name = DP[opc as usize];
    let sfx = if s == 1 && !(8..=11).contains(&opc) {
        "s"
    } else {
        ""
    };
    // 第 2 オペランド
    let (op2, alias): (String, Option<(String, String)>) = if i == 1 {
        let (rot, v) = ((w >> 8) & 15, w & 0xFF);
        let val = v.rotate_right(2 * rot);
        // 最小の回転でないもの（#imm, #rot の形）は扱わない
        if rot != 0 && (0..rot).any(|r| val.rotate_left(2 * r) <= 0xFF) {
            return None;
        }
        (imm(val as i64), None)
    } else {
        let (rm, ty) = (w & 15, (w >> 5) & 3);
        if (w >> 4) & 1 == 0 {
            let amt = (w >> 7) & 31;
            let a = if opc == 13 && !(ty == 0 && amt == 0) {
                // mov + シフト = lsl / lsr / asr / ror / rrx
                if ty == 3 && amt == 0 {
                    Some((format!("rrx{sfx}{cc}"), format!("{}, {}", reg(rd), reg(rm))))
                } else {
                    Some((
                        format!("{}{sfx}{cc}", SHIFT[ty as usize]),
                        format!(
                            "{}, {}, {}",
                            reg(rd),
                            reg(rm),
                            imm(shift_amount(ty, amt) as i64)
                        ),
                    ))
                }
            } else {
                None
            };
            (so_reg_imm(rm, ty, amt), a)
        } else {
            let rs = (w >> 8) & 15;
            let a = (opc == 13).then(|| {
                (
                    format!("{}{sfx}{cc}", SHIFT[ty as usize]),
                    format!("{}, {}, {}", reg(rd), reg(rm), reg(rs)),
                )
            });
            (
                format!("{}, {} {}", reg(rm), SHIFT[ty as usize], reg(rs)),
                a,
            )
        }
    };
    if let Some(a) = alias {
        return Some(a);
    }
    let mn = format!("{name}{sfx}{cc}");
    Some(match opc {
        8..=11 => (mn, format!("{}, {op2}", reg(rn))),
        13 | 15 => (mn, format!("{}, {op2}", reg(rd))),
        _ => (mn, format!("{}, {}, {op2}", reg(rd), reg(rn))),
    })
}

fn multiply(w: u32, cc: &str) -> Option<(String, String)> {
    let (rd, rn, rs, rm) = ((w >> 16) & 15, (w >> 12) & 15, (w >> 8) & 15, w & 15);
    let four = |n: &str| {
        Some((
            format!("{n}{cc}"),
            format!("{}, {}, {}, {}", reg(rn), reg(rd), reg(rm), reg(rs)),
        ))
    };
    match (w >> 20) & 0xFF {
        0x00 | 0x01 if rn == 0 => Some((
            format!("mul{}{cc}", if w & (1 << 20) != 0 { "s" } else { "" }),
            format!("{}, {}, {}", reg(rd), reg(rm), reg(rs)),
        )),
        0x02 | 0x03 | 0x06 => {
            let n = match (w >> 20) & 0xF {
                2 => "mla",
                3 => "mlas",
                _ => "mls",
            };
            Some((
                format!("{n}{cc}"),
                format!("{}, {}, {}, {}", reg(rd), reg(rm), reg(rs), reg(rn)),
            ))
        }
        0x04 => four("umaal"),
        0x08 => four("umull"),
        0x09 => four("umulls"),
        0x0A => four("umlal"),
        0x0B => four("umlals"),
        0x0C => four("smull"),
        0x0D => four("smulls"),
        0x0E => four("smlal"),
        0x0F => four("smlals"),
        _ => None,
    }
}

/// ロード/ストア（ハーフワード・符号付き・ダブルワード）
fn halfword(w: u32, cc: &str) -> Option<(String, String)> {
    let (p, u, i, wb, l) = (
        (w >> 24) & 1,
        (w >> 23) & 1,
        (w >> 22) & 1,
        (w >> 21) & 1,
        (w >> 20) & 1,
    );
    let sh = (w >> 5) & 3;
    let (rn, rd) = ((w >> 16) & 15, (w >> 12) & 15);
    let name = match (l, sh) {
        (1, 1) => "ldrh",
        (0, 1) => "strh",
        (1, 2) => "ldrsb",
        (1, 3) => "ldrsh",
        (0, 2) => "ldrd",
        (0, 3) => "strd",
        _ => return None,
    };
    if p == 0 && wb == 1 {
        return None; // ldrht など
    }
    if i == 0 && (w >> 8) & 15 != 0 {
        return None;
    }
    let first = if name.ends_with('d') {
        if rd % 2 == 1 {
            return None;
        }
        format!("{}, {}", reg(rd), reg(rd + 1))
    } else {
        reg(rd).to_string()
    };
    let sign = if u == 1 { "" } else { "-" };
    let off = if i == 1 {
        let v = ((w >> 4) & 0xF0 | w & 15) as i64;
        if u == 1 {
            imm(v)
        } else if v == 0 {
            "#-0".into()
        } else {
            imm(-v)
        }
    } else {
        format!("{sign}{}", reg(w))
    };
    let zero = i == 1 && ((w >> 4) & 0xF0 | w & 15) == 0 && u == 1 && wb == 0;
    let addr = if p == 1 {
        let wbs = if wb == 1 { "!" } else { "" };
        if zero {
            format!("[{}]{wbs}", reg(rn))
        } else {
            format!("[{}, {off}]{wbs}", reg(rn))
        }
    } else {
        format!("[{}], {off}", reg(rn))
    };
    Some((format!("{name}{cc}"), format!("{first}, {addr}")))
}

/// ldr / str / ldrb / strb
fn single(w: u32, cc: &str) -> (String, String) {
    let (i, p, u, b, wb, l) = (
        (w >> 25) & 1,
        (w >> 24) & 1,
        (w >> 23) & 1,
        (w >> 22) & 1,
        (w >> 21) & 1,
        (w >> 20) & 1,
    );
    let (rn, rd) = ((w >> 16) & 15, (w >> 12) & 15);
    let mut name = String::from(if l == 1 { "ldr" } else { "str" });
    if b == 1 {
        name.push('b');
    }
    if p == 0 && wb == 1 {
        name.push('t');
    }
    // ldr rX, [sp], #4 = pop {rX}（capstone は str の方を push にしない）
    if i == 0 && b == 0 && rn == 13 && w & 0xFFF == 4 && l == 1 && p == 0 && u == 1 && wb == 0 {
        return (format!("pop{cc}"), format!("{{{}}}", reg(rd)));
    }
    let off = if i == 0 {
        let v = (w & 0xFFF) as i64;
        if u == 1 {
            imm(v)
        } else if v == 0 {
            "#-0".into()
        } else {
            imm(-v)
        }
    } else {
        let sign = if u == 1 { "" } else { "-" };
        format!("{sign}{}", so_reg_imm(w & 15, (w >> 5) & 3, (w >> 7) & 31))
    };
    let zero = i == 0 && w & 0xFFF == 0 && u == 1 && wb == 0;
    let addr = if p == 1 {
        let wbs = if wb == 1 { "!" } else { "" };
        if zero {
            format!("[{}]{wbs}", reg(rn))
        } else {
            format!("[{}, {off}]{wbs}", reg(rn))
        }
    } else {
        format!("[{}], {off}", reg(rn))
    };
    (format!("{name}{cc}"), format!("{}, {addr}", reg(rd)))
}

/// ldm / stm（push / pop）
fn multi(w: u32, cc: &str) -> Option<(String, String)> {
    let (p, u, s, wb, l) = (
        (w >> 24) & 1,
        (w >> 23) & 1,
        (w >> 22) & 1,
        (w >> 21) & 1,
        (w >> 20) & 1,
    );
    let rn = (w >> 16) & 15;
    let list = w & 0xFFFF;
    if list == 0 {
        return None;
    }
    let hat = if s == 1 { " ^" } else { "" };
    if rn == 13 && wb == 1 && s == 0 && list.count_ones() > 1 {
        if l == 1 && p == 0 && u == 1 {
            return Some((format!("pop{cc}"), reglist(list)));
        }
        if l == 0 && p == 1 && u == 0 {
            return Some((format!("push{cc}"), reglist(list)));
        }
    }
    let mode = match (p, u) {
        (0, 1) => "",
        (1, 1) => "ib",
        (0, 0) => "da",
        _ => "db",
    };
    let name = if l == 1 { "ldm" } else { "stm" };
    let wbs = if wb == 1 { "!" } else { "" };
    Some((
        format!("{name}{mode}{cc}"),
        format!("{}{wbs}, {}{hat}", reg(rn), reglist(list)),
    ))
}
