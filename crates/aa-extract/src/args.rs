//! コマンドの引数

use std::path::PathBuf;

pub use aa_rom::pipeline::STEPS;

pub const USAGE: &str = "使い方: aa-extract <rom.nds> [--out 出力先] [--only 手順,...] [--no-raw]
            [--font-mapping mapping.tsv] [--font-fixes font_fixes.tsv] [--font-extra font_extra.txt]
            [--font-also フォルダー ...] [--path-prefix assets/extracted] [--jobs N]
            [--max-bgm 秒] [--max-se 秒] [--audio-only 名前,...]

手順（--only、既定はすべて）:
  files     NitroFS のファイルをそのまま files/ に
  archives  data.bin の先頭の画像アーカイブ 8 個を data/archiveN/ に
  tail      それより後ろの領域を data/tail/ に
  desks     法廷の机（OBJ）を data/desks/ に
  sound     sound_data.sdat を分割して sound/raw/ に
  font      字形（font/glyphs.txt, sheet.png）。--font-mapping があれば ds-font.png / ds-font.json も
  script    台本を script/ に（文字の対応は --font-mapping と --font-fixes）
  tables    tables/*.json と record/・anims47/・data/tail/chars/by_anim/
  audio     SSEQ を WAV にして sound/rendered/ に（Ogg は作らない）";

pub struct Args {
    pub rom: PathBuf,
    pub out: PathBuf,
    pub steps: Vec<String>,
    pub raw: bool,
    pub font_mapping: Option<PathBuf>,
    pub font_fixes: Option<PathBuf>,
    pub font_extra: Option<PathBuf>,
    pub font_also: Vec<PathBuf>,
    /// JSON に書くパスの頭（Python 版と同じ文字列にするため。既定 assets/extracted）
    pub path_prefix: String,
    pub jobs: usize,
    pub max_bgm: f64,
    pub max_se: f64,
    pub audio_only: Option<Vec<String>>,
}

pub fn parse() -> Result<Args, String> {
    let mut it = std::env::args().skip(1);
    let mut rom = None;
    let root = repo_root();
    let mut a = Args {
        rom: PathBuf::new(),
        out: root.join("assets/extracted-rs"),
        steps: STEPS.iter().map(|s| s.to_string()).collect(),
        raw: true,
        font_mapping: None,
        font_fixes: Some(root.join("tools/rom/font_fixes.tsv")).filter(|p| p.exists()),
        font_extra: Some(root.join("tools/rom/font_extra.txt")).filter(|p| p.exists()),
        font_also: Vec::new(),
        path_prefix: "assets/extracted".into(),
        jobs: 0,
        max_bgm: 900.0,
        max_se: 60.0,
        audio_only: None,
    };
    let val = |it: &mut dyn Iterator<Item = String>, k: &str| {
        it.next().ok_or(format!("{k} の値がありません"))
    };
    while let Some(x) = it.next() {
        match x.as_str() {
            "--out" => a.out = PathBuf::from(val(&mut it, &x)?),
            "--only" => {
                a.steps = val(&mut it, &x)?
                    .split(',')
                    .filter(|s| !s.is_empty())
                    .map(String::from)
                    .collect()
            }
            "--no-raw" => a.raw = false,
            "--font-mapping" => a.font_mapping = Some(PathBuf::from(val(&mut it, &x)?)),
            "--font-fixes" => a.font_fixes = Some(PathBuf::from(val(&mut it, &x)?)),
            "--font-extra" => a.font_extra = Some(PathBuf::from(val(&mut it, &x)?)),
            "--font-also" => a.font_also.push(PathBuf::from(val(&mut it, &x)?)),
            "--path-prefix" => a.path_prefix = val(&mut it, &x)?,
            "--jobs" => a.jobs = val(&mut it, &x)?.parse().map_err(|_| "--jobs は数")?,
            "--max-bgm" => a.max_bgm = val(&mut it, &x)?.parse().map_err(|_| "--max-bgm は数")?,
            "--max-se" => a.max_se = val(&mut it, &x)?.parse().map_err(|_| "--max-se は数")?,
            "--audio-only" => {
                a.audio_only = Some(
                    val(&mut it, &x)?
                        .split(',')
                        .map(|s| s.trim().to_string())
                        .collect(),
                )
            }
            "-h" | "--help" => return Err(String::new()),
            s if s.starts_with("--") => return Err(format!("知らないオプション: {s}")),
            _ => rom = Some(PathBuf::from(x)),
        }
    }
    a.rom = rom.ok_or("ROM を指定してください")?;
    for s in &a.steps {
        if !STEPS.contains(&s.as_str()) {
            return Err(format!("知らない手順です: {s}"));
        }
    }
    Ok(a)
}

/// このリポジトリの根（crates/aa-extract から 2 つ上。見つからなければ今のフォルダー）
pub fn repo_root() -> PathBuf {
    let here = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    here.parent()
        .and_then(|p| p.parent())
        .map(PathBuf::from)
        .filter(|p| p.join("tools/rom").exists())
        .unwrap_or_else(|| PathBuf::from("."))
}
