//! 人物の動き（台本の命令 30 の動きの番号）と人物の番号の表（tbl_chars.py）。
//!
//! 出力: tables/char_anims.json、tables/chars.json、data/tail/chars/by_anim/NNN/fXX.png

use std::collections::{BTreeMap, BTreeSet};

use super::Counter;
use crate::bytes::{u16_at, u32_at, words16, Result};
use crate::chars::{parse_gfx, read_frame, render, Piece};
use crate::gfx;
use crate::json::Json;
use crate::nds::Arm9;
use crate::sink::Sink;
use crate::statics::{self, argc};

const PACK: usize = 0x2202220;
const ANIM_TABLE: u32 = 0x020a8f80;
const ANIM_COUNT: u32 = 704;
const SCRIPT_ANIMS: usize = 505;
const CHAR_TABLE: u32 = 0x020a8c20;
const CHAR_COUNT: u16 = 64;

fn end_name(dur: u8) -> Option<&'static str> {
    match dur {
        0xFF => Some("loop"),
        0xFE => Some("hold"),
        0xFD => Some("delete"),
        _ => None,
    }
}

/// 人物のパックの中身（圧縮されていないそのままの切り出し）
pub fn pack_parts(d: &[u8]) -> Result<Vec<&[u8]>> {
    let n = u32_at(d, PACK)? as usize;
    let mut out = Vec::with_capacity(n);
    for k in 0..n {
        let (p, s) = (u32_at(d, PACK + 4 + 8 * k)? as usize, u32_at(d, PACK + 8 + 8 * k)? as usize);
        out.push(crate::bytes::py_slice(d, PACK + p, PACK + p + s));
    }
    Ok(out)
}

/// 区間の 1 項目: (コマの絶対位置, 長さ, 印, 効果音, 演出)
type Step = (Option<usize>, u8, u8, u16, u16);

/// 区間を読み、(画像の中の位置, 項目の一覧, 終わり方)
fn parse_block(anim: &[u8], off: usize) -> Result<(usize, Vec<Step>, Option<&'static str>)> {
    let n = u16_at(anim, off + 2)? as usize;
    let gofs = u32_at(anim, off + 4)? as usize;
    let (mut seq, mut end) = (Vec::new(), None);
    for i in 0..n.max(1) + 64 {
        let q = off + 8 + 8 * i;
        if q + 8 > anim.len() {
            break;
        }
        let (fo, dur, flag, se, fx) = (u16_at(anim, q)? as usize, anim[q + 2], anim[q + 3], u16_at(anim, q + 4)?, u16_at(anim, q + 6)?);
        if let Some(e) = end_name(dur) {
            end = Some(e);
            // 終わりの印の項目の効果音・演出も、ここに来たときに実行される
            if flag & 6 != 0 {
                seq.push((None, 0, flag, se, fx));
            }
            break;
        }
        seq.push((Some(off + fo), dur, flag, se, fx));
    }
    Ok((gofs, seq, end))
}

/// 台本の命令 30 から (動き → 人物の出現回数, (項目, 人物, 話す, 黙る) の一覧)
pub fn script_usage(entries: &[Vec<u8>]) -> (BTreeMap<u16, Counter<u16>>, Vec<(usize, u16, u16, u16)>) {
    let mut anim_char: BTreeMap<u16, Counter<u16>> = BTreeMap::new();
    let mut uses = Vec::new();
    for (e, b) in entries.iter().enumerate() {
        let w = words16(b);
        let mut i = (w[2] as usize | (w[3] as usize) << 16) / 2; // 最初の区画の位置
        while i < w.len() {
            let op = w[i];
            if op >= 0x80 {
                i += 1;
                continue;
            }
            let n = argc(op);
            let a = &w[(i + 1).min(w.len())..(i + 1 + n).min(w.len())];
            if op == 30 && a.len() == 3 && a[0] != 0 {
                let c = a[0] & 0x1FFF;
                for &x in &a[1..] {
                    anim_char.entry(x).or_default().add(c, 1);
                }
                uses.push((e, a[0], a[1], a[2]));
            }
            i += 1 + n;
        }
    }
    (anim_char, uses)
}

