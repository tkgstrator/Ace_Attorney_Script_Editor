// エンジンの、探索編（探偵メニュー）と証拠品を詳しく調べる操作（engine.rs の続き）。
use crate::engine::{BeatKind, Engine, Res};
use crate::model::*;
use crate::state::{Frame, Mode};

impl<'m> Engine<'m> {
    /// その場所にいる人物がいるか（候補のうち when が真の人物）
    pub fn person_here(&self, p: &Place) -> Res<bool> {
        for w in &p.person {
            if self.test(w.as_ref())? {
                return Ok(true);
            }
        }
        Ok(false)
    }

    pub(crate) fn require_place(&self, action: &str) -> Res<&'m Place> {
        if self.s.mode != Mode::Investigate {
            return Err(format!("探偵メニューでないと {action} できません"));
        }
        self.place()
    }

    /// 画面上の点を調べる
    pub fn examine(&mut self, x: i64, y: i64) -> Res {
        let hit = self.examine_hit(x, y)?;
        self.examine_known(hit)
    }

    /// 当たる調べる所が分かっているときの examine
    pub fn examine_known(&mut self, hit: Option<usize>) -> Res {
        let p = self.require_place("examine")?;
        match hit {
            Some(i) => {
                self.mark_seen(p.examine[i].seen);
                self.run(p.examine[i].pc);
            }
            None => self.run(p.examine_default),
        }
        self.settle()
    }

    /// 点 (x, y) を調べたときに当たる、調べる所の番号（なければ None）。結果はこれだけで決まる
    pub fn examine_hit(&self, x: i64, y: i64) -> Res<Option<usize>> {
        let p = self.require_place("examine")?;
        for (i, e) in p.examine.iter().enumerate() {
            let [ax, ay, w, h] = e.area;
            if self.test(e.when.as_ref())? && x >= ax && x < ax + w && y >= ay && y < ay + h {
                return Ok(Some(i));
            }
        }
        Ok(None)
    }

    /// 別の場所へ移動する（今の探偵メニューで選べる移動先であること）
    pub fn move_to(&mut self, place: u32) -> Res {
        let ok = self.s.mode == Mode::Investigate && self.moves()?.contains(&place);
        if !ok {
            return Err(format!(
                "ここからは移動できません: {}",
                self.m.scene_name(place)
            ));
        }
        self.go_place(place)?;
        self.settle()
    }

    /// 今の探偵メニューで選べる移動先
    pub fn moves(&self) -> Res<Vec<u32>> {
        let mut out = vec![];
        for (to, w) in &self.place()?.moves {
            if self.test(w.as_ref())? {
                out.push(*to);
            }
        }
        Ok(out)
    }

    /// 今の探偵メニューで選べる話題（場所の talk の番号。相手がいなければなし）
    pub fn talks(&self) -> Res<Vec<usize>> {
        let p = self.place()?;
        let mut out = vec![];
        if !self.person_here(p)? {
            return Ok(out);
        }
        for (i, t) in p.talk.iter().enumerate() {
            if self.test(t.when.as_ref())? {
                out.push(i);
            }
        }
        Ok(out)
    }

    /// 話題を選んで話す（talk の番号）
    pub fn talk(&mut self, i: usize) -> Res {
        let p = self.require_place("talk")?;
        if !self.talks()?.contains(&i) {
            return Err(format!(
                "今は選べない話題です: {}",
                self.m.seen_ids[p.talk[i].seen as usize]
            ));
        }
        self.mark_seen(p.talk[i].seen);
        self.run(p.talk[i].pc);
        self.settle()
    }

    /// 今詳しく調べられる証拠品（持っていて、詳しく調べるシーンがあるもの。持っている順）
    pub fn inspectable(&self) -> Vec<u32> {
        self.s
            .evidence
            .iter()
            .copied()
            .filter(|&e| self.m.evidence[e as usize].inspect.is_some())
            .collect()
    }

    /// その Beat で法廷記録を開いて詳しく調べられるか（core の canInspectAt）。詳しく調べている途中は調べられない。
    /// つきつけの要求・探偵メニューは、法廷記録を使えなくしていても調べられる
    pub fn can_inspect_at(&self, b: BeatKind) -> bool {
        if self.s.inspect_from.is_some() {
            return false;
        }
        match b {
            BeatKind::Demand | BeatKind::Investigate => true,
            BeatKind::Line | BeatKind::Statement { .. } | BeatKind::Choice | BeatKind::Card => {
                !self.s.record_locked
            }
            _ => false,
        }
    }

    /// 証拠品を詳しく調べる（法廷記録を開ける場面で）。調べ終えたら、調べ始めた場面に戻る
    pub fn inspect(&mut self, ev: u32) -> Res {
        let b = self.beat()?;
        if !self.can_inspect_at(b) || !self.inspectable().contains(&ev) {
            return Err(format!(
                "今は詳しく調べられません: {}",
                self.m.evidence[ev as usize].id
            ));
        }
        let s = &self.s;
        let from = Frame {
            scene: s.scene,
            pc: s.pc,
            mode: s.mode,
            phase: s.phase,
            statement: s.statement,
            var_ev: s.var_ev,
        };
        let scene = self.m.evidence[ev as usize].inspect.unwrap();
        self.enter(scene)?;
        self.s.inspect_from = Some(from);
        self.settle()
    }
}
