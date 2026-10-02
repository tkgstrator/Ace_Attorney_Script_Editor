use super::*;

/// 流れ・フラグ・法廷記録の命令。当てはまらなければ None
pub(super) fn control(ctx: &dyn Ctx, name: &str, args: &[i64]) -> Option<Vec<Step>> {
    let a = |i| arg(args, i);
    Some(match name {
        "E004" => ctx.jump(a(0)),
        "E039" => ctx.end(),
        "E031" => ctx.script(a(0), a(1)),
        "E393" => ctx.free_roam(a(0), a(1)),
        "E392" => {
            let f = flag_name(a(0), a(1));
            ctx.state().add_flag(&f);
            ctx.end_flag(&f);
            vec![]
        }
        "E386" => {
            ctx.map_place(a(1));
            vec![]
        }
        "E377" | "E378" => ctx.topics(name == "E378", args),
        "E394" => ctx.end_invest(),
        "E026" => ctx.call_local(a(0)),
        "E052" => {
            let (chap, scene) = ctx.hub()?;
            if a(1) == chap && a(2) == scene {
                ctx.jump(a(3))
            } else {
                vec![]
            }
        }
        "E028" | "E029" => {
            let f = flag_name(a(0), a(1));
            ctx.state().add_flag(&f);
            vec![json!({"set": {f: name == "E028"}})]
        }
        "E030" => {
            let f = flag_name(a(0), a(1));
            ctx.state().add_flag(&f);
            let cond = if a(2) != 0 { f } else { format!("not {f}") };
            vec![json!({"if": cond, "then": ctx.jump(a(3))})]
        }
        "E245" => {
            let f = ctx.reveal(a(0))?;
            vec![json!({"set": {f: true}})]
        }
        "E249" => vec![json!({"random": args.iter().map(|&n| ctx.jump(n)).collect::<Vec<_>>()})],
        // <E022 使う ラベル …>: 使う（1）ラベルの中から選ぶ。最後の「0 ラベル」は 1 つ前と同じ行き先の番兵
        "E022" => {
            let mut to: Vec<i64> = Vec::new();
            let mut i = 0;
            while i + 1 < args.len() {
                if args[i] == 1 && !to.contains(&args[i + 1]) {
                    to.push(args[i + 1]);
                }
                i += 2;
            }
            if to.is_empty() {
                return None;
            }
            vec![json!({"random": to.iter().map(|&n| ctx.jump(n)).collect::<Vec<_>>()})]
        }
        // 法廷記録に加える（<E107 種類 番号 ?>）/ 差し替える（<E106 種類 旧 新>）。<E101> は native で残す
        "E107" => match ctx.record_id(a(0), a(1)) {
            Some(id) => vec![json!({(if a(0) == 0 { "give" } else { "giveProfile" }): id})],
            None => vec![],
        },
        "E103" => vec![],
        "E106" => {
            let (from, to) = (ctx.record_id(a(0), a(1)), ctx.record_id(a(0), a(2)));
            match (from, to) {
                (Some(f), Some(t)) if f != t => {
                    if a(0) == 0 {
                        vec![json!({"take": f}), json!({"give": t})]
                    } else {
                        vec![json!({"takeProfile": f}), json!({"giveProfile": t})]
                    }
                }
                _ => vec![],
            }
        }
        "E060" => {
            let id = ctx.record_id(a(0), a(1))?;
            if a(0) != 0 {
                return None;
            }
            vec![json!({"showEvidence": id})]
        }
        "E061" => vec![json!({"showEvidence": null})],
        "E279" => vec![json!({"lifeRisk": a(0)})],
        "E284" => vec![json!({"penalty": a(0)})],
        "E285" => vec![json!({"gameover": true})],
        "E003" => vec![json!({"wait": a(0)})],
        "E604" => vec![json!({"bgm": bgm_id(a(0))})],
        "E605" => vec![json!({"bgm": null})],
        _ => return None,
    })
}
