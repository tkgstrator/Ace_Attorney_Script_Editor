// IR の JSON（packages/script/src/export-ir.ts が書き出すもの）を読み、Model にする。
// 整合性チェックの下ごしらえ（verify-key.ts の prepare）として、乱数で飛ぶ命令（random）は選択肢に置き換える。
use crate::model::*;
use serde_json::{Map, Value};
use std::collections::HashMap;

type Obj = Map<String, Value>;

/// 文字列を番号にする入れ物
#[derive(Default)]
struct Interner {
    names: Vec<String>,
    index: HashMap<String, u32>,
}

impl Interner {
    fn get(&mut self, s: &str) -> u32 {
        if let Some(&i) = self.index.get(s) {
            return i;
        }
        let i = self.names.len() as u32;
        self.names.push(s.to_string());
        self.index.insert(s.to_string(), i);
        i
    }
}

struct Ctx {
    flags: Interner,
    strings: Interner,
    /// 証拠品と人物ファイル（人物ファイルは PROFILE を頭に付けた名前で入れる）
    evidence: Interner,
    /// profile のある人物 ID → 法廷記録の項目の番号
    profiles: HashMap<String, u32>,
    scenes: HashMap<String, u32>,
    missing: Interner,
    extra_visit: Interner,
    seen: Interner,
    scene_count: u32,
}

/// 人物ファイルの項目の名前の頭（証拠品の ID と重ならないように）
const PROFILE: &str = "\u{1}profile:";

fn err(msg: impl Into<String>) -> String {
    msg.into()
}

fn obj(v: &Value) -> Result<&Obj, String> {
    v.as_object().ok_or_else(|| err(format!("オブジェクトではありません: {v}")))
}
fn str_of<'a>(o: &'a Obj, k: &str) -> Result<&'a str, String> {
    o.get(k).and_then(Value::as_str).ok_or_else(|| err(format!("{k} がありません")))
}
fn num_of(o: &Obj, k: &str) -> Result<f64, String> {
    o.get(k).and_then(Value::as_f64).ok_or_else(|| err(format!("{k} がありません")))
}
fn pc_of(o: &Obj, k: &str) -> Result<u32, String> {
    Ok(num_of(o, k)? as u32)
}
fn opt_pc(o: &Obj, k: &str) -> Option<u32> {
    o.get(k).and_then(Value::as_f64).map(|v| v as u32)
}

impl Ctx {
    fn value(&mut self, v: &Value) -> FVal {
        match v {
            Value::Bool(b) => FVal::Bool(*b),
            Value::Number(n) => FVal::Num(n.as_f64().unwrap_or(f64::NAN)),
            Value::String(s) => FVal::Str(self.strings.get(s)),
            _ => FVal::Undef,
        }
    }

    fn scene_ref(&mut self, id: &str) -> u32 {
        match self.scenes.get(id) {
            Some(&i) => i,
            None => self.scene_count + self.missing.get(id),
        }
    }

    fn expr(&mut self, v: &Value) -> Result<Expr, String> {
        let o = obj(v)?;
        Ok(match str_of(o, "t")? {
            "lit" => Expr::Lit(self.value(o.get("v").unwrap_or(&Value::Null))),
            "var" => {
                let name = str_of(o, "name")?;
                if name == "life" { Expr::Life } else { Expr::Var(self.flags.get(name)) }
            }
            "call" => {
                let arg = str_of(o, "arg")?;
                match str_of(o, "fn")? {
                    "has" => Expr::Has(self.evidence.get(arg)),
                    "visited" => match self.scenes.get(arg) {
                        Some(&i) => Expr::Visited(i),
                        None => Expr::Visited(self.scene_count + self.extra_visit.get(arg)),
                    },
                    "seen" => Expr::Seen(self.seen.get(arg)),
                    f => return Err(err(format!("未知の関数です: {f}"))),
                }
            }
            "not" => Expr::Not(Box::new(self.expr(&o["e"])?)),
            "bin" => {
                let op = match str_of(o, "op")? {
                    "&&" => BinOp::And, "||" => BinOp::Or, "==" => BinOp::Eq, "!=" => BinOp::Ne,
                    "<" => BinOp::Lt, "<=" => BinOp::Le, ">" => BinOp::Gt, ">=" => BinOp::Ge,
                    "+" => BinOp::Add, "-" => BinOp::Sub,
                    x => return Err(err(format!("未知の演算子です: {x}"))),
                };
                Expr::Bin(op, Box::new(self.expr(&o["l"])?), Box::new(self.expr(&o["r"])?))
            }
            t => return Err(err(format!("未知の式です: {t}"))),
        })
    }

