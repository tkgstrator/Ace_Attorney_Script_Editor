//! ROM から素材を取り出して書き出す（tools/rom/extract_assets.py などの Rust 版）。
//!
//!     aa-extract <rom.nds> --out assets/extracted-rs [--only files,archives,...] [--no-raw]
//!
//! 手順は steps.rs を参照。出力の形は Python 版（assets/extracted/）と同じ。

mod args;
mod audio;
mod extra;
mod fsink;
mod steps;

use std::time::Instant;

fn main() {
    let a = match args::parse() {
        Ok(a) => a,
        Err(msg) => {
            eprintln!("{msg}\n\n{}", args::USAGE);
            std::process::exit(2);
        }
    };
    let rom = match std::fs::read(&a.rom) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("ROM を読めません: {}: {e}", a.rom.display());
            std::process::exit(1);
        }
    };
    let t0 = Instant::now();
    if let Err(e) = steps::run(&rom, &a) {
        eprintln!("失敗しました: {e}");
        std::process::exit(1);
    }
    println!("完了（{:.1} 秒）: {}", t0.elapsed().as_secs_f64(), a.out.display());
}
