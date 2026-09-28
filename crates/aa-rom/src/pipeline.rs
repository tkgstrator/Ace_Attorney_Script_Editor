//! 手順（files / archives / tail / desks / sound / font / script / tables / audio）をまとめて行う入口。
//! コマンド（aa-extract）とブラウザー（aa-wasm）の両方から使う。入力はすべてメモリーの上のもの。

use crate::bytes::Result;
use crate::font::{self, OtherFont};
use crate::sink::Sink;
use crate::tail::TailSummary;
use crate::Rom;

/// 手順の名前（行う順）
pub const STEPS: [&str; 9] = ["files", "archives", "tail", "desks", "sound", "font", "script", "tables", "audio"];

/// ほかの作品のフォント（glyphs.txt・mapping.tsv・font_fixes.<名前>.tsv の中身）
#[derive(Clone, Default)]
pub struct OtherFontText {
    pub glyphs: String,
    pub mapping: String,
    pub fixes: Option<String>,
}

/// 手順の設定。フォントの対応表などは開発のときに作ったもの（無ければその部分を作らない）
#[derive(Clone)]
pub struct Options {
    /// 画像にできたものの展開済み .bin も書き出す
    pub raw: bool,
    /// JSON に書くパスの頭（Python 版と同じ「assets/extracted」）
    pub prefix: String,
    /// font/mapping.tsv（OCR の結果）
    pub font_mapping: Option<String>,
    /// tools/rom/font_fixes.tsv
    pub font_fixes: Option<String>,
    /// tools/rom/font_extra.txt
    pub font_extra: Option<String>,
    pub font_also: Vec<OtherFontText>,
    /// BGM・効果音の長さの上限（秒）
    pub max_bgm: f64,
    pub max_se: f64,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            raw: true,
            prefix: "assets/extracted".into(),
            font_mapping: None,
            font_fixes: None,
            font_extra: None,
            font_also: Vec::new(),
            max_bgm: 900.0,
            max_se: 60.0,
        }
    }
}

/// 手順の間で受け渡すもの
#[derive(Default)]
pub struct State {
    /// tail の結果（data/tail/bg・tex の PNG の名前）
    pub tail: Option<TailSummary>,
    /// script/*.txt の中身（名前の順。audio の scriptUses に使う）
    pub script_txt: Option<Vec<String>>,
}

fn tsv(t: &Option<String>) -> Vec<(i64, String)> {
    t.as_deref().map(font::read_tsv).unwrap_or_default()
}

/// 台本の文字の対応
pub fn chars(o: &Options) -> std::collections::HashMap<u16, String> {
    crate::script::load_chars(&tsv(&o.font_mapping), &tsv(&o.font_fixes))
}

/// 書き出さずに tail の結果（PNG の名前）だけを求める
struct Discard;
impl Sink for Discard {
    fn put(&mut self, _: &str, _: Vec<u8>) {}
}

fn tail_summary<'s>(rom: &Rom, st: &'s mut State) -> Result<&'s TailSummary> {
    if st.tail.is_none() {
        st.tail = Some(rom.export_tail(&mut Discard, false)?);
    }
    Ok(st.tail.as_ref().unwrap())
}

/// font/
fn font_step(rom: &Rom, o: &Options, out: &mut dyn Sink) -> Result<()> {
    let glyphs = font::extract(rom.bytes)?;
    out.put("font/glyphs.txt", font::glyphs_txt(&glyphs).into_bytes());
    out.put("font/sheet.png", font::sheet_png(&glyphs));
    out.log(&format!("  字形 {} 個", glyphs.len()));
    let Some(mapping) = &o.font_mapping else {
        out.log("  文字の対応表が無いので ds-font.png / ds-font.json は作りません");
        return Ok(());
    };
    let also: Vec<OtherFont> = o
        .font_also
        .iter()
        .map(|f| {
            let mut m = font::read_tsv(&f.mapping);
            for (k, v) in tsv(&f.fixes) {
                font::tsv_set(&mut m, k, v);
            }
            OtherFont { glyphs: font::read_glyphs(&f.glyphs), mapping: m }
        })
        .collect();
    let extra = o.font_extra.as_deref().map(font::read_extra).unwrap_or_default();
    let (png, json) = font::build(&glyphs, &font::read_tsv(mapping), &tsv(&o.font_fixes), &also, &extra);
    out.put("font/ds-font.png", png);
    out.put("font/ds-font.json", json.into_bytes());
    Ok(())
}

