//! MT Framework の GMD（文章）。形式は tools/rom/mt_gmd.py の先頭を参照。
//! 版 0x10201（5）は文を XOR してあり、版 0x10302（6）は暗号化されていない。

use crate::u32le;
use std::collections::HashMap;

const KEY1: &[u8; 32] = b"fjfajfahajra;tira9tgujagjjgajgoa";
const KEY2: &[u8; 32] = b"mva;eignhpe/dfkfjgp295jtugkpejfu";

pub struct Gmd {
    pub name: String,
    /// (ラベル, 文)。ラベルの無い文もある
    pub entries: Vec<(Option<String>, String)>,
}

pub fn parse(data: &[u8]) -> crate::Result<Gmd> {
    if data.get(..4) != Some(b"GMD\0") {
        return Err("GMD ではありません".into());
    }
    let f = |i: usize| u32le(data, 4 + i * 4) as usize;
    let (ver, nl, ns, ls, ss, nn) = (f(0) as u32, f(4), f(5), f(6), f(7), f(8));
    let name = String::from_utf8_lossy(&data[0x28..0x28 + nn]).into_owned();
    let mut p = 0x28 + nn + 1;
    let items: Vec<u32> = match ver {
        0x10201 => {
            let v = (0..nl).map(|i| u32le(data, p + i * 8)).collect();
            p += nl * 8;
            v
        }
        0x10302 => {
            let v = (0..nl).map(|i| u32le(data, p + i * 0x14)).collect();
            p += nl * 0x14 + if nl > 0 { 0x400 } else { 0 };
            v
        }
        _ => return Err(format!("知らない版 {ver:#x}")),
    };
    let labels: Vec<&[u8]> = data[p..p + ls].split(|&c| c == 0).take(nl).collect();
    let mut body = data[p + ls..p + ls + ss].to_vec();
    if ver == 0x10201 {
        for (i, c) in body.iter_mut().enumerate() {
            *c ^= KEY1[i % 32] ^ KEY2[i % 32];
        }
    }
    let mut by_index = HashMap::new();
    for (i, l) in items.iter().zip(&labels) {
        by_index.insert(*i as usize, String::from_utf8_lossy(l).into_owned());
    }
    let entries = body
        .split(|&c| c == 0)
        .take(ns)
        .enumerate()
        .map(|(i, t)| {
            (
                by_index.get(&i).cloned(),
                String::from_utf8_lossy(t).into_owned(),
            )
        })
        .collect();
    Ok(Gmd { name, entries })
}

/// 文の中の命令（<E040 1 4>、<PAGE> など）の (名前, 引数の数)。
/// 6 には引数が全角数字の命令（<E025 ８>）が少しあるので、全角数字も数字として読む
pub fn commands(text: &str) -> Vec<(String, usize)> {
    let half: String = text
        .chars()
        .map(|c| match c {
            '０'..='９' => char::from(b'0' + (c as u32 - '０' as u32) as u8),
            _ => c,
        })
        .collect();
    let b = half.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'<' {
            if let Some((end, cmd)) = command_at(b, i + 1) {
                out.push(cmd);
                i = end;
                continue;
            }
        }
        i += 1;
    }
    out
}

fn command_at(b: &[u8], start: usize) -> Option<(usize, (String, usize))> {
    let run =
        |from: usize, ok: fn(&u8) -> bool| from + b[from..].iter().take_while(|c| ok(c)).count();
    let mut j = start;
    let digits_after_e = if b.get(j) == Some(&b'E') {
        run(j + 1, u8::is_ascii_digit)
    } else {
        j
    };
    if digits_after_e > j + 1 {
        j = digits_after_e;
    } else {
        j = run(j, u8::is_ascii_uppercase);
        if j == start {
            return None;
        }
    }
    let name = String::from_utf8_lossy(&b[start..j]).into_owned();
    let mut args = 0;
    loop {
        match b.get(j) {
            Some(b'>') => return Some((j + 1, (name, args))),
            Some(b' ') => {
                let k = j + 1 + usize::from(b.get(j + 1) == Some(&b'-'));
                let e = run(k, u8::is_ascii_digit);
                if e == k {
                    return None;
                }
                args += 1;
                j = e;
            }
            _ => return None,
        }
    }
}

/// mt_gmd.py と同じ形の文章（1 行目にもとのファイル）
pub fn to_text(source: &str, g: &Gmd) -> String {
    let mut s = format!("# {source}\n");
    for (i, (label, text)) in g.entries.iter().enumerate() {
        let head = format!("== {i} {}", label.as_deref().unwrap_or(""));
        s.push_str(head.trim_end());
        s.push('\n');
        s.push_str(text);
        s.push('\n');
    }
    s
}
