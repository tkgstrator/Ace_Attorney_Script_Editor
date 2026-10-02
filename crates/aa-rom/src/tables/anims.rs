//! 命令 47 anim（特別な動き・画像）の表（tbl_anims.py）。
//!
//! 出力: tables/anims47.json、anims47/NNN/fNN.png・anim.tsv・anim.gif（英語で差し替えがあるものは anims47/NNN_en/）

use std::collections::{BTreeMap, HashMap};

use crate::bytes::{i16_at, u16_at, u16le, u32le, Result};
use crate::chars::{parse_gfx, read_frame, render, Piece};
use crate::databin::read_pack;
use crate::gfx;
use crate::json::Json;
use crate::sink::Sink;
use crate::statics;
use crate::tail::unpack;

const B: usize = 0x0200_0000;
const TABLE: usize = 0x020a9a80;
const TABLE_EN: usize = 0x020a8cf8;
const PAIRS: usize = 0x020a8f80;
const COUNT: usize = 184;
const CHAR_PACK: usize = 0x2202220;

fn end_name(dur: u8) -> Option<&'static str> {
    match dur {
        0xfd => Some("delete"),
        0xfe => Some("stop"),
        0xff => Some("loop"),
        _ => None,
    }
}

struct Entry {
    j: Json,
    pack: usize,
    offset: usize,
    en: Option<u16>,
}

fn entry(a: &[u8], base: usize, i: usize) -> Result<Entry> {
    let p = base - B + i * 0x18;
    let pair = u32le(a, p) as usize;
    let (vram, x, y) = (u32le(a, p + 4), i16_at(a, p + 8)?, i16_at(a, p + 10)?);
    let (c, dd, e, flags, en) = (
        a[p + 12],
        a[p + 13],
        u16le(a, p + 14),
        u32le(a, p + 16),
        u16le(a, p + 20),
    );
    let (pack, off) = (
        u16le(a, PAIRS - B + 4 * pair) as usize,
        u16le(a, PAIRS - B + 4 * pair + 2) as usize,
    );
    let en = (en != 0xffff).then_some(en);
    let j = Json::obj()
        .with("pair", pair)
        .with("pack", pack)
        .with("offset", off)
        .with("vram", format!("{vram:#x}"))
        .with("x", x)
        .with("y", y)
        .with("b0c", c)
        .with("b0d", dd)
        .with("h0e", e)
        .with("flags", format!("{flags:#x}"))
        .with("bottom_screen", flags & 0x8000 != 0)
        .with("en_entry", en);
    Ok(Entry {
        j,
        pack,
        offset: off,
        en,
    })
}

/// (コマの位置（off から）, 長さ, se, 効果音の有無) の一覧と終わり方
struct Seq {
    steps: Vec<(u16, u8, Option<u16>)>,
    json: Vec<Json>,
    total: usize,
    end: &'static str,
}

fn sequence(anim: &[u8], off: usize) -> Result<Seq> {
    let m = u16_at(anim, off + 2)? as usize;
    let mut s = Seq {
        steps: vec![],
        json: vec![],
        total: 0,
        end: "stop",
    };
    for k in 0..m {
        let q = off + 8 + 8 * k;
        let (fo, dur, fl, se, aux) = (
            u16_at(anim, q)?,
            anim[q + 2],
            anim[q + 3],
            u16_at(anim, q + 4)?,
            u16_at(anim, q + 6)?,
        );
        if let Some(e) = end_name(dur) {
            s.end = e;
            break;
        }
        let mut st = Json::obj().with("frame", fo).with("frames", dur);
        if fl & 2 != 0 {
            st.set("se", se);
        }
        if fl & 4 != 0 {
            st.set("aux", aux);
        }
        if fl & !6 != 0 {
            st.set("flags", fl);
        }
        s.steps.push((fo, dur, (fl & 2 != 0).then_some(se)));
        s.json.push(st);
        s.total += dur as usize;
    }
    Ok(s)
}