    fn when(&mut self, o: &Obj) -> Result<Option<Expr>, String> {
        o.get("when").map(|w| self.expr(w)).transpose()
    }

    /// 証拠品 ID → pc の表（IR の並びのまま）
    fn answers(&mut self, v: Option<&Value>) -> Vec<(u32, u32)> {
        let Some(Value::Object(m)) = v else { return vec![] };
        m.iter().map(|(k, v)| (self.evidence.get(k), v.as_f64().unwrap_or(0.0) as u32)).collect()
    }

    /// 人物 ID → pc の表（人物ファイルの項目の番号にする。profile の無い人物は除く）
    fn profile_answers(&self, v: Option<&Value>) -> Vec<(u32, u32)> {
        let Some(Value::Object(m)) = v else { return vec![] };
        m.iter().filter_map(|(k, v)| self.profiles.get(k).map(|&x| (x, v.as_f64().unwrap_or(0.0) as u32))).collect()
    }

    /// 人物ファイルに載せる・外す（profile の無い人物はつきつけられないので、何もしない）
    fn profile_op(&self, o: &Obj, give: bool) -> Result<Op, String> {
        Ok(match self.profiles.get(str_of(o, "character")?) {
            Some(&x) => if give { Op::Give(x) } else { Op::Take(x) },
            None => Op::Nop(if give { "giveProfile" } else { "takeProfile" }),
        })
    }

    fn instr(&mut self, v: &Value) -> Result<Op, String> {
        let o = obj(v)?;
        let op = str_of(o, "op")?;
        Ok(match op {
            "say" => Op::Stop(StopKind::Line),
            "shout" => Op::Stop(StopKind::Shout),
            "banner" => Op::Stop(StopKind::Banner),
            "card" => Op::Stop(StopKind::Card),
            "wait" => Op::Stop(StopKind::Wait),
            "fade" => {
                if o.get("wait").and_then(Value::as_bool).unwrap_or(false) { Op::Stop(StopKind::Fade) } else { Op::Nop("fade") }
            }
            "random" => {
                let to: Vec<u32> = o["to"].as_array().map(|a| a.iter().map(|x| x.as_f64().unwrap_or(0.0) as u32).collect()).unwrap_or_default();
                // 乱数の行き先は、すべて試せるようプレイヤーが選ぶ選択肢にする（verify-key.ts の prepare）
                if to.is_empty() { Op::Random(to) } else { Op::Choice(to.into_iter().map(|to| Opt { when: None, to }).collect()) }
            }
            "choice" => {
                let mut opts = vec![];
                for x in o["options"].as_array().ok_or("choice の options がありません")? {
                    let xo = obj(x)?;
                    opts.push(Opt { when: self.when(xo)?, to: pc_of(xo, "to")? });
                }
                Op::Choice(opts)
            }
            "demand" => Op::Demand {
                prompt: str_of(o, "prompt").unwrap_or("").to_string(),
                speaker: o.get("speaker").is_some_and(|s| s.is_string()),
                options: self.answers(o.get("options")),
                profiles: o.get("profiles").map(|p| self.profile_answers(Some(p))),
                wrong: pc_of(o, "wrong")?,
                give_up: opt_pc(o, "giveUp"),
            },
            "giveProfile" => self.profile_op(o, true)?,
            "takeProfile" => self.profile_op(o, false)?,
            "ui" => match o.get("record").and_then(Value::as_bool) {
                Some(r) => Op::Lock(!r),
                None => Op::Nop("ui"),
            },
            "set" => { let f = self.flags.get(str_of(o, "flag")?); Op::Set(f, self.value(&o["value"])) }
            "add" => Op::Add(self.flags.get(str_of(o, "flag")?), num_of(o, "amount")?),
            "give" => Op::Give(self.evidence.get(str_of(o, "evidence")?)),
            "take" => Op::Take(self.evidence.get(str_of(o, "evidence")?)),
            "jump" => Op::Jump(pc_of(o, "to")?),
            "jumpUnless" => Op::JumpUnless(self.expr(&o["cond"])?, pc_of(o, "to")?),
            "goto" => Op::Goto(self.scene_ref(str_of(o, "scene")?)),
            "investigate" => Op::Investigate(self.scene_ref(str_of(o, "place")?)),
            "menu" => Op::Menu,
            "resume" => Op::Resume(match str_of(o, "to")? {
                "next" => ResumeTo::Next, "stay" => ResumeTo::Stay, "first" => ResumeTo::First,
                "crossIntro" => ResumeTo::CrossIntro, "afterReading" => ResumeTo::AfterReading,
                x => return Err(err(format!("未知の resume です: {x}"))),
            }),
            "inspectEnd" => Op::InspectEnd,
            "end" => Op::End,
            "gameover" => Op::Gameover,
            "penalty" => Op::Penalty(num_of(o, "amount")?),
            "showEvidence" | "palette" | "pan" | "overlay" | "scroll" | "textbox"
            | "bgmPause" | "show" | "location" | "bgm" | "se" | "shake" | "flash"
            | "heal" | "lifeRisk" | "locks" => Op::Nop(static_name(op)),
            x => return Err(err(format!("未知の命令です: {x}"))),
        })
    }

