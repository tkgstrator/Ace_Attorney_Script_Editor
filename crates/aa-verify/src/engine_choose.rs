// 選ぶ操作（選択肢・範囲を選ぶ・サイコ・ロックのつきつけをやめる）。engine.rs の Engine の続き（core の Engine と同じ意味）。
use super::{Engine, Res};
use crate::model::*;
use crate::state::Mode;

impl Engine<'_> {
    /// サイコ・ロックのつきつけをやめる（つきつけの要求に give_up があるときだけ）
    pub fn give_up(&mut self) -> Res {
        let ins = if self.s.mode == Mode::Run {
            Some(self.instr()?)
        } else {
            None
        };
        let Some(Op::Demand {
            give_up: Some(to), ..
        }) = ins
        else {
            return Err("今はやめられません".into());
        };
        self.s.pc = *to;
        self.settle()
    }

    /// 表示される選択肢の index 番目を選ぶ
    pub fn choose(&mut self, index: usize) -> Res {
        let ins = if self.s.mode == Mode::Run {
            Some(self.instr()?)
        } else {
            None
        };
        let Some(Op::Choice(opts)) = ins else {
            return Err("選択肢は表示されていません".into());
        };
        let mut shown = vec![];
        for o in opts {
            if self.test(o.when.as_ref())? {
                shown.push(o.to);
            }
        }
        let to = *shown
            .get(index)
            .ok_or_else(|| format!("選択肢の番号が範囲外です: {index}"))?;
        self.s.pc = to;
        self.settle()
    }

    /// 絵の上の範囲を選ぶ（pick）。index は今選べるもの（範囲・範囲の外・やめるの順）の番号（core の Engine.pick）
    pub fn pick(&mut self, index: usize) -> Res {
        let ins = if self.s.mode == Mode::Run {
            Some(self.instr()?)
        } else {
            None
        };
        let Some(Op::Pick(opts)) = ins else {
            return Err("範囲を選ぶ場面ではありません".into());
        };
        let mut shown = vec![];
        for o in opts {
            if self.test(o.when.as_ref())? {
                shown.push(o.to);
            }
        }
        let to = *shown
            .get(index)
            .ok_or_else(|| format!("範囲の番号が範囲外です: {index}"))?;
        self.s.pc = to;
        self.settle()
    }
}
