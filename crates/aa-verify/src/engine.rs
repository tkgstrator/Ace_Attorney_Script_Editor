// シナリオの実行器（packages/core の Engine のうち、分岐と状態に関わる部分だけ）。
// 表示・音は扱わない（人物ファイルは証拠品と同じく持つ）。命令の意味・エラーの文は core に合わせる。
use crate::expr::{test, Env};
use crate::model::*;
use crate::state::{Mode, Phase, State};

const STEP_LIMIT: usize = 100_000;

pub type Res<T = ()> = Result<T, String>;

/// 今の表示単位（Beat）の種類
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BeatKind {
    Line, Shout, Banner, Card, Fade, Wait, Choice, Demand, Statement { cross: bool }, Investigate, End, Gameover,
}

impl BeatKind {
    pub fn name(self) -> &'static str {
        match self {
            BeatKind::Line => "line", BeatKind::Shout => "shout", BeatKind::Banner => "banner", BeatKind::Card => "card",
            BeatKind::Fade => "fade", BeatKind::Wait => "wait", BeatKind::Choice => "choice", BeatKind::Demand => "demand",
            BeatKind::Statement { .. } => "statement", BeatKind::Investigate => "investigate", BeatKind::End => "end",
            BeatKind::Gameover => "gameover",
        }
    }
}

/// 条件式から状態を読む（エンジン用: 値のないフラグはエラー）
pub struct StateEnv<'a> {
    pub s: &'a State,
    pub m: &'a Model,
}

impl Env for StateEnv<'_> {
    fn var(&self, f: u32) -> Res<FVal> {
        match self.s.flags[f as usize] {
            FVal::Undef => Err(format!("未定義のフラグです: {}", self.m.flag_names[f as usize])),
            v => Ok(v),
        }
    }
    fn life(&self) -> f64 { self.s.life }
    fn has(&self, ev: u32) -> bool { self.s.holds(ev) }
    fn visited(&self, id: u32) -> bool { self.s.visited.has(id) }
    fn seen(&self, id: u32) -> bool { self.s.seen.has(id) }
}

#[derive(Clone)]
pub struct Engine<'m> {
    pub m: &'m Model,
    pub s: State,
}

impl<'m> Engine<'m> {
    pub fn new(m: &'m Model) -> Res<Engine<'m>> {
        let mut e = Engine { m, s: State::initial(m) };
        e.enter(m.start_scene)?;
        e.settle()?;
        Ok(e)
    }

    pub fn load(m: &'m Model, s: State) -> Engine<'m> {
        Engine { m, s }
    }

    pub fn test(&self, e: Option<&Expr>) -> Res<bool> {
        test(e, &StateEnv { s: &self.s, m: self.m }, self.m)
    }

    pub fn scene(&self) -> Res<&'m Scene> {
        self.m.scenes.get(self.s.scene as usize).ok_or_else(|| format!("存在しないシーンです: {}", self.m.scene_name(self.s.scene)))
    }

    pub fn place(&self) -> Res<&'m Place> {
        let sc = self.scene()?;
        sc.place().ok_or_else(|| format!("探索編の場所ではありません: {}", sc.id))
    }

