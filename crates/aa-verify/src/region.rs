// 流れの解析の補助（verify-region.ts と同じ）: 条件式・if のかたまりが、どの変数の値で結果が変わるかを求める。
//
// 1. 式が本当に読む変数: 真偽の変数だけの式なら、真理値表で調べる
// 2. if のかたまりのまとめ: 止まって選ぶ場面・シーンの移動などのない命令だけが続いて、どの道も同じ出口に着く
//    かたまりを、入りから出口への 1 本の辺とみなし、出口での値に効く変数だけを「読む」とする
use crate::expr::{test, Env};
use crate::model::*;
use std::collections::HashSet;

const MAX_VARS: usize = 12;
const MAX_WORK: usize = 2_000_000;

/// 式が参照する名前
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Name {
    Flag(u32),
    Visit(u32),
    Seen(u32),
    Has(u32),
    Life,
}

/// 真偽の値しか取らないフラグ（初めの値が真偽で、set でも真偽しか入れず、add しない）
pub fn boolean_flags(m: &Model) -> Vec<bool> {
    let mut out: Vec<bool> = (0..m.flag_names.len()).map(|i| i < m.declared_flags && matches!(m.flag_init[i], FVal::Bool(_))).collect();
    for sc in &m.scenes {
        for ins in &sc.program {
            match ins {
                Op::Set(f, v) if !matches!(v, FVal::Bool(_)) => out[*f as usize] = false,
                Op::Add(f, _) => out[*f as usize] = false,
                _ => {}
            }
        }
    }
    out
}

/// 式が参照する名前を、出てきた順に集める
pub fn refs(e: &Expr, out: &mut Vec<Name>) {
    let add = |n: Name, out: &mut Vec<Name>| if !out.contains(&n) { out.push(n) };
    match e {
        Expr::Var(f) => add(Name::Flag(*f), out),
        Expr::Life => add(Name::Life, out),
        Expr::Has(x) => add(Name::Has(*x), out),
        Expr::Visited(x) => add(Name::Visit(*x), out),
        Expr::Seen(x) => add(Name::Seen(*x), out),
        Expr::Not(x) => refs(x, out),
        Expr::Table(t) => refs(&t.orig, out),
        Expr::Bin(_, l, r) => { refs(l, out); refs(r, out); }
        Expr::Lit(_) => {}
    }
}

fn is_bool(bool_flags: &[bool], n: Name) -> bool {
    match n {
        Name::Visit(_) | Name::Seen(_) | Name::Has(_) => true,
        Name::Flag(f) => bool_flags[f as usize],
        Name::Life => false,
    }
}

/// 名前 → 値の小さな表で式を評価する（値のない名前は false。入りのままの印は None）
struct MapEnv<'a>(&'a [(Name, Option<FVal>)]);

impl MapEnv<'_> {
    fn get(&self, n: Name) -> Option<FVal> {
        self.0.iter().find(|(k, _)| *k == n).and_then(|(_, v)| *v)
    }
    fn is_true(&self, n: Name) -> bool {
        self.get(n) == Some(FVal::Bool(true))
    }
}

impl Env for MapEnv<'_> {
    fn var(&self, f: u32) -> Result<FVal, String> {
        Ok(self.get(Name::Flag(f)).unwrap_or(FVal::Bool(false)))
    }
    fn life(&self) -> f64 { 0.0 }
    fn has(&self, ev: u32) -> bool { self.is_true(Name::Has(ev)) }
    fn visited(&self, id: u32) -> bool { self.is_true(Name::Visit(id)) }
    fn seen(&self, id: u32) -> bool { self.is_true(Name::Seen(id)) }
}

fn evaluate(e: &Expr, val: &[(Name, Option<FVal>)], m: &Model) -> bool {
    test(Some(e), &MapEnv(val), m).unwrap_or(false)
}

/// 式が本当に読む変数（証拠品とライフは除く。verify-region.ts の exprDeps）
pub fn expr_deps(e: Option<&Expr>, bool_flags: &[bool], m: &Model) -> Vec<Name> {
    deps(e, bool_flags, m, false)
}

/// 式が本当に読む変数と証拠品（ライフは除く）
pub fn expr_deps_with_evidence(e: Option<&Expr>, bool_flags: &[bool], m: &Model) -> Vec<Name> {
    deps(e, bool_flags, m, true)
}

fn deps(e: Option<&Expr>, bool_flags: &[bool], m: &Model, evidence: bool) -> Vec<Name> {
    let Some(e) = e else { return vec![] };
    let mut names = vec![];
    refs(e, &mut names);
    let vars: Vec<Name> = names.iter().copied().filter(|n| *n != Name::Life && (evidence || !matches!(n, Name::Has(_)))).collect();
    if vars.is_empty() { return vars; }
    if names.len() > MAX_VARS || !names.iter().all(|n| is_bool(bool_flags, *n)) { return vars; }
    let mut val: Vec<(Name, Option<FVal>)> = names.iter().map(|n| (*n, Some(FVal::Bool(false)))).collect();
    vars.into_iter().filter(|&v| {
        let vi = names.iter().position(|n| *n == v).unwrap();
        let others: Vec<usize> = (0..names.len()).filter(|&i| i != vi).collect();
        for mask in 0..1usize << others.len() {
            for (bit, &i) in others.iter().enumerate() { val[i].1 = Some(FVal::Bool(mask >> bit & 1 == 1)); }
            val[vi].1 = Some(FVal::Bool(true));
            let a = evaluate(e, &val, m);
            val[vi].1 = Some(FVal::Bool(false));
            if a != evaluate(e, &val, m) { return true; }
        }
        false
    }).collect()
}

