// IR の探索編の場所（PlaceScene）を読む（load.rs の Ctx の続き）。
use super::{obj, opt_pc, pc_of, str_of, Ctx, Obj};
use crate::model::*;
use serde_json::Value;

impl Ctx {
    pub(super) fn place(&mut self, o: &Obj) -> Result<Place, String> {
        let arr = |k: &str| {
            o.get(k)
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
        };
        let mut person = vec![];
        for p in arr("person") {
            person.push(self.when(obj(&p)?)?);
        }
        let mut examine = vec![];
        for x in arr("examine") {
            let xo = obj(&x)?;
            let a = xo["area"].as_array().ok_or("area がありません")?;
            let n = |i: usize| a.get(i).and_then(Value::as_f64).unwrap_or(0.0) as i64;
            examine.push(Examine {
                seen: self.seen.get(str_of(xo, "id")?),
                name: xo.get("name").and_then(Value::as_str).map(str::to_string),
                area: [n(0), n(1), n(2), n(3)],
                when: self.when(xo)?,
                pc: pc_of(xo, "pc")?,
            });
        }
        let mut talk = vec![];
        for x in arr("talk") {
            let xo = obj(&x)?;
            talk.push(Talk {
                seen: self.seen.get(str_of(xo, "id")?),
                topic: str_of(xo, "topic")?.to_string(),
                when: self.when(xo)?,
                pc: pc_of(xo, "pc")?,
            });
        }
        let mut moves = vec![];
        for m in arr("move") {
            let mo = obj(&m)?;
            moves.push((self.scene_ref(str_of(mo, "to")?), self.when(mo)?));
        }
        Ok(Place {
            name: str_of(o, "name").unwrap_or("").to_string(),
            person,
            enter: opt_pc(o, "enter"),
            examine,
            examine_default: pc_of(o, "examineDefault")?,
            talk,
            present: self.answers(o.get("present")),
            present_profile: self.profile_answers(o.get("presentProfile")),
            present_wrong: pc_of(o, "presentWrong")?,
            moves,
        })
    }
}
