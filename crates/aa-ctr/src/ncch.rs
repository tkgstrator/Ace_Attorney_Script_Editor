//! カードイメージ（NCSD）の先頭の区画のゲーム本体（NCCH）を、読みながら復号する。
//!
//! 鍵: KeyY は NCCH の署名の先頭 16 バイト。ExHeader・ExeFS（.code 以外）は slot 0x2C、
//! .code と RomFS はフラグ（0x18B）で選ぶ slot（0 → 0x2C、1 → 0x25、0x0A → 0x18、0x0B → 0x1B）。
//! AES-CTR のカウンター: 版 0・2 は パーティション ID を逆順にした 8 バイト + 種類（1 ExHeader、2 ExeFS、3 RomFS）+ 0。

use crate::keys::Keys;
use crate::{u16le, u32le, u64le};
use aes::cipher::{KeyIvInit, StreamCipher};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

type Aes128Ctr = ctr::Ctr128BE<aes::Aes128>;
const MEDIA: u64 = 0x200;

#[derive(Clone, Copy)]
pub enum Part {
    ExHeader,
    ExeFs { code: bool },
    RomFs,
}

pub struct Ncch {
    pub base: u64,
    pub header: Vec<u8>,
    key1: Option<[u8; 16]>,
    key2: Option<[u8; 16]>,
}

impl Ncch {
    pub fn open(f: &mut File, keys: &Keys) -> crate::Result<Ncch> {
        let ncsd = read_at(f, 0, 0x200)?;
        if &ncsd[0x100..0x104] != b"NCSD" {
            return Err("NCSD のカードイメージではありません".into());
        }
        let base = u32le(&ncsd, 0x120) as u64 * MEDIA;
        let header = read_at(f, base, 0x200)?;
        if &header[0x100..0x104] != b"NCCH" {
            return Err("先頭の区画が NCCH ではありません".into());
        }
        let flags = &header[0x188..0x190];
        if flags[7] & 0x04 != 0 {
            return Ok(Ncch {
                base,
                header,
                key1: None,
                key2: None,
            });
        }
        if flags[7] & 0x21 != 0 {
            return Err("固定鍵・シード暗号の NCCH には対応していません".into());
        }
        let slot2 = match flags[3] {
            0x00 => 0x2C,
            0x01 => 0x25,
            0x0A => 0x18,
            0x0B => 0x1B,
            s => return Err(format!("知らない鍵の種類 {s:#x}")),
        };
        let key_y = u128::from_be_bytes(header[..16].try_into().unwrap());
        let key1 = keys.scramble(keys.get("slot0x2CKeyX")?, key_y)?;
        let key2 = keys.scramble(keys.get(&format!("slot0x{slot2:02X}KeyX"))?, key_y)?;
        Ok(Ncch {
            base,
            header,
            key1: Some(key1),
            key2: Some(key2),
        })
    }

    pub fn product(&self) -> String {
        String::from_utf8_lossy(&self.header[0x150..0x160])
            .trim_end_matches('\0')
            .to_string()
    }

    pub fn title_id(&self) -> u64 {
        u64le(&self.header, 0x118)
    }

    /// (NCCH 内の位置, 大きさ)
    pub fn region(&self, part: Part) -> (u64, u64) {
        let at = match part {
            Part::ExHeader => return (0x200, 0x800),
            Part::ExeFs { .. } => 0x1A0,
            Part::RomFs => 0x1B0,
        };
        (
            u32le(&self.header, at) as u64 * MEDIA,
            u32le(&self.header, at + 4) as u64 * MEDIA,
        )
    }

    fn counter(&self, part: Part) -> u128 {
        let pid = &self.header[0x108..0x110];
        let mut c = [0u8; 16];
        if u16le(&self.header, 0x112) == 1 {
            c[..8].copy_from_slice(pid);
        } else {
            for i in 0..8 {
                c[i] = pid[7 - i];
            }
            c[8] = match part {
                Part::ExHeader => 1,
                Part::ExeFs { .. } => 2,
                Part::RomFs => 3,
            };
        }
        u128::from_be_bytes(c)
    }

    /// 区画の先頭から off バイト目以降 len バイトを復号して返す
    pub fn read(&self, f: &mut File, part: Part, off: u64, len: usize) -> crate::Result<Vec<u8>> {
        let start = off & !0xF;
        let lead = (off - start) as usize;
        let mut data = read_at(f, self.base + self.region(part).0 + start, len + lead)?;
        let key = match part {
            Part::ExeFs { code: false } | Part::ExHeader => self.key1,
            _ => self.key2,
        };
        if let Some(key) = key {
            let iv = self
                .counter(part)
                .wrapping_add((start / 16) as u128)
                .to_be_bytes();
            Aes128Ctr::new(&key.into(), &iv.into()).apply_keystream(&mut data);
        }
        data.drain(..lead);
        Ok(data)
    }

    /// ExeFS のファイル（名前, 中身）
    pub fn exefs(&self, f: &mut File) -> crate::Result<Vec<(String, Vec<u8>)>> {
        let head = self.read(f, Part::ExeFs { code: false }, 0, 0x200)?;
        let mut out = Vec::new();
        for i in 0..10 {
            let name = String::from_utf8_lossy(&head[i * 16..i * 16 + 8])
                .trim_end_matches('\0')
                .to_string();
            if name.is_empty() {
                continue;
            }
            let (off, size) = (
                u32le(&head, i * 16 + 8) as u64,
                u32le(&head, i * 16 + 12) as usize,
            );
            let part = Part::ExeFs {
                code: name == ".code",
            };
            out.push((name, self.read(f, part, 0x200 + off, size)?));
        }
        Ok(out)
    }
}

pub fn read_at(f: &mut File, at: u64, len: usize) -> crate::Result<Vec<u8>> {
    let mut buf = vec![0u8; len];
    f.seek(SeekFrom::Start(at)).map_err(|e| e.to_string())?;
    f.read_exact(&mut buf)
        .map_err(|e| format!("読めません（{at:#x} から {len} バイト）: {e}"))?;
    Ok(buf)
}

pub fn open(path: &Path) -> crate::Result<File> {
    File::open(path).map_err(|e| format!("{}: {e}", path.display()))
}
