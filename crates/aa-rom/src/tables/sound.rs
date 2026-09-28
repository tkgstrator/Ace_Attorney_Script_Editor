//! 台本の音の番号 → SDAT のシーケンスの対応表（tbl_sound.py）。出力: tables/sound.json

use crate::bytes::{err, u16_at, u32_at, u8_at, Result};
use crate::json::Json;
use crate::nds::Arm9;
use crate::sound::sdat::names;

/// 英語のときの se の置き換え（0x020258f8 の比較の並び）
const EN_REMAP: [(u16, u16); 6] = [(0x37, 0x195), (0x38, 0x193), (0x39, 0x192), (0x41, 0x194), (0x47, 0x191), (0x51, 0x190)];
/// 文字送りの音: 解釈ループ 0x020249ec の mov
const BLIP_MOVS: [(u32, u32); 3] = [(0, 0x02024a64), (1, 0x02024a6c), (2, 0x02024a88)];
const NAME_KIND_TABLE: u32 = 0x020aabc0;
const NAME_KIND_COUNT: usize = 64;
const EN_SPEED_TABLE: u32 = 0x020b3e68;

/// mov rX, #imm（ARM）の即値を読む
fn mov_imm(a: &Arm9, addr: u32) -> Result<u32> {
    let w = a.u32(addr)?;
    if w & 0x0FFF_0000 != 0x03A0_0000 {
        return err(format!("{addr:#x} は mov #imm ではありません: {w:#010x}"));
    }
    let (rot, imm) = ((w >> 8) & 0xF, w & 0xFF);
    Ok(imm.rotate_right(2 * rot))
}

struct Seq {
    index: usize,
    name: String,
    file: String,
    player: u8,
    json: Json,
}

fn sequences(s: &[u8]) -> Result<Vec<Seq>> {
    let (symb, info) = (u32_at(s, 0x10)? as usize, u32_at(s, 0x18)? as usize);
    let nm = names(s, symb, 0)?;
    let base = info + u32_at(s, info + 8)? as usize;
    let n = u32_at(s, base)? as usize;
    let mut first_name: Vec<(u32, String)> = Vec::new();
    let mut out = Vec::new();
    for i in 0..n {
        let off = u32_at(s, base + 4 + 4 * i)? as usize;
        if off == 0 {
            continue;
        }
        let p = info + off;
        let fid = u32_at(s, p)?;
        let (bank, vol, cprio, pprio, player) = (u16_at(s, p + 4)?, u8_at(s, p + 6)?, u8_at(s, p + 7)?, u8_at(s, p + 8)?, u8_at(s, p + 9)?);
        let name = nm.get(i).cloned().flatten().filter(|x| !x.is_empty()).unwrap_or_else(|| format!("sequence_{i:03}"));
        if !first_name.iter().any(|(f, _)| *f == fid) {
            first_name.push((fid, name.clone()));
        }
        let file = format!("{}.sseq", first_name.iter().find(|(f, _)| *f == fid).unwrap().1);
        let json = Json::obj().with("sseq", i).with("name", name.clone()).with("file", file.clone()).with("file_id", fid)
            .with("bank", bank).with("volume", vol).with("channel_prio", cprio).with("player_prio", pprio).with("player", player);
        out.push(Seq { index: i, name, file, player, json });
    }
    Ok(out)
}

fn players(s: &[u8]) -> Result<Vec<Json>> {
    let (symb, info) = (u32_at(s, 0x10)? as usize, u32_at(s, 0x18)? as usize);
    let nm = names(s, symb, 4)?;
    let base = info + u32_at(s, info + 8 + 16)? as usize;
    let mut out = Vec::new();
    for i in 0..u32_at(s, base)? as usize {
        let off = u32_at(s, base + 4 + 4 * i)? as usize;
        if off != 0 {
            let p = info + off;
            out.push(Json::obj().with("player", i).with("name", nm.get(i).cloned().flatten()).with("max_seq", u8_at(s, p)?).with("heap", u32_at(s, p + 4)?));
        }
    }
    Ok(out)
}

/// tables/sound.json の中身
pub fn build(a: &Arm9, sdat: &[u8]) -> Result<Json> {
    let seqs = sequences(sdat)?;
    let find = |i: u32| seqs.iter().find(|s| s.index == i as usize).ok_or_else(|| crate::Error(format!("シーケンス {i} が無い")));
    let by = |p: &str| Json::Obj(seqs.iter().filter(|s| s.name.starts_with(p)).map(|s| (s.index.to_string(), s.json.clone())).collect());
    let other = Json::Obj(seqs.iter().filter(|s| !s.name.starts_with("BGM") && !s.name.starts_with("SE")).map(|s| (s.index.to_string(), s.json.clone())).collect());
    let mut remap = Json::obj();
    for (k, v) in EN_REMAP {
        remap.set(k.to_string(), Json::obj().with("to", v).with("name", find(v as u32)?.name.clone()));
    }
    let mut kinds = Json::obj();
    for (k, ad) in BLIP_MOVS {
        let v = mov_imm(a, ad)?;
        let s = find(v)?;
        kinds.set(k.to_string(), Json::obj().with("sseq", v).with("name", s.name.clone()).with("file", s.file.clone()).with("player", s.player));
    }
    let name_kind: Vec<u8> = a.read(NAME_KIND_TABLE, NAME_KIND_COUNT)?.to_vec();
    let en_speed: Vec<u32> = (0..16).map(|i| a.u32(EN_SPEED_TABLE + 4 * i)).collect::<Result<_>>()?;
    Ok(Json::obj()
        .with("note", "台本の番号 = SDAT のシーケンスの添字（表による変換なし）。bgm/se は同じ番号空間。鍵は台本の番号（10 進の文字列）。file は assets/extracted/sound/raw/sequence/ のファイル名")
        .with("players", players(sdat)?)
        .with("bgm", by("BGM"))
        .with("se", by("SE"))
        .with("other", other)
        .with("se_en_remap", remap)
        .with("blip", Json::obj()
            .with("kinds", kinds)
            .with("kind_names", Json::obj().with("0", "標準（主に男性）").with("1", "女性").with("2", "タイプライター（日時・場所の表示など）"))
            .with("name_kind", name_kind)
            .with("rule_ja", "1 文字を出すたびに数え、カウンタ c が 0 か、速さ >= 5 なら鳴らす（それ以外は c -= 1）。鳴らしたら種類 != 2 のとき c = 1（= 1 文字おき）、種類 2 は c をそのまま（毎文字）。区画の始めに c = 1（最初の文字は鳴らない）。速さ 0（瞬間表示）・文字 0x17f・文脈+0x390 bit2 では鳴らない")
            .with("rule_en", "英語: 鳴らしたら c = 2。c が 0、または速さ >= 2 かつ c <= 1 なら鳴らす（= 2 文字おき、速さ 1 は 3 文字おき）。区画の始めに c = 2")
            .with("en_speed_table", en_speed)))
}
