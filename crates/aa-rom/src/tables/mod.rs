//! ARM9 と台本から読む表（tbl_*.py）。出力は tables/*.json と、それに付く画像（record/・anims47/・by_anim/）

pub mod anims;
pub mod armdis;
pub mod capstone_text;
pub mod chars;
pub mod court;
pub mod invest;
pub mod invest_start;
pub mod invest_sym;
pub mod record;
pub mod script;
pub mod sound;

/// Python の collections.Counter（入れた順を覚える）
#[derive(Debug, Clone)]
pub struct Counter<K: PartialEq + Copy>(pub Vec<(K, usize)>);

impl<K: PartialEq + Copy> Default for Counter<K> {
    fn default() -> Self {
        Counter(Vec::new())
    }
}

impl<K: PartialEq + Copy> Counter<K> {
    pub fn add(&mut self, k: K, n: usize) {
        match self.0.iter_mut().find(|(kk, _)| *kk == k) {
            Some(e) => e.1 += n,
            None => self.0.push((k, n)),
        }
    }
    /// most_common(1)[0][0]: 最も多いもの（同じ数なら先に入れたもの）
    pub fn most_common(&self) -> K {
        let mut best = self.0[0];
        for &(k, n) in &self.0[1..] {
            if n > best.1 {
                best = (k, n);
            }
        }
        best.0
    }
    pub fn total(&self) -> usize {
        self.0.iter().map(|x| x.1).sum()
    }
}

/// Python の str.isspace と同じ空白
fn py_space(c: char) -> bool {
    c.is_whitespace() || ('\u{1c}'..='\u{1f}').contains(&c)
}

/// Python の str.strip()
pub fn py_strip(s: &str) -> &str {
    s.trim_matches(py_space)
}

/// Python の s[-n:]（文字単位）
pub fn tail_chars(s: &str, n: usize) -> String {
    let len = s.chars().count();
    s.chars().skip(len.saturating_sub(n)).collect()
}

/// 表を作るのに要るもの
pub struct Inputs<'a> {
    pub rom: &'a [u8],
    /// data.bin
    pub data: &'a [u8],
    /// mes_all.bin の各項目を展開したもの
    pub items: &'a [Vec<u8>],
    /// フォントの番号 → 文字
    pub chars: &'a std::collections::HashMap<u16, String>,
    /// data/tail/bg/ と data/tail/tex/ の PNG の名前（tail の手順の結果）
    pub bg_pngs: &'a [String],
    pub tex_pngs: &'a [String],
    /// JSON に書くパスの頭（Python 版と同じ「assets/extracted」）
    pub prefix: &'a str,
}

/// tables/*.json と record/・anims47/・data/tail/chars/by_anim/ を書き出す（out の根は出力の根）
pub fn export_all(inp: &Inputs, out: &mut dyn crate::sink::Sink) -> crate::Result<()> {
    let a9 = crate::nds::Arm9::new(inp.rom)?;
    let arm9 = crate::nds::arm9(inp.rom)?;
    let entries: Vec<Vec<u16>> = inp.items.iter().map(|d| crate::bytes::words16(d)).collect();
    script::export(inp.items, &a9, &mut crate::sink::Prefixed { inner: out, prefix: "tables".into() })?;
    out.put("tables/court.json", court::export(&entries, &a9, inp.chars)?.into_bytes());
    chars::export(inp.data, &a9, inp.items, out, true)?;
    record::export(inp.data, arm9, out)?;
    anims::export(inp.data, arm9, out)?;
    let rom = crate::Rom::new(inp.rom)?;
    out.put("tables/sound.json", sound::build(&a9, rom.file("sound_data.sdat")?)?.dumps().into_bytes());
    let bg_map = crate::script::dump::bg_map(inp.rom, inp.bg_pngs)?.join("\n") + "\n";
    let refs = invest::Refs { tex_pngs: inp.tex_pngs, bg_map: Some(&bg_map), prefix: inp.prefix };
    out.put("tables/investigation.json", invest::export(&a9, &refs)?.into_bytes());
    out.put("tables/invest_start.json", invest_start::export(&a9)?.into_bytes());
    Ok(())
}