/// かたまりの中に置ける、止まって選ぶことも移動することもない命令（verify-region.ts の QUIET と同じ。
/// 人物ファイルの出し入れと法廷記録の鍵もフラグに効かないので置ける。証拠品の出し入れは置けない）
pub fn quiet(op: &Op, m: &Model) -> bool {
    match op {
        Op::Stop(_) | Op::Nop(_) | Op::Penalty(_) | Op::Set(..) | Op::Jump(_) | Op::JumpUnless(..) | Op::Lock(_) => true,
        Op::Give(x) | Op::Take(x) => m.is_profile(*x),
        _ => false,
    }
}

pub struct Summary {
    pub exit: u32,
    /// 出口での値に効く（読む）変数
    pub gen: Vec<Name>,
    /// 出口での値が、入りでの自分の値によらない変数（書き込むとみなす）
    pub def: Vec<Name>,
    /// 出口での値に効く証拠品（has の条件）
    pub has: Vec<u32>,
    /// かたまりの中の人物ファイルの出し入れ（通るかもしれない。証拠品の流れの解析で使う）
    pub maybe: Vec<(u32, bool)>,
}

/// pc の if（jumpUnless）から始まるかたまりをまとめる。まとめられなければ None
pub fn summarize(program: &[Op], pc: u32, bool_flags: &[bool], m: &Model) -> Option<Summary> {
    let (mut inside, mut exits) = (HashSet::new(), HashSet::new());
    let (mut read, mut written): (Vec<Name>, Vec<Name>) = (vec![], vec![]);
    let mut maybe = vec![];
    let mut todo = vec![pc];
    while let Some(at) = todo.pop() {
        if inside.contains(&at) || exits.contains(&at) { continue; }
        let ins = match program.get(at as usize) {
            Some(i) if quiet(i, m) => i,
            _ => { exits.insert(at); continue; }
        };
        inside.insert(at);
        if inside.len() > 5000 { return None; }
        match ins {
            Op::Jump(to) | Op::JumpUnless(_, to) => {
                if *to <= at { return None; }
                todo.push(*to);
                if let Op::JumpUnless(c, _) = ins { refs(c, &mut read); todo.push(at + 1); }
                continue;
            }
            Op::Set(f, _) => if !written.contains(&Name::Flag(*f)) { written.push(Name::Flag(*f)) },
            Op::Give(x) => maybe.push((*x, true)),
            Op::Take(x) => maybe.push((*x, false)),
            _ => {}
        }
        todo.push(at + 1);
    }
    if exits.len() != 1 { return None; }
    let exit = *exits.iter().next().unwrap();
    if exit as usize >= program.len() { return None; }
    let inputs = read;
    if inputs.len() > MAX_VARS || inputs.contains(&Name::Life) || !inputs.iter().all(|n| is_bool(bool_flags, *n)) { return None; }
    if (1usize << inputs.len()) * inside.len() > MAX_WORK { return None; }

    // 読む変数の値の組ごとに、かたまりを実行して出口での値を求める（None は「入りのまま」）
    let mut tracked: Vec<Name> = vec![];
    for n in inputs.iter().chain(written.iter()) {
        if !matches!(n, Name::Has(_)) && !tracked.contains(n) { tracked.push(*n); }
    }
    let run = |mask: usize| -> Vec<Option<FVal>> {
        let mut val: Vec<(Name, Option<FVal>)> = inputs.iter().enumerate().map(|(i, n)| (*n, Some(FVal::Bool(mask >> i & 1 == 1)))).collect();
        for n in &written { if !val.iter().any(|(k, _)| k == n) { val.push((*n, None)); } }
        let mut at = pc;
        while at != exit {
            match &program[at as usize] {
                Op::Jump(to) => at = *to,
                Op::JumpUnless(c, to) => at = if evaluate(c, &val, m) { at + 1 } else { *to },
                ins => {
                    if let Op::Set(f, v) = ins {
                        let slot = val.iter_mut().find(|(k, _)| *k == Name::Flag(*f)).unwrap();
                        slot.1 = Some(*v);
                    }
                    at += 1;
                }
            }
        }
        tracked.iter().map(|n| val.iter().find(|(k, _)| k == n).and_then(|(_, v)| *v)).collect()
    };
    let results: Vec<Vec<Option<FVal>>> = (0..1usize << inputs.len()).map(run).collect();

    let (mut gen, mut def) = (vec![], vec![]);
    for (t, name) in tracked.iter().enumerate() {
        let i = inputs.iter().position(|n| n == name);
        let (mut own, mut effect) = (false, false);
        match i {
            None => own = results.iter().any(|r| r[t].is_none()),
            Some(i) => {
                for mask in 0..results.len() {
                    if mask >> i & 1 == 1 { continue; }
                    let (a, b) = (&results[mask], &results[mask | 1 << i]);
                    if a[t] != b[t] { own = true; }
                    if a.iter().zip(b.iter()).enumerate().any(|(k, (x, y))| k != t && x != y) { effect = true; }
                }
            }
        }
        if effect { gen.push(*name); }
        if !own { def.push(*name); }
    }
    // 証拠品（has）は、出口でのどれかの変数の値に効くときだけ読む
    let has = inputs.iter().enumerate().filter_map(|(i, n)| {
        let Name::Has(x) = n else { return None };
        (0..results.len()).any(|mask| mask >> i & 1 == 0 && results[mask] != results[mask | 1 << i]).then_some(*x)
    }).collect();
    Some(Summary { exit, gen, def, has, maybe })
}