    fn scene(&mut self, id: &str, v: &Value) -> Result<Scene, String> {
        let o = obj(v)?;
        let mut program = vec![];
        for i in o["program"].as_array().ok_or("program がありません")? {
            program.push(self.instr(i)?);
        }
        let kind = match str_of(o, "kind")? {
            "dialogue" => Kind::Dialogue,
            "testimony" => {
                let mut statements = vec![];
                for st in o["statements"].as_array().ok_or("statements がありません")? {
                    let so = obj(st)?;
                    statements.push(Statement {
                        when: self.when(so)?, press: opt_pc(so, "press"), present: self.answers(so.get("present")),
                        present_profile: so.get("presentProfile").map(|p| self.profile_answers(Some(p))), before: opt_pc(so, "before"),
                    });
                }
                Kind::Testimony(Testimony {
                    title: str_of(o, "title").unwrap_or("").to_string(),
                    statements,
                    after: opt_pc(o, "after"),
                    reading: opt_pc(o, "reading"),
                    looping: opt_pc(o, "loop"),
                    wrong: pc_of(o, "wrong")?,
                })
            }
            "place" => Kind::Place(self.place(o)?),
            k => return Err(err(format!("未知のシーンの種類です: {k}"))),
        };
        Ok(Scene { id: id.to_string(), kind, program, nop_end: vec![], stop_run: vec![], defer: vec![], segment: vec![], trivial: vec![] })
    }

