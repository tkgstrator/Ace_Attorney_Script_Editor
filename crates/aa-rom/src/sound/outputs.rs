//! sseq_render の出力: WAV・JSON・index.json（sseq_outputs.py）。Ogg は作らない（ogg は null）。
//!
//! 確かめの値（check）のうち rmsDb（log10）と centroidHz（FFT）は numpy と最後の桁が違いうる。

use rustfft::num_complex::Complex;
use rustfft::FftPlanner;

use super::render::{np_sum, np_sum_by, Rendered};
use super::sdat::SeqInfo;
use super::tables::OUTPUT_RATE_INT;
use crate::json::Json;

const RATE: i64 = OUTPUT_RATE_INT;

/// 左右が交互に並んだもの（Python の (n, 2) の配列を平らにしたもの）の i 番目
fn inter(l: &[f64], r: &[f64], i: usize) -> f64 {
    if i.is_multiple_of(2) { l[i / 2] } else { r[i / 2] }
}

fn rms_db(l: &[f64], r: &[f64]) -> f64 {
    if l.is_empty() {
        return f64::NEG_INFINITY;
    }
    let n = l.len() * 2;
    let v = (np_sum_by(n, &|i| inter(l, r, i) * inter(l, r, i)) / n as f64).sqrt();
    if v > 0.0 { 20.0 * v.log10() } else { f64::NEG_INFINITY }
}

/// スペクトルの重心（Hz）
fn centroid(l: &[f64], r: &[f64]) -> f64 {
    if l.len() < 1024 {
        return 0.0;
    }
    let m = l.len().min((RATE * 60) as usize);
    // np.hanning(m) = 0.5 + 0.5 * cos(pi * n / (m - 1))、n = 1-m, 3-m, …, m-1
    let mut buf: Vec<Complex<f64>> = (0..m)
        .map(|i| {
            let v = (l[i] + r[i]) / 2.0;
            let n = (1 - m as i64 + 2 * i as i64) as f64;
            let w = 0.5 + 0.5 * (std::f64::consts::PI * n / (m - 1) as f64).cos();
            Complex::new(v * w, 0.0)
        })
        .collect();
    FftPlanner::new().plan_fft_forward(m).process(&mut buf);
    let half = m / 2 + 1;
    let spec: Vec<f64> = buf[..half].iter().map(|c| c.norm()).collect();
    drop(buf);
    let val = 1.0 / (m as f64 * (1.0 / RATE as f64));
    let s = np_sum(&spec);
    if s > 0.0 { np_sum_by(half, &|i| spec[i] * (i as f64 * val)) / s } else { 0.0 }
}

/// 16 ビット ステレオの WAV（Python の wave と同じ 44 バイトの見出し）
pub fn wav(pcm: &[i16]) -> Vec<u8> {
    let data_len = (pcm.len() * 2) as u32;
    let mut b = Vec::with_capacity(44 + data_len as usize);
    b.extend_from_slice(b"RIFF");
    b.extend_from_slice(&(36 + data_len).to_le_bytes());
    b.extend_from_slice(b"WAVEfmt ");
    b.extend_from_slice(&16u32.to_le_bytes());
    b.extend_from_slice(&1u16.to_le_bytes());
    b.extend_from_slice(&2u16.to_le_bytes());
    b.extend_from_slice(&(RATE as u32).to_le_bytes());
    b.extend_from_slice(&(RATE as u32 * 4).to_le_bytes());
    b.extend_from_slice(&4u16.to_le_bytes());
    b.extend_from_slice(&16u16.to_le_bytes());
    b.extend_from_slice(b"data");
    b.extend_from_slice(&data_len.to_le_bytes());
    for s in pcm {
        b.extend_from_slice(&s.to_le_bytes());
    }
    b
}

/// 1 曲分の (WAV, 曲の JSON, index.json の項目)
pub struct One {
    pub wav: Vec<u8>,
    pub json: String,
    pub entry: Json,
}

