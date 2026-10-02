//! 逆転裁判 蘇る逆転（AGYJ）の ROM から素材を取り出す（tools/rom/*.py の Rust 版）。
//!
//! ファイルには触らない。ROM のバイト列を受け取り、書き出すものを (相対パス, 中身) として [`sink::Sink`] に渡す。
//! 出力の置き場所と形式は Python 版（assets/extracted/）と同じ。

#![allow(clippy::type_complexity)]

pub mod archives;
pub mod bytes;
pub mod chars;
pub mod charset;
pub mod databin;
pub mod desks;
pub mod font;
pub mod gfx;
pub mod json;
pub mod nds;
pub mod nitro;
pub mod pipeline;
pub mod rom;
pub mod script;
pub mod sink;
pub mod sound;
pub mod statics;
pub mod tables;
pub mod tail;
pub mod tailfmt;

pub use bytes::{Error, Result};
pub use rom::Rom;
pub use sink::{MemSink, Sink};
