// 条件式を速く評価するための下ごしらえ。真偽しか取らない変数（真偽のフラグ・has・visited・seen）だけの式を、
// 真理値表（Expr::Table）に置き換える。変換済みのシナリオの条件は、同じ変数を何度も読む長い式が多いため。
// 真偽のフラグは初めから値があり、真偽しか入らないので、評価の結果もエラーの出方も元の式と同じ。
use crate::expr::test;
use crate::model::*;
use crate::region::{boolean_flags, refs, Name};

const MAX_VARS: usize = 12;

/// 評価用の口: 真理値表を作るときに、変数の値を番号のビットから読む
struct Bits<'a>(&'a [TableVar], usize);

impl crate::expr::Env for Bits<'_> {
    fn var(&self, f: u32) -> Result<FVal, String> {
        Ok(FVal::Bool(self.get(TableVar::Flag(f))))
    }
    fn life(&self) -> f64 {
        0.0
    }
    fn has(&self, x: u32) -> bool {
        self.get(TableVar::Has(x))
    }
    fn visited(&self, x: u32) -> bool {
        self.get(TableVar::Visited(x))
    }
    fn seen(&self, x: u32) -> bool {
        self.get(TableVar::Seen(x))
    }
}

impl Bits<'_> {
    fn get(&self, v: TableVar) -> bool {
        self.0
            .iter()
            .position(|x| *x == v)
            .is_some_and(|i| self.1 >> i & 1 == 1)
    }
}

fn compile(e: &mut Expr, bool_flags: &[bool], m: &Model) {
    // 変数 1 つだけの式などは、そのままでも速い
    if matches!(
        e,
        Expr::Var(_)
            | Expr::Has(_)
            | Expr::Visited(_)
            | Expr::Seen(_)
            | Expr::Lit(_)
            | Expr::Table(_)
    ) {
        return;
    }
    let mut names = vec![];
    refs(e, &mut names);
    if names.is_empty() || names.len() > MAX_VARS {
        return;
    }
    let mut vars = vec![];
    for n in names {
        vars.push(match n {
            Name::Flag(f) if bool_flags[f as usize] => TableVar::Flag(f),
            Name::Has(x) => TableVar::Has(x),
            Name::Visit(x) => TableVar::Visited(x),
            Name::Seen(x) => TableVar::Seen(x),
            _ => return,
        });
    }
    let n = 1usize << vars.len();
    let mut bits = vec![0u64; n.div_ceil(64)];
    for i in 0..n {
        if test(Some(e), &Bits(&vars, i), m).unwrap_or(false) {
            bits[i >> 6] |= 1 << (i & 63);
        }
    }
    let orig = std::mem::replace(e, Expr::Lit(FVal::Undef));
    *e = Expr::Table(Box::new(Table { orig, vars, bits }));
}

/// 命令を速く進めるための表を作る（Scene の nop_end・stop_run）
fn skip_tables(sc: &mut Scene) {
    let n = sc.program.len();
    sc.nop_end = vec![0; n];
    sc.stop_run = vec![(0, 0); n];
    let mut next = n as u32;
    let (mut last, mut count) = (u32::MAX, 0u32);
    for pc in (0..n).rev() {
        match sc.program[pc] {
            Op::Nop(_) => {
                sc.nop_end[pc] = next;
            }
            Op::Stop(_) => {
                next = pc as u32;
                sc.nop_end[pc] = next;
                if last == u32::MAX {
                    last = pc as u32;
                    count = 0;
                }
                count += 1;
                sc.stop_run[pc] = (last, count);
                continue;
            }
            _ => {
                next = pc as u32;
                sc.nop_end[pc] = next;
            }
        }
        // Nop は Stop の続きを切らない。ほかの命令は切る
        if !matches!(sc.program[pc], Op::Nop(_)) {
            last = u32::MAX;
        }
    }
}

/// 台詞・日時の表示ごとに、詳しく調べるのを次の台詞・日時の表示に回せるか（Scene の defer）
fn defer_table(sc: &mut Scene) {
    let record = |op: &Op| matches!(op, Op::Stop(StopKind::Line | StopKind::Card));
    sc.defer = vec![false; sc.program.len()];
    let mut next = false;
    for pc in (0..sc.program.len()).rev() {
        let op = &sc.program[pc];
        if record(op) {
            sc.defer[pc] = next;
            next = true;
        } else if !matches!(op, Op::Nop(_) | Op::Stop(_)) {
            next = false;
        }
    }
}

/// シナリオのすべての条件式を下ごしらえする
pub fn prepare(m: &mut Model) {
    m.scenes.iter_mut().for_each(skip_tables);
    m.scenes.iter_mut().for_each(defer_table);
    let bool_flags = boolean_flags(m);
    let snapshot = m.clone();
    let c = |e: &mut Option<Expr>| {
        if let Some(e) = e {
            compile(e, &bool_flags, &snapshot)
        }
    };
    for sc in &mut m.scenes {
        for ins in &mut sc.program {
            match ins {
                Op::JumpUnless(e, _) => compile(e, &bool_flags, &snapshot),
                Op::Choice(opts) | Op::Pick(opts) => opts.iter_mut().for_each(|o| c(&mut o.when)),
                _ => {}
            }
        }
        match &mut sc.kind {
            Kind::Testimony(t) => t.statements.iter_mut().for_each(|s| c(&mut s.when)),
            Kind::Place(p) => {
                p.person.iter_mut().for_each(|w| c(w));
                p.moves.iter_mut().for_each(|(_, w)| c(w));
                p.talk.iter_mut().for_each(|t| c(&mut t.when));
                p.examine.iter_mut().for_each(|x| c(&mut x.when));
            }
            Kind::Dialogue => {}
        }
    }
}
