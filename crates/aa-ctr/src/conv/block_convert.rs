use super::*;

struct Demand {
    pos: usize,
    present: Map<String, Value>,
    wrong_from: usize,
}

/// self_label は変換するブロックのラベルの番号。つきつけの要求（<E224>）の外れの後にある、自分への <E004> を落とすのに使う。
///   問いかけの台詞 <E027> <E224 1 0> <E225 種類 番号 ラベル>… 外れのときの台詞… <E004 自分>
pub fn convert_block(tokens: &[Token], ctx: &dyn Ctx, self_label: Option<usize>) -> Vec<Step> {
    let mut steps: Vec<Step> = Vec::new();
    let mut line: Option<Line> = None;
    let mut choice: Option<Vec<(i64, i64)>> = None;
    let mut demand: Option<Demand> = None;
    let mut spots: Vec<Value> = Vec::new();
    let mut spots_from = 0usize;
    // 指紋検出の失敗のハンドラ（<E558 指紋なし 粉が多い 粉が足りない 指以外>）を登録した位置
    let mut fingerprint: Option<(usize, Vec<i64>)> = None;
    let mut conds: Vec<String> = Vec::new();
    let is_self = |n: i64| self_label.is_some_and(|s| s as i64 == n);
    let trailing_nl = Regex::new(r"\n+$").expect("re");

    let finish = |line: &mut Option<Line>, steps: &mut Vec<Step>, auto: bool| {
        let Some(l) = line.take() else { return };
        let joined = l.parts.join("");
        let text = trailing_nl.replace(&joined, "").into_owned();
        if plain(&text).trim().is_empty() {
            return;
        }
        if l.centered && l.green {
            steps.push(json!({"card": plain(&text)}));
            return;
        }
        let who = l
            .speaker
            .and_then(|s| usize::try_from(s).ok())
            .and_then(|s| ctx.names().get(s));
        let id = who.filter(|w| !w.name.trim().is_empty()).map(char_id);
        if id.is_some() {
            ctx.state()
                .used_names
                .borrow_mut()
                .insert(l.speaker.unwrap_or(0) as usize);
        }
        if auto {
            steps.push(json!({"say": id, "text": text, "auto": true}));
        } else {
            match id {
                Some(id) => steps.push(json!({id: text})),
                None => steps.push(json!({"narrate": text})),
            }
        }
    };

    for t in tokens {
        let (name, args, label) = match t {
            Token::Text(s) => {
                if line.is_none() {
                    if s.trim().is_empty() {
                        continue;
                    }
                    line = Some(Line {
                        speaker: None,
                        parts: vec![],
                        centered: false,
                        green: false,
                    });
                }
                line.as_mut()
                    .expect("line")
                    .parts
                    .push(s.replace('[', "[["));
                continue;
            }
            Token::Cmd { name, args, label } => (name.as_str(), args.as_slice(), label.as_deref()),
        };
        let a = |i| arg(args, i);
        if name == "E033" && line.is_none() {
            steps.extend(ctx.call(a(0), a(1), label));
            continue;
        }
        match name {
            "E041" | "E260" => {
                finish(&mut line, &mut steps, false);
                line = Some(Line {
                    speaker: args.get(1).copied(),
                    parts: vec![],
                    centered: false,
                    green: false,
                });
                continue;
            }
            "E023" | "PAGE" => {
                finish(&mut line, &mut steps, false);
                continue;
            }
            "E024" | "E027" | "E206" => {
                finish(&mut line, &mut steps, true);
                continue;
            }
            _ => {}
        }
        if let Some(l) = line.as_mut() {
            if name == "CNTR" {
                l.centered = true;
            }
            if name == "E008" {
                l.green = true;
            }
            l.parts.push(inline(ctx, name, args));
            continue;
        }
        if SKIP.contains(&name) {
            continue;
        }
        match name {
            "E221" => {
                choice = Some(vec![]);
                continue;
            }
            "E222" => {
                if let Some(c) = choice.as_mut() {
                    c.push((a(0), a(1)));
                }
                continue;
            }
            "E223" => {
                let list = match choice.as_ref().filter(|c| !c.is_empty()) {
                    Some(c) => c.clone(),
                    None => ctx.choices_at(self_label),
                };
                let opts: Vec<Value> = list
                    .iter()
                    .map(|&(id, to)| json!({"text": ctx.choice_text(id), "then": ctx.jump(to)}))
                    .collect();
                if opts.is_empty() {
                    steps.extend(ctx.game());
                } else {
                    steps.push(json!({"choice": opts}));
                }
                choice = None;
                continue;
            }
            "E224" => {
                let asked = if steps.last().is_some_and(|q| q.get("say").is_some()) {
                    steps.pop()
                } else {
                    None
                };
                let mut step = Map::new();
                let question = asked.as_ref().map_or(String::new(), |q| {
                    plain(q["text"].as_str().unwrap_or("")).replace('\n', "")
                });
                step.insert("demand".into(), json!(question));
                if let Some(by) = asked
                    .as_ref()
                    .and_then(|q| q["say"].as_str())
                    .filter(|s| !s.is_empty())
                {
                    step.insert("by".into(), json!(by));
                }
                step.insert("present".into(), json!({}));
                steps.push(Value::Object(step));
                demand = Some(Demand {
                    pos: steps.len() - 1,
                    present: Map::new(),
                    wrong_from: steps.len(),
                });
                continue;
            }
            _ => {}
        }
        // 指紋の照合（<E561> で人物を選ばせ、<E226 種類 番号 ラベル> が正解。外れは自分に戻る）もつきつけ要求にする
        if name == "E226" && demand.is_none() {
            steps.push(json!({"demand": "照合する相手を選ぶ", "present": {}}));
            demand = Some(Demand {
                pos: steps.len() - 1,
                present: Map::new(),
                wrong_from: steps.len(),
            });
        }
        if let Some(d) = demand
            .as_mut()
            .filter(|_| matches!(name, "E225" | "E226" | "E255"))
        {
            let id = ctx.record_id(a(0), a(1));
            if let Some(id) = id {
                let jumped = ctx.jump(a(2));
                d.present.insert(id, json!(jumped));
                if let Some(s) = steps.get_mut(d.pos) {
                    s["present"] = Value::Object(d.present.clone());
                }
            }
            d.wrong_from = steps.len();
            continue;
        }
        // みぬく（<E177 開始 成功 やめる 外れ>）: 開始の台詞の後、成功・やめる・外れの先を選ぶ
        if name == "E177" && args.len() >= 4 && ctx.perceive_choice() {
            steps.push(native("perceive", &[]));
            steps.extend(ctx.jump(a(0)));
            steps.push(json!({"choice": [
                {"text": "みぬく（正解）", "then": ctx.jump(a(1))},
                {"text": "やめる", "then": ctx.jump(a(2))},
                {"text": "みぬく（はずれ）", "then": ctx.jump(a(3))},
            ]}));
            continue;
        }
        if name == "E558" && args.len() >= 3 {
            fingerprint = Some((steps.len(), args.iter().take(4).copied().collect()));
            continue;
        }
        if name == "E004" && demand.is_some() && is_self(a(0)) {
            continue;
        }
        if name == "E307" {
            if let Some(pick) = ctx.point_out(self_label) {
                steps.push(pick);
                continue;
            }
        }
        // 証拠品を 3D で調べる（<E293>、<E327 2 所 ラベル>… <E004 自分>）。当たりの範囲は台本に無いので、所ごとの選択肢にする
        // 所を並べた後に台詞があれば、それはほかの所を調べたとき（外れ）
        if name == "E327" {
            if spots.is_empty() {
                spots_from = steps.len();
            }
            spots.push(json!({"text": ctx.spot_name(a(2), a(1)), "then": ctx.jump(a(2))}));
            continue;
        }
        if name == "E004" && !spots.is_empty() {
            let miss: Vec<Step> = steps.split_off(spots_from.min(steps.len()));
            let back = is_self(a(0));
            let mut miss_then = miss.clone();
            if !back {
                miss_then.extend(ctx.jump(a(0)));
            }
            let mut options = std::mem::take(&mut spots);
            if !miss.is_empty() || !back {
                options.push(json!({"text": "ほかの所", "then": miss_then}));
            }
            steps.push(native("examine3d", &[]));
            steps.push(json!({"choice": options}));
            if back {
                steps.extend(ctx.jump(a(0)));
            }
            continue;
        }
        // <E051 a b>… で条件のフラグを並べ、<E050 値 ラベル> ですべてが値なら飛ぶ
        if name == "E051" {
            let f = flag_name(a(0), a(1));
            ctx.state().add_flag(&f);
            conds.push(f);
            continue;
        }
        if name == "E050" && !conds.is_empty() {
            let cond = conds
                .iter()
                .map(|f| {
                    if a(0) != 0 {
                        f.clone()
                    } else {
                        format!("not {f}")
                    }
                })
                .collect::<Vec<_>>()
                .join(" and ");
            steps.push(json!({"if": cond, "then": ctx.jump(a(1))}));
            conds.clear();
            continue;
        }
        if let Some(done) = control(ctx, name, args) {
            steps.extend(done);
            continue;
        }
        ctx.state().count(format!("ステップ {name}"));
        steps.push(native(name, args));
    }
    finish(&mut line, &mut steps, false);
    if let Some((at, labels)) = fingerprint {
        // ここから先は指紋が検出できたとき。失敗するとゲームが登録したハンドラの台詞に入り、終わると遊びに戻る
        let ok = steps.split_off(at.min(steps.len()));
        let fail = [
            "指紋のない所を調べる",
            "粉が多すぎる",
            "粉が足りない",
            "指以外の所を調べる",
        ];
        let mut opts = vec![json!({"text": "指紋を検出できた", "then": ok})];
        for (i, l) in labels.iter().enumerate() {
            opts.push(json!({"text": fail[i], "then": ctx.jump(*l)}));
        }
        steps.push(json!({"choice": opts}));
    }
    if let Some(d) = demand {
        let wrong = steps.split_off(d.wrong_from.min(steps.len()));
        if let Some(s) = steps.get_mut(d.pos) {
            s["wrong"] = json!(wrong);
        }
    }
    steps
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_removes_directives_but_keeps_escaped_brackets() {
        assert_eq!(plain("な、[wait 8]なんですと[[x]"), "な、なんですと[");
        assert_eq!(plain("[[abc]"), "[");
        assert_eq!(plain("a[b"), "a[b");
    }

    #[test]
    fn char_ids_follow_the_name_table_labels() {
        let e = |l: &str| NameEntry {
            label: l.into(),
            name: "x".into(),
        };
        assert_eq!(char_id(&e("NAME201_0")), "p201");
        assert_eq!(char_id(&e("NAME202_1")), "p202_1");
        assert_eq!(char_id(&e("NAME217")), "p217");
    }
}
