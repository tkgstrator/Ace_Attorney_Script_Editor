// 軽いチェックの、値の集まりでの条件式の評価。フラグは「どこかで取りうる値」の集まり（場所・順番によらない）、
// 証拠品は地点ごとの「持っているかもしれない・必ず持っている」、visited・seen は「どこかで真になりうるか」で表し、
// 条件式が真になりうるか・偽になりうるかを求める。変数どうしの関係は見ない（近似）。
use crate::expr::JsVal;
use crate::model::*;
use crate::state::Bits;

/// フラグの取りうる値（any_num: add で増減するので、数はどの値にもなりうる）
#[derive(Clone, Debug, Default)]
pub struct Vals {
    pub list: Vec<FVal>,
    pub any_num: bool,
}

impl Vals {
    /// 値を足す。新しい値なら true
    pub fn add(&mut self, v: FVal) -> bool {
        if self.list.contains(&v) { return false; }
        self.list.push(v);
        true
    }
}

/// 条件式を評価するときの手がかり
pub struct Facts<'a> {
    pub flags: &'a [Vals],
    /// 着きうるシーン（visited が真になりうる）・付きうる調べた印
    pub visited: &'a Bits,
    pub seen: &'a Bits,
    /// その地点で持っているかもしれない・必ず持っている証拠品
    pub may: &'a [u64],
    pub must: &'a [u64],
}

/// 値の集まり（top: 何にでもなりうる）
#[derive(Clone, Debug)]
pub struct Abs<'m> {
    pub vals: Vec<JsVal<'m>>,
    pub top: bool,
}

const CAP: usize = 256;

fn bools(t: bool, f: bool) -> Abs<'static> {
    let mut vals = vec![];
    if t { vals.push(JsVal::Bool(true)); }
    if f { vals.push(JsVal::Bool(false)); }
    Abs { vals, top: false }
}

fn bit(v: &[u64], i: u32) -> bool {
    v.get(i as usize >> 6).is_some_and(|w| w >> (i & 63) & 1 == 1)
}

impl Abs<'_> {
    /// 真になりうるか・偽になりうるか
    pub fn truth(&self) -> (bool, bool) {
        if self.top { return (true, true); }
        (self.vals.iter().any(JsVal::truthy), self.vals.iter().any(|v| !v.truthy()))
    }
}

pub fn eval<'m>(e: &Expr, f: &Facts, m: &'m Model) -> Abs<'m> {
    match e {
        Expr::Lit(v) => Abs { vals: vec![JsVal::from_flag(*v, m)], top: false },
        Expr::Var(x) => {
            let v = &f.flags[*x as usize];
            if v.any_num { return Abs { vals: vec![], top: true }; }
            Abs { vals: v.list.iter().map(|v| JsVal::from_flag(*v, m)).collect(), top: false }
        }
        Expr::Life => Abs { vals: vec![], top: true },
        Expr::Has(x) => bools(bit(f.may, *x), !bit(f.must, *x)),
        Expr::Visited(x) => bools(f.visited.has(*x), true),
        Expr::Seen(x) => bools(f.seen.has(*x), true),
        Expr::Table(t) => eval(&t.orig, f, m),
        Expr::Not(x) => { let (t, fa) = eval(x, f, m).truth(); bools(fa, t) }
        Expr::Bin(BinOp::And, l, r) => {
            let ((lt, lf), (rt, rf)) = (eval(l, f, m).truth(), eval(r, f, m).truth());
            bools(lt && rt, lf || rf)
        }
        Expr::Bin(BinOp::Or, l, r) => {
            let ((lt, lf), (rt, rf)) = (eval(l, f, m).truth(), eval(r, f, m).truth());
            bools(lt || rt, lf && rf)
        }
        Expr::Bin(op, l, r) => {
            let (a, b) = (eval(l, f, m), eval(r, f, m));
            let cmp = !matches!(op, BinOp::Add | BinOp::Sub);
            if a.top || b.top || a.vals.len() * b.vals.len() > CAP {
                return if cmp { bools(true, true) } else { Abs { vals: vec![], top: true } };
            }
            // 取りうる値の組ごとに、エンジンと同じ規則で計算する
            let mut out: Vec<JsVal> = vec![];
            for x in &a.vals {
                for y in &b.vals {
                    let v = crate::expr::binop(*op, x.clone(), y.clone());
                    if !out.iter().any(|o| o.strict_eq(&v)) { out.push(v); }
                }
            }
            Abs { vals: out, top: false }
        }
    }
}
