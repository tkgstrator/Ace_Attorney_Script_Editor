//! Python の `json.dumps(..., ensure_ascii=False, indent=1)` と同じ文字列を作る JSON の値。
//!
//! 鍵の順番は入れた順（Python の dict と同じ）。数は整数と浮動小数点を区別し、浮動小数点は
//! Python の repr と同じ書き方（最短の桁、1e-05 のような指数の形）にする。NaN / ±inf は
//! Python と同じく NaN / Infinity / -Infinity と書く。

#[derive(Debug, Clone, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    Str(String),
    Arr(Vec<Json>),
    Obj(Vec<(String, Json)>),
}

impl Json {
    pub fn obj() -> Json {
        Json::Obj(Vec::new())
    }

    /// 鍵を足す（同じ鍵があれば置き換える。Python の d[k] = v と同じく位置は変えない）
    pub fn set(&mut self, k: impl Into<String>, v: impl Into<Json>) -> &mut Self {
        if let Json::Obj(m) = self {
            let k = k.into();
            let v = v.into();
            if let Some(e) = m.iter_mut().find(|(kk, _)| *kk == k) {
                e.1 = v;
            } else {
                m.push((k, v));
            }
        }
        self
    }

    pub fn with(mut self, k: impl Into<String>, v: impl Into<Json>) -> Self {
        self.set(k, v);
        self
    }

