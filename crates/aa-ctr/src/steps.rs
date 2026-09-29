//! 取り出しの手順。出力の形は Python 版（tools/rom/ctr.py・mt_arc.py・mt_gmd.py）と同じ。
//! 音声だけは Python 版（ffmpeg で ogg）と違い、自前で展開した WAV を書く。

use crate::Args;
use aa_ctr::keys::Keys;
use aa_ctr::ncch::{self, Ncch, Part};
use aa_ctr::{arc, gmd, mca, romfs};
use rayon::prelude::*;
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

pub const STEPS: &[&str] = &["romfs", "arc", "script", "audio"];

type R<T> = aa_ctr::Result<T>;

fn write(path: &Path, data: &[u8]) -> R<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    fs::write(path, data).map_err(|e| format!("{}: {e}", path.display()))
}

fn read(path: &Path) -> R<Vec<u8>> {
    fs::read(path).map_err(|e| format!("{}: {e}", path.display()))
}

/// root の下の拡張子 ext のファイル（root からの相対パス、パスの部分ごとの順）
fn find(root: &Path, ext: &str) -> Vec<PathBuf> {
    fn walk(dir: &Path, ext: &str, out: &mut Vec<PathBuf>) {
        let Ok(rd) = fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(&p, ext, out);
            } else if p.extension().is_some_and(|x| x == ext) {
                out.push(p);
            }
        }
    }
    let mut out = Vec::new();
    walk(root, ext, &mut out);
    let mut rel: Vec<PathBuf> = out
        .into_iter()
        .map(|p| p.strip_prefix(root).unwrap().to_path_buf())
        .collect();
    rel.sort();
    rel
}

