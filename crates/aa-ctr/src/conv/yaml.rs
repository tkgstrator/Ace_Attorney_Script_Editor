//! シナリオ YAML の書き出し（依存を増やさない自作）。読む側（yaml パッケージ）が同じ意味に読めることが基準。
//! 文字列は JSON の二重引用符形式（YAML の二重引用符と互換）、数だけの配列は `[ 1, 2 ]` の 1 行、空は `[]`・`{}`。

use serde_json::Value;

pub const HEADER: &str = "# 元の台本から tools/convert/ で自動生成したもの。手で直さず、変換を直して作り直すこと。\n\
# 元のゲームの文を含むので、手元で遊ぶためだけに使い、配布しないこと（assets/extracted/ は git の対象外）。\n\n";

fn quote(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_default()
}

fn key(k: &str) -> String {
    let plain = !k.is_empty()
        && k.chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        && !matches!(
            k.to_ascii_lowercase().as_str(),
            "true" | "false" | "null" | "yes" | "no" | "on" | "off" | "y" | "n"
        );
    if plain {
        k.to_string()
    } else {
        quote(k)
    }
}

fn is_num_seq(a: &[Value]) -> bool {
    !a.is_empty() && a.iter().all(Value::is_number)
}

/// 1 行で書けるもの（None なら複数行）
fn inline(v: &Value) -> Option<String> {
    match v {
        Value::Null => Some("null".into()),
        Value::Bool(b) => Some(b.to_string()),
        Value::Number(n) => Some(n.to_string()),
        Value::String(s) => Some(quote(s)),
        Value::Array(a) if a.is_empty() => Some("[]".into()),
        Value::Array(a) if is_num_seq(a) => {
            let items: Vec<String> = a.iter().map(|x| x.to_string()).collect();
            Some(format!("[ {} ]", items.join(", ")))
        }
        Value::Object(m) if m.is_empty() => Some("{}".into()),
        _ => None,
    }
}

fn write_map(m: &serde_json::Map<String, Value>, indent: usize, out: &mut String) {
    let pad = " ".repeat(indent);
    for (k, v) in m {
        // 未定義（JS の undefined）に当たるものは書かない
        out.push_str(&format!("{pad}{}:", key(k)));
        match inline(v) {
            Some(s) => {
                out.push(' ');
                out.push_str(&s);
                out.push('\n');
            }
            None => {
                out.push('\n');
                write_block(v, indent + 2, out);
            }
        }
    }
}

fn write_seq(a: &[Value], indent: usize, out: &mut String) {
    let pad = " ".repeat(indent);
    for item in a {
        match inline(item) {
            Some(s) => out.push_str(&format!("{pad}- {s}\n")),
            None => {
                let mut sub = String::new();
                write_block(item, indent + 2, &mut sub);
                // 先頭行の字下げを「- 」に置き換える
                out.push_str(&pad);
                out.push_str("- ");
                out.push_str(&sub[indent + 2..]);
            }
        }
    }
}

fn write_block(v: &Value, indent: usize, out: &mut String) {
    match v {
        Value::Object(m) => write_map(m, indent, out),
        Value::Array(a) => write_seq(a, indent, out),
        other => {
            out.push_str(&" ".repeat(indent));
            out.push_str(&inline(other).unwrap_or_default());
            out.push('\n');
        }
    }
}

pub fn to_yaml(v: &Value) -> String {
    let mut out = String::from(HEADER);
    write_block(v, 0, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn writes_blocks_flow_numbers_and_quotes() {
        let v = json!({
            "id": "ep1",
            "n": 3,
            "steps": [{"native": "E147", "args": [1, 5]}, {"p000": "a\nb\"c"}, [1, 2], []],
            "empty": {},
            "if": null
        });
        let y = to_yaml(&v);
        assert!(y.contains("id: \"ep1\"\n"));
        assert!(y.contains("  - native: \"E147\"\n    args: [ 1, 5 ]\n"));
        assert!(y.contains("  - p000: \"a\\nb\\\"c\"\n"));
        assert!(y.contains("  - [ 1, 2 ]\n  - []\n"));
        assert!(y.contains("empty: {}\nif: null\n"));
    }

    #[test]
    fn nested_sequences_and_maps_indent() {
        let v = json!({"a": [[{"x": 1}, {"y": [{"z": true}]}]]});
        let y = to_yaml(&v);
        // 入れ子を落とさず書く（具体的な字下げは実装の契約にしない）
        assert!(y.contains("a:\n"));
        assert!(y.contains("x: 1\n"));
        assert!(y.contains("z: true\n"));
    }
}
