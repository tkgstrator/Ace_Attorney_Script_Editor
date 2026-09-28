// 条件式の評価。JS（packages/core の expr.ts）と同じ結果になるよう、真偽・比べ・足し算の決まりを合わせる。
use crate::model::{BinOp, Expr, FVal, Model};
use std::borrow::Cow;

/// 式の値（JS の値）
#[derive(Clone, Debug)]
pub enum JsVal<'a> {
    Undef,
    Bool(bool),
    Num(f64),
    Str(Cow<'a, str>),
}

impl<'a> JsVal<'a> {
    pub fn from_flag(v: FVal, m: &'a Model) -> JsVal<'a> {
        match v {
            FVal::Undef => JsVal::Undef,
            FVal::Bool(b) => JsVal::Bool(b),
            FVal::Num(n) => JsVal::Num(n),
            FVal::Str(i) => JsVal::Str(Cow::Borrowed(&m.strings[i as usize])),
        }
    }

    /// JS の !!v
    pub fn truthy(&self) -> bool {
        match self {
            JsVal::Undef => false,
            JsVal::Bool(b) => *b,
            JsVal::Num(n) => *n != 0.0 && !n.is_nan(),
            JsVal::Str(s) => !s.is_empty(),
        }
    }

    /// JS の Number(v)
    pub fn number(&self) -> f64 {
        match self {
            JsVal::Undef => f64::NAN,
            JsVal::Bool(b) => f64::from(u8::from(*b)),
            JsVal::Num(n) => *n,
            JsVal::Str(s) => {
                let t = s.trim();
                if t.is_empty() { 0.0 } else { t.parse().unwrap_or(f64::NAN) }
            }
        }
    }

    /// JS の String(v)
    pub fn string(&self) -> String {
        match self {
            JsVal::Undef => "undefined".into(),
            JsVal::Bool(b) => b.to_string(),
            JsVal::Num(n) => num_string(*n),
            JsVal::Str(s) => s.to_string(),
        }
    }

    /// JS の ===
    pub fn strict_eq(&self, o: &JsVal) -> bool {
        match (self, o) {
            (JsVal::Undef, JsVal::Undef) => true,
            (JsVal::Bool(a), JsVal::Bool(b)) => a == b,
            (JsVal::Num(a), JsVal::Num(b)) => a == b,
            (JsVal::Str(a), JsVal::Str(b)) => a == b,
            _ => false,
        }
    }
}

/// JS の数の文字列化（整数は小数点なし）
pub fn num_string(n: f64) -> String {
    if n.is_nan() {
        "NaN".into()
    } else if n.is_infinite() {
        if n > 0.0 { "Infinity".into() } else { "-Infinity".into() }
    } else if n == n.trunc() && n.abs() < 1e21 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

/// 式から状態を読む口
pub trait Env {
    /// フラグの値（エンジンでは、値のないフラグはエラー）
    fn var(&self, flag: u32) -> Result<FVal, String>;
    fn life(&self) -> f64;
    fn has(&self, ev: u32) -> bool;
    fn visited(&self, id: u32) -> bool;
    fn seen(&self, id: u32) -> bool;
}

pub fn eval<'a, E: Env>(e: &Expr, env: &E, m: &'a Model) -> Result<JsVal<'a>, String> {
    Ok(match e {
        Expr::Table(t) => JsVal::Bool(table(t, env)?),
        Expr::Lit(v) => JsVal::from_flag(*v, m),
        Expr::Var(f) => JsVal::from_flag(env.var(*f)?, m),
        Expr::Life => JsVal::Num(env.life()),
        Expr::Has(x) => JsVal::Bool(env.has(*x)),
        Expr::Visited(x) => JsVal::Bool(env.visited(*x)),
        Expr::Seen(x) => JsVal::Bool(env.seen(*x)),
        Expr::Not(x) => JsVal::Bool(!eval(x, env, m)?.truthy()),
        Expr::Bin(BinOp::And, l, r) => JsVal::Bool(eval(l, env, m)?.truthy() && eval(r, env, m)?.truthy()),
        Expr::Bin(BinOp::Or, l, r) => JsVal::Bool(eval(l, env, m)?.truthy() || eval(r, env, m)?.truthy()),
        Expr::Bin(op, l, r) => binop(*op, eval(l, env, m)?, eval(r, env, m)?),
    })
}

/// 2 つの値の演算（and・or 以外。and・or は短絡するので eval で扱う）
pub fn binop<'a>(op: BinOp, a: JsVal<'a>, b: JsVal<'a>) -> JsVal<'a> {
    match op {
        BinOp::Eq => JsVal::Bool(a.strict_eq(&b)),
        BinOp::Ne => JsVal::Bool(!a.strict_eq(&b)),
        BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => JsVal::Bool(compare(op, &a, &b)),
        BinOp::Add => match (&a, &b) {
            (JsVal::Num(x), JsVal::Num(y)) => JsVal::Num(x + y),
            _ => JsVal::Str(Cow::Owned(a.string() + &b.string())),
        },
        BinOp::Sub => JsVal::Num(a.number() - b.number()),
        BinOp::And => JsVal::Bool(a.truthy() && b.truthy()),
        BinOp::Or => JsVal::Bool(a.truthy() || b.truthy()),
    }
}

