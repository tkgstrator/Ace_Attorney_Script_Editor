//! capstone の文字列（ニーモニック・引数）の読み方（tbl_invest_sym.py の _split / _imm / re.split / re.match と同じ）

const COND: [&str; 14] = [
    "eq", "ne", "hs", "cs", "lo", "cc", "mi", "pl", "hi", "ls", "ge", "lt", "gt", "le",
];

/// 'addls' → ('add', 'ls') など（Python の _split と同じ順に試す）
pub fn split_mn(mn: &str) -> (String, String) {
    const BASES: [&str; 30] = [
        "ldrb", "ldrh", "ldrsh", "ldrsb", "strb", "strh", "ldm", "stm", "movs", "ands", "subs",
        "adds", "push", "pop", "mov", "mvn", "ldr", "str", "add", "sub", "cmp", "tst", "and",
        "orr", "bic", "lsl", "lsr", "bx", "bl", "b",
    ];
    for base in BASES {
        if let Some(rest) = mn.strip_prefix(base) {
            if COND.contains(&rest) {
                return (base.into(), rest.into());
            }
            if rest.is_empty() || base == "ldm" || base == "stm" {
                return (base.into(), String::new());
            }
        }
    }
    (mn.into(), String::new())
}

/// Python の int(s, 0)
pub fn parse_int0(s: &str) -> Option<i64> {
    let (neg, t) = match s.strip_prefix('-') {
        Some(t) => (true, t),
        None => (false, s.strip_prefix('+').unwrap_or(s)),
    };
    let v = if let Some(h) = t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")) {
        i64::from_str_radix(h, 16).ok()?
    } else {
        t.parse::<i64>().ok()?
    };
    Some(if neg { -v } else { v })
}

pub fn imm_of(s: &str) -> Option<i64> {
    parse_int0(s.trim().trim_start_matches('#'))
}

/// re.split(r',(?![^\[]*\])', ops) して前後の空白を除く
pub fn split_ops(ops: &str) -> Vec<String> {
    let b: Vec<char> = ops.chars().collect();
    let mut out = Vec::new();
    let mut cur = String::new();
    for i in 0..b.len() {
        if b[i] == ',' {
            // 後ろに [ より先に ] があれば、[] の中の , なので分けない
            let inside = b[i + 1..].iter().find(|&&c| c == '[' || c == ']') == Some(&']');
            if !inside {
                out.push(cur.trim().to_string());
                cur.clear();
                continue;
            }
        }
        cur.push(b[i]);
    }
    out.push(cur.trim().to_string());
    out
}

/// re.match(r'\[(\w+)(?:, #(-?0x[0-9a-f]+|-?\d+))?\]', s) → (レジスター, 位置)
pub fn match_mem(s: &str) -> Option<(String, Option<i64>)> {
    let s = s.strip_prefix('[')?;
    let n = s
        .find(|c: char| !(c.is_alphanumeric() || c == '_'))
        .unwrap_or(s.len());
    if n == 0 {
        return None;
    }
    let (r, rest) = s.split_at(n);
    if rest.starts_with(']') {
        return Some((r.into(), None));
    }
    let num = rest.strip_prefix(", #")?;
    let (neg, t) = match num.strip_prefix('-') {
        Some(t) => (1, t),
        None => (0, num),
    };
    let len = if let Some(h) = t.strip_prefix("0x") {
        let k = h
            .find(|c: char| !matches!(c, '0'..='9' | 'a'..='f'))
            .unwrap_or(h.len());
        if k > 0 {
            2 + k
        } else {
            0
        }
    } else {
        0
    };
    let len = if len > 0 {
        len
    } else {
        t.find(|c: char| !c.is_ascii_digit()).unwrap_or(t.len())
    };
    if len == 0 || !t[len..].starts_with(']') {
        return None;
    }
    Some((r.into(), parse_int0(&num[..neg + len])))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn helpers() {
        assert_eq!(split_mn("addls"), ("add".into(), "ls".into()));
        assert_eq!(split_mn("bls"), ("b".into(), "ls".into()));
        assert_eq!(split_mn("stmdb"), ("stm".into(), "".into()));
        assert_eq!(split_mn("ldrhs"), ("ldr".into(), "hs".into()));
        assert_eq!(split_ops("r0, [r1, #4]"), vec!["r0", "[r1, #4]"]);
        assert_eq!(match_mem("[r4, #0x68]"), Some(("r4".into(), Some(0x68))));
        assert_eq!(match_mem("[sp]"), Some(("sp".into(), None)));
        assert_eq!(match_mem("[r1, r2]"), None);
        assert_eq!(match_mem("[r1, #-4]!"), Some(("r1".into(), Some(-4))));
    }
}
