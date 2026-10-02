//! <E033 話 番号 ラベル>: 台本の番号表の N 番の台本のラベルを呼び、終わると戻る（tools/convert/ctr/calls.ts の Rust 版）。
//! シナリオには呼び出しが無いので、呼ばれたブロックをその場に展開する。ブロックの中から同じ台本の別のラベルへ飛ぶときは、
//! その台本がシーンになっていれば goto、なっていなければ（探偵パートの場所の台本など）それも展開する。

use super::block::{convert_block, NameEntry, State};
use super::file::{main_label, scene_id};
use super::gmd::{read_gmd_text, tokenize, Entry};
use super::{Conv, Hub, Step, Topics};
use regex::Regex;
use serde_json::json;
use std::rc::Rc;

fn native(to: i64, idx: i64) -> Vec<Step> {
    vec![json!({"native": "E033", "args": [to, idx]})]
}

impl Conv {
    pub fn load(&self, name: &str) -> Option<Rc<Vec<Entry>>> {
        if let Some(c) = self.cache.borrow().get(name) {
            return c.clone();
        }
        let p = self.dir.join(format!("_{name}_jpn.txt"));
        let v = p
            .exists()
            .then(|| read_gmd_text(&p).ok().map(Rc::new))
            .flatten();
        self.cache.borrow_mut().insert(name.to_string(), v.clone());
        v
    }

    /// 台本 short のラベル k のブロックを変換する。呼び出しが自分に戻る輪は、2 度目を展開しない
    pub fn block(
        &self,
        short: &str,
        entries: &Rc<Vec<Entry>>,
        k: usize,
        hub: Option<&Rc<Hub>>,
    ) -> Vec<Step> {
        let key = format!("{short}:{k}");
        if self.active.borrow().contains(&key) {
            return vec![];
        }
        let Some(e) = entries.get(k) else {
            return vec![];
        };
        self.active.borrow_mut().insert(key.clone());
        let ctx = CallCtx {
            conv: self,
            short,
            entries,
            hub,
            main: main_label(entries),
        };
        let steps = convert_block(&tokenize(&e.text), &ctx, Some(k));
        self.active.borrow_mut().remove(&key);
        steps
    }

    pub fn call(&self, to: i64, idx: i64, label: Option<&str>) -> Vec<Step> {
        let name = self
            .tables
            .get(&to)
            .and_then(|t| usize::try_from(idx).ok().and_then(|i| t.get(i)))
            .cloned()
            .flatten();
        let Some(name) = name else {
            return native(to, idx);
        };
        let entries = self.load(&name);
        let k = entries
            .as_ref()
            .and_then(|e| label.and_then(|l| e.iter().position(|x| x.label.as_deref() == Some(l))));
        let (Some(entries), Some(k)) = (entries, k) else {
            return native(to, idx);
        };
        // 今の話の物語のファイルならシーン名と同じ短い名前、ほか（場所・人物の台本）は名前のまま
        let prefix = format!("{}_", self.sce);
        let story = name.starts_with(&prefix)
            && Regex::new(r"_c[0-9]{3}_[0-9]{4}$")
                .expect("re")
                .is_match(&name);
        let short = if story {
            name.replacen(&prefix, "", 1)
        } else {
            name.clone()
        };
        if story {
            self.called.borrow_mut().insert(scene_id(
                &short,
                label.unwrap_or(""),
                &main_label(&entries),
            ));
        }
        self.block(&short, &entries, k, None)
    }

    /// <E031 話 番号>: 話（0 始まり）の台本の番号表の N 番の台本へ飛ぶ。別の話なら話の終わり
    pub fn script(&self, to: i64, idx: i64) -> Vec<Step> {
        if to != self.ep {
            return vec![json!({"end": true})];
        }
        let target = usize::try_from(idx)
            .ok()
            .and_then(|i| self.script_ids.get(i))
            .cloned()
            .flatten()
            .map(|t| t.replacen(&format!("{}_", self.sce), "", 1));
        match target {
            Some(t) if !t.is_empty() && self.short.contains(&t) => vec![json!({"goto": t})],
            _ => vec![json!({"native": "E031", "args": [to, idx]})],
        }
    }
}

impl Topics {
    pub fn flag(&self, t: i64, l: i64) -> String {
        format!("{}_t{t}_{l}", self.id)
    }

