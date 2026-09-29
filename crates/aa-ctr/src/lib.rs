//! 3DS の逆転裁判5・6（MT Framework）のカードイメージから素材を取り出す。形式の説明は各モジュールの先頭と
//! tools/rom/ctr.py・mt_arc.py・mt_gmd.py・mt_sound.py（Python 版）を参照。

pub mod arc;
pub mod gmd;
pub mod keys;
pub mod mca;
pub mod ncch;
pub mod romfs;

pub type Result<T> = std::result::Result<T, String>;

pub(crate) fn u16le(b: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([b[at], b[at + 1]])
}

pub(crate) fn u32le(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(b[at..at + 4].try_into().unwrap())
}

pub(crate) fn u64le(b: &[u8], at: usize) -> u64 {
    u64::from_le_bytes(b[at..at + 8].try_into().unwrap())
}
