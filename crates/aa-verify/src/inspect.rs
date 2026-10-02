// 整合性チェックで、証拠品を「詳しく調べる」操作をまとめる（verify-inspect.ts と verify-actions.ts の linear と同じ）。
// 法廷記録を開ける場面ならいつでも調べられる。文章送りだけの場面は、状態を変えうる証拠品を持っていて法廷記録を開けるときだけ
// 止まって調べるのを試す（表示が続くかたまりの途中の台詞では止まらない。調べても状態が変わらないときも止まらない）。
use crate::actions::Act;
use crate::engine::Engine;
use crate::expr::{test, Env};
use crate::model::*;
use crate::state::{Bits, Mode, Phase, State};

/// 詳しく調べるシーンの、選択肢の項目ごとの「試さなくてよいか」（Model の inspect_skip。シーンの番号ごと）
pub fn inspect_skip(m: &Model) -> Vec<Vec<bool>> {
    m.scenes
        .iter()
        .map(|s| match s.program.first() {
            Some(Op::Choice(opts)) => opts.iter().map(|o| pure_block(&s.program, o.to)).collect(),
            _ => vec![],
        })
        .collect()
}

/// 詳しく調べられる証拠品すべてと、詳しく調べると状態を変えうる証拠品（verify-inspect.ts の inspectInfo。証拠品の並び）
pub fn inspect_info(m: &Model) -> (Vec<u32>, Vec<u32>) {
    let all: Vec<u32> = (0..m.evidence.len() as u32)
        .filter(|&x| {
            m.evidence[x as usize]
                .inspect
                .is_some_and(|s| (s as usize) < m.scenes.len())
        })
        .collect();
    let effective = all
        .iter()
        .copied()
        .filter(|&x| {
            let program = &m.scenes[m.evidence[x as usize].inspect.unwrap() as usize].program;
            match program.first() {
                Some(Op::Choice(opts)) => opts.iter().any(|o| !pure_block(program, o.to)),
                _ => true,
            }
        })
        .collect();
    (all, effective)
}

/// pc から、止まって選ぶ場面も状態を変える命令も通らずに、どの道でも inspectEnd に着くか
/// （人物ファイルの出し入れ（Give・Take）と、法廷記録の鍵（Lock）は状態を変える）
fn pure_block(program: &[Op], pc: u32) -> bool {
    let mut done = std::collections::HashSet::new();
    let mut todo = vec![pc];
    while let Some(at) = todo.pop() {
        if !done.insert(at) {
            continue;
        }
        let Some(ins) = program.get(at as usize) else {
            return false;
        };
        match ins {
            Op::InspectEnd => {}
            Op::Jump(to) => todo.push(*to),
            Op::JumpUnless(_, to) => {
                todo.push(at + 1);
                todo.push(*to);
            }
            Op::Stop(_) | Op::Nop(_) | Op::Penalty(_) => todo.push(at + 1),
            _ => return false,
        }
    }
    true
}

/// 詳しく調べる選択肢の条件（値のないフラグはエラーにせず undefined として読む）
pub(crate) struct LooseEnv<'a>(pub &'a State);

impl Env for LooseEnv<'_> {
    fn var(&self, f: u32) -> Result<FVal, String> {
        Ok(self.0.flags[f as usize])
    }
    fn life(&self) -> f64 {
        self.0.life
    }
    fn has(&self, ev: u32) -> bool {
        self.0.holds(ev)
    }
    fn visited(&self, id: u32) -> bool {
        self.0.visited.has(id)
    }
    fn seen(&self, id: u32) -> bool {
        self.0.seen.has(id)
    }
}

/// 証拠品 evs を詳しく調べる操作（状態を変えうる場所だけ。verify-inspect.ts の inspectActions）。
/// passed には、調べられる（入れる）詳しく調べるシーンを記録する
pub(crate) fn inspect_acts(
    m: &Model,
    s: &State,
    evs: Vec<u32>,
    mut passed: Option<&mut Bits>,
) -> Vec<Act> {
    let mut out = vec![];
    for ev in evs {
        let Some(scene) = m.evidence[ev as usize]
            .inspect
            .filter(|&x| (x as usize) < m.scenes.len())
        else {
            continue;
        };
        if let Some(p) = passed.as_deref_mut() {
            p.add(scene);
        }
        let program = &m.scenes[scene as usize].program;
        let Some(Op::Choice(opts)) = program.first() else {
            out.push(Act::Inspect(ev, None));
            continue;
        };
        let skip = &m.inspect_skip[scene as usize];
        let mut shown = 0;
        for (i, o) in opts.iter().enumerate() {
            if !test(o.when.as_ref(), &LooseEnv(s), m).unwrap_or(false) {
                continue;
            }
            let n = shown;
            shown += 1;
            if !skip[i] {
                out.push(Act::Inspect(ev, Some(n)));
            }
        }
    }
    out
}

