//! 話し手の名札と法廷記録（証拠品・人物ファイル）の表（tbl_record.py）。
//!
//! 出力: tables/names.json、tables/evidence.json、record/{nametag,icon,icon_ds,name,desc}/…

use std::collections::HashSet;

use crate::bytes::{py_slice, u16le, u32le, Result};
use crate::databin::read_pack;
use crate::gfx::{self, Indexed, Rgb};
use crate::json::Json;
use crate::nitro::decompress;
use crate::sink::Sink;
use crate::statics;

const B: usize = 0x0200_0000;
const LANGS: [&str; 2] = ["ja", "en"];
const NAMETAG: [usize; 2] = [0x1a81c54, 0x1a87454];
const NAMETAG_PAL: usize = 0x1a807b4;
const NAMETAG_COUNT: usize = 55;
const BLIP_TABLE: usize = 0x020aabc0;
const REC_TABLE: usize = 0x020ab27c;
const REC_SIZE: usize = 0x18;
const REC_COUNT: usize = 208;
const ICON: [usize; 2] = [0x1b1dbb4, 0x1b68614];
const ICON_DS: usize = 0x1bb3074;
const ICON_DS_END: usize = 0x1bcc3a8;
const ICON_STRIDE: usize = 0x820;
const NAME_PACK: [usize; 2] = [0x1b0b10c, 0x1b14878];
const NAME_PAL: usize = 0x1b0b0ec;
const DESC_PACK: [usize; 2] = [0x1ab13d4, 0x1ae2ea4];
const DESC_PAL: usize = 0x1ab13b4;
const START_TABLE: usize = 0x020b4554;
const START_COUNT: usize = 35;

fn blip_se(b: u8) -> Option<u8> {
    match b {
        0 => Some(0x2d),
        1 => Some(0x2e),
        2 => Some(0x44),
        _ => None,
    }
}

fn pack_items(d: &[u8], base: usize) -> Result<Vec<Vec<u8>>> {
    let (ents, _) = read_pack(d, base).ok_or_else(|| crate::Error(format!("パックが読めません: {base:#x}")))?;
    ents.iter().map(|&(p, _)| decompress(d, p).map(|r| r.0)).collect()
}

fn nametag_image(d: &[u8], lang: usize, n: usize) -> Result<Indexed> {
    let s = NAMETAG[lang] + (n / 5) * 0x800 + (n % 5) * 0xc0;
    let mut b = py_slice(d, s, s + 0xc0).to_vec();
    b.extend_from_slice(py_slice(d, s + 0x400, s + 0x4c0));
    gfx::tiled(&gfx::unpack4(&b), 48, 16)
}

fn icon_image(d: &[u8], s: usize) -> Result<(Indexed, Vec<Rgb>)> {
    let pal = gfx::palette(py_slice(d, s, s + 32));
    Ok((gfx::tiled(&gfx::unpack4(py_slice(d, s + 32, s + ICON_STRIDE)), 64, 64)?, pal))
}

/// 説明文（64×32 の OBJ ブロック 4 個を 128×64 に並べ替える。tailfmt と同じ）
fn desc_image(b: &[u8]) -> Result<Indexed> {
    let blocks = gfx::obj_blocks(&gfx::unpack4(b), 256, 32, 64, 32)?;
    let mut out = Indexed::zeros(128, 64);
    for k in 0..4 {
        let (x, y) = (64 * (k / 2), 32 * (k % 2));
        for yy in 0..32 {
            for xx in 0..64 {
                out.px[(y + yy) * 128 + x + xx] = blocks.px[yy * 256 + 64 * k + xx];
            }
        }
    }
    Ok(out)
}

fn start_lists(a: &[u8]) -> Vec<(usize, Vec<u8>, Vec<u8>)> {
    (0..START_COUNT)
        .map(|part| {
            let mut p = u32le(a, START_TABLE - B + 4 * part) as usize - B;
            let (mut prof, mut ev) = (Vec::new(), Vec::new());
            while a[p] != 0xfe {
                prof.push(a[p]);
                p += 1;
            }
            p += 1;
            while a[p] != 0xff {
                ev.push(a[p]);
                p += 1;
            }
            (part, prof, ev)
        })
        .collect()
}

fn lang_obj(f: impl Fn(usize) -> Json) -> Json {
    Json::obj().with("ja", f(0)).with("en", f(1))
}

