//! ROM 全体の入口。extract_assets.py の手順（files / archives / tail / desks / sound）などをここから呼ぶ。

use crate::bytes::{Error, Result};
use crate::nds::{self, NdsFile};
use crate::sink::{Prefixed, Sink};
use crate::{archives, desks, tail};

pub struct Rom<'a> {
    pub bytes: &'a [u8],
    pub files: Vec<NdsFile>,
}

impl<'a> Rom<'a> {
    pub fn new(bytes: &'a [u8]) -> Result<Self> {
        let files = nds::list_files(bytes)?;
        Ok(Rom { bytes, files })
    }

    /// NitroFS のファイルの中身
    pub fn file(&self, path: &str) -> Result<&'a [u8]> {
        let f = self.files.iter().find(|f| f.path == path).ok_or_else(|| Error(format!("ファイルが無い: {path}")))?;
        Ok(crate::bytes::py_slice(self.bytes, f.start, f.end))
    }

    pub fn arm9(&self) -> Result<&'a [u8]> {
        nds::arm9(self.bytes)
    }

    pub fn data_bin(&self) -> Result<&'a [u8]> {
        self.file("data.bin")
    }

    /// files: NitroFS のファイルをそのまま files/ に
    pub fn export_files(&self, out: &mut dyn Sink) -> Result<()> {
        for f in &self.files {
            out.put(&format!("files/{}", f.path), crate::bytes::py_slice(self.bytes, f.start, f.end).to_vec());
        }
        out.log(&format!("  {} 個", self.files.len()));
        Ok(())
    }

    /// archives: data.bin の先頭の画像アーカイブを data/archiveN/ に
    pub fn export_archives(&self, out: &mut dyn Sink, raw: bool) -> Result<()> {
        archives::export(self.data_bin()?, &mut Prefixed { inner: out, prefix: "data".into() }, raw)?;
        Ok(())
    }

    /// tail: data.bin の後半を data/tail/ に
    pub fn export_tail(&self, out: &mut dyn Sink, raw: bool) -> Result<tail::TailSummary> {
        tail::export(self.data_bin()?, self.arm9()?, &mut Prefixed { inner: out, prefix: "data/tail".into() }, raw)
    }

    /// sound: sound_data.sdat を分割して sound/raw/ に
    pub fn export_sound_raw(&self, out: &mut dyn Sink) -> Result<()> {
        crate::sound::export_raw(self.file("sound_data.sdat")?, &mut Prefixed { inner: out, prefix: "sound".into() })?;
        Ok(())
    }

    /// desks: 法廷の机を data/desks/ に
    pub fn export_desks(&self, out: &mut dyn Sink) -> Result<()> {
        desks::export(self.data_bin()?, self.arm9()?, &mut Prefixed { inner: out, prefix: "data/desks".into() })
    }
}
