//! 台本の区画とラベル・命令の意味・エンジンの定数（tbl_script.py、ds_fx.py の count_fx）。
//!
//! 出力（tables/）: opcodes.json labels.json engine.json ds_fx.json

use crate::bytes::{err, u16_at, u32_at, words16, Result};
use crate::json::Json;
use crate::nds::Arm9;
use crate::sink::Sink;
use crate::statics::{self, argc};

/// 見出しを (区画の位置の一覧, ラベル [(区画, バイト位置)]) に分ける
pub fn split_header(d: &[u8]) -> Result<(Vec<usize>, Vec<(u32, u32)>)> {
    let n = u32_at(d, 0)? as usize;
    let mut v = Vec::with_capacity(n);
    for i in 0..n {
        v.push(u32_at(d, 4 + 4 * i)? as usize);
    }
    let mut k = 0;
    while k < n && v[k] < d.len() && (k == 0 || v[k] > v[k - 1]) && u16_at(d, v[k])? == 0 {
        k += 1;
    }
    let labels: Vec<(u32, u32)> = v[k..].iter().map(|&x| ((x >> 16) as u32, (x & 0xfffe) as u32)).collect();
    if labels.iter().any(|&(s, _)| s as usize >= k) {
        return err("ラベルの区画が範囲外");
    }
    Ok((v[..k].to_vec(), labels))
}

pub fn labels_json(items: &[Vec<u8>]) -> Result<Json> {
    let mut all = Json::obj();
    for (i, d) in items.iter().enumerate() {
        let (secs, labs) = split_header(d)?;
        let mut l = Json::obj();
        for (j, (s, o)) in labs.iter().enumerate() {
            l.set((secs.len() + j).to_string(), Json::obj().with("section", *s).with("offset", *o));
        }
        all.set(format!("{i:03}"), Json::obj().with("sections", secs.len()).with("labels", l));
    }
    Ok(Json::obj()
        .with("_doc", "項目ごとの区画の数とラベル。ラベルの鍵 = 見出しの添字（54/53(0x80)/120/122 の引数）。offset は区画の先頭からのバイト位置")
        .with("items", all))
}

/// 105 98 x の効果ごとに、(効果, 回数, 段ごとの回数, 使われた項目)
pub fn count_fx(items: &[Vec<u8>]) -> Result<Vec<(u16, usize, Vec<(String, usize)>, Vec<usize>)>> {
    let mut out: Vec<(u16, usize, Vec<(String, usize)>, Vec<usize>)> = Vec::new();
    for (n, d) in items.iter().enumerate() {
        let (secs, _) = split_header(d)?;
        let mut bounds = secs.clone();
        bounds.push(d.len());
        for s in 0..secs.len() {
            let len = bounds[s + 1].saturating_sub(bounds[s]) / 2;
            let words = words16(&d[bounds[s]..bounds[s] + len * 2]);
            let mut i = 0;
            while i < words.len() {
                let w = words[i];
                if w >= 0x80 {
                    i += 1;
                    continue;
                }
                if w == 105 && i + 2 < words.len() && words[i + 1] == 98 {
                    let (fx, stage) = (words[i + 2] & 0xff, words[i + 2] >> 8);
                    let e = match out.iter().position(|e| e.0 == fx) {
                        Some(p) => &mut out[p],
                        None => {
                            out.push((fx, 0, Vec::new(), Vec::new()));
                            out.last_mut().unwrap()
                        }
                    };
                    e.1 += 1;
                    let st = stage.to_string();
                    match e.2.iter_mut().find(|(k, _)| *k == st) {
                        Some(x) => x.1 += 1,
                        None => e.2.push((st, 1)),
                    }
                    if !e.3.contains(&n) {
                        e.3.push(n);
                    }
                }
                i += 1 + argc(w);
            }
        }
    }
    out.sort_by_key(|e| e.0);
    Ok(out)
}

pub fn ds_fx_json(items: &[Vec<u8>]) -> Result<Json> {
    let mut effects = Json::obj();
    let table = statics::get("ds_fx");
    for (fx, count, stages, used) in count_fx(items)? {
        let mut e = table.get(&fx.to_string()).cloned().unwrap_or_else(|| Json::obj().with("desc", "未調査"));
        let st = Json::Obj(stages.into_iter().map(|(k, v)| (k, Json::from(v))).collect());
        e.set("uses", Json::obj().with("count", count).with("stages", st).with("items", used));
        effects.set(fx.to_string(), e);
    }
    Ok(Json::obj()
        .with("_doc", "105 98 (段<<8 | 効果)。段 1 = 終わるまで止まる、2 = 止まらない。107 a b c は 文脈 +0x8a/+0x8c/+0x8e（効果の引数）")
        .with("effects", effects))
}

fn u16s(a: &Arm9, base: u32, n: u32) -> Result<Json> {
    Ok(Json::from((0..n).map(|i| a.u16(base + i * 2)).collect::<Result<Vec<u16>>>()?))
}

