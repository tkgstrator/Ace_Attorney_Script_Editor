//! 出力から、台本のほかの場面の写しや、変換で置き換えた遊びの中身でどこからも移らないシーンを落とす。
//! tools/convert/ctr/index.ts の dropRedundant の Rust 版。

use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

/// ステップが、そこから先の同じシーンの続きには進まない（移動・終わりで抜ける）か。選択肢・if はすべての枝が抜けるとき
fn terminates(step: &Value) -> bool {
    let Some(o) = step.as_object() else {
        return false;
    };
    if ["goto", "end", "gameover", "investigate"]
        .iter()
        .any(|k| o.contains_key(*k))
    {
        return true;
    }
    let all = |v: Option<&Value>| {
        v.and_then(Value::as_array)
            .is_some_and(|a| !a.is_empty() && terminates(a.last().expect("last")))
    };
    if let Some(c) = o.get("choice").and_then(Value::as_array) {
        return c.iter().all(|x| all(x.get("then")));
    }
    if o.contains_key("if") {
        return all(o.get("then")) && all(o.get("else"));
    }
    false
}

fn body(scenes: &Map<String, Value>, id: &str) -> Option<Vec<Value>> {
    let a = scenes.get(id)?.as_array()?;
    let a = if a.last().is_some_and(|x| x.get("goto").is_some()) {
        &a[..a.len() - 1]
    } else {
        a
    };
    Some(a.to_vec())
}

fn display_only(scenes: &Map<String, Value>, id: &str) -> bool {
    let Some(b) = body(scenes, id) else {
        return false;
    };
    let display = [
        "E118", "E119", "E120", "E121", "E140", "E141", "E142", "E144", "E145", "E147", "E149",
        "E152", "E153", "E157", "E158", "E088", "E525", "E526", "E527",
    ];
    !b.is_empty()
        && b.iter().any(|x| {
            x.get("native")
                .and_then(Value::as_str)
                .is_some_and(|n| display.contains(&n))
        })
        && b.iter().all(|x| {
            display.contains(&x.get("native").and_then(Value::as_str).unwrap_or(""))
                || ["give", "giveProfile", "take", "takeProfile"]
                    .iter()
                    .any(|k| x.get(*k).is_some())
        })
}

/// scenes を変える。where は goto と、暗黙の次のシーンを数える全てのマップ（story scenes, places, investigation scenes）。
pub fn drop_redundant(
    scenes: &mut Map<String, Value>,
    where_: &[Map<String, Value>],
    roots: &[Option<String>],
    orig_ref: &HashSet<String>,
    called: &HashSet<String>,
) {
    loop {
        let mut refs = HashSet::new();
        for w in where_ {
            let text = serde_json::to_string(w).unwrap_or_default();
            let re = regex::Regex::new(r#""goto":"([^"]+)""#).expect("re");
            refs.extend(re.captures_iter(&text).map(|m| m[1].to_string()));
            let ids: Vec<String> = w.keys().cloned().collect();
            for (i, id) in ids.iter().enumerate() {
                let Some(a) = w.get(id).and_then(Value::as_array) else {
                    continue;
                };
                if i + 1 < ids.len() && !a.last().is_some_and(terminates) {
                    refs.insert(ids[i + 1].clone());
                }
            }
        }
        let mut bodies: HashMap<String, HashSet<String>> = HashMap::new();
        for id in &refs {
            if let Some(b) = body(scenes, id) {
                if !b.is_empty() {
                    bodies
                        .entry(serde_json::to_string(&b).unwrap_or_default())
                        .or_default()
                        .insert(id.clone());
                }
            }
        }
        let gone: Vec<String> = scenes
            .keys()
            .filter(|id| !roots.iter().flatten().any(|r| r == *id) && !refs.contains(*id))
            .filter(|id| {
                let b = body(scenes, id).unwrap_or_default();
                let copy = !b.is_empty()
                    && bodies
                        .get(&serde_json::to_string(&b).unwrap_or_default())
                        .is_some_and(|s| s.iter().any(|x| x != *id));
                b.is_empty()
                    || display_only(scenes, id)
                    || copy
                    || regex::Regex::new(r"_spirit_(check|hint|no_hint|retry)(_\d+)?$")
                        .expect("re")
                        .is_match(id)
                    || orig_ref.contains(*id)
                    || (id.ends_with("_end") && !scenes.contains_key(id.trim_end_matches("_end")))
                    || called.contains(*id)
            })
            .cloned()
            .collect();
        if gone.is_empty() {
            return;
        }
        for id in gone {
            scenes.shift_remove(&id);
        }
    }
}
