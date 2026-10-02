//! 探偵パートの出口。<E392> の終わりのフラグはゲーム本体側が LABEL_0000 を動かす仕組みで、台本だけでは
//! 何が立てるか完全には分からない。話題を最後まで聞いたことを近似の出口条件にもする。

use super::Conv;
use serde_json::json;

impl Conv {
    pub(super) fn install_done(&self, all: &[String], fresh: &[String], end_flags: &[String]) {
        let meta = self.meta.borrow();
        let place_values: Vec<serde_json::Value> = {
            let places = self.places.borrow();
            all.iter().filter_map(|x| places.get(x).cloned()).collect()
        };
        let built = serde_json::to_string(
            &place_values
                .iter()
                .map(|p| (&p["talk"], &p["examine"], &p["present"]))
                .collect::<Vec<_>>(),
        )
        .unwrap_or_default();
        let by_flags = !end_flags.is_empty()
            && end_flags
                .iter()
                .all(|f| built.contains(&format!("\"{f}\":true")));
        let talks: Vec<_> = all
            .iter()
            .flat_map(|x| {
                self.meta
                    .borrow()
                    .get(x)
                    .map(|m| m.talk.clone())
                    .unwrap_or_default()
            })
            .collect();
        let seen_last = talks
            .iter()
            .rev()
            .take(4)
            .rev()
            .map(|t| format!("(not {} or seen({}))", t.flag, t.id))
            .collect::<Vec<_>>()
            .join(" and ");
        let psyche = all
            .iter()
            .any(|x| self.meta.borrow().get(x).is_some_and(|m| m.psyche));
        let cond = match (by_flags, psyche, seen_last.is_empty()) {
            (true, true, false) => format!("({}) or ({})", end_flags.join(" and "), seen_last),
            (true, _, _) => end_flags.join(" and "),
            (_, _, false) => seen_last,
            _ => return,
        };
        drop(meta);
        for x in fresh {
            let data = {
                let meta = self.meta.borrow();
                meta.get(x).and_then(|m| {
                    m.done_k
                        .map(|k| (m.short.clone(), m.entries.clone(), k, m.hub.clone()))
                })
            };
            let Some((short, entries, k, hub)) = data else {
                continue;
            };
            let mut steps = self.block(&short, &entries, k, Some(&hub));
            steps.push(json!({"investigate": x}));
            self.inv_scenes
                .borrow_mut()
                .insert(format!("{x}_done"), json!(steps));
            // places の topic の then に出口の判定を足す
            if let Some(p) = self.places.borrow_mut().get_mut(x) {
                if let Some(talk) = p["talk"].as_array_mut() {
                    for t in talk {
                        if let Some(then) = t["then"].as_array_mut() {
                            then.push(json!({"if": cond, "then": [{"goto": format!("{x}_done")}]}));
                        }
                    }
                }
            }
        }
    }
}
