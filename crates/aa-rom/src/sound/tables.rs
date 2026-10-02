//! DS の音源ドライバー（NITRO-SDK の SND）が使う表と換算（nds_sound_tables.py）。
//!
//! 浮動小数点で作る表（デシベル・音程・音量レジスター）は、環境で結果が変わらないように
//! Python 版が作った値を data/static.json から読む。

use std::sync::OnceLock;

use crate::json::Json;
use crate::statics;

/// ARM7 のクロックの半分（チャンネルのタイマー）
pub const CHANNEL_CLOCK: i64 = 33513982 / 2;
/// ミキサーの出力の周波数（整数にしたもの）
pub const OUTPUT_RATE_INT: i64 = 32728;
/// 音量の下限（0.1 dB 単位）
pub const AMPL_K: i64 = 723;
/// 包絡線（ADSR）の内部値の下限
pub const AMPL_THRESHOLD: i64 = -AMPL_K << 7;

const SINE_TABLE: [i64; 33] = [
    0, 6, 12, 19, 25, 31, 37, 43, 49, 54, 60, 65, 71, 76, 81, 85, 90, 94, 98, 102, 106, 109, 112,
    115, 118, 120, 122, 123, 125, 126, 126, 127, 127,
];
const ATTACK_LUT: [i64; 19] = [
    0x00, 0x01, 0x05, 0x0E, 0x1A, 0x26, 0x33, 0x3F, 0x49, 0x54, 0x5C, 0x64, 0x6D, 0x74, 0x7B, 0x7F,
    0x84, 0x89, 0x8F,
];
const DIV_SHIFT: [u32; 4] = [0, 1, 2, 4];

pub const ADPCM_INDEX: [i32; 8] = [-1, -1, -1, -1, 2, 4, 6, 8];
pub const ADPCM_STEP: [i32; 89] = [
    7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66,
    73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449,
    494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272,
    2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493,
    10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];

struct Tables {
    decibel_square: Vec<i64>,
    pitch: Vec<i64>,
    volume_registers: Vec<(i64, i64)>,
}

fn tables() -> &'static Tables {
    static CELL: OnceLock<Tables> = OnceLock::new();
    CELL.get_or_init(|| {
        let t = statics::get("sound_tables");
        let ints = |k: &str| statics::ints(t.get(k).unwrap_or(&Json::Null));
        let regs = match t.get("volume_registers") {
            Some(Json::Arr(a)) => a
                .iter()
                .map(|x| {
                    let v = statics::ints(x);
                    (v[0], v[1])
                })
                .collect(),
            _ => Vec::new(),
        };
        let out = Tables {
            decibel_square: ints("decibel_square"),
            pitch: ints("pitch_table"),
            volume_registers: regs,
        };
        assert_eq!(out.decibel_square.len(), 128);
        assert_eq!(out.pitch.len(), 768);
        assert_eq!(out.volume_registers.len(), AMPL_K as usize + 1);
        out
    })
}

/// Python の list[i]（負なら後ろから）
fn py_get(v: &[i64], i: i64) -> i64 {
    let j = if i < 0 { v.len() as i64 + i } else { i };
    v[j as usize]
}

/// 音量・表情・ベロシティ・サステインの 0〜127 → 0.1 dB
pub fn cnv_sust(v: i64) -> i64 {
    let v = if v & 0x80 != 0 { 0x7F } else { v };
    py_get(&tables().decibel_square, v)
}

/// アタックの値 → 1 フレームごとに掛ける係数（/255）
pub fn cnv_attack(a: i64) -> i64 {
    let a = if a & 0x80 != 0 { 0 } else { a };
    if a >= 0x6D {
        py_get(&ATTACK_LUT, 0x7F - a)
    } else {
        0xFF - a
    }
}

/// ディケイ・リリースの値 → 1 フレームごとに引く量
pub fn cnv_fall(f: i64) -> i64 {
    let f = if f & 0x80 != 0 { 0 } else { f };
    if f == 0x7F {
        0xFFFF
    } else if f == 0x7E {
        0x3C00
    } else if f < 0x32 {
        ((f << 1) + 1) & 0xFFFF
    } else {
        (0x1E00_i64.div_euclid(0x7E - f)) & 0xFFFF
    }
}

/// 0〜127 の位相 → -127〜127
pub fn cnv_sine(arg: i64) -> i64 {
    if arg < 0x20 {
        py_get(&SINE_TABLE, arg)
    } else if arg < 0x40 {
        SINE_TABLE[(0x40 - arg) as usize]
    } else if arg < 0x60 {
        -SINE_TABLE[(arg - 0x40) as usize]
    } else {
        -py_get(&SINE_TABLE, 0x20 - (arg - 0x60))
    }
}

/// タイマーの値（周期のクロック数）を pitch（1/64 半音）だけ上げたものにする
pub fn timer_adjust(base: i64, pitch: i64) -> i64 {
    let mut shift: i64 = 0;
    let mut pitch = -pitch;
    while pitch < 0 {
        shift -= 1;
        pitch += 0x300;
    }
    while pitch >= 0x300 {
        shift += 1;
        pitch -= 0x300;
    }
    let mut tmr: i128 = base as i128 * (tables().pitch[pitch as usize] + 0x10000) as i128;
    shift -= 16;
    if shift <= 0 {
        tmr >>= -shift;
    } else if shift < 32 {
        let mask: i128 = (!0i128 << (32 - shift)) & 0xFFFF_FFFF_FFFF_FFFF;
        if tmr & mask != 0 {
            return 0xFFFF;
        }
        tmr <<= shift;
    } else {
        return 0x10;
    }
    tmr.clamp(0x10, 0xFFFF) as i64
}

/// 0.1 dB の合計 → (音量レジスター, 割り算の番号)
pub fn volume_gain(total_db: i64) -> (i64, i64) {
    let idx = (total_db + AMPL_K).clamp(0, AMPL_K);
    tables().volume_registers[idx as usize]
}

/// 音量レジスターの値 → 実際の倍率
pub fn register_amplitude(vol: i64, div: i64) -> f64 {
    vol as f64 / 128.0 / (1u32 << DIV_SHIFT[div as usize]) as f64
}

/// NCSFCommon/NCSF.cs の ConvertScale（曲の音量用のデシベル表）。
pub fn cnv_scale(v: i64) -> i64 {
    const TABLE: [i64; 128] = [
        -32768, -421, -361, -325, -300, -281, -265, -252, -240, -230, -221, -212, -205, -198, -192,
        -186, -180, -175, -170, -165, -161, -156, -152, -148, -145, -141, -138, -134, -131, -128,
        -125, -122, -120, -117, -114, -112, -110, -107, -105, -103, -100, -98, -96, -94, -92, -90,
        -88, -86, -85, -83, -81, -79, -78, -76, -74, -73, -71, -70, -68, -67, -65, -64, -62, -61,
        -60, -58, -57, -56, -54, -53, -52, -51, -49, -48, -47, -46, -45, -43, -42, -41, -40, -39,
        -38, -37, -36, -35, -34, -33, -32, -31, -30, -29, -28, -27, -26, -25, -24, -23, -23, -22,
        -21, -20, -19, -18, -17, -17, -16, -15, -14, -13, -12, -12, -11, -10, -9, -9, -8, -7, -6,
        -6, -5, -4, -3, -3, -2, -1, -1, 0,
    ];
    TABLE[if v & 0x80 != 0 { 127 } else { v as usize }]
}
