//! data.bin のうち、先頭の画像アーカイブより後ろの領域の書き出し（ex_tail.py）。
//!
//! 目次が無いので databin::walk で「パック・テクスチャ・圧縮データ」として読める所を拾い、
//! 中身の大きさや見出しから形式を推定して書き出す。ARM9 の表から背景の番号とリソース名が分かれば名前に付ける。
//! 書き出し先（data/tail）: bg/ tex/ chars/<位置>/NNN/ packs/<位置>/ blobs/ named/ index.tsv unknown.tsv

use std::collections::{BTreeMap, HashMap, HashSet};

use crate::bytes::{py_slice, Result};
use crate::databin::{bg_table, gaps, named_resources, walk, ItemInfo, ARCHIVE_COUNT};
use crate::nitro::{decompress, COMPRESSION_TYPES};
use crate::sink::Sink;
use crate::{chars, tailfmt};

/// これより小さい単独の圧縮データは誤検出が多いので書き出さない
const MIN_BLOB: usize = 64;

/// パックの中身を 1 個取り出す（圧縮されていれば展開する）。(中身, 'raw' / 'lzNN')
pub fn unpack(d: &[u8], p: usize, size: usize) -> (Vec<u8>, String) {
    if p < d.len() && COMPRESSION_TYPES.contains(&d[p]) {
        if let Ok((out, used)) = decompress(d, p) {
            if used <= size + 3 {
                return (out, format!("lz{:02x}", d[p]));
            }
        }
    }
    (py_slice(d, p, p + size).to_vec(), "raw".into())
}

/// 書き出したもののうち、ほかの手順が名前を引くもの
#[derive(Default, Debug, Clone)]
pub struct TailSummary {
    /// data/tail/bg/ の PNG のファイル名
    pub bg_pngs: Vec<String>,
    /// data/tail/tex/ の PNG のファイル名
    pub tex_pngs: Vec<String>,
}

struct Writer<'a> {
    out: &'a mut dyn Sink,
    raw: bool,
    index: Vec<String>,
    sum: TailSummary,
}

impl Writer<'_> {
    fn image(&mut self, group: &str, stem: &str, png: Option<Vec<u8>>) -> bool {
        let Some(png) = png else { return false };
        let name = format!("{stem}.png");
        self.out.put(&format!("{group}/{name}"), png);
        match group {
            "bg" => self.sum.bg_pngs.push(name),
            "tex" => self.sum.tex_pngs.push(name),
            _ => {}
        }
        true
    }

    fn binary(&mut self, group: &str, stem: &str, b: Vec<u8>) {
        self.out.put(&format!("{group}/{stem}.bin"), b);
    }

    fn log(&mut self, offset: usize, kind: &str, size: usize, note: &str, dest: &str) {
        self.index.push(format!("{offset:#09x}\t{kind}\t{size}\t{note}\t{dest}"));
    }
}

fn stem(off: usize, names: &BTreeMap<usize, String>, bgs: Option<&HashMap<usize, usize>>) -> String {
    let mut s = format!("{off:07x}");
    if let Some(n) = bgs.and_then(|b| b.get(&off)) {
        s = format!("bg{n:03}_{s}");
    }
    if let Some(n) = names.get(&off) {
        s.push('_');
        s.push_str(n);
    }
    s
}

fn pack(w: &mut Writer, d: &[u8], offset: usize, size: usize, ents: &[(usize, usize)], st: &str) {
    let parts: Vec<(Vec<u8>, String)> = ents.iter().map(|&(p, s)| unpack(d, p, s)).collect();
    let data: Vec<Vec<u8>> = parts.iter().map(|(b, _)| b.clone()).collect();
    // 背景のパック（先頭がパレット、残りが圧縮された帯）
    if parts[0].1 == "raw" && parts[1..].iter().all(|(_, k)| k != "raw") {
        if let Some(png) = tailfmt::bg_pack(&data) {
            w.image("bg", st, Some(png));
            w.log(offset, "pack/bg", size, &format!("{} 個", ents.len()), &format!("bg/{st}.png"));
            return;
        }
    }
    if tailfmt::is_char_pack(&data) {
        let group = format!("chars/{st}");
        chars::export_pack(&data, &group, w.out);
        if w.raw {
            for (i, b) in data.iter().enumerate() {
                let kind = if i % 2 == 0 { "gfx" } else { "anim" };
                w.binary(&format!("{group}/raw"), &format!("{:03}_{kind}", i / 2), b.clone());
            }
        }
        w.log(offset, "pack/chars", size, &format!("アニメーション {} 個", data.len() / 2), &format!("{group}/"));
        return;
    }
    let group = format!("packs/{st}");
    let mut made = 0;
    for (i, (b, _)) in parts.into_iter().enumerate() {
        let name = format!("{i:04}");
        let png = tailfmt::texture(&b)
            .or_else(|| tailfmt::profile_text(&b))
            .or_else(|| tailfmt::name_label(&b))
            .or_else(|| tailfmt::full_bg(&b));
        let ok = w.image(&group, &name, png);
        made += ok as usize;
        if !ok || w.raw {
            w.binary(&group, &name, b);
        }
    }
    w.log(offset, "pack", size, &format!("{} 個、画像 {made} 枚", ents.len()), &format!("{group}/"));
}