    fn place(&mut self, o: &Obj) -> Result<Place, String> {
        let arr = |k: &str| o.get(k).and_then(Value::as_array).cloned().unwrap_or_default();
        let mut person = vec![];
        for p in arr("person") { person.push(self.when(obj(&p)?)?); }
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
            talk.push(Talk { seen: self.seen.get(str_of(xo, "id")?), topic: str_of(xo, "topic")?.to_string(), when: self.when(xo)?, pc: pc_of(xo, "pc")? });
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

fn static_name(op: &str) -> &'static str {
    const NAMES: [&str; 16] = [
        "showEvidence", "palette", "giveProfile", "takeProfile", "pan", "overlay", "scroll", "textbox", "ui", "bgmPause", "show",
        "location", "bgm", "se", "shake", "flash",
    ];
    NAMES.iter().find(|n| **n == op).copied().unwrap_or("nop")
}

/// IR の JSON のテキストから Model を作る
pub fn load(text: &str) -> Result<Model, String> {
    let root: Value = serde_json::from_str(text).map_err(|e| format!("JSON として読めません: {e}"))?;
    let o = obj(&root)?;
    let scenes_obj = o.get("scenes").and_then(Value::as_object).ok_or("scenes がありません")?;
    let mut cx = Ctx {
        flags: Interner::default(), strings: Interner::default(), evidence: Interner::default(), profiles: HashMap::new(), scenes: HashMap::new(),
        missing: Interner::default(), extra_visit: Interner::default(), seen: Interner::default(), scene_count: scenes_obj.len() as u32,
    };
    for (i, id) in scenes_obj.keys().enumerate() {
        cx.scenes.insert(id.clone(), i as u32);
    }
    // フラグ・証拠品は IR の並びで番号を付ける（後から出てきたものは後ろに足す）
    let mut flag_init = vec![];
    if let Some(Value::Object(f)) = o.get("flags") {
        for (k, v) in f {
            cx.flags.get(k);
            flag_init.push(cx.value(v));
        }
    }
    let declared_flags = flag_init.len();
    let ev_obj = o.get("evidence").and_then(Value::as_object).cloned().unwrap_or_default();
    for k in ev_obj.keys() {
        cx.evidence.get(k);
    }
    // 人物ファイル（profile のある人物、人物の定義の順）は証拠品の後ろに並べる
    let ch_obj = o.get("characters").and_then(Value::as_object).cloned().unwrap_or_default();
    let profile_of = |id: &str| ch_obj.get(id).and_then(|c| c.get("profile")).filter(|p| p.is_object());
    for id in ch_obj.keys() {
        if profile_of(id).is_some() { let x = cx.evidence.get(&format!("{PROFILE}{id}")); cx.profiles.insert(id.clone(), x); }
    }
    let mut scenes = vec![];
    for (id, v) in scenes_obj {
        scenes.push(cx.scene(id, v).map_err(|e| format!("シーン {id}: {e}"))?);
    }
    let start_scene = cx.scene_ref(str_of(o, "startScene")?);
    let mut start_evidence: Vec<u32> = o.get("startEvidence").and_then(Value::as_array).cloned().unwrap_or_default().iter()
        .filter_map(Value::as_str).map(|s| cx.evidence.get(s)).collect();
    // 最初の人物ファイル（null なら profile のある全員）
    match o.get("startProfiles").and_then(Value::as_array) {
        Some(list) => start_evidence.extend(list.iter().filter_map(Value::as_str).filter_map(|id| cx.profiles.get(id).copied())),
        None => start_evidence.extend(ch_obj.keys().filter_map(|id| cx.profiles.get(id).copied())),
    }
    let gameover_scene = o.get("gameoverScene").and_then(Value::as_str).map(|s| cx.scene_ref(s));
    let life_out: Vec<u32> = o.get("lifeOutScenes").and_then(Value::as_array).map(|a| {
        a.iter().filter_map(Value::as_str).map(|s| cx.scene_ref(s)).collect()
    }).unwrap_or_default();
    let mut parts = vec![];
    for p in o.get("parts").and_then(Value::as_array).cloned().unwrap_or_default() {
        let po = obj(&p)?;
        let list = po.get("scenes").and_then(Value::as_array).cloned().unwrap_or_default();
        parts.push(Part {
            id: str_of(po, "id")?.to_string(),
            kind: str_of(po, "kind").unwrap_or("").to_string(),
            title: str_of(po, "title").unwrap_or("").to_string(),
            scenes: list.iter().filter_map(Value::as_str).filter_map(|s| cx.scenes.get(s).copied()).collect(),
        });
    }
    let evidence = cx.evidence.names.iter().map(|id| {
        if let Some(ch) = id.strip_prefix(PROFILE) {
            // 人物ファイルの表示名（profile.name、なければ name）
            let c = ch_obj.get(ch);
            let name = c.and_then(|c| c["profile"].get("name")).or(c.and_then(|c| c.get("name"))).and_then(Value::as_str).unwrap_or(ch);
            return Evidence { id: ch.to_string(), name: name.to_string(), inspect: None, profile: true, effective: false, effective_index: None };
        }
        let e = ev_obj.get(id).and_then(Value::as_object);
        Evidence {
            id: id.clone(),
            name: e.and_then(|e| e.get("name")).and_then(Value::as_str).unwrap_or(id).to_string(),
            inspect: e.and_then(|e| e.get("inspect")).and_then(Value::as_str).map(|s| cx.scenes.get(s).copied().unwrap_or(u32::MAX)),
            profile: false,
            effective: false,
            effective_index: None,
        }
    }).collect();
    flag_init.resize(cx.flags.names.len(), FVal::Undef);
    let mut model = Model {
        id: str_of(o, "id").unwrap_or("").to_string(),
        flag_names: cx.flags.names,
        flag_init,
        declared_flags,
        strings: cx.strings.names,
        evidence,
        scenes,
        extra_visit: cx.extra_visit.names,
        seen_ids: cx.seen.names,
        start_scene,
        start_evidence,
        profile_points: false,
        inspect_effective: vec![],
        inspect_all: vec![],
        inspect_skip: vec![],
        defer: Default::default(),
        gameover_scene,
        life_out,
        max_life: o.get("maxLife").and_then(Value::as_f64).unwrap_or(5.0),
        parts,
        missing_scenes: cx.missing.names,
    };
    model.profile_points = model.scenes.iter().any(|sc| sc.place().is_some_and(|p| !p.person.is_empty())
        || sc.program.iter().any(|op| matches!(op, Op::Demand { profiles: Some(_), .. }))
        || matches!(&sc.kind, Kind::Testimony(t) if t.statements.iter().any(|st| st.present_profile.is_some())));
    (model.inspect_all, model.inspect_effective) = crate::inspect::inspect_info(&model);
    for (j, &x) in model.inspect_effective.iter().enumerate() {
        model.evidence[x as usize].effective = true;
        model.evidence[x as usize].effective_index = Some(j);
    }
    model.inspect_skip = crate::inspect::inspect_skip(&model);
    // 条件式を速く評価できるようにする（fast.rs）
    crate::fast::prepare(&mut model);
    // 文章送りだけの場面で詳しく調べるのを試すかの下ごしらえ（defer.rs）
    crate::defer::prepare(&mut model);
    Ok(model)
}
