//! `script/**/*.txt`（aa-ctr の script 手順の出力）を読む。形: 1 行目 "# もとのファイル"、以降 "== 番号 ラベル" の行と
//! その文（改行を含むことがある）の繰り返し。文は命令（<E041 1 0>、<PAGE> など）と文字に分けて扱う。

use regex::Regex;
use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;
use unicode_normalization::UnicodeNormalization;

#[derive(Clone, Debug)]
pub struct Entry {
    pub label: Option<String>,
    pub text: String,
}

impl Entry {
    pub fn label(&self) -> &str {
        self.label.as_deref().unwrap_or("")
    }
}

fn nfkc(s: &str) -> String {
    s.nfkc().collect()
}

pub fn parse_gmd_text(content: &str) -> Vec<Entry> {
    let content = content.replace("\r\n", "\n");
    let mut out: Vec<Entry> = Vec::new();
    let mut cur: Option<(Option<String>, Vec<&str>)> = None;
    let flush = |cur: Option<(Option<String>, Vec<&str>)>, out: &mut Vec<Entry>| {
        if let Some((label, lines)) = cur {
            out.push(Entry {
                label,
                text: lines.join("\n"),
            });
        }
    };
    for line in content.split('\n').skip(1) {
        if let Some((n, label)) = header(line) {
            if n == out.len() + usize::from(cur.is_some()) {
                flush(cur.take(), &mut out);
                cur = Some((label.map(|l| nfkc(&l)), Vec::new()));
                continue;
            }
        }
        if let Some((_, lines)) = cur.as_mut() {
            lines.push(line);
        }
    }
    if let Some((label, mut lines)) = cur.take() {
        if lines.last() == Some(&"") {
            lines.pop();
        }
        flush(Some((label, lines)), &mut out);
    }
    out
}

/// `== 12 L_MAIN`（ラベルは無いこともある）→ (12, ラベル)
fn header(line: &str) -> Option<(usize, Option<String>)> {
    let rest = line.strip_prefix("== ")?;
    let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
    if digits == 0 {
        return None;
    }
    let n: usize = rest[..digits].parse().ok()?;
    match &rest[digits..] {
        "" => Some((n, None)),
        r if r.starts_with(' ') => Some((n, Some(r[1..].to_string()))),
        _ => None,
    }
}

pub fn read_gmd_text(path: &Path) -> crate::Result<Vec<Entry>> {
    let content = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(parse_gmd_text(&content))
}

/// ラベル → 文（同じラベルは後のもの）
pub fn label_map(entries: &[Entry]) -> HashMap<String, String> {
    let mut m = HashMap::new();
    for e in entries {
        if let Some(l) = e.label.as_deref().filter(|l| !l.is_empty()) {
            m.insert(l.to_string(), e.text.clone());
        }
    }
    m
}

#[derive(Clone, Debug)]
pub enum Token {
    Text(String),
    Cmd {
        name: String,
        args: Vec<i64>,
        label: Option<String>,
    },
}

impl Token {
    pub fn name(&self) -> Option<&str> {
        match self {
            Token::Cmd { name, .. } => Some(name),
            Token::Text(_) => None,
        }
    }
    pub fn is_cmd(&self, n: &str) -> bool {
        self.name() == Some(n)
    }
    pub fn args(&self) -> &[i64] {
        match self {
            Token::Cmd { args, .. } => args,
            Token::Text(_) => &[],
        }
    }
}

/// 引数（無ければ、範囲外の番号にして「未定義」の扱いに近づける）
pub fn arg(args: &[i64], i: usize) -> i64 {
    args.get(i).copied().unwrap_or(-1)
}

fn half(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '０'..='９' => char::from(b'0' + (c as u32 - '０' as u32) as u8),
            _ => c,
        })
        .collect()
}

fn token_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"<(E[0-9]+|[A-Z]+)((?: -?[0-9０-９]+)*)(?: ([A-Za-zＡ-Ｚａ-ｚ_][A-Za-z0-9_０-９Ａ-Ｚａ-ｚ＿]*))?>",
        )
        .expect("token regex")
    })
}

/// 文を命令と文字に分ける。6 には引数が全角数字の命令（<E025 ８>）が少しある。
/// <E033 話 番号 ラベル> だけは最後の引数がラベルの名前（label に入れる）
pub fn tokenize(text: &str) -> Vec<Token> {
    let mut out = Vec::new();
    let mut last = 0;
    for m in token_re().captures_iter(text) {
        let whole = m.get(0).expect("whole match");
        if whole.start() > last {
            out.push(Token::Text(text[last..whole.start()].to_string()));
        }
        let args = half(m.get(2).map_or("", |x| x.as_str()));
        let args = args.trim();
        out.push(Token::Cmd {
            name: m[1].to_string(),
            args: if args.is_empty() {
                Vec::new()
            } else {
                args.split(' ').map(|x| x.parse().unwrap_or(0)).collect()
            },
            label: m.get(3).map(|x| nfkc(x.as_str())),
        });
        last = whole.end();
    }
    if last < text.len() {
        out.push(Token::Text(text[last..].to_string()));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_entries_with_and_without_labels() {
        let e = parse_gmd_text("# f\n== 0 L_MAIN\nabc\ndef\n== 1\nxyz\n");
        assert_eq!(e.len(), 2);
        assert_eq!(e[0].label(), "L_MAIN");
        assert_eq!(e[0].text, "abc\ndef");
        assert_eq!(e[1].label, None);
        assert_eq!(e[1].text, "xyz");
    }

    #[test]
    fn a_header_looking_line_out_of_order_is_text() {
        let e = parse_gmd_text("# f\n== 0 A\n== 7 x\nq\n");
        assert_eq!(e.len(), 1);
        assert_eq!(e[0].text, "== 7 x\nq");
    }

    #[test]
    fn tokenizes_commands_labels_and_fullwidth_args() {
        let t = tokenize("あ<E025 ８>い<E033 0 5 L_X><PAGE>");
        assert!(matches!(&t[0], Token::Text(s) if s == "あ"));
        assert_eq!(t[1].args(), &[8]);
        match &t[3] {
            Token::Cmd { name, args, label } => {
                assert_eq!(name, "E033");
                assert_eq!(args, &[0, 5]);
                assert_eq!(label.as_deref(), Some("L_X"));
            }
            _ => panic!(),
        }
        assert!(t[4].is_cmd("PAGE"));
    }
}