pub fn write_one(category: &str, info: &SeqInfo, r: Rendered) -> One {
    let (mut l, mut rr) = (r.left, r.right);
    for x in l.iter_mut().chain(rr.iter_mut()) {
        *x /= 32768.0;
    }
    let frames = l.len();
    let mut seam = None;
    let mut seq_dur = None;
    let cut = if let Some(lp) = &r.loop_ {
        let (ls, le) = (lp.start_sample, lp.end_sample);
        let m = (frames as i64 - le).min(le - ls).min(RATE / 20);
        if m > 0 {
            let (a0, b0, m2) = ((ls * 2) as usize, (le * 2) as usize, (m * 2) as usize);
            let a = |i: usize| inter(&l, &rr, a0 + i);
            let b = |i: usize| inter(&l, &rr, b0 + i);
            let r0 = (np_sum_by(m2, &|i| a(i) * a(i)) / m2 as f64).sqrt();
            let rf = if r0 != 0.0 { r0 } else { 1e-12 };
            let d = np_sum_by(m2, &|i| (a(i) - b(i)) * (a(i) - b(i))) / m2 as f64;
            seam = Some(d.sqrt() / rf);
        }
        lp.file_end.max(le).min(frames as i64) as usize // 前奏 + ループ 2 回で切る
    } else {
        // 後ろの完全な無音は切る。シーケンスとしての長さは sequenceDuration に残す
        seq_dur = Some(frames as f64 / RATE as f64);
        (0..frames).rev().find(|&i| l[i].abs().max(rr[i].abs()) >= 0.5 / 32768.0).map_or(0, |i| i + 1)
    };
    l.truncate(cut);
    rr.truncate(cut);
    let peak = l.iter().chain(&rr).fold(0.0f64, |m, x| m.max(x.abs()));
    let clipped = l.iter().chain(&rr).filter(|x| x.abs() > 32767.0 / 32768.0).count();
    let to16 = |x: f64| (x * 32768.0).round_ties_even().clamp(-32768.0, 32767.0) as i16;
    let pcm: Vec<i16> = l.iter().zip(&rr).flat_map(|(a, b)| [to16(*a), to16(*b)]).collect();
    let n = cut;
    let check = Json::obj().with("peak", peak).with("clipped", clipped).with("rmsDb", rms_db(&l, &rr)).with("centroidHz", centroid(&l, &rr));
    let mut e = Json::obj()
        .with("name", info.name.clone()).with("category", category).with("sdatIndex", info.index).with("fileId", info.file_id)
        .with("bank", info.bank).with("volume", info.volume).with("channelPriority", info.channel_prio)
        .with("playerPriority", info.player_prio).with("player", info.player)
        .with("wav", format!("{category}/{}.wav", info.name)).with("ogg", Json::Null)
        .with("sampleRate", RATE).with("samples", n).with("duration", n as f64 / RATE as f64)
        .with("loop", Json::Null).with("peak", peak).with("check", check)
        .with("finished", r.finished).with("capped", r.capped).with("bankName", r.bank_name.clone())
        .with("waveArchives", r.wave_archives.clone()).with("tracks", r.tracks)
        .with("missingWaves", r.missing_waves.clone()).with("usesRandom", r.uses_random);
    if let Some(d) = seq_dur {
        e.set("sequenceDuration", d);
    }
    if let Some(lp) = &r.loop_ {
        let (s, en) = (lp.start_sample as f64 / RATE as f64, lp.end_sample as f64 / RATE as f64);
        e.set("loop", Json::obj()
            .with("startSample", lp.start_sample).with("endSample", lp.end_sample).with("start", s).with("end", en)
            .with("startTick", lp.start_tick).with("endTick", lp.end_tick).with("lengthTicks", lp.length_ticks)
            .with("endShift", lp.end_shift).with("seamError", lp.seam_error).with("seamRms", seam.unwrap_or(f64::NAN)));
        e.set("loopStart", s);
        e.set("loopEnd", en);
    }
    One { wav: wav(&pcm), json: e.dumps(), entry: e }
}

/// JSON に書けない inf / nan を null にする
fn clean(o: &Json) -> Json {
    match o {
        Json::Float(f) if !f.is_finite() => Json::Null,
        Json::Obj(m) => Json::Obj(m.iter().map(|(k, v)| (k.clone(), clean(v))).collect()),
        Json::Arr(a) => Json::Arr(a.iter().map(clean).collect()),
        x => x.clone(),
    }
}

/// 台本（script/*.txt の中身）での [bgm N] / [se N] の使用回数: 番号 → [(種類, 回数)]
pub fn script_uses(texts: &[String]) -> std::collections::BTreeMap<i64, Vec<(String, i64)>> {
    let mut res: std::collections::BTreeMap<i64, Vec<(String, i64)>> = Default::default();
    for t in texts {
        let b = t.as_bytes();
        let mut i = 0;
        while let Some(p) = t[i..].find('[') {
            let s = i + p + 1;
            i = s;
            let kind = if b[s..].starts_with(b"bgm ") { "bgm" } else if b[s..].starts_with(b"se ") { "se" } else { continue };
            let ds = s + kind.len() + 1;
            let de = ds + b[ds..].iter().take_while(|c| c.is_ascii_digit()).count();
            if de == ds {
                continue;
            }
            let n: i64 = t[ds..de].parse().unwrap_or(i64::MAX);
            let u = res.entry(n).or_default();
            match u.iter_mut().find(|(k, _)| k == kind) {
                Some(x) => x.1 += 1,
                None => u.push((kind.to_string(), 1)),
            }
            i = de;
        }
    }
    res
}

/// index.json と index.html の中身。entries は sdatIndex の順に並べ直す
pub fn write_index(mut entries: Vec<Json>, uses: &std::collections::BTreeMap<i64, Vec<(String, i64)>>) -> (String, String) {
    entries.sort_by_key(|e| e.get("sdatIndex").and_then(Json::as_i64).unwrap_or(0));
    for e in &mut entries {
        let id = e.get("sdatIndex").and_then(Json::as_i64).unwrap_or(0);
        e.set("scriptId", id);
        let u = uses.get(&id).map_or(Json::obj(), |v| Json::Obj(v.iter().map(|(k, n)| (k.clone(), Json::from(*n))).collect()));
        e.set("scriptUses", u);
    }
    let doc = Json::obj()
        .with("source", "sound_data.sdat（逆転裁判 蘇る逆転 AGYJ）")
        .with("sampleRate", RATE)
        .with("note", "loop.start/end は秒。loop の範囲（2 回目のループ）を繰り返せば継ぎ目なく鳴る。sdatIndex は SDAT の INFO のシーケンス番号。名前の BGMnnn/SEnnn は SYMB による。台本の [bgm N] / [se N] の N は sdatIndex そのもの（scriptId。bgm 380〜386 = BGM150〜156、se 406〜450 = SE0B6〜SE0E2 など、台本に出てくる番号がすべて SDAT の空でない項目に当たることで確かめた。bgm 255 は止める）。scriptUses は台本での使用回数。")
        .with("items", clean(&Json::Arr(entries.clone())));
    (doc.dumps(), super::audition::page(&entries))
}
