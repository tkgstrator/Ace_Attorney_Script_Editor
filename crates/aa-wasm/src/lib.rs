//! aa-rom をブラウザーから使うための入口（wasm-bindgen）。
//!
//! 使う人が自分の ROM を渡し、手元（ブラウザーの中）で素材を取り出す。ROM や取り出したものはどこにも送らない。
//!
//! ```js
//! const rom = new RomImage(new Uint8Array(buf));      // ROM を読む
//! rom.files();                                         // NitroFS のファイルの一覧
//! rom.file("data.bin");                                // ファイルの中身（Uint8Array）
//! rom.setFontMapping(mappingTsv, fixesTsv);            // 任意: 台本の文字の対応
//! rom.extract("tables", (path, bytes) => { ... });     // 手順を行い、書き出すものを 1 つずつ受け取る
//! rom.renderSequence("BGM001");                        // 1 曲を WAV に
//! ```

use aa_rom::pipeline::{self, Options, OtherFontText, State};
use aa_rom::sink::Sink;
use aa_rom::Rom;
use wasm_bindgen::prelude::*;

fn js_err(e: aa_rom::Error) -> JsError {
    JsError::new(&e.0)
}

/// JS の関数に (パス, Uint8Array) を渡す書き出し先
struct JsSink<'a> {
    f: &'a js_sys::Function,
    count: u32,
    error: Option<JsValue>,
}

impl Sink for JsSink<'_> {
    fn put(&mut self, path: &str, data: Vec<u8>) {
        if self.error.is_some() {
            return;
        }
        let arr = js_sys::Uint8Array::from(data.as_slice());
        if let Err(e) = self.f.call2(&JsValue::NULL, &JsValue::from_str(path), &arr) {
            self.error = Some(e);
        }
        self.count += 1;
    }
}

/// 読み込んだ ROM と、手順の間で受け渡すもの
#[wasm_bindgen]
pub struct RomImage {
    bytes: Vec<u8>,
    opts: Options,
    state: State,
}

#[wasm_bindgen]
impl RomImage {
    /// ROM のバイト列を読む（NitroFS の目次を確かめる）
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: Vec<u8>) -> Result<RomImage, JsError> {
        Rom::new(&bytes).map_err(js_err)?;
        Ok(RomImage {
            bytes,
            opts: Options::default(),
            state: State::default(),
        })
    }

    /// 手順の名前の一覧（行う順）
    pub fn steps() -> Vec<String> {
        pipeline::STEPS.iter().map(|s| s.to_string()).collect()
    }

    /// NitroFS のファイルのパスの一覧
    pub fn files(&self) -> Result<Vec<String>, JsError> {
        Ok(Rom::new(&self.bytes)
            .map_err(js_err)?
            .files
            .iter()
            .map(|f| f.path.clone())
            .collect())
    }

    /// NitroFS のファイルの中身
    pub fn file(&self, path: &str) -> Result<Vec<u8>, JsError> {
        Ok(Rom::new(&self.bytes)
            .map_err(js_err)?
            .file(path)
            .map_err(js_err)?
            .to_vec())
    }

    /// 台本の文字の対応（mapping.tsv と font_fixes.tsv の中身）。無ければ台本の漢字は {番号} になる
    #[wasm_bindgen(js_name = setFontMapping)]
    pub fn set_font_mapping(&mut self, mapping_tsv: Option<String>, fixes_tsv: Option<String>) {
        self.opts.font_mapping = mapping_tsv;
        self.opts.font_fixes = fixes_tsv;
    }

    /// DS 版にない字の字形（font_extra.txt）とほかの作品のフォント（glyphs.txt, mapping.tsv, font_fixes の組）
    #[wasm_bindgen(js_name = addFontSource)]
    pub fn add_font_source(
        &mut self,
        glyphs_txt: String,
        mapping_tsv: String,
        fixes_tsv: Option<String>,
    ) {
        self.opts.font_also.push(OtherFontText {
            glyphs: glyphs_txt,
            mapping: mapping_tsv,
            fixes: fixes_tsv,
        });
    }

    #[wasm_bindgen(js_name = setFontExtra)]
    pub fn set_font_extra(&mut self, extra_txt: Option<String>) {
        self.opts.font_extra = extra_txt;
    }

    /// 画像にできたものの展開済み .bin も書き出すか（既定 true）
    #[wasm_bindgen(js_name = setRaw)]
    pub fn set_raw(&mut self, raw: bool) {
        self.opts.raw = raw;
    }

    /// 手順を 1 つ行い、書き出すもの (パス, Uint8Array) を on_file に 1 つずつ渡す。渡した数を返す
    pub fn extract(&mut self, step: &str, on_file: &js_sys::Function) -> Result<u32, JsValue> {
        let rom = Rom::new(&self.bytes).map_err(|e| JsValue::from(js_err(e)))?;
        let mut sink = JsSink {
            f: on_file,
            count: 0,
            error: None,
        };
        pipeline::run_step(&rom, step, &self.opts, &mut self.state, &mut sink)
            .map_err(|e| JsValue::from(js_err(e)))?;
        if let Some(e) = sink.error {
            return Err(e);
        }
        Ok(sink.count)
    }

    /// 1 曲（SDAT の名前か番号）を鳴らして WAV（32728 Hz、16 ビット ステレオ）にする
    #[wasm_bindgen(js_name = renderSequence)]
    pub fn render_sequence(&self, name: &str) -> Result<Vec<u8>, JsError> {
        use aa_rom::sound::{render::Cache, render_one, sdat::Sdat};
        let rom = Rom::new(&self.bytes).map_err(js_err)?;
        let sdat = Sdat::new(rom.file("sound_data.sdat").map_err(js_err)?).map_err(js_err)?;
        let info = sdat
            .seqs
            .iter()
            .find(|s| s.name == name || s.index.to_string() == name)
            .ok_or_else(|| JsError::new(&format!("シーケンスが無い: {name}")))?;
        let (_, one) = render_one(
            &sdat,
            info,
            self.opts.max_bgm,
            self.opts.max_se,
            &mut Cache::default(),
        )
        .map_err(js_err)?;
        Ok(one.wav)
    }
}