pub fn engine_json(a: &Arm9) -> Result<Json> {
    let en_speed: Vec<u32> = (0..16).map(|i| a.u32(0x020b3e68 + i * 4).map(|v| v & 0xff)).collect::<Result<_>>()?;
    let text = Json::obj()
        .with("glyph", Json::obj().with("data_bin", 0x01bcb374).with("size", vec![16, 16]).with("bpp", 4).with("bytes", 0x80)
            .with("en_small_font", 0x01bfc374).with("_note", "英語で文字番号 <= 0xff は別の字形（0x01bfc374）"))
        .with("advance_px", Json::obj().with("ja", 14).with("en", "ARM9 0x020b3f28[文字]（番号 >= 0x110 は 14）"))
        .with("line_height_px", Json::obj().with("ja", 18).with("en", 16))
        .with("max_chars_per_line", 32)
        .with("origin", Json::obj().with("x", 9).with("y_ja", 0x94).with("y_en", 0x86).with("_note", "文脈 +0x44/+0x46。72 で変わる"))
        .with("palette_data_bin", 0x01bcb354)
        .with("colors", Json::obj().with("0", "#f7f7f7").with("1", "#f7733a").with("2", "#6bc5f7").with("3", "#00f700")
            .with("_note", "色 c は字形の画素の番号 1〜3 を 1+3c〜3+3c に置き換える。影/縁は #636363 系"))
        .with("speed_default", 3)
        .with("speed_en_table", en_speed)
        .with("char_timing", "文字は「速さ」フレームに 1 個（カウンタが速さに達したフレームに出す）。0 = 同じフレームで全部")
        .with("page_advance_se", 0x2f)
        .with("blip", "sound.json の blip");
    let life = Json::obj().with("max", 5).with("addr", "game+0x6b").with("penalty_se", 0x4c)
        .with("gameover_section_by_part", u16s(a, 0x020aad40, 35)?)
        .with("_note", "値は区画 + 128（0 = 無し）。添字 = パート（game+0x69、項目 = 2×パート + 言語）");
    let fade = Json::obj()
        .with("types", Json::obj().with("1", "BLDY を下げる（黒から戻す）").with("2", "BLDY を上げる（黒へ）").with("3", "白から戻す")
            .with("4", "白へ").with("5", "白を一度だけ量ぶん足す"))
        .with("bldcnt_black", "対象 | 0xc0").with("bldcnt_white", "対象 | 0xa0").with("bldcnt_default", 0x1d42)
        .with("white_flash_769_8_31", "BLDY 24(=16 扱い), 16, 8, 0 → 白 2 フレーム + 半分 1 フレーム");
    let pan = Json::obj()
        .with("tables", Json::obj().with("short(0..65 tile)", u16s(a, 0x020b3dc0, 16)?).with("long(0..130 tile)", u16s(a, 0x020b3de0, 16)?))
        .with("frames", 31).with("unit_px", 8).with("counter", "0x020ce16c+0xc を毎フレーム ±1（0x02017e88）、偶数で描く");
    let reset = Json::obj()
        .with("_note", "区画に入るたび（0x02024d5c、13/10/54/8/9 などすべての飛び先）に文脈が初期化される。YAML では各 scene の頭で次の値に戻す")
        .with("text", "消す").with("color", 0).with("speed", 3).with("align", 0).with("speaker(+0x60)", 0).with("blip_kind(+0x33)", 0)
        .with("text_origin", "(9, 0x94)").with("next", "今の区画 + 1").with("press(+0x58)", 0).with("ctx_flags(+0)", 0)
        .with("not_reset", "背景・人物・枠の表示・音楽・フラグ・体力・名札の絵（次の 28 0 で名前 0 として描き直される）");
    Ok(Json::obj()
        .with("fps", 60)
        .with("_fps_note", "主ループ 0x02000b98 は game+0x11 回の VBlank を待つ。0x02017fa4 で 1 にしている → 1 フレーム = 1/60 秒")
        .with("text", text)
        .with("textbox_palette_data_bin", 0x01a807b4)
        .with("life", life)
        .with("fade", fade)
        .with("shake_amplitude_px", Json::obj().with("0", 1).with("1", 3).with("2", 7).with("other", 3))
        .with("bg_change_latency_frames", 7)
        .with("pan", pan)
        .with("section_entry_reset", reset)
        .with("present_se", 0x31).with("item_slide_se", 0x33).with("choice_move_se", 0x2a).with("choice_ok_se", 0x2b))
}

/// tables/ の opcodes.json labels.json engine.json ds_fx.json（out の根は tables）
pub fn export(items: &[Vec<u8>], a: &Arm9, out: &mut dyn Sink) -> Result<()> {
    out.put("opcodes.json", statics::get("opcodes").dumps().into_bytes());
    out.put("labels.json", labels_json(items)?.dumps().into_bytes());
    out.put("engine.json", engine_json(a)?.dumps().into_bytes());
    out.put("ds_fx.json", ds_fx_json(items)?.dumps().into_bytes());
    Ok(())
}