/// script/ と script/json/
fn script_step(rom: &Rom, o: &Options, st: &mut State, out: &mut dyn Sink) -> Result<()> {
    let ents = crate::script::entries(rom.file("mes_all.bin")?)?;
    let chars = chars(o);
    let bgs = tail_summary(rom, st)?.bg_pngs.clone();
    let mut mem = crate::sink::MemSink::default();
    crate::script::dump::export(&ents, &chars, Some(rom.bytes), &bgs, &mut mem)?;
    let mut txt: Vec<(String, String)> = Vec::new();
    for (p, d) in mem.files {
        if p.ends_with(".txt") {
            txt.push((p.clone(), String::from_utf8_lossy(&d).into_owned()));
        }
        out.put(&format!("script/{p}"), d);
    }
    txt.sort();
    st.script_txt = Some(txt.into_iter().map(|x| x.1).collect());
    let a9 = crate::nds::Arm9::new(rom.bytes)?;
    for (i, e) in ents.iter().enumerate() {
        let j = crate::script::json::export(e, i, &chars, Some(&a9), &o.prefix)?;
        out.put(&format!("script/json/{i:03}.json"), j.into_bytes());
    }
    Ok(())
}

/// tables/ と record/・anims47/・data/tail/chars/by_anim/
fn tables_step(rom: &Rom, o: &Options, st: &mut State, out: &mut dyn Sink) -> Result<()> {
    let items = crate::script::items(rom.file("mes_all.bin")?)?;
    let chars = chars(o);
    let t = tail_summary(rom, st)?;
    let inp = crate::tables::Inputs {
        rom: rom.bytes,
        data: rom.data_bin()?,
        items: &items,
        chars: &chars,
        bg_pngs: &t.bg_pngs,
        tex_pngs: &t.tex_pngs,
        prefix: &o.prefix,
    };
    crate::tables::export_all(&inp, out)
}

/// audio（1 曲ずつ順に。並列に鳴らすときは sound::render_one を直接使う）
fn audio_step(rom: &Rom, o: &Options, st: &State, out: &mut dyn Sink) -> Result<()> {
    use crate::sound::{outputs, render::Cache, render_one, sdat::Sdat};
    let sdat = Sdat::new(rom.file("sound_data.sdat")?)?;
    let mut cache = Cache::default();
    let mut entries = Vec::new();
    for info in &sdat.seqs {
        let (cat, one) = render_one(&sdat, info, o.max_bgm, o.max_se, &mut cache)?;
        out.put(&format!("sound/rendered/{cat}/{}.wav", info.name), one.wav);
        out.put(&format!("sound/rendered/{cat}/{}.json", info.name), one.json.into_bytes());
        entries.push(one.entry);
    }
    let uses = outputs::script_uses(st.script_txt.as_deref().unwrap_or(&[]));
    let (index, html) = outputs::write_index(entries, &uses);
    out.put("sound/rendered/index.json", index.into_bytes());
    out.put("sound/rendered/index.html", html.into_bytes());
    Ok(())
}

/// 手順を 1 つ行う（書き出し先 out の根は出力の根）
pub fn run_step(rom: &Rom, step: &str, o: &Options, st: &mut State, out: &mut dyn Sink) -> Result<()> {
    match step {
        "files" => rom.export_files(out),
        "archives" => rom.export_archives(out, o.raw),
        "tail" => {
            st.tail = Some(rom.export_tail(out, o.raw)?);
            Ok(())
        }
        "desks" => rom.export_desks(out),
        "sound" => rom.export_sound_raw(out),
        "font" => font_step(rom, o, out),
        "script" => script_step(rom, o, st, out),
        "tables" => tables_step(rom, o, st, out),
        "audio" => audio_step(rom, o, st, out),
        s => crate::bytes::err(format!("知らない手順です: {s}")),
    }
}
