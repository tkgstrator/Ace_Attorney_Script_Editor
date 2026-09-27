//! audio: SSEQ を WAV にして sound/rendered/ に書き出す（sseq_render.py）。parallel があれば曲ごとに並列に鳴らす

use aa_rom::json::Json;
use aa_rom::pipeline::{Options, State};
use aa_rom::sound::render::Cache;
use aa_rom::sound::sdat::{Sdat, SeqInfo};
use aa_rom::Rom;

use crate::args::Args;
use crate::fsink::write;

type Out = Result<(Json, String), aa_rom::Error>;

fn one(sdat: &Sdat, info: &SeqInfo, a: &Args, cache: &mut Cache) -> Out {
    let (cat, o) = aa_rom::sound::render_one(sdat, info, a.max_bgm, a.max_se, cache)?;
    let base = format!("sound/rendered/{cat}/{}", info.name);
    write(&a.out, &format!("{base}.wav"), &o.wav);
    write(&a.out, &format!("{base}.json"), o.json.as_bytes());
    let dur = o.entry.get("duration").map(|d| d.dumps()).unwrap_or_default();
    Ok((o.entry, format!("  {cat}/{}: {dur} 秒", info.name)))
}

#[cfg(feature = "parallel")]
fn all(sdat: &Sdat, seqs: &[SeqInfo], a: &Args) -> Vec<Out> {
    use rayon::prelude::*;
    let pool = rayon::ThreadPoolBuilder::new().num_threads(a.jobs).build().expect("スレッド");
    pool.install(|| seqs.par_iter().map_init(Cache::default, |c, s| one(sdat, s, a, c)).collect())
}

#[cfg(not(feature = "parallel"))]
fn all(sdat: &Sdat, seqs: &[SeqInfo], a: &Args) -> Vec<Out> {
    let mut c = Cache::default();
    seqs.iter().map(|s| one(sdat, s, a, &mut c)).collect()
}

pub fn run(rom: &Rom, a: &Args, _o: &Options, st: &State) -> Result<(), aa_rom::Error> {
    let sdat = Sdat::new(rom.file("sound_data.sdat")?)?;
    let mut seqs = sdat.seqs.clone();
    if let Some(want) = &a.audio_only {
        seqs.retain(|s| want.contains(&s.name) || want.contains(&s.index.to_string()));
    }
    let mut entries = Vec::new();
    for r in all(&sdat, &seqs, a) {
        let (e, msg) = r?;
        println!("{msg}");
        entries.push(e);
    }
    // --audio-only のときは前の index.json の項目に足す
    let idx_path = a.out.join("sound/rendered/index.json");
    if a.audio_only.is_some() {
        if let Ok(t) = std::fs::read_to_string(&idx_path) {
            if let Ok(v) = serde_json_value(&t) {
                if let Some(Json::Arr(old)) = v.get("items") {
                    for e in old {
                        let name = e.get("name").and_then(Json::as_str).unwrap_or("");
                        if !entries.iter().any(|x| x.get("name").and_then(Json::as_str) == Some(name)) {
                            entries.push(e.clone());
                        }
                    }
                }
            }
        }
    }
    let uses = aa_rom::sound::outputs::script_uses(st.script_txt.as_deref().unwrap_or(&[]));
    let (index, html) = aa_rom::sound::outputs::write_index(entries, &uses);
    write(&a.out, "sound/rendered/index.json", index.as_bytes());
    write(&a.out, "sound/rendered/index.html", html.as_bytes());
    println!("  {} 曲", seqs.len());
    Ok(())
}

fn serde_json_value(t: &str) -> Result<Json, ()> {
    aa_rom::json::parse(t).ok_or(())
}