/// 区間のコマを描いて (コマの絶対位置 → 番号, 原点, 大きさ, PNG の一覧)
fn render_anim(gfx_b: &[u8], anim_b: &[u8], gofs: usize, seq: &[Step]) -> Result<(BTreeMap<usize, usize>, (i32, i32), [usize; 2], Vec<Vec<u8>>)> {
    let (pals, cells) = parse_gfx(crate::bytes::py_slice(gfx_b, gofs, gfx_b.len()))?;
    let mut frames: Vec<(usize, Vec<Piece>)> = Vec::new();
    for (fo, ..) in seq {
        let Some(fo) = *fo else { continue };
        if frames.iter().any(|(o, _)| *o == fo) || fo + 4 > anim_b.len() {
            continue;
        }
        frames.push((fo, read_frame(anim_b, fo)?));
    }
    let (imgs, origin) = render(&pals, &cells, &frames)?;
    let order: BTreeMap<usize, usize> = imgs.keys().enumerate().map(|(n, &fo)| (fo, n)).collect();
    let size = imgs.values().next().map_or([0, 0], |img| [img.w, img.h]);
    let pngs = imgs.values().map(gfx::png_rgba).collect();
    Ok((order, origin, size, pngs))
}

/// tables/char_anims.json と tables/chars.json（と by_anim の PNG。out の根は出力の根）
pub fn export(d: &[u8], a: &Arm9, script_items: &[Vec<u8>], out: &mut dyn Sink, png: bool) -> Result<()> {
    let parts = pack_parts(d)?;
    if parts.len() / 2 != a.u32(0x020235a0)? as usize {
        return crate::bytes::err("人物のパックの数が ARM9 と合わない");
    }
    let (anim_char, uses) = script_usage(script_items);
    let mut table = Vec::new();
    for i in 0..ANIM_COUNT {
        table.push((a.u16(ANIM_TABLE + 4 * i)? as usize, a.u16(ANIM_TABLE + 4 * i + 2)? as usize));
    }
    // ファイル NNN → 人物（台本で使われた動きから）
    let mut file_char: BTreeMap<usize, Counter<u16>> = BTreeMap::new();
    for (i, &(nnn, _)) in table.iter().enumerate().take(SCRIPT_ANIMS) {
        let e = file_char.entry(nnn).or_default();
        if let Some(c) = anim_char.get(&(i as u16)) {
            for (k, v) in &c.0 {
                e.add(*k, *v);
            }
        }
    }
    let mut anims = Json::obj();
    let mut anim_chars: Vec<Option<u16>> = Vec::new();
    let mut anim_files: Vec<String> = Vec::new();
    for (i, &(nnn, off)) in table.iter().enumerate() {
        let (g, an) = (parts[2 * nnn], parts[2 * nnn + 1]);
        let (gofs, seq, end) = parse_block(an, off)?;
        let (order, origin, size, pngs) = render_anim(g, an, gofs, &seq)?;
        if png {
            for (n, p) in pngs.into_iter().enumerate() {
                out.put(&format!("data/tail/chars/by_anim/{i:03}/f{n:02}.png"), p);
            }
        }
        let used = anim_char.get(&(i as u16)).filter(|c| !c.0.is_empty());
        let inferred = file_char.get(&nnn).filter(|c| !c.0.is_empty() && i < SCRIPT_ANIMS);
        let chr = used.or(inferred).map(|c| c.most_common());
        let from = if used.is_some() { Some("script") } else if inferred.is_some() { Some("same_file") } else { None };
        let mut ent = Json::obj()
            .with("file", format!("{nnn:03}")).with("block_offset", off).with("gfx_offset", gofs)
            .with("char", chr).with("char_from", from)
            .with("script_uses", used.map_or(0, |c| c.total()))
            .with("end", end).with("loop", end == Some("loop"))
            .with("origin", vec![origin.0, origin.1]).with("size", size.to_vec())
            .with("frames", Json::Arr(vec![]));
        if png {
            ent.set("png_dir", format!("data/tail/chars/by_anim/{i:03}"));
        }
        let mut frames = Vec::new();
        for &(fo, dur, flag, se, fx) in &seq {
            let mut fr = Json::obj().with("frame", fo.and_then(|f| order.get(&f).copied())).with("dur", dur);
            if fo.is_none() {
                fr.set("at_end", true);
            }
            if flag & 2 != 0 {
                fr.set("se", se);
            }
            if flag & 1 != 0 {
                fr.set("alt_tiles", true); // 部品の番号を 9 ビットで読む（今の人物では未使用）
            }
            if flag & 4 != 0 {
                fr.set("effect", match fx {
                    1 => Json::from("shake"),
                    2 => Json::from("flash"),
                    x => Json::from(x),
                });
            }
            frames.push(fr);
        }
        ent.set("frames", frames);
        if off == 0 {
            ent.set("same_as_extracted", format!("data/tail/chars/2202220/{nnn:03}"));
        }
        anims.set(i.to_string(), ent);
        anim_chars.push(chr);
        anim_files.push(format!("{nnn:03}"));
    }
    let mut per_char: BTreeMap<u16, Vec<usize>> = BTreeMap::new();
    for (i, c) in anim_chars.iter().enumerate().take(SCRIPT_ANIMS).skip(1) {
        if let Some(c) = *c {
            per_char.entry(c).or_default().push(i);
        }
    }
    let mut entries_of: BTreeMap<u16, BTreeSet<usize>> = BTreeMap::new();
    for &(e, c, _, _) in &uses {
        entries_of.entry(c & 0x1FFF).or_default().insert(e);
    }
    let names = statics::get("chars_names");
    let mut chars = Json::obj();
    for (c, ids) in &per_char {
        let files: BTreeSet<&String> = ids.iter().map(|&i| &anim_files[i]).collect();
        let oam = if *c < CHAR_COUNT { Some(a.u16(CHAR_TABLE + 4 * *c as u32)?) } else { None };
        chars.set(c.to_string(), Json::obj()
            .with("name", names.get(&c.to_string()).cloned().unwrap_or(Json::Null))
            .with("name_id", *c)
            .with("anims", ids.clone())
            .with("files", files.into_iter().cloned().collect::<Vec<_>>())
            .with("script_entries", entries_of.get(c).map_or(vec![], |s| s.iter().copied().collect()))
            .with("pos", Json::obj().with("x", 128).with("y", 96))
            .with("oam_max", oam));
    }
    let meta = Json::obj()
        .with("_about", "動きの番号（台本 30 の話す/黙る動き）→ アニメーション。ARM9 0x020a8f80 の表と data.bin 0x2202220 のパック")
        .with("_screen", "人物の基準点は上画面 (128, 96)。origin は PNG の中の基準点。0x4000/0x8000 は tables/chars.json の _flags")
        .with("_frames", "frame = png_dir の fNN（区間の中のコマの番号）、dur = 表示する長さ（1/60 秒）。end: loop = 最初へ戻る / hold = 最後のコマで止まる / delete = 人物を消す")
        .with("anims", anims);
    out.put("tables/char_anims.json", meta.dumps().into_bytes());
    let cmeta = Json::obj()
        .with("_about", "人物の番号（台本 30 の第 1 引数の下位 13 ビット）。名前は確かなものだけ（ほかは null）。name_id = 14 name の名前の番号（ほぼ同じ番号）")
        .with("_flags", Json::obj()
            .with("0x8000", "背景の表のフラグに 0x10 があるとき x = 128 - 256（横長の背景の左側に置く）。無ければ 128")
            .with("0x4000", "背景の表のフラグに 0x20 があるとき x = 128 + 256（横長の背景の右側に置く）。無ければ 128")
            .with("0x2000", "左右反転（部品の印 1 → OAM の H フリップと x の反転。0x02022568 → 0x02021214）"))
        .with("_pos", "x, y = 上画面の座標。y は人物 28 と一部の状態（game+0x23a == 1）で 24 上がる（0x020223b4）")
        .with("chars", chars);
    out.put("tables/chars.json", cmeta.dumps().into_bytes());
    Ok(())
}