    /// 場所の話題（<E377 人 話題 ラベル> で足す、<E378 人 旧 新 ラベル> で差し替える）の増減
    pub fn steps(&self, conv: &Conv, swap: bool, a: &[i64]) -> Vec<Step> {
        let g = |i: usize| super::gmd::arg(a, i);
        if !swap {
            let f = self.flag(g(1), g(2));
            conv.st.add_flag(&f);
            return vec![json!({"set": {f: true}})];
        }
        let off: Vec<String> = self
            .variants
            .iter()
            .find(|v| v.0 == g(1))
            .map(|v| v.1.iter().map(|&l| self.flag(g(1), l)).collect())
            .unwrap_or_default();
        for f in &off {
            conv.st.add_flag(f);
        }
        let on = self.flag(g(2), g(3));
        conv.st.add_flag(&on);
        let mut set = serde_json::Map::new();
        for f in off {
            set.insert(f, json!(false));
        }
        set.insert(on, json!(true));
        vec![json!({"set": set})]
    }
}

/// 呼び出しの中・探偵パートの中でブロックを変換するときの状況
pub struct CallCtx<'a> {
    pub conv: &'a Conv,
    pub short: &'a str,
    pub entries: &'a Rc<Vec<Entry>>,
    pub hub: Option<&'a Rc<Hub>>,
    pub main: String,
}

impl super::block::Ctx for CallCtx<'_> {
    fn state(&self) -> &State {
        &self.conv.st
    }
    fn names(&self) -> &[NameEntry] {
        &self.conv.names
    }
    fn choice_text(&self, id: i64) -> String {
        self.conv.choice_text(id)
    }
    fn jump(&self, n: i64) -> Vec<Step> {
        let label = usize::try_from(n)
            .ok()
            .and_then(|i| self.entries.get(i))
            .map(|e| e.label());
        let Some(label) = label.filter(|l| !l.is_empty()) else {
            return vec![];
        };
        if Regex::new(r"^L_(INIT|LOAD)(_[0-9]+)?$")
            .expect("re")
            .is_match(label)
        {
            return vec![];
        }
        if self.conv.converted.contains(self.short) {
            vec![json!({"goto": scene_id(self.short, label, &self.main)})]
        } else {
            self.conv
                .block(self.short, self.entries, n as usize, self.hub)
        }
    }
    fn end(&self) -> Vec<Step> {
        vec![]
    }
    fn reveal(&self, _msg: i64) -> Option<String> {
        None
    }
    fn game(&self) -> Vec<Step> {
        vec![json!({"native": "game", "args": []})]
    }
    fn point_out(&self, _self_label: Option<usize>) -> Option<Step> {
        None
    }
    fn spot_name(&self, _label: i64, spot: i64) -> String {
        format!("調べる所 {spot}")
    }
    fn choices_at(&self, _label: Option<usize>) -> Vec<(i64, i64)> {
        vec![]
    }
    fn script(&self, sce: i64, idx: i64) -> Vec<Step> {
        self.conv.script(sce, idx)
    }
    fn call(&self, sce: i64, idx: i64, label: Option<&str>) -> Vec<Step> {
        self.conv.call(sce, idx, label)
    }
    fn call_local(&self, n: i64) -> Vec<Step> {
        match usize::try_from(n) {
            Ok(k) => self.conv.block(self.short, self.entries, k, self.hub),
            Err(_) => vec![],
        }
    }
    fn hub(&self) -> Option<(i64, i64)> {
        self.hub.map(|h| (h.chap, h.scene))
    }
    fn perceive_choice(&self) -> bool {
        self.conv.episode <= 4
    }
    fn end_invest(&self) -> Vec<Step> {
        match self.hub {
            Some(h) => h.end.clone(),
            None => vec![json!({"native": "E394", "args": []})],
        }
    }
    fn free_roam(&self, place: i64, n: i64) -> Vec<Step> {
        vec![json!({"native": "E393", "args": [place, n]})]
    }
    fn map_place(&self, _place: i64) {}
    fn end_flag(&self, _flag: &str) {}
    fn topics(&self, swap: bool, args: &[i64]) -> Vec<Step> {
        match self.hub.and_then(|h| h.topics.as_ref()) {
            Some(t) => t.steps(self.conv, swap, args),
            None => vec![],
        }
    }
    fn record_id(&self, kind: i64, idx: i64) -> Option<String> {
        self.conv.record_id(kind, idx)
    }
}