    pub fn testimony(&self) -> Res<&'m Testimony> {
        let sc = self.scene()?;
        sc.testimony().ok_or_else(|| format!("証言のシーンではありません: {}", sc.id))
    }

    pub fn instr(&self) -> Res<&'m Op> {
        let sc = self.scene()?;
        sc.program.get(self.s.pc as usize).ok_or_else(|| format!("{} の命令 {} がありません", sc.id, self.s.pc))
    }

    pub fn beat(&self) -> Res<BeatKind> {
        Ok(match self.s.mode {
            Mode::Investigate => BeatKind::Investigate,
            Mode::Testimony => match self.s.phase {
                Phase::Intro | Phase::CrossIntro => BeatKind::Banner,
                p => BeatKind::Statement { cross: p == Phase::Cross },
            },
            Mode::Run => match self.instr()? {
                Op::Stop(k) => match k {
                    StopKind::Line => BeatKind::Line, StopKind::Shout => BeatKind::Shout, StopKind::Banner => BeatKind::Banner,
                    StopKind::Card => BeatKind::Card, StopKind::Wait => BeatKind::Wait, StopKind::Fade => BeatKind::Fade,
                },
                Op::Choice(_) => BeatKind::Choice,
                Op::Demand { .. } => BeatKind::Demand,
                Op::End => BeatKind::End,
                Op::Gameover => BeatKind::Gameover,
                op => return Err(format!("停止しない命令で止まっています: {}", op.name())),
            },
        })
    }

    // ---- 証言 ----

    pub fn visible_statements(&self, t: &Testimony) -> Res<Vec<u32>> {
        let mut out = vec![];
        for (i, st) in t.statements.iter().enumerate() {
            if self.test(st.when.as_ref())? { out.push(i as u32); }
        }
        Ok(out)
    }

    fn first_visible(&self, t: &Testimony) -> Res<u32> {
        self.visible_statements(t)?.first().copied().ok_or_else(|| format!("{} に表示できる証言がありません", self.m.scenes[self.s.scene as usize].id))
    }

    fn next_visible(&self, t: &Testimony, from: u32) -> Res<Option<u32>> {
        Ok(self.visible_statements(t)?.into_iter().find(|&i| i > from))
    }

    fn to_statement(&mut self, phase: Phase, index: u32) -> Res {
        self.s.mode = Mode::Testimony;
        self.s.phase = phase;
        self.s.statement = index;
        let t = self.testimony()?;
        if phase == Phase::Cross {
            if let Some(before) = t.statements.get(index as usize).and_then(|st| st.before) {
                self.apply_before(before)?;
            }
        }
        Ok(())
    }

    /// 証言の前のブロック（止まらない命令だけ）を、resume までまとめて実行する
    fn apply_before(&mut self, pc: u32) -> Res {
        let program = &self.scene()?.program;
        for ins in &program[pc as usize..] {
            if matches!(ins, Op::Resume(_)) { return Ok(()); }
            if !self.exec_simple(ins) {
                return Err(format!("証言の前のブロックに止まる命令があります: {}", ins.name()));
            }
        }
        Ok(())
    }

    fn resume(&mut self, to: ResumeTo) -> Res {
        self.s.var_ev = None;
        let t = self.testimony()?;
        let statement = match to {
            ResumeTo::CrossIntro => None,
            ResumeTo::AfterReading => match t.after {
                Some(pc) => { self.run(pc); return Ok(()); }
                None => None,
            },
            ResumeTo::First => Some(self.first_visible(t)?),
            ResumeTo::Stay => {
                let when = t.statements.get(self.s.statement as usize).and_then(|st| st.when.as_ref());
                Some(if self.test(when)? { self.s.statement } else { self.first_visible(t)? })
            }
            ResumeTo::Next => match self.next_visible(t, self.s.statement)? {
                Some(i) => Some(i),
                None => match t.looping {
                    Some(pc) => { self.run(pc); return Ok(()); }
                    None => Some(self.first_visible(t)?),
                },
            },
        };
        match statement {
            None => { self.s.mode = Mode::Testimony; self.s.phase = Phase::CrossIntro; Ok(()) }
            Some(i) => self.to_statement(Phase::Cross, i),
        }
    }

    // ---- シーン・場所 ----

    pub fn run(&mut self, pc: u32) {
        self.s.mode = Mode::Run;
        self.s.pc = pc;
    }

    pub fn enter(&mut self, scene: u32) -> Res {
        let sc = self.m.scenes.get(scene as usize).ok_or_else(|| format!("存在しないシーンです: {}", self.m.scene_name(scene)))?;
        let s = &mut self.s;
        s.scene = scene;
        s.pc = 0;
        s.var_ev = None;
        s.inspect_from = None;
        match sc.kind {
            Kind::Testimony(_) => { s.visited.add(scene); s.mode = Mode::Testimony; s.phase = Phase::Intro; s.statement = 0; }
            Kind::Place(_) => s.mode = Mode::Run,
            Kind::Dialogue => { s.visited.add(scene); s.mode = Mode::Run; }
        }
        Ok(())
    }

    pub fn go_place(&mut self, id: u32) -> Res {
        self.enter(id)?;
        match self.place()?.enter {
            Some(pc) => { self.run(pc); Ok(()) }
            None => self.to_menu(),
        }
    }

    pub fn to_menu(&mut self) -> Res {
        self.place()?;
        self.s.mode = Mode::Investigate;
        self.s.var_ev = None;
        self.s.visited.add(self.s.scene);
        Ok(())
    }

    pub fn mark_seen(&mut self, id: u32) {
        self.s.seen.add(id);
    }

    // ---- 実行 ----

    /// 止まらずに状態を変えるだけの命令なら実行して true（core の execSimple）
    fn exec_simple(&mut self, ins: &Op) -> bool {
        let s = &mut self.s;
        match ins {
            Op::Nop(_) => {}
            Op::Set(f, v) => s.flags[*f as usize] = *v,
            Op::Add(f, a) => {
                let cur = match s.flags[*f as usize] {
                    FVal::Undef => 0.0,
                    v => crate::expr::JsVal::from_flag(v, self.m).number(),
                };
                s.flags[*f as usize] = FVal::Num(cur + a);
            }
            Op::Give(e) => if !s.evidence.contains(e) { s.evidence.push(*e) },
            Op::Take(e) => s.evidence.retain(|x| x != e),
            Op::Lock(l) => s.record_locked = *l,
            _ => return false,
        }
        true
    }

    /// 止まる命令（台詞・選択肢など）に着くまで命令を実行する
    pub fn settle(&mut self) -> Res {
        let mut n = 0;
        while n < STEP_LIMIT {
            n += 1;
            if self.s.mode != Mode::Run { return Ok(()); }
            let ins = self.instr()?;
            match ins {
                // 表示だけの命令は、続く分をまとめて飛ばす
                Op::Nop(_) => {
                    let to = self.m.scenes[self.s.scene as usize].nop_end[self.s.pc as usize];
                    n += (to - self.s.pc) as usize - 1;
                    self.s.pc = to;
                }
                Op::Stop(_) | Op::Choice(_) | Op::Demand { .. } | Op::End | Op::Gameover => return Ok(()),
                Op::Jump(to) => self.s.pc = *to,
                // 乱数の行き先がないときは次へ（行き先があるものは、読み込むときに選択肢にしている）
                Op::Random(_) => self.s.pc += 1,
                Op::JumpUnless(c, to) => self.s.pc = if self.test(Some(c))? { self.s.pc + 1 } else { *to },
                Op::Goto(sc) => self.enter(*sc)?,
                Op::Resume(to) => self.resume(*to)?,
                Op::Investigate(p) => self.go_place(*p)?,
                Op::Menu => self.to_menu()?,
                Op::InspectEnd => {
                    let f = self.s.inspect_from.ok_or("詳しく調べるブロックの外で inspectEnd に来ました")?;
                    self.s.scene = f.scene;
                    self.s.pc = f.pc;
                    self.s.mode = if f.mode == Mode::Testimony { Mode::Testimony } else { Mode::Run };
                    self.s.inspect_from = None;
                    self.s.var_ev = f.var_ev;
                    if f.mode == Mode::Testimony { self.s.phase = f.phase; self.s.statement = f.statement; }
                    if f.mode == Mode::Investigate { self.to_menu()?; }
                }
                Op::Penalty(a) => {
                    self.s.life = (self.s.life - a).max(0.0);
                    if self.s.life > 0.0 {
                        self.s.pc += 1;
                    } else if let Some(g) = self.m.gameover_scene {
                        self.enter(g)?;
                    } else {
                        return Err("ライフが尽きましたが、gameover シーンが定義されていません".into());
                    }
                }
                _ => {
                    if self.exec_simple(ins) { self.s.pc += 1; } else { return Err(format!("実行できない命令です: {}", ins.name())); }
                }
            }
        }
        if self.s.mode == Mode::Run {
            return Err(format!("{STEP_LIMIT} 命令を実行しても止まりません（無限ループの可能性）"));
        }
        Ok(())
    }

    // ---- プレイヤーの操作 ----

    pub fn advance(&mut self) -> Res {
        if self.s.mode == Mode::Testimony {
            let t = self.testimony()?;
            match self.s.phase {
                Phase::Intro => match t.reading {
                    Some(pc) => self.run(pc),
                    None => { let i = self.first_visible(t)?; self.to_statement(Phase::Reading, i)?; }
                },
                Phase::CrossIntro => { let i = self.first_visible(t)?; self.to_statement(Phase::Cross, i)?; }
                Phase::Reading => match self.next_visible(t, self.s.statement)? {
                    Some(i) => self.to_statement(Phase::Reading, i)?,
                    None => match t.after {
                        Some(pc) => self.run(pc),
                        None => self.s.phase = Phase::CrossIntro,
                    },
                },
                Phase::Cross => self.resume(ResumeTo::Next)?,
            }
        } else if self.s.mode == Mode::Run {
            match self.instr()? {
                op @ (Op::Choice(_) | Op::Demand { .. }) => return Err(format!("{} では advance できません", op.name())),
                Op::End | Op::Gameover => return Ok(()),
                _ => self.s.pc += 1,
            }
        }
        self.settle()
    }

    pub(crate) fn require_cross(&self, action: &str) -> Res {
        if self.s.mode != Mode::Testimony || self.s.phase != Phase::Cross {
            return Err(format!("尋問中でないと {action} できません"));
        }
        Ok(())
    }

    pub fn press(&mut self) -> Res {
        self.require_cross("press")?;
        let st = &self.testimony()?.statements[self.s.statement as usize];
        let pc = st.press.ok_or("この証言はゆさぶれません")?;
        self.run(pc);
        self.settle()
    }

    /// 法廷記録の項目（証拠品か人物ファイル）をつきつける
    pub fn present(&mut self, ev: u32) -> Res {
        let item = &self.m.evidence[ev as usize];
        let profile = item.profile;
        if !self.s.holds(ev) {
            return Err(if profile { format!("人物ファイルに載っていない人物です: {}", item.id) } else { format!("持っていない証拠品です: {}", item.id) });
        }
        let find = |list: &[(u32, u32)]| list.iter().find(|(e, _)| *e == ev).map(|(_, pc)| *pc);
        match self.s.mode {
            Mode::Testimony => {
                self.require_cross("present")?;
                if profile { return Err("尋問では人物ファイルをつきつけられません".into()); }
                let t = self.testimony()?;
                let target = find(&t.statements[self.s.statement as usize].present).unwrap_or(t.wrong);
                self.s.var_ev = Some(ev);
                self.run(target);
            }
            Mode::Investigate => {
                let p = self.place()?;
                if !self.person_here(p)? { return Err("この場所には証拠品をつきつける相手がいません".into()); }
                self.s.var_ev = Some(ev);
                self.run(find(if profile { &p.present_profile } else { &p.present }).unwrap_or(p.present_wrong));
            }
            Mode::Run => {
                let Op::Demand { options, profiles, wrong, .. } = self.instr()? else { return Err("今は証拠品をつきつけられません".into()) };
                let list = if profile {
                    profiles.as_deref().ok_or("このつきつけの要求では人物ファイルをつきつけられません")?
                } else { options };
                self.s.var_ev = Some(ev);
                self.s.pc = find(list).unwrap_or(*wrong);
            }
        }
        self.settle()
    }

    /// 表示される選択肢の index 番目を選ぶ
    pub fn choose(&mut self, index: usize) -> Res {
        let ins = if self.s.mode == Mode::Run { Some(self.instr()?) } else { None };
        let Some(Op::Choice(opts)) = ins else { return Err("選択肢は表示されていません".into()) };
        let mut shown = vec![];
        for o in opts {
            if self.test(o.when.as_ref())? { shown.push(o.to); }
        }
        let to = *shown.get(index).ok_or_else(|| format!("選択肢の番号が範囲外です: {index}"))?;
        self.s.pc = to;
        self.settle()
    }

}
