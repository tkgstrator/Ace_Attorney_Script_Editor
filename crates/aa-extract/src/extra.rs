//! ファイルから読む入力（フォントの対応表など）と、前に書き出したものの読み直し

use std::path::Path;

use aa_rom::pipeline::{Options, OtherFontText, State};
use aa_rom::tail::TailSummary;

use crate::args::{repo_root, Args};

fn read_text(p: &Path) -> Result<String, aa_rom::Error> {
    std::fs::read_to_string(p).map_err(|e| aa_rom::Error(format!("{}: {e}", p.display())))
}

fn opt_text(p: Option<&Path>) -> Result<Option<String>, aa_rom::Error> {
    p.map(read_text).transpose()
}

/// 引数から手順の設定を作る（フォントの対応表などのファイルを読む）
pub fn options(a: &Args) -> Result<Options, aa_rom::Error> {
    let mut also = Vec::new();
    for dir in &a.font_also {
        let name = dir.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        let fx = repo_root().join(format!("tools/rom/font_fixes.{name}.tsv"));
        also.push(OtherFontText {
            glyphs: read_text(&dir.join("glyphs.txt"))?,
            mapping: read_text(&dir.join("mapping.tsv"))?,
            fixes: opt_text(Some(fx.as_path()).filter(|p| p.exists()))?,
        });
    }
    Ok(Options {
        raw: a.raw,
        prefix: a.path_prefix.clone(),
        font_mapping: opt_text(a.font_mapping.as_deref())?,
        font_fixes: opt_text(a.font_fixes.as_deref())?,
        font_extra: opt_text(a.font_extra.as_deref())?,
        font_also: also,
        max_bgm: a.max_bgm,
        max_se: a.max_se,
    })
}

pub fn list_files(dir: &Path, ext: &str) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(dir)
        .map(|it| it.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.ends_with(ext)).collect())
        .unwrap_or_default();
    v.sort();
    v
}

/// この回に行わない手順の結果を、前に書き出したもの（出力先のフォルダー）から読む（Python 版と同じ）
pub fn preload(a: &Args, st: &mut State) {
    let has = |s: &str| a.steps.iter().any(|x| x == s);
    let bg = a.out.join("data/tail/bg");
    if !has("tail") && bg.exists() {
        st.tail = Some(TailSummary { bg_pngs: list_files(&bg, ".png"), tex_pngs: list_files(&a.out.join("data/tail/tex"), ".png") });
    }
    let sc = a.out.join("script");
    if !has("script") && sc.exists() {
        let names = list_files(&sc, ".txt");
        st.script_txt = Some(names.iter().map(|n| String::from_utf8_lossy(&std::fs::read(sc.join(n)).unwrap_or_default()).into_owned()).collect());
    }
}