/// names.json・evidence.json と record/ の画像（out の根は出力の根）
pub fn export(d: &[u8], a: &[u8], out: &mut dyn Sink) -> Result<()> {
    // ---- 名札 ----
    let tag_pal = gfx::palette(py_slice(d, NAMETAG_PAL, NAMETAG_PAL + 32));
    let tag_text = statics::get("record_nametag_text");
    let mut names = Vec::new();
    for n in 0..NAMETAG_COUNT {
        for (li, lang) in LANGS.iter().enumerate() {
            out.put(&format!("record/nametag/{lang}/{n:02}.png"), gfx::png_indexed(&nametag_image(d, li, n)?, &tag_pal, false));
        }
        let blip = a[BLIP_TABLE - B + n];
        let text = |li: usize| match tag_text.get(LANGS[li]) {
            Some(Json::Arr(v)) => v[n].clone(),
            _ => Json::Null,
        };
        names.push(Json::obj()
            .with("id", n)
            .with("text", lang_obj(text))
            .with("image", lang_obj(|li| Json::from(format!("record/nametag/{}/{n:02}.png", LANGS[li]))))
            .with("data_bin", lang_obj(|li| Json::from(format!("{:#x}", NAMETAG[li] + (n / 5) * 0x800 + (n % 5) * 0xc0))))
            .with("blip", blip)
            .with("blip_se", blip_se(blip)));
    }
    let doc = Json::obj()
        .with("_about", "命令 14 name の名前の番号（引数 >> 8）。下位 8 ビットが 0 でなければ名札を右端（x=208）に出す（台本では未使用）。名札は 48×16。日本語は BG の行 16〜17（y=128）、英語は行 14〜15（y=112）、x=0。その下の行に枠の下端。blip = 文字送りの音の種類（0x020aabc0）、blip_se = その効果音の番号。text は画像から読み取ったもの")
        .with("palette_data_bin", format!("{NAMETAG_PAL:#x}"))
        .with("layout", Json::obj()
            .with("ja", Json::obj().with("x", 0).with("y", 128).with("x_right", 208))
            .with("en", Json::obj().with("x", 0).with("y", 112).with("x_right", 208))
            .with("size", vec![48, 16]))
        .with("names", names);
    out.put("tables/names.json", doc.dumps().into_bytes());

    // ---- 法廷記録 ----
    let name_pal = gfx::palette(py_slice(d, NAME_PAL, NAME_PAL + 32));
    let desc_pal = gfx::palette(py_slice(d, DESC_PAL, DESC_PAL + 32));
    for (li, lang) in LANGS.iter().enumerate() {
        for (i, b) in pack_items(d, NAME_PACK[li])?.iter().enumerate() {
            let img = gfx::obj_blocks(&gfx::unpack4(b), 128, 16, 32, 16)?;
            out.put(&format!("record/name/{lang}/{i:03}.png"), gfx::png_indexed(&img, &name_pal, false));
        }
        for (i, b) in pack_items(d, DESC_PACK[li])?.iter().enumerate() {
            out.put(&format!("record/desc/{lang}/{i:03}.png"), gfx::png_indexed(&desc_image(b)?, &desc_pal, false));
        }
    }
    let n_icons = (ICON[1] - ICON[0]) / ICON_STRIDE;
    for (li, lang) in LANGS.iter().enumerate() {
        for i in 0..n_icons {
            let (idx, pal) = icon_image(d, ICON[li] + i * ICON_STRIDE)?;
            out.put(&format!("record/icon/{lang}/{i:03}.png"), gfx::png_indexed(&idx, &pal, true));
        }
    }
    for i in 0..(ICON_DS_END - ICON_DS) / ICON_STRIDE {
        let (idx, pal) = icon_image(d, ICON_DS + i * ICON_STRIDE)?;
        out.put(&format!("record/icon_ds/{i:03}.png"), gfx::png_indexed(&idx, &pal, true));
    }

    let starts = start_lists(a);
    let ev_used: HashSet<u8> = starts.iter().flat_map(|s| s.2.iter().copied()).collect();
    let pr_used: HashSet<u8> = starts.iter().flat_map(|s| s.1.iter().copied()).collect();
    let texts = statics::get("record_text");
    let mut items = Vec::new();
    for i in 0..REC_COUNT {
        let r = REC_TABLE - B + i * REC_SIZE;
        let f: Vec<u16> = (0..7).map(|k| u16le(a, r + 2 * k)).collect();
        let (icon, nja, nen, desc) = (f[0], f[1], f[2], f[3]);
        let mut e = Json::obj()
            .with("id", i)
            .with("icon", icon)
            .with("name_index", Json::obj().with("ja", nja).with("en", nen))
            .with("desc_index", desc)
            .with("desc_index_alt", f[4])
            .with("check", f[5])
            .with("model3d", f[6])
            .with("image", Json::obj()
                .with("icon", lang_obj(|li| Json::from(format!("record/icon/{}/{icon:03}.png", LANGS[li]))))
                .with("name", lang_obj(|li| Json::from(format!("record/name/{}/{:03}.png", LANGS[li], if li == 0 { nja } else { nen }))))
                .with("desc", lang_obj(|li| Json::from(format!("record/desc/{}/{desc:03}.png", LANGS[li])))));
        if let Some(Json::Arr(t)) = texts.get(&i.to_string()) {
            e.set("text_ja", Json::obj().with("name", t[0].clone()).with("desc", t[1].clone()));
        }
        if i < 256 && pr_used.contains(&(i as u8)) {
            e.set("start_as", "profile");
        } else if i < 256 && ev_used.contains(&(i as u8)) {
            e.set("start_as", "evidence");
        }
        items.push(e);
    }
    let start_json: Vec<Json> = starts.iter()
        .map(|(p, prof, ev)| Json::obj().with("part", *p).with("profiles", prof.clone()).with("evidence", ev.clone()))
        .collect();
    let doc = Json::obj()
        .with("_about", "法廷記録の番号（命令 23/24/25/19 の下位 14 ビット、または 8 ビット）→ 絵と文字。証拠品と人物ファイルは同じ表を使い、ビット 15 は入れる一覧（0 = 証拠品 0x020ce240, 1 = 人物 0x020ce260、各 32 個）だけを決める。check = 0 でなければ「詳しく調べる」がある、model3d = 第 5 話の 3D の番号（推測）。text_ja は第 1 話で使うものだけ画像から読み取った。desc_index_alt は英語のときの下画面の処理（0x02083fe8、0x02b62684 + 番号 * 0x2034）が使う別の番号で、説明文のパックの番号とは合わない（未解明）")
        .with("palette_data_bin", Json::obj().with("name", format!("{NAME_PAL:#x}")).with("desc", format!("{DESC_PAL:#x}")).with("icon", "各アイコンの先頭 32 バイト"))
        .with("detail_window", Json::obj().with("icon", vec![16, 16, 64, 64]).with("note", "上画面の「ファイルした」窓: アイコン 64×64・名前 128×16・説明文 128×64（OBJ）"))
        .with("start", start_json)
        .with("items", items);
    out.put("tables/evidence.json", doc.dumps().into_bytes());
    Ok(())
}