fn render_dir(
    gfx_b: &[u8],
    anim: &[u8],
    off: usize,
    seq: &Seq,
    dst: &str,
    out: &mut dyn Sink,
) -> Result<Vec<Vec<i32>>> {
    let (pals, cells) = parse_gfx(gfx_b)?;
    let mut frames: Vec<(usize, Vec<Piece>)> = Vec::new();
    for &(f, ..) in &seq.steps {
        let fo = off + f as usize;
        if !frames.iter().any(|(o, _)| *o == fo) && fo + 4 <= anim.len() {
            let k = u16_at(anim, fo)? as usize;
            if k > 0 && fo + 4 + 4 * k > anim.len() {
                return crate::bytes::err("コマの部品が範囲外");
            }
            frames.push((fo, read_frame(anim, fo)?));
        }
    }
    let (imgs, origin) = render(&pals, &cells, &frames)?;
    let mut names = BTreeMap::new();
    for (n, (fo, img)) in imgs.iter().enumerate() {
        let name = format!("f{n:02}.png");
        out.put(&format!("{dst}/{name}"), gfx::png_rgba(img));
        names.insert(*fo, name);
    }
    let rows: Vec<String> = seq
        .steps
        .iter()
        .map(|&(f, dur, se)| {
            let n = names.get(&(off + f as usize)).map_or("-", |s| s.as_str());
            format!(
                "{n}\t{dur}\t{}",
                se.map_or(String::new(), |s| s.to_string())
            )
        })
        .collect();
    let tsv = format!(
        "# 原点: 画像の {}（画面では表の x, y に来る）。終わり: {}\nコマ\t長さ（1/60 秒）\t効果音\n{}\n",
        crate::chars::py_tuple2(origin),
        seq.end,
        rows.join("\n")
    );
    out.put(&format!("{dst}/anim.tsv"), tsv.into_bytes());
    if names.len() > 1 {
        let frames: Vec<(&gfx::Rgba, u16)> = seq
            .steps
            .iter()
            .filter_map(|&(f, dur, _)| {
                imgs.get(&(off + f as usize))
                    .map(|img| (img, gfx::gif_delay(dur as u32)))
            })
            .collect();
        out.put(&format!("{dst}/anim.gif"), gfx::gif_anim(&frames));
    }
    Ok(vec![vec![origin.0, origin.1]])
}

/// tables/anims47.json と anims47/（out の根は出力の根）
pub fn export(d: &[u8], a: &[u8], out: &mut dyn Sink) -> Result<()> {
    let (ents, _) =
        read_pack(d, CHAR_PACK).ok_or_else(|| crate::Error("人物のパックが読めません".into()))?;
    let mut cache: HashMap<usize, Vec<u8>> = HashMap::new();
    let mut part = |k: usize| -> Vec<u8> {
        cache
            .entry(k)
            .or_insert_with(|| unpack(d, ents[k].0, ents[k].1).0)
            .clone()
    };
    let mut one = |e: &mut Entry, dst: &str, out: &mut dyn Sink| -> Result<()> {
        let (g, an) = (part(2 * e.pack), part(2 * e.pack + 1));
        let seq = sequence(&an, e.offset)?;
        e.j.set("steps", seq.json.clone());
        e.j.set("total_frames", seq.total);
        e.j.set("end", seq.end);
        e.j.set("image_dir", dst);
        e.j.set(
            "chars_dir",
            format!("data/tail/chars/2202220/{:03}", e.pack),
        );
        match render_dir(&g, &an, e.offset, &seq, dst, out) {
            Ok(o) => e.j.set("origin_in_image", o),
            Err(ex) => e.j.set("error", ex.0),
        };
        Ok(())
    };
    let labels = statics::get("anims_label");
    let mut list = Vec::new();
    for i in 1..COUNT {
        let mut e = entry(a, TABLE, i)?;
        let label = labels
            .get(&i.to_string())
            .cloned()
            .unwrap_or(Json::from(""));
        let mut j = Json::obj().with("id", i).with("label", label);
        if let Json::Obj(m) = std::mem::replace(&mut e.j, Json::Null) {
            for (k, v) in m {
                j.set(k, v);
            }
        }
        e.j = j;
        one(&mut e, &format!("anims47/{i:03}"), out)?;
        if let Some(en_i) = e.en {
            let mut en = entry(a, TABLE_EN, en_i as usize)?;
            one(&mut en, &format!("anims47/{i:03}_en"), out)?;
            e.j.set("en", en.j);
        }
        list.push(e.j);
    }
    let doc = Json::obj()
        .with("_about", "命令 47 anim の番号 → 動きの物体。(n, 1) で出し (n, 0) で消す。台本は止まらない（待ちは台本の wait）。steps = コマ送り（frames は 1/60 秒、se はそのコマで鳴る効果音）、end = 最後の後の動き（delete = 自分で消える, stop = 最後のコマで止まる, loop = 繰り返す）。total_frames = end までの長さ。en = 英語のときに使う項目")
        .with("anims", list);
    out.put("tables/anims47.json", doc.dumps().into_bytes());
    Ok(())
}
