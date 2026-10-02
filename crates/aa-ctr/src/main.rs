//! 3DS の逆転裁判5・6 のカードイメージから台本・音声などを取り出す（tools/rom/ctr.py・mt_*.py の Rust 版）。
//!
//!     aa-ctr <rom.3ds> --keys <aes_keys.txt> --out assets/extracted-rs/aa5 [--only romfs,arc,script,audio] [--jobs N]

mod steps;

use std::path::PathBuf;
use std::time::Instant;

const USAGE: &str = "使い方: aa-ctr <rom.3ds> --keys <aes_keys.txt> --out <出力先> [--only 手順,...] [--jobs N]

手順（--only、既定はすべて。後の手順は前の手順の出力を読む）:
  romfs   復号して exheader.bin・exefs/・romfs/（とその一覧 romfs.tsv）に
  arc     romfs/ の .arc を展開して arc/ に（一覧 arc/index.tsv）
  script  romfs/・arc/ の .gmd を文章にして script/ に（script/index.tsv・commands.tsv）
  audio   romfs/ の .mca と arc/ の .madp を WAV にして sound/ に（長さとループの位置は sound/index.json）
  yaml    3DS 版逆転裁判6の script/・table/ からシナリオ YAML に（--episode N、--yaml-out ファイル）";

pub struct Args {
    pub rom: PathBuf,
    pub keys: PathBuf,
    pub out: PathBuf,
    pub steps: Vec<String>,
    /// yaml 手順で作る話（None なら 1〜5）
    pub episode: Option<i64>,
    /// yaml 手順の出力先（None なら assets/extracted/aa6/converted/epN.yaml）
    pub yaml_out: Option<PathBuf>,
}

fn parse() -> Result<Args, String> {
    let mut it = std::env::args().skip(1);
    let (mut rom, mut keys, mut out) = (None, None, None);
    let (mut episode, mut yaml_out) = (None, None);
    let mut steps: Vec<String> = steps::STEPS.iter().map(|s| s.to_string()).collect();
    let mut jobs = 0;
    while let Some(x) = it.next() {
        let mut val = || it.next().ok_or(format!("{x} の値がありません"));
        match x.as_str() {
            "--keys" => keys = Some(PathBuf::from(val()?)),
            "--out" => out = Some(PathBuf::from(val()?)),
            "--only" => steps = val()?.split(',').map(str::to_string).collect(),
            "--episode" => {
                episode = Some(val()?.parse().map_err(|_| "--episode は 1〜5 の数です")?)
            }
            "--yaml-out" => yaml_out = Some(PathBuf::from(val()?)),
            "--jobs" => jobs = val()?.parse().map_err(|_| "--jobs は数です")?,
            "-h" | "--help" => return Err(String::new()),
            s if s.starts_with('-') => return Err(format!("知らないオプション {s}")),
            _ => rom = Some(PathBuf::from(x)),
        }
    }
    for s in &steps {
        if !steps::STEPS.contains(&s.as_str()) {
            return Err(format!("知らない手順 {s}"));
        }
    }
    if jobs > 0 {
        rayon::ThreadPoolBuilder::new()
            .num_threads(jobs)
            .build_global()
            .map_err(|e| e.to_string())?;
    }
    Ok(Args {
        rom: rom.ok_or("ROM がありません")?,
        keys: keys.ok_or("--keys がありません")?,
        out: out.ok_or("--out がありません")?,
        steps,
        episode,
        yaml_out,
    })
}

fn main() {
    let a = match parse() {
        Ok(a) => a,
        Err(msg) => {
            eprintln!("{msg}\n\n{USAGE}");
            std::process::exit(2);
        }
    };
    let t0 = Instant::now();
    if let Err(e) = steps::run(&a) {
        eprintln!("失敗しました: {e}");
        std::process::exit(1);
    }
    println!(
        "完了（{:.1} 秒）: {}",
        t0.elapsed().as_secs_f64(),
        a.out.display()
    );
}