    pub fn get(&self, k: &str) -> Option<&Json> {
        match self {
            Json::Obj(m) => m.iter().find(|(kk, _)| kk == k).map(|(_, v)| v),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Json::Str(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_i64(&self) -> Option<i64> {
        match self {
            Json::Int(i) => Some(*i),
            _ => None,
        }
    }

    /// serde_json の値から作る（埋め込みの固定の表を読むとき）
    pub fn from_serde(v: &serde_json::Value) -> Json {
        use serde_json::Value as V;
        match v {
            V::Null => Json::Null,
            V::Bool(b) => Json::Bool(*b),
            V::Number(n) => {
                if let Some(i) = n.as_i64() {
                    Json::Int(i)
                } else {
                    Json::Float(n.as_f64().unwrap_or(f64::NAN))
                }
            }
            V::String(s) => Json::Str(s.clone()),
            V::Array(a) => Json::Arr(a.iter().map(Json::from_serde).collect()),
            V::Object(m) => Json::Obj(m.iter().map(|(k, v)| (k.clone(), Json::from_serde(v))).collect()),
        }
    }

    /// `json.dumps(self, ensure_ascii=False, indent=1)`
    pub fn dumps(&self) -> String {
        let mut s = String::new();
        write_value(self, 0, &mut s);
        s
    }
}

macro_rules! from_int {
    ($($t:ty),*) => {$(
        impl From<$t> for Json {
            fn from(v: $t) -> Json { Json::Int(v as i64) }
        }
    )*};
}
from_int!(i8, i16, i32, i64, u8, u16, u32, usize);

impl From<f64> for Json {
    fn from(v: f64) -> Json {
        Json::Float(v)
    }
}
impl From<bool> for Json {
    fn from(v: bool) -> Json {
        Json::Bool(v)
    }
}
impl From<&str> for Json {
    fn from(v: &str) -> Json {
        Json::Str(v.to_string())
    }
}
impl From<String> for Json {
    fn from(v: String) -> Json {
        Json::Str(v)
    }
}
impl From<&String> for Json {
    fn from(v: &String) -> Json {
        Json::Str(v.clone())
    }
}
impl<T: Into<Json>> From<Option<T>> for Json {
    fn from(v: Option<T>) -> Json {
        v.map_or(Json::Null, Into::into)
    }
}
impl<T: Into<Json>> From<Vec<T>> for Json {
    fn from(v: Vec<T>) -> Json {
        Json::Arr(v.into_iter().map(Into::into).collect())
    }
}

fn indent(n: usize, s: &mut String) {
    s.push('\n');
    for _ in 0..n {
        s.push(' ');
    }
}

fn write_value(v: &Json, lvl: usize, s: &mut String) {
    match v {
        Json::Null => s.push_str("null"),
        Json::Bool(b) => s.push_str(if *b { "true" } else { "false" }),
        Json::Int(i) => s.push_str(&i.to_string()),
        Json::Float(f) => s.push_str(&json_float(*f)),
        Json::Str(t) => write_str(t, s),
        Json::Arr(a) => {
            if a.is_empty() {
                s.push_str("[]");
                return;
            }
            s.push('[');
            for (i, x) in a.iter().enumerate() {
                if i > 0 {
                    s.push(',');
                }
                indent(lvl + 1, s);
                write_value(x, lvl + 1, s);
            }
            indent(lvl, s);
            s.push(']');
        }
        Json::Obj(m) => {
            if m.is_empty() {
                s.push_str("{}");
                return;
            }
            s.push('{');
            for (i, (k, x)) in m.iter().enumerate() {
                if i > 0 {
                    s.push(',');
                }
                indent(lvl + 1, s);
                write_str(k, s);
                s.push_str(": ");
                write_value(x, lvl + 1, s);
            }
            indent(lvl, s);
            s.push('}');
        }
    }
}

/// ensure_ascii=False の文字列の書き方
fn write_str(t: &str, s: &mut String) {
    s.push('"');
    for c in t.chars() {
        match c {
            '"' => s.push_str("\\\""),
            '\\' => s.push_str("\\\\"),
            '\n' => s.push_str("\\n"),
            '\r' => s.push_str("\\r"),
            '\t' => s.push_str("\\t"),
            '\u{8}' => s.push_str("\\b"),
            '\u{c}' => s.push_str("\\f"),
            c if (c as u32) < 0x20 => s.push_str(&format!("\\u{:04x}", c as u32)),
            c => s.push(c),
        }
    }
    s.push('"');
}

fn json_float(f: f64) -> String {
    if f.is_nan() {
        "NaN".into()
    } else if f.is_infinite() {
        if f > 0.0 { "Infinity" } else { "-Infinity" }.into()
    } else {
        py_repr(f)
    }
}

/// Python の `repr(float)`（最短で元に戻る桁。10 進の指数が -4 未満か 16 以上なら指数の形）
pub fn py_repr(f: f64) -> String {
    if f.is_nan() {
        return "nan".into();
    }
    if f.is_infinite() {
        return if f > 0.0 { "inf".into() } else { "-inf".into() };
    }
    if f == 0.0 {
        return if f.is_sign_negative() { "-0.0".into() } else { "0.0".into() };
    }
    // Rust の {:e} は最短の桁を出す: "d.ddddde-X"
    let e = format!("{:e}", f.abs());
    let (mant, exp) = e.split_once('e').unwrap();
    let exp: i32 = exp.parse().unwrap();
    let digits: String = mant.chars().filter(|c| c.is_ascii_digit()).collect();
    let n = digits.len() as i32;
    let decpt = exp + 1; // 小数点の位置（先頭の桁の前から数える）
    let sign = if f < 0.0 { "-" } else { "" };
    if decpt <= -4 || decpt > 16 {
        let m = if n > 1 { format!("{}.{}", &digits[..1], &digits[1..]) } else { digits.clone() };
        let es = if exp < 0 { format!("-{:02}", -exp) } else { format!("+{exp:02}") };
        format!("{sign}{m}e{es}")
    } else if decpt <= 0 {
        format!("{sign}0.{}{}", "0".repeat((-decpt) as usize), digits)
    } else if decpt >= n {
        format!("{sign}{}{}.0", digits, "0".repeat((decpt - n) as usize))
    } else {
        format!("{sign}{}.{}", &digits[..decpt as usize], &digits[decpt as usize..])
    }
}

/// JSON の文字列を読む（NaN / Infinity も読む）
pub fn parse(t: &str) -> Option<Json> {
    let t = t.replace("-Infinity", "null").replace("Infinity", "null").replace("NaN", "null");
    let v: serde_json::Value = serde_json::from_str(&t).ok()?;
    Some(Json::from_serde(&v))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repr() {
        assert_eq!(py_repr(1.0), "1.0");
        assert_eq!(py_repr(0.1), "0.1");
        assert_eq!(py_repr(1e-5), "1e-05");
        assert_eq!(py_repr(0.0001), "0.0001");
        assert_eq!(py_repr(1e16), "1e+16");
        assert_eq!(py_repr(1e15), "1000000000000000.0");
        assert_eq!(py_repr(123.456), "123.456");
        assert_eq!(py_repr(-2.5e-7), "-2.5e-07");
        assert_eq!(py_repr(1.2345e20), "1.2345e+20");
    }

    #[test]
    fn dumps() {
        let j = Json::obj().with("a", 1).with("b", Json::Arr(vec![])).with("c", vec![1.5, 2.0]).with("d", "え\"");
        assert_eq!(j.dumps(), "{\n \"a\": 1,\n \"b\": [],\n \"c\": [\n  1.5,\n  2.0\n ],\n \"d\": \"え\\\"\"\n}");
    }
}
