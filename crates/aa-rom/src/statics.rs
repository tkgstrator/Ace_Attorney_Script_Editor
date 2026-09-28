//! ROM から読まない固定の表（tools/rom/*.py に直接書かれているもの）。
//!
//! data/static.json は tools/rom/export_static_rs.py が Python の表から作る。Python 側の表を直したら作り直す。

use std::sync::OnceLock;

use crate::json::Json;

static RAW: &str = include_str!("../data/static.json");

fn root() -> &'static Json {
    static CELL: OnceLock<Json> = OnceLock::new();
    CELL.get_or_init(|| {
        let v: serde_json::Value = serde_json::from_str(RAW).expect("static.json が読めません");
        Json::from_serde(&v)
    })
}

/// 鍵 k の値（無ければ Null）
pub fn get(k: &str) -> &'static Json {
    static NULL: Json = Json::Null;
    root().get(k).unwrap_or(&NULL)
}

/// script_format.py の命令の表: 番号 → (名前, 引数の数)
pub fn script_opcodes() -> &'static [(String, usize); 128] {
    static CELL: OnceLock<[(String, usize); 128]> = OnceLock::new();
    CELL.get_or_init(|| {
        let mut t: [(String, usize); 128] = std::array::from_fn(|o| (format!("op{o}"), usize::MAX));
        if let Json::Obj(m) = get("script_format") {
            for (k, v) in m {
                let o: usize = k.parse().expect("命令の番号");
                if let Json::Arr(a) = v {
                    t[o] = (a[0].as_str().unwrap().to_string(), a[1].as_i64().unwrap() as usize);
                }
            }
        }
        t
    })
}

/// 命令 op の引数の数（表に無ければ 0。Python の ARGC.get(op, 0)）
pub fn argc(op: u16) -> usize {
    match script_opcodes().get(op as usize) {
        Some((_, n)) if *n != usize::MAX => *n,
        _ => 0,
    }
}

/// 命令の名前（表に無ければ opN）
pub fn op_name(op: u16) -> String {
    match script_opcodes().get(op as usize) {
        Some((n, c)) if *c != usize::MAX => n.clone(),
        _ => format!("op{op}"),
    }
}

/// 表の中の整数の一覧
pub fn ints(v: &Json) -> Vec<i64> {
    match v {
        Json::Arr(a) => a.iter().filter_map(Json::as_i64).collect(),
        _ => Vec::new(),
    }
}
