//! リトルエンディアンの読み出しの小道具。範囲外は `Err`（Python の struct.error / IndexError に当たる）。

use std::fmt;

/// 読み出しの失敗（範囲外・形式の違い）
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error(pub String);

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for Error {}

pub type Result<T> = std::result::Result<T, Error>;

pub fn err<T>(msg: impl Into<String>) -> Result<T> {
    Err(Error(msg.into()))
}

#[inline]
fn slice(d: &[u8], p: usize, n: usize) -> Result<&[u8]> {
    d.get(p..p.checked_add(n).ok_or_else(|| Error("範囲外".into()))?)
        .ok_or_else(|| Error(format!("範囲外: {p:#x}+{n}")))
}

#[inline]
pub fn u8_at(d: &[u8], p: usize) -> Result<u8> {
    d.get(p).copied().ok_or_else(|| Error(format!("範囲外: {p:#x}")))
}

#[inline]
pub fn u16_at(d: &[u8], p: usize) -> Result<u16> {
    let s = slice(d, p, 2)?;
    Ok(u16::from_le_bytes([s[0], s[1]]))
}

#[inline]
pub fn i16_at(d: &[u8], p: usize) -> Result<i16> {
    Ok(u16_at(d, p)? as i16)
}

#[inline]
pub fn u32_at(d: &[u8], p: usize) -> Result<u32> {
    let s = slice(d, p, 4)?;
    Ok(u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
}

/// 範囲外を気にしなくてよい所で使う（呼ぶ側で長さを確かめてある）
#[inline]
pub fn u16le(d: &[u8], p: usize) -> u16 {
    u16::from_le_bytes([d[p], d[p + 1]])
}

#[inline]
pub fn u32le(d: &[u8], p: usize) -> u32 {
    u32::from_le_bytes([d[p], d[p + 1], d[p + 2], d[p + 3]])
}

/// Python の `d[a:b]`（範囲外は切り詰める）
#[inline]
pub fn py_slice(d: &[u8], a: usize, b: usize) -> &[u8] {
    let b = b.min(d.len());
    let a = a.min(b);
    &d[a..b]
}

/// バイト列を u16 の並びにする（奇数の端は捨てる）
pub fn words16(d: &[u8]) -> Vec<u16> {
    d.as_chunks::<2>().0.iter().map(|c| u16::from_le_bytes([c[0], c[1]])).collect()
}

/// 0 終端の文字列（見つからなければ末尾まで）
pub fn cstr(d: &[u8], p: usize) -> &[u8] {
    let s = py_slice(d, p, d.len());
    match s.iter().position(|&b| b == 0) {
        Some(e) => &s[..e],
        None => s,
    }
}
