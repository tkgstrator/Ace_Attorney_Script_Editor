//! 音: SDAT の分割（sound.py）と SSEQ の書き出し（sseq_render.py ほか）

pub mod audition;
pub mod bank;
pub mod channel;
pub mod outputs;
pub mod player;
pub mod render;
pub mod sdat;
pub mod tables;
pub mod track;

use crate::bytes::Result;
use crate::sink::Sink;

/// sound_data.sdat を分割して raw/ に書き出す（out の根は sound）。種類 → 個数 を返す
pub fn export_raw(sdat: &[u8], out: &mut dyn Sink) -> Result<Vec<(String, usize)>> {
    let mut counts: Vec<(String, usize)> = Vec::new();
    for (name, body) in sdat::split(sdat)? {
        let kind = name.split('/').next().unwrap_or("").to_string();
        match counts.iter_mut().find(|(k, _)| *k == kind) {
            Some(c) => c.1 += 1,
            None => counts.push((kind, 1)),
        }
        out.put(&format!("raw/{name}"), body);
    }
    let s: Vec<String> = counts.iter().map(|(k, n)| format!("'{k}': {n}")).collect();
    out.log(&format!("  raw/: {{{}}}", s.join(", ")));
    Ok(counts)
}

/// 1 曲を鳴らして書き出す中身を作る。(種類 bgm / se, 出力)
pub fn render_one(
    sdat: &sdat::Sdat,
    info: &sdat::SeqInfo,
    max_bgm: f64,
    max_se: f64,
    cache: &mut render::Cache,
) -> Result<(&'static str, outputs::One)> {
    let is_bgm = info.name.to_uppercase().starts_with("BGM");
    let r = render::render(sdat, info, if is_bgm { max_bgm } else { max_se }, cache)?;
    let cat = if is_bgm { "bgm" } else { "se" };
    Ok((cat, outputs::write_one(cat, info, r)))
}
