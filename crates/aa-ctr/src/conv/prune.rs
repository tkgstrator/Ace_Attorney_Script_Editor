//! 変換した場所のステップから、その地点では絶対に成り立たない条件の枝を落とす（tools/convert/ctr/prune.ts の Rust 版）。
//! 場所の台本は話の全体で使い回されるので、進み具合のフラグで出す話題を切り替えている。今いる探偵パートより後のファイルでしか
//! 立たないフラグの枝は、その探偵パートでは通らない。通らない枝を残すと、整合性チェックの「たどり着かない」が場所ごとに増える。

use regex::Regex;
use serde_json::{Map, Value};
use std::collections::HashSet;

/// フラグが（この地点で）立ちうるか。分からないものは true
pub type Possible<'a> = &'a dyn Fn(&str) -> bool;

/// 条件式が決まれば Some(真偽)、決まらなければ None。書けるのは変換が作る `f` `not f` と、その or の並びだけ
pub fn eval_cond(cond: &Value, possible: Possible) -> Option<bool> {
    let s = cond.as_str()?;
    let s = if s.len() >= 2 && s.starts_with('(') && s.ends_with(')') {
        &s[1..s.len() - 1]
    } else {
        s
    };
    let lit = Regex::new(r"^(not )?([A-Za-z_][A-Za-z0-9_]*)$").expect("re");
    let mut unknown = false;
    for p in s.split(" or ") {
        let m = lit.captures(p.trim())?;
        let can = possible(&m[2]);
        if m.get(1).is_some() {
            // not f: f が立ちえなければ常に真
            if !can {
                return Some(true);
            }
            unknown = true;
        } else if can {
            unknown = true;
        }
    }
    if unknown {
        None
    } else {
        Some(false)
    }
}

fn prune_arr(arr: &[Value], possible: Possible) -> Vec<Value> {
    let mut out = Vec::new();
    for el in arr {
        if let Some(o) = el.as_object() {
            if let Some(cond) = o.get("if") {
                if let Some(c) = eval_cond(cond, possible) {
                    let branch = if c { o.get("then") } else { o.get("else") };
                    if let Some(Value::Array(b)) = branch {
                        out.extend(prune_arr(b, possible));
                    }
                    continue;
                }
            }
        }
        out.push(prune(el, possible));
    }
    out
}

/// ステップの木を写して、決まった条件の枝を落とす
pub fn prune(x: &Value, possible: Possible) -> Value {
    match x {
        Value::Array(a) => Value::Array(prune_arr(a, possible)),
        Value::Object(o) => {
            let mut m = Map::new();
            for (k, v) in o {
                m.insert(k.clone(), prune(v, possible));
            }
            Value::Object(m)
        }
        other => other.clone(),
    }
}

/// ステップの木の中で true にされるフラグ（`set: { f: true }`）
pub fn set_true(x: &Value, into: &mut HashSet<String>) {
    match x {
        Value::Array(a) => a.iter().for_each(|e| set_true(e, into)),
        Value::Object(o) => {
            if let Some(Value::Object(s)) = o.get("set") {
                for (f, v) in s {
                    if v == &Value::Bool(true) {
                        into.insert(f.clone());
                    }
                }
            }
            o.values().for_each(|v| set_true(v, into));
        }
        _ => {}
    }
}

/// 条件（`if` と `when`）に書かれている名前の集まり（フラグとは限らない名前も入る）
pub fn read_names(x: &Value, into: &mut HashSet<String>) {
    match x {
        Value::Array(a) => a.iter().for_each(|e| read_names(e, into)),
        Value::Object(o) => {
            let re = Regex::new(r"[A-Za-z_][A-Za-z0-9_]*").expect("re");
            for (k, v) in o {
                match (k.as_str(), v.as_str()) {
                    ("if" | "when", Some(s)) => {
                        for m in re.find_iter(s) {
                            into.insert(m.as_str().to_string());
                        }
                    }
                    _ => read_names(v, into),
                }
            }
        }
        _ => {}
    }
}

/// どの条件からも読まれないフラグへの `set` を落とす（書くだけのフラグは結果を変えない）。空になった `set` のステップも落とす
pub fn drop_unread_sets(x: &mut Value, read: &HashSet<String>) {
    match x {
        Value::Array(a) => {
            let mut i = a.len();
            while i > 0 {
                i -= 1;
                let only_set = a[i]
                    .as_object()
                    .is_some_and(|o| o.len() == 1 && o.get("set").is_some_and(Value::is_object));
                if only_set {
                    let set = a[i]["set"].as_object_mut().expect("set");
                    let dead: Vec<String> =
                        set.keys().filter(|f| !read.contains(*f)).cloned().collect();
                    for f in dead {
                        set.shift_remove(&f);
                    }
                    if set.is_empty() {
                        a.remove(i);
                        continue;
                    }
                }
                drop_unread_sets(&mut a[i], read);
            }
        }
        Value::Object(o) => o.values_mut().for_each(|v| drop_unread_sets(v, read)),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn eval_cond_decides_impossible_flags() {
        let possible = |f: &str| f != "f1_1";
        assert_eq!(eval_cond(&json!("f1_1"), &possible), Some(false));
        assert_eq!(eval_cond(&json!("not f1_1"), &possible), Some(true));
        assert_eq!(eval_cond(&json!("(f1_1 or f2_2)"), &possible), None);
        assert_eq!(eval_cond(&json!("a == 1"), &possible), None);
    }

    #[test]
    fn prune_keeps_the_decided_branch_in_place() {
        let possible = |f: &str| f != "f1_1";
        let steps = json!([{"a": 1}, {"if": "f1_1", "then": [{"x": 1}], "else": [{"y": 2}]}]);
        let out = prune(&steps, &possible);
        assert_eq!(out, json!([{"a": 1}, {"y": 2}]));
    }

    #[test]
    fn unread_sets_are_dropped() {
        let mut v = json!([{"set": {"a": true, "b": true}}, {"set": {"c": false}}, {"say": 1}]);
        let read: HashSet<String> = ["a".to_string()].into();
        drop_unread_sets(&mut v, &read);
        assert_eq!(v, json!([{"set": {"a": true}}, {"say": 1}]));
    }
}
