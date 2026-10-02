//! 手順を順に行う

use std::time::Instant;

use aa_rom::pipeline::{run_step, State, STEPS};
use aa_rom::Rom;

use crate::args::Args;
use crate::fsink::FileSink;

const TITLE: [&str; 9] = [
    "NitroFS のファイルを書き出します",
    "data.bin の先頭の画像アーカイブを書き出します",
    "data.bin の後半を書き出します",
    "法廷の机を書き出します",
    "sound_data.sdat を書き出します",
    "フォントを書き出します",
    "台本を書き出します",
    "表を書き出します",
    "SSEQ を WAV にします",
];

pub fn run(rom_bytes: &[u8], a: &Args) -> Result<(), aa_rom::Error> {
    let rom = Rom::new(rom_bytes)?;
    std::fs::create_dir_all(&a.out)
        .map_err(|e| aa_rom::Error(format!("{}: {e}", a.out.display())))?;
    let opts = crate::extra::options(a)?;
    let mut st = State::default();
    crate::extra::preload(a, &mut st);
    let mut sink = FileSink::new(a.out.clone());
    for (k, step) in STEPS.iter().enumerate() {
        if !a.steps.iter().any(|x| x == step) {
            continue;
        }
        let t = Instant::now();
        println!("{step}: {}", TITLE[k]);
        if *step == "audio" {
            crate::audio::run(&rom, a, &opts, &st)?;
        } else {
            run_step(&rom, step, &opts, &mut st, &mut sink)?;
        }
        println!("  （{step}: {:.2} 秒）", t.elapsed().as_secs_f64());
    }
    Ok(())
}
