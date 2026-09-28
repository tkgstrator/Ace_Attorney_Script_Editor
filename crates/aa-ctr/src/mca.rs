//! カプコンの MCA（"MADP"）。中身は GameCube 系の 4 ビット ADPCM（DSP ADPCM）。
//!
//! 見出し: u16 版（0x04、5 は 4、6 は 5）、u8 チャンネル数（0x08）、u16 インターリーブ（0x0A）、u32 サンプル数（0x0C）、
//! u32 周波数（0x10）、u32 ループの始まり・終わり（0x14・0x18、サンプル単位。終わりが 0 ならループしない）、
//! u32 見出しの大きさ（0x1C、マーカーの分を含まない）、u32 データの大きさ（0x20）。
//! マーカー（0x14 バイト）がいくつか並び、その後ろに係数（1 チャンネル 0x30 バイト）、そのあとにデータ。
//! - 版 4: マーカーの数は 0x28 の u16、0x34 から並ぶ
//! - 版 5: マーカーの数は 0x28 の u32、0x38 から並ぶ。データの位置は 0x34（係数との間に空きがある）。
//!   版 5 でマーカーがあると ffmpeg は読めない
//!
//! 係数のかたまり（0x30）: i16 × 16、u16 gain、u16 ps、i16 hist1、i16 hist2、ループの ps・hist1・hist2、空き。

use crate::{u16le, u32le};

pub struct Mca {
    pub channels: usize,
    pub rate: u32,
    pub samples: usize,
    pub loop_start: u32,
    pub loop_end: u32,
    /// チャンネルを交互に並べた 16 ビットの PCM
    pub pcm: Vec<i16>,
}

pub fn decode(d: &[u8]) -> crate::Result<Mca> {
    if d.get(..4) != Some(b"MADP") {
        return Err("MCA ではありません".into());
    }
    let ver = u16le(d, 4);
    let ch = d[8] as usize;
    let il = u16le(d, 0x0A) as usize;
    let samples = u32le(d, 0x0C) as usize;
    let (rate, loop_start, loop_end) = (u32le(d, 0x10), u32le(d, 0x14), u32le(d, 0x18));
    let size = u32le(d, 0x20) as usize;
    let coef = match ver {
        4 => 0x34 + u16le(d, 0x28) as usize * 0x14,
        5 => 0x38 + u32le(d, 0x28) as usize * 0x14,
        _ => return Err(format!("知らない版 {ver}")),
    };
    let start = if ver == 5 {
        u32le(d, 0x34) as usize
    } else {
        coef + 0x30 * ch
    };
    if ch == 0 || il == 0 || start + size > d.len() {
        return Err("見出しが合いません".into());
    }
    let data = &d[start..start + size];
    let full = size / (il * ch);
    let last = (size % (il * ch)) / ch;
    let mut pcm = vec![0i16; samples * ch];
    for c in 0..ch {
        let k = coef + c * 0x30;
        let coefs: Vec<i32> = (0..16).map(|i| u16le(d, k + i * 2) as i16 as i32).collect();
        let (mut h1, mut h2) = (
            u16le(d, k + 0x24) as i16 as i32,
            u16le(d, k + 0x26) as i16 as i32,
        );
        let mut stream = Vec::with_capacity(size / ch);
        for b in 0..full {
            let at = b * il * ch + c * il;
            stream.extend_from_slice(&data[at..at + il]);
        }
        let at = full * il * ch + c * last;
        stream.extend_from_slice(&data[at..at + last]);
        let mut n = 0;
        'frames: for frame in stream.chunks(8) {
            let scale = 1i32 << (frame[0] & 0xF);
            let ci = (frame[0] >> 4) as usize * 2;
            let (c1, c2) = (coefs[ci], coefs[ci + 1]);
            for i in 0..(frame.len() - 1) * 2 {
                if n == samples {
                    break 'frames;
                }
                let byte = frame[1 + i / 2];
                let nib = if i % 2 == 0 { byte >> 4 } else { byte & 0xF } as i32;
                let nib = if nib >= 8 { nib - 16 } else { nib };
                let s = (((nib * scale) << 11) + 1024 + c1 * h1 + c2 * h2) >> 11;
                let s = s.clamp(-32768, 32767);
                pcm[n * ch + c] = s as i16;
                h2 = h1;
                h1 = s;
                n += 1;
            }
        }
    }
    Ok(Mca {
        channels: ch,
        rate,
        samples,
        loop_start,
        loop_end,
        pcm,
    })
}

pub fn wav(m: &Mca) -> Vec<u8> {
    let data_len = (m.pcm.len() * 2) as u32;
    let mut w = Vec::with_capacity(44 + data_len as usize);
    let block = (m.channels * 2) as u16;
    w.extend_from_slice(b"RIFF");
    w.extend_from_slice(&(36 + data_len).to_le_bytes());
    w.extend_from_slice(b"WAVEfmt ");
    w.extend_from_slice(&16u32.to_le_bytes());
    w.extend_from_slice(&1u16.to_le_bytes());
    w.extend_from_slice(&(m.channels as u16).to_le_bytes());
    w.extend_from_slice(&m.rate.to_le_bytes());
    w.extend_from_slice(&(m.rate * block as u32).to_le_bytes());
    w.extend_from_slice(&block.to_le_bytes());
    w.extend_from_slice(&16u16.to_le_bytes());
    w.extend_from_slice(b"data");
    w.extend_from_slice(&data_len.to_le_bytes());
    for s in &m.pcm {
        w.extend_from_slice(&s.to_le_bytes());
    }
    w
}
