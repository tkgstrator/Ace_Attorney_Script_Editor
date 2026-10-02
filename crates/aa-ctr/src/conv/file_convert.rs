use super::*;

pub fn convert_file(conv: &Conv, entries: &[Entry], file: &str, next: Option<&str>) -> FileResult {
    let blocks: Vec<Vec<Token>> = entries.iter().map(|e| tokenize(&e.text)).collect();
    let exam = find_exam(&blocks);
    let entry = main_label(entries);
    let id_of = |f: &str, l: &str| scene_id(f, l, &entry);
    let label_at = |n: usize| {
        entries
            .get(n)
            .map(|e| e.label().to_string())
            .filter(|l| !l.is_empty())
    };
    let testimony = exam
        .as_ref()
        .map(|e| id_of(file, &label_at(e.start).unwrap_or_default()));
    let msgs: HashSet<i64> = exam
        .iter()
        .flat_map(|e| e.statements.iter().map(|s| s.msg))
        .collect();
    let mut reveal_flag: HashMap<i64, String> = HashMap::new();
    if let Some(e) = &exam {
        for s in e.statements.iter().filter(|s| s.hidden) {
            reveal_flag.insert(s.msg, format!("{file}_open{}", s.flag));
        }
    }
    for f in reveal_flag.values() {
        conv.st.add_flag(f);
    }
    let choices_at = find_choices_at(&blocks);
    // 法廷記録の増減はふつうファイルの終わりで行うが、このファイルの中で求める物が含まれるなら始めで行う
    let gains = conv.gains.get(file).cloned().unwrap_or_default();
    let early = needs_gain(&blocks, &gains, conv);
    let f = FileConv {
        conv,
        entries,
        file: file.to_string(),
        next: next.map(str::to_string),
        blocks,
        exam,
        entry: entry.clone(),
        testimony,
        reveal_flag,
        choices_at,
        at_end: if early { vec![] } else { gains.clone() },
        inlined: RefCell::default(),
        calling: RefCell::default(),
        map_places: RefCell::default(),
        end_flags: RefCell::default(),
        pending: RefCell::default(),
        file_re: Regex::new(r"^c([0-9]+)_([0-9]+)$").expect("re"),
    };
    let ctx0 = |stack: Option<Vec<usize>>| FCtx { f: &f, stack };
    let mut scenes: BTreeMap<usize, Value> = BTreeMap::new();

    if let Some(exam) = &f.exam {
        let inline = |n: i64| ctx0(Some(vec![])).jump(n);
        let title = testimony_title(&f.blocks);
        let mut witness: Option<String> = None;
        let mut statements: Vec<Value> = Vec::new();
        for (i, s) in exam.statements.iter().enumerate() {
            let msg = usize::try_from(s.msg).unwrap_or(usize::MAX);
            let empty: Vec<Token> = vec![];
            let tokens = f.blocks.get(msg).unwrap_or(&empty);
            let converted = convert_block(tokens, &ctx0(Some(vec![msg])), None);
            let (speaker, text) = statement_line(tokens, &converted);
            if let Some(sp) = speaker {
                if let Some(who) = usize::try_from(sp).ok().and_then(|x| conv.names.get(x)) {
                    witness.get_or_insert_with(|| char_id(who));
                    conv.st.used_names.borrow_mut().insert(sp as usize);
                }
            }
            let answer = if s.correct != s.wrong {
                exam.answer(s.correct)
            } else {
                None
            };
            let answer_id = answer.and_then(|(k, x)| conv.record_id(k, x));
            if answer_id.is_some() {
                f.push_pending(s.correct as usize);
            }
            let mut o = Map::new();
            o.insert("id".into(), json!(format!("s{}", i + 1)));
            o.insert("text".into(), json!(text));
            if s.hidden {
                if let Some(w) = f.reveal_flag.get(&s.msg) {
                    o.insert("when".into(), json!(w));
                }
            }
            // ゆさぶれない証言（<E414>）は、何もしないゆさぶりにする
            let press = match s.press {
                Some(p) => inline(p),
                None => vec![json!({"native": "unpressable", "args": []})],
            };
            o.insert("press".into(), json!(press));
            if let Some(aid) = answer_id {
                let to = f.id_of(f.label_of(s.correct).unwrap_or(""));
                o.insert("present".into(), json!({aid: [{"goto": to}]}));
            }
            statements.push(Value::Object(o));
        }
        // 「相談する」（L_ASSIST）はゲームのボタンで入る。証言をひと巡りしたところで相談するかどうかを聞く
        let assist_re = Regex::new(r"^L_ASSIST(_[0-9]+)?$").expect("re");
        let assists: Vec<usize> = entries
            .iter()
            .enumerate()
            .filter(|(_, e)| assist_re.is_match(e.label()))
            .map(|(k, _)| k)
            .collect();
        for &k in &assists {
            f.push_pending(k);
        }
        let consult: Vec<Value> = if assists.is_empty() {
            vec![]
        } else {
            let mut opts: Vec<Value> = assists
                .iter()
                .enumerate()
                .map(|(i, &k)| {
                    json!({
                        "text": if assists.len() > 1 { format!("相談する（{}）", i + 1) } else { "相談する".to_string() },
                        "then": [{"goto": f.id_of(entries[k].label())}],
                    })
                })
                .collect();
            opts.push(json!({"text": "続ける"}));
            vec![json!({"choice": opts})]
        };
        let mut sc = Map::new();
        let t = title.map_or("証言".to_string(), |t| {
            let p = plain(&t);
            let p = p.strip_prefix('～').unwrap_or(&p);
            p.strip_suffix('～').unwrap_or(p).to_string()
        });
        sc.insert("testimony".into(), json!(t));
        if let Some(w) = witness {
            sc.insert("witness".into(), json!(w));
        }
        sc.insert("statements".into(), json!(statements));
        if exam.follow.is_some() || !consult.is_empty() {
            let mut l: Vec<Step> = exam.follow.map(&inline).unwrap_or_default();
            l.extend(consult);
            sc.insert("loop".into(), json!(l));
        }
        sc.insert("wrong".into(), json!(inline(exam.statements[0].wrong)));
        scenes.insert(exam.start, Value::Object(sc));
    }

    let main = entries.iter().position(|e| e.label() == entry);
    let reachable = main
        .map(|m| reachable_from(&f.blocks, m))
        .unwrap_or_default();
    let order: Vec<usize> = main
        .into_iter()
        .chain((0..entries.len()).filter(|k| Some(*k) != main))
        .collect();
    // <MCRS 種類 ? n> ～ <MCRE …> の間の台詞は、ラベル n（L_KAISOU・L_MATOME）にも写してある。話の流れには入らない写し
    let mut copies: HashSet<i64> = HashSet::new();
    for b in &f.blocks {
        for t in b {
            if t.is_cmd("MCRS") && t.args().first() != Some(&14) {
                let n = t.args().get(2).copied().unwrap_or(-1);
                let l = f.label_of(n).unwrap_or("");
                if (l.contains("KAISOU") || l.contains("MATOME")) && !l.ends_with("END") {
                    copies.insert(n);
                }
            }
        }
    }
    for &k in &order {
        if !skip_label(label_at(k).as_deref())
            && !msgs.contains(&(k as i64))
            && !f.exam.as_ref().is_some_and(|e| e.resume.contains(&k))
            && !f.inlined.borrow().contains(&k)
            && !copies.contains(&(k as i64))
        {
            f.push_pending(k);
        }
    }
    let title_text = testimony_title(&f.blocks);
    let po_start_re = Regex::new(r"^L_PO_START(_[0-9]+)?$").expect("re");
    loop {
        let Some(k) = f.pending.borrow_mut().pop_front() else {
            break;
        };
        if scenes.contains_key(&k) || skip_label(label_at(k).as_deref()) {
            continue;
        }
        scenes.insert(k, json!([]));
        let label = label_at(k).unwrap_or_default();
        let is_title = |s: &Step| {
            title_text.as_ref().is_some_and(|t| {
                s.get("say").is_some_and(Value::is_null)
                    && s.get("text")
                        .and_then(Value::as_str)
                        .is_some_and(|x| plain(x).trim() == plain(t).trim())
            })
        };
        // 遊びの入口（ヒント・やり直し・外れとの輪は台本の外の遊びで抜けるので、遊びの代わりを置く）
        let game = match label.as_str() {
            "L_SPIRIT" => Some("spirit_vision"),
            "L_PO_START" => Some("point_out"),
            _ => None,
        };
        let lp = f.loop_game(&label);
        let is_po = po_start_re.is_match(&label);
        let po = if is_po { f.po_success(&label) } else { None };
        let po_idx = if is_po {
            f.point_out_index(Some(k))
        } else {
            None
        };
        let seance_k = if label == "L_SPIRIT" {
            f.seance_steps()
        } else {
            None
        };
        let bare = f.blocks[k].iter().all(|t| match t {
            Token::Text(s) => s.trim().is_empty(),
            Token::Cmd { name, .. } => ["RDFG", "E800", "E001"].contains(&name.as_str()),
        });
        // 入口から行けない探偵パートの始まりは、ゲームが入らないので場所ごと変換しない
        let dead_dtc = label == "L_DTC_START" && main.is_some() && !reachable.contains(&k);
        let value: Value = if bare || dead_dtc {
            json!([])
        } else if po_idx.is_some_and(|p| f.conv.games.point_out(p).is_some()) {
            json!(convert_block(&f.blocks[k], &ctx0(None), Some(k)))
        } else if let Some(s) = seance_k {
            json!(s)
        } else if let Some(s) = is_po.then(|| f.po_by_flags(&label)).flatten() {
            json!(s)
        } else if let Some(p) = po {
            json!(f.solved(
                "point_out",
                &[p.as_str()],
                Some(&label.replacen("START", "CHECK", 1))
            ))
        } else if let Some(g) = game {
            json!(f.solved(g, &["L_MAIN2", "L_PO_OK"], None))
        } else if let Some((g, to, ng)) = lp {
            // みぬく: 台詞から正解の証言の行が決まるものは、行を選ぶ選択肢にする
            let pick = match ng.as_deref() {
                Some(n) if g == "perceive" => {
                    let (ok, ngs) = (f.go(&to), f.go(n));
                    conv.games.perceive(conv.ep, file, &ok, &ngs)
                }
                _ => None,
            };
            // 映像の指し示し: <E568 映像の点 ラベル> は、その点を選んだときの反応（終わると遊びに戻る）
            let wrongs: Vec<Vec<i64>> = if g == "point_out_movie" {
                f.blocks[k]
                    .iter()
                    .filter(|t| t.is_cmd("E568"))
                    .map(|t| t.args().to_vec())
                    .collect()
            } else {
                vec![]
            };
            if let Some(p) = pick {
                json!([p])
            } else if !wrongs.is_empty() {
                let ok = f.solved(g, &[to.as_str()], None);
                let mut opts = vec![json!({"text": "正解する", "then": ok[1..]})];
                for a in &wrongs {
                    let lab = f
                        .label_of(a.get(1).copied().unwrap_or(-1))
                        .unwrap_or("")
                        .to_string();
                    opts.push(json!({"text": format!("ほかの点を選ぶ（{}）", a.first().copied().unwrap_or(-1)), "then": f.go(&lab)}));
                }
                json!([ok[0].clone(), {"choice": opts}])
            } else {
                json!(f.solved(g, &[to.as_str()], ng.as_deref()))
            }
        } else {
            let steps: Vec<Step> = convert_block(&f.blocks[k], &ctx0(None), Some(k))
                .into_iter()
                .filter(|s| !is_title(s))
                .collect();
            json!(steps)
        };
        scenes.insert(k, value);
    }
    if let (Some(m), true) = (main, early) {
        if let Some(Value::Array(a)) = scenes.get_mut(&m) {
            let mut v = gains.clone();
            v.append(a);
            *a = v;
        }
    }
    let mut sorted: Vec<(usize, Value)> = scenes.into_iter().collect();
    sorted.sort_by(
        |(a, _), (b, _)| match (Some(*a) == main, Some(*b) == main) {
            (true, _) => std::cmp::Ordering::Less,
            (_, true) => std::cmp::Ordering::Greater,
            _ => a.cmp(b),
        },
    );
    let gameover = entries.iter().position(|e| e.label() == "L_GAMEOVER");
    let has_gameover = gameover.is_some_and(|g| sorted.iter().any(|(k, _)| *k == g));
    let orig_ref = referenced_labels(&f.blocks)
        .into_iter()
        .filter_map(|n| f.label_of(n).map(|l| f.id_of(l)))
        .collect();
    FileResult {
        scenes: sorted
            .iter()
            .map(|(k, s)| (f.id_of(entries[*k].label()), s.clone()))
            .collect(),
        gameover: has_gameover.then(|| f.id_of("L_GAMEOVER")),
        orig_ref,
    }
}
