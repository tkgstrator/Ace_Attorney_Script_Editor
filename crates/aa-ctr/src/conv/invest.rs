//! 3DS 版（逆転裁判6）の探偵パートを、探索編の場所（places）にする（tools/convert/ctr/invest.ts の Rust 版）。
//! 調べる所の位置は 3D の部品なので取れず、画面を縦に切った帯で選ばせる近似にしている。

use super::{Conv, Step};
use regex::Regex;
use serde_json::json;

impl Conv {
    /// 話題の番号 → 名前。その話で使う最小の番号が topic_sceNN の表の先頭
    pub fn topic_name(&self, id: i64) -> Option<String> {
        let base = self.topic_base?;
        let i = usize::try_from(id - base).ok()?;
        let t = self.topic_entries.get(i)?.text.as_str();
        (t != "Invalid Message" && !t.is_empty()).then(|| t.to_string())
    }

    /// 進み具合のフラグが物語のファイル file の探偵パートで立ちうるか。
    pub fn flag_possible(&self, flag: &str, file: &str) -> bool {
        let at = self.flag_first.get(flag);
        let pos = self.story.iter().position(|s| s == file);
        at.is_none()
            || self.flag_other.contains(flag)
            || pos.is_none_or(|p| at.is_some_and(|&a| a <= p))
    }

    /// 探偵パートの入口。場所の台本の版は場所の番号（表 12）で決まり、行き来できる場所は直前の <E386> で並べたもの
    pub fn investigate(
        &self,
        file: &str,
        hub: (i64, i64),
        end: Vec<Step>,
        place: i64,
        others: &[i64],
        end_flags: &[String],
    ) -> Vec<Step> {
        let mut order = vec![place];
        order.extend(others.iter().copied().filter(|&p| p != place));
        let ids: Vec<(i64, String, String)> = order
            .into_iter()
            .filter_map(|p| {
                let short = usize::try_from(p)
                    .ok()
                    .and_then(|i| self.bg_scripts.get(i))?
                    .clone()?;
                self.load(&short)?;
                let id = format!(
                    "{file}_{}",
                    Regex::new(r"^sce[0-9]+_").expect("re").replace(&short, "")
                );
                Some((p, short, id))
            })
            .collect();
        if ids.is_empty() {
            let mut v = vec![json!({"native": "E393", "args": [place]})];
            v.extend(end);
            return v;
        }
        // 出るときは出口のシーンを通す。そこで手に入る法廷記録をまとめて加える（物語のファイルを順につなぐ近似）
        let exit = format!("{file}_dtc_exit{place}");
        let to_exit = vec![json!({"goto": exit})];
        let mut fresh: Vec<String> = Vec::new();
        for (p, short, id) in &ids {
            if self.places.borrow().contains_key(id) {
                continue;
            }
            self.places.borrow_mut().insert(id.clone(), json!({})); // 再入の防止
            let entries = self.load(short).expect("loaded");
            let moves: Vec<String> = ids
                .iter()
                .filter(|(q, _, _)| q != p)
                .map(|(_, _, x)| x.clone())
                .collect();
            let hub_obj = std::rc::Rc::new(super::Hub {
                chap: hub.0,
                scene: hub.1,
                end: to_exit.clone(),
                topics: None,
            });
            let (value, m) = self.build_place(id, file, short, &entries, &hub_obj, &moves);
            self.places.borrow_mut().insert(id.clone(), value);
            self.meta.borrow_mut().insert(id.clone(), m);
            fresh.push(id.clone());
        }
        let all: Vec<String> = ids.iter().map(|x| x.2.clone()).collect();
        if !fresh.is_empty()
            && !all
                .iter()
                .any(|x| self.meta.borrow().get(x).is_some_and(|m| m.real_end))
        {
            self.install_done(&all, &fresh, end_flags);
        }
        if !self.inv_scenes.borrow().contains_key(&exit) {
            let text = serde_json::to_string(
                &ids.iter()
                    .filter_map(|x| self.places.borrow().get(&x.2).cloned())
                    .collect::<Vec<_>>(),
            )
            .unwrap_or_default();
            let re = Regex::new(r#""give(Profile)?":"[^"]+""#).expect("re");
            let mut unique: Vec<String> = Vec::new();
            for m in re.find_iter(&text) {
                let m = m.as_str().to_string();
                if !unique.contains(&m) {
                    unique.push(m);
                }
            }
            let mut gains: Vec<Step> = unique
                .iter()
                .filter_map(|m| serde_json::from_str(&format!("{{{m}}}")).ok())
                .collect();
            gains.extend(end);
            self.inv_scenes.borrow_mut().insert(exit, json!(gains));
        }
        let id = ids
            .iter()
            .find(|x| x.0 == place)
            .map_or(&ids[0].2, |x| &x.2);
        vec![json!({"investigate": id})]
    }
}
