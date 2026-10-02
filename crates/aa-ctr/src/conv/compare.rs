//! TS 版との比較をしやすくするための、Rust の JSON から安定した JSON を出す補助。
//! YAML の表記（引用符・複数行文字列）は違っても、YAML を読み直した結果を深い順序で比べる。

use serde_json::Value;

/// JSON のキーの順序を無視して比較する（配列の順序は意味を持つので保つ）
pub fn same_json(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Null, Value::Null)
        | (Value::Bool(_), Value::Bool(_))
        | (Value::Number(_), Value::Number(_))
        | (Value::String(_), Value::String(_)) => a == b,
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(x, y)| same_json(x, y))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(k, v)| b.get(k).is_some_and(|w| same_json(v, w)))
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_ignore_order_but_arrays_do_not() {
        assert!(same_json(
            &json!({"a": 1, "b": [2, 3]}),
            &json!({"b": [2, 3], "a": 1})
        ));
        assert!(!same_json(&json!([1, 2]), &json!([2, 1])));
    }
}