/// 操作が 1 つしかない（文章送りだけの）場面か（verify-actions.ts の linear）。詳しく調べられる台詞でも、
/// 状態を変えうる調べ方をどれも試して、状態が変わらなければ止まらない
pub fn linear(e: &Engine) -> bool {
    linear_static(e.m, &e.s) || (inspect_stop(e.m, &e.s) && crate::defer::skippable(e))
}

/// 詳しく調べて状態が変わるかを試さずに見る linear（状態を変えうる証拠品を持っていて法廷記録を開けるなら止まる）
pub fn linear_static(m: &Model, s: &State) -> bool {
    match s.mode {
        Mode::Investigate => false,
        Mode::Testimony => s.phase != Phase::Cross && !inspect_stop(m, s),
        Mode::Run => {
            matches!(
                m.scenes
                    .get(s.scene as usize)
                    .and_then(|sc| sc.program.get(s.pc as usize)),
                Some(Op::Stop(_))
            ) && !inspect_stop(m, s)
        }
    }
}

/// 文章送りだけの場面で、法廷記録を開けるか（台詞・日時の表示・証言を聞く途中で、法廷記録を使えなくしていない）
fn record_open(m: &Model, s: &State) -> bool {
    if s.inspect_from.is_some() || s.record_locked {
        return false;
    }
    match s.mode {
        Mode::Testimony => s.phase == Phase::Reading,
        Mode::Run => matches!(
            m.scenes
                .get(s.scene as usize)
                .and_then(|sc| sc.program.get(s.pc as usize)),
            Some(Op::Stop(StopKind::Line | StopKind::Card))
        ),
        Mode::Investigate => false,
    }
}

/// 台詞などが続く所で、詳しく調べるために止まりうるか（場面の種類によらず、証拠品と法廷記録の鍵だけで見る）
pub(crate) fn may_stop_inspect(m: &Model, s: &State) -> bool {
    s.inspect_from.is_none() && !s.record_locked && holds_effective(m, s)
}

/// 状態を変えうる証拠品を持っているか（持っている証拠品の数だけ見る）
fn holds_effective(m: &Model, s: &State) -> bool {
    !m.inspect_effective.is_empty() && s.evidence.iter().any(|&x| m.evidence[x as usize].effective)
}

/// 詳しく調べるために止まるか（verify-inspect.ts の inspectStop）。表示が続くかたまりの途中の台詞では止まらない
fn inspect_stop(m: &Model, s: &State) -> bool {
    if m.inspect_effective.is_empty() || !record_open(m, s) {
        return false;
    }
    if s.mode == Mode::Run && m.scenes[s.scene as usize].defer[s.pc as usize] {
        return false;
    }
    holds_effective(m, s)
}

/// 文章送りだけの場面で、詳しく調べられるシーンを記録する（verify-inspect.ts の markInspect）。
/// 台詞などが続くだけの所を飛ばすときは、飛ばす間（run_end まで）の台詞・日時の表示でも法廷記録を開けるとみなす
/// （飛ばす間は、持っている証拠品も法廷記録の鍵も変わらない）
pub(crate) fn mark_inspect(m: &Model, s: &State, passed: &mut Bits, run_end: u32) {
    // 持っている証拠品のうち、まだ記録していない詳しく調べるシーンのもの
    let scene_of = |x: u32| {
        m.evidence[x as usize]
            .inspect
            .filter(|&sc| (sc as usize) < m.scenes.len())
    };
    let todo = |p: &Bits| {
        s.evidence
            .iter()
            .any(|&x| scene_of(x).is_some_and(|sc| !p.has(sc)))
    };
    if !todo(passed) {
        return;
    }
    let open = record_open(m, s)
        || (s.mode == Mode::Run
            && !s.record_locked
            && s.inspect_from.is_none()
            && (s.pc + 1..=run_end).any(|pc| {
                matches!(
                    m.scenes[s.scene as usize].program[pc as usize],
                    Op::Stop(StopKind::Line | StopKind::Card)
                )
            }));
    if !open {
        return;
    }
    for &x in &s.evidence {
        if let Some(sc) = scene_of(x) {
            passed.add(sc);
        }
    }
}