fn slash(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

pub fn run(a: &Args) -> R<()> {
    for step in &a.steps {
        let t = std::time::Instant::now();
        let msg = match step.as_str() {
            "romfs" => step_romfs(a)?,
            "arc" => step_arc(&a.out)?,
            "script" => step_script(&a.out)?,
            "audio" => step_audio(&a.out)?,
            _ => unreachable!(),
        };
        println!("{step}: {msg}（{:.1} 秒）", t.elapsed().as_secs_f64());
    }
    Ok(())
}

fn step_romfs(a: &Args) -> R<String> {
    let keys = Keys::parse(&String::from_utf8_lossy(&read(&a.keys)?))?;
    let mut f = ncch::open(&a.rom)?;
    let n = Ncch::open(&mut f, &keys)?;
    println!("{} {:016X}", n.product(), n.title_id());
    write(
        &a.out.join("exheader.bin"),
        &n.read(&mut f, Part::ExHeader, 0, 0x800)?,
    )?;
    for (name, body) in n.exefs(&mut f)? {
        write(
            &a.out
                .join("exefs")
                .join(format!("{}.bin", name.trim_start_matches('.'))),
            &body,
        )?;
    }
    let files = romfs::list(&n, &mut f)?;
    files.par_iter().try_for_each(|e| -> R<()> {
        let mut f = ncch::open(&a.rom)?;
        let mut body = Vec::with_capacity(e.size as usize);
        let mut pos = 0;
        while pos < e.size {
            let len = (e.size - pos).min(1 << 24) as usize;
            body.extend(n.read(&mut f, Part::RomFs, e.offset + pos, len)?);
            pos += len as u64;
        }
        write(&a.out.join("romfs").join(&e.path), &body)
    })?;
    let tsv: String = files
        .iter()
        .map(|e| format!("{}\t{}\n", e.size, e.path))
        .collect();
    write(
        &a.out.join("romfs.tsv"),
        format!("size\tpath\n{tsv}").as_bytes(),
    )?;
    Ok(format!("{} 個", files.len()))
}

fn step_arc(out: &Path) -> R<String> {
    let src = out.join("romfs");
    let dst = out.join("arc");
    let rows: Vec<Vec<String>> = find(&src, "arc")
        .par_iter()
        .map(|rel| -> R<Vec<String>> {
            let base = rel.with_extension("");
            let items = arc::items(&read(&src.join(rel))?)
                .map_err(|e| format!("{}: {e}", rel.display()))?;
            let mut rows = Vec::new();
            for it in items {
                let name = format!("{}.{}", it.name, arc::ext_of(&it.body, it.type_hash));
                write(&dst.join(&base).join(&name), &it.body)?;
                rows.push(format!(
                    "{}\t{name}\t{:08X}\t{}\n",
                    slash(&base),
                    it.type_hash,
                    it.body.len()
                ));
            }
            Ok(rows)
        })
        .collect::<R<_>>()?;
    let n: usize = rows.iter().map(Vec::len).sum();
    write(
        &dst.join("index.tsv"),
        format!("arc\tpath\ttype\tsize\n{}", rows.concat().concat()).as_bytes(),
    )?;
    Ok(format!("{n} 個"))
}

fn step_script(out: &Path) -> R<String> {
    let dst = out.join("script");
    let mut jobs = Vec::new();
    for src in ["romfs", "arc"] {
        jobs.extend(
            find(&out.join(src), "gmd")
                .into_iter()
                .map(|rel| (src, rel)),
        );
    }
    let done: Vec<(String, Vec<(String, usize)>)> = jobs
        .par_iter()
        .map(|(src, rel)| -> R<_> {
            let source = format!("{src}/{}", slash(rel));
            let g = gmd::parse(&read(&out.join(src).join(rel))?)
                .map_err(|e| format!("{source}: {e}"))?;
            write(
                &dst.join(src).join(rel.with_extension("txt")),
                gmd::to_text(&source, &g).as_bytes(),
            )?;
            let chars: usize = g.entries.iter().map(|(_, t)| t.chars().count()).sum();
            let bad: usize = g
                .entries
                .iter()
                .map(|(_, t)| t.matches('\u{FFFD}').count())
                .sum();
            let row = format!(
                "{source}\t{}\t{}\t{chars}\t{bad}\n",
                g.name,
                g.entries.len()
            );
            Ok((
                row,
                g.entries
                    .iter()
                    .flat_map(|(_, t)| gmd::commands(t))
                    .collect(),
            ))
        })
        .collect::<R<_>>()?;
    let mut counts: BTreeMap<(String, usize), usize> = BTreeMap::new();
    let mut index = String::from("file\tname\tentries\tchars\tbad_chars\n");
    for (row, cmds) in &done {
        index.push_str(row);
        for c in cmds {
            *counts.entry(c.clone()).or_default() += 1;
        }
    }
    let cmds: String = counts
        .iter()
        .map(|((c, n), k)| format!("{c}\t{n}\t{k}\n"))
        .collect();
    write(&dst.join("index.tsv"), index.as_bytes())?;
    write(
        &dst.join("commands.tsv"),
        format!("command\targs\tcount\n{cmds}").as_bytes(),
    )?;
    Ok(format!("{} 個、命令 {} 種類", done.len(), counts.len()))
}

fn round4(x: f64) -> f64 {
    (x * 1e4).round() / 1e4
}

/// romfs/ の .mca（BGM・ボイス・長い効果音）と arc/ の .madp（ARC に入った効果音。形式は同じ）
fn step_audio(out: &Path) -> R<String> {
    let dst = out.join("sound");
    let mut jobs = Vec::new();
    for (src, ext) in [("romfs", "mca"), ("arc", "madp")] {
        jobs.extend(find(&out.join(src), ext).into_iter().map(|rel| (src, rel)));
    }
    let done: Vec<(String, Value)> = jobs
        .par_iter()
        .map(|(src, rel)| -> R<_> {
            let key = format!("{src}/{}", slash(&rel.with_extension("wav")));
            let m = mca::decode(&read(&out.join(src).join(rel))?).map_err(|e| format!("{src}/{}: {e}", rel.display()))?;
            write(&dst.join(&key), &mca::wav(&m))?;
            let rate = m.rate as f64;
            let mut v = json!({"channels": m.channels, "rate": m.rate, "seconds": round4(m.samples as f64 / rate)});
            if m.loop_end > 0 {
                v["loop"] = json!({"start": round4(m.loop_start as f64 / rate), "end": round4(m.loop_end as f64 / rate)});
            }
            Ok((key, v))
        })
        .collect::<R<_>>()?;
    let index: Map<String, Value> = done.into_iter().collect();
    let n = index.len();
    let text = serde_json::to_string_pretty(&Value::Object(index)).map_err(|e| e.to_string())?;
    write(&dst.join("index.json"), format!("{text}\n").as_bytes())?;
    Ok(format!("{n} 個"))
}