/// data/tail を書き出す（out の根は data/tail）
pub fn export(d: &[u8], arm9: &[u8], out: &mut dyn Sink, raw: bool) -> Result<TailSummary> {
    let all = walk(d);
    let packs: Vec<_> = all.iter().filter(|it| it.kind() == "pack").collect();
    let last = packs.get(ARCHIVE_COUNT - 1).ok_or_else(|| crate::bytes::Error("アーカイブが足りません".into()))?;
    let start = last.offset + last.size; // 先頭のアーカイブの後ろ
    let items: Vec<_> = all.iter().filter(|it| it.offset >= start).cloned().collect();
    let names = named_resources(arm9, d.len());
    let pack_offs: HashSet<usize> = items.iter().filter(|it| it.kind() == "pack").map(|it| it.offset).collect();
    let bgs = bg_table(arm9, &pack_offs);
    let mut w = Writer { out, raw, index: Vec::new(), sum: TailSummary::default() };
    let mut seen: HashSet<Vec<u8>> = HashSet::new();
    for it in &items {
        match &it.info {
            ItemInfo::Pack(ents) => {
                let st = stem(it.offset, &names, Some(&bgs));
                pack(&mut w, d, it.offset, it.size, ents, &st);
            }
            ItemInfo::Tex(t) => {
                let st = stem(it.offset, &names, None);
                let png = tailfmt::texture(&d[it.offset..it.offset + it.size]);
                w.image("tex", &st, png);
                w.log(it.offset, "tex", it.size, &format!("形式 {} {}×{}", t.fmt, t.w, t.h), &format!("tex/{st}.png"));
            }
            ItemInfo::Blob(_) => {
                let (b, _) = decompress(d, it.offset)?;
                if b.len() < MIN_BLOB || !b.iter().any(|&x| x != 0) || seen.contains(&b) {
                    let note = format!("展開後 {}（小さい・空・重複のため省略）", b.len());
                    w.log(it.offset, "blob", it.size, &note, "");
                    continue;
                }
                seen.insert(b.clone());
                let st = stem(it.offset, &names, None);
                let mut ok = w.image("blobs", &st, tailfmt::texture(&b));
                ok = ok || w.image("bg", &st, tailfmt::full_bg(&b));
                ok = ok || w.image("blobs", &st, tailfmt::gray_bitmap(&b));
                let n = b.len();
                if !ok || raw {
                    w.binary("blobs", &st, b);
                }
                let kind = format!("blob/lz{:02x}", d[it.offset]);
                w.log(it.offset, &kind, it.size, &format!("展開後 {n}"), if ok { "png" } else { "bin" });
            }
        }
    }
    let index = format!("位置\t種類\t大きさ\tメモ\t書き出し先\n{}\n", w.index.join("\n"));
    w.out.put("index.tsv", index.into_bytes());
    let unknown: Vec<(usize, usize)> = gaps(&items, d.len(), 256).into_iter().filter(|g| g.0 >= start).collect();
    let rows: Vec<String> = unknown
        .iter()
        .map(|&(o, s)| format!("{o:#09x}\t{s}\t{}", names.get(&o).map_or("", |s| s.as_str())))
        .collect();
    w.out.put("unknown.tsv", format!("位置\t大きさ\t名前\n{}\n", rows.join("\n")).into_bytes());
    let total: usize = unknown.iter().map(|g| g.1).sum();
    w.out.log(&format!("  拾ったもの {} 個、未解明の領域 {} 個（計 {:.1} MB）", items.len(), unknown.len(), total as f64 / 1e6));
    // 未解明の領域の中にあって ARM9 に名前が載っているもの（itm*** など）を、次の名前か領域の終わりまで書き出す
    for &(s, size) in &unknown {
        let offs: Vec<usize> = names.range(s..s + size).map(|(o, _)| *o).collect();
        for (k, &o) in offs.iter().enumerate() {
            let nxt = offs.get(k + 1).copied().unwrap_or(s + size);
            w.out.put(&format!("named/{o:07x}_{}.bin", names[&o]), py_slice(d, o, nxt).to_vec());
        }
    }
    Ok(w.sum)
}