/// JS の < <= > >=（両方が文字列なら文字列の順、そうでなければ数にして比べる）
fn compare(op: BinOp, a: &JsVal, b: &JsVal) -> bool {
    if let (JsVal::Str(x), JsVal::Str(y)) = (a, b) {
        let (x, y): (Vec<u16>, Vec<u16>) = (x.encode_utf16().collect(), y.encode_utf16().collect());
        return match op {
            BinOp::Lt => x < y, BinOp::Le => x <= y, BinOp::Gt => x > y, _ => x >= y,
        };
    }
    let (x, y) = (a.number(), b.number());
    match op {
        BinOp::Lt => x < y, BinOp::Le => x <= y, BinOp::Gt => x > y, _ => x >= y,
    }
}

/// 条件の真偽（条件がなければ真）
pub fn test<E: Env>(e: Option<&Expr>, env: &E, m: &Model) -> Result<bool, String> {
    match e {
        None => Ok(true),
        Some(e) => truth(e, env, m),
    }
}

/// 式の真偽。よく使う形（真偽のフラグ・not・and・or・数との ==）は、値を作らずに速く求める
fn truth<E: Env>(e: &Expr, env: &E, m: &Model) -> Result<bool, String> {
    Ok(match e {
        Expr::Table(t) => table(t, env)?,
        Expr::Var(f) => match env.var(*f)? {
            FVal::Bool(b) => b,
            v => JsVal::from_flag(v, m).truthy(),
        },
        Expr::Has(x) => env.has(*x),
        Expr::Visited(x) => env.visited(*x),
        Expr::Seen(x) => env.seen(*x),
        Expr::Not(x) => !truth(x, env, m)?,
        Expr::Bin(BinOp::And, l, r) => truth(l, env, m)? && truth(r, env, m)?,
        Expr::Bin(BinOp::Or, l, r) => truth(l, env, m)? || truth(r, env, m)?,
        Expr::Bin(op @ (BinOp::Eq | BinOp::Ne), l, r) => match (&**l, &**r) {
            (Expr::Var(f), Expr::Lit(FVal::Num(n))) | (Expr::Lit(FVal::Num(n)), Expr::Var(f)) => {
                let eq = matches!(env.var(*f)?, FVal::Num(x) if x == *n);
                eq == (*op == BinOp::Eq)
            }
            _ => eval(e, env, m)?.truthy(),
        },
        _ => eval(e, env, m)?.truthy(),
    })
}

/// 真理値表を引く
fn table<E: Env>(t: &crate::model::Table, env: &E) -> Result<bool, String> {
    use crate::model::TableVar;
    let mut idx = 0usize;
    for (i, v) in t.vars.iter().enumerate() {
        let on = match *v {
            TableVar::Flag(f) => env.var(f)? == FVal::Bool(true),
            TableVar::Has(x) => env.has(x),
            TableVar::Visited(x) => env.visited(x),
            TableVar::Seen(x) => env.seen(x),
        };
        idx |= usize::from(on) << i;
    }
    Ok(t.bits[idx >> 6] >> (idx & 63) & 1 == 1)
}

/// 式を読める形に戻す（報告に使う）
pub fn show(e: &Expr, m: &Model) -> String {
    match e {
        Expr::Table(t) => show(&t.orig, m),
        Expr::Lit(v) => match v {
            FVal::Undef => "undefined".into(),
            FVal::Bool(b) => b.to_string(),
            FVal::Num(n) => num_string(*n),
            FVal::Str(i) => format!("'{}'", m.strings[*i as usize]),
        },
        Expr::Var(f) => m.flag_names[*f as usize].clone(),
        Expr::Life => "life".into(),
        Expr::Has(x) => format!("has({})", m.evidence[*x as usize].id),
        Expr::Visited(x) => {
            let n = m.scenes.len();
            format!("visited({})", if (*x as usize) < n { &m.scenes[*x as usize].id } else { &m.extra_visit[*x as usize - n] })
        }
        Expr::Seen(x) => format!("seen({})", m.seen_ids[*x as usize]),
        Expr::Not(x) => format!("not {}", show_atom(x, m)),
        Expr::Bin(op, l, r) => {
            let o = match op {
                BinOp::And => "and", BinOp::Or => "or", BinOp::Eq => "==", BinOp::Ne => "!=", BinOp::Lt => "<",
                BinOp::Le => "<=", BinOp::Gt => ">", BinOp::Ge => ">=", BinOp::Add => "+", BinOp::Sub => "-",
            };
            format!("{} {o} {}", show_atom(l, m), show_atom(r, m))
        }
    }
}

fn show_atom(e: &Expr, m: &Model) -> String {
    match e {
        Expr::Bin(..) => format!("({})", show(e, m)),
        _ => show(e, m),
    }
}
