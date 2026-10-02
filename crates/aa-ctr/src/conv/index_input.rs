//! YAML 変換の入力（台本・番号表・話題・フラグ）の読み方。

use super::*;

pub(super) fn root_from(root: &Path) -> PathBuf {
    // assets/extracted-rs/aa6 → assets
    root.parent()
        .and_then(Path::parent)
        .unwrap_or(root)
        .join("extracted/aa6/converted")
}

pub(super) fn script_table_file(n: i64) -> String {
    format!("APP_PARAM_ID_SCRIPT_{n:0>2}.prp")
}

pub(super) fn script_tables(
    root: &Path,
    ep: i64,
    current: Vec<Option<String>>,
) -> crate::Result<HashMap<i64, Vec<Option<String>>>> {
    let mut out = HashMap::new();
    out.insert(ep, current);
    for (n, name) in [(11, "CHR"), (12, "BG")] {
        out.insert(
            n,
            load_script_ids(
                &root
                    .join("romfs/table")
                    .join(format!("APP_PARAM_ID_SCRIPT_{name}.prp")),
            )?,
        );
    }
    Ok(out)
}

pub(super) fn story_files(dir: &Path, sce: &str) -> crate::Result<(Vec<String>, Vec<String>)> {
    let story_re = regex::Regex::new(r"_c[0-9]{3}_[0-9]{4}_jpn\.txt$").expect("re");
    let load_re = regex::Regex::new(r"^L_(INIT|LOAD)(_[0-9]+)?$").expect("re");
    let mut all: Vec<String> = fs::read_dir(dir)
        .map_err(|e| format!("{}: {e}", dir.display()))?
        .flatten()
        .filter_map(|e| e.file_name().to_str().map(str::to_string))
        .filter(|f| f.starts_with(&format!("_{sce}_")) && story_re.is_match(f))
        .collect();
    all.sort();
    let mut files = Vec::new();
    for f in &all {
        let entries = read_gmd_text(&dir.join(f))?;
        if entries
            .iter()
            .any(|e| e.label.as_deref().is_some_and(|l| !load_re.is_match(l)))
        {
            files.push(f.clone());
        }
    }
    Ok((all, files))
}

pub(super) fn short_of(sce: &str, f: &str) -> String {
    f.replacen(&format!("_{sce}_"), "", 1)
        .trim_end_matches("_jpn.txt")
        .to_string()
}

/// 選択肢の文は全話の通し番号。表の枠（途中の空きも 1 枠）が番号に順に並ぶ
pub(super) fn choice_meta(
    dir: &Path,
    files: &[String],
    own: &[Entry],
) -> crate::Result<(Option<usize>, Option<i64>)> {
    let mut used = Vec::new();
    let re = regex::Regex::new(r"<E222 ([0-9]+)").expect("re");
    for f in files {
        let text = fs::read_to_string(dir.join(f)).map_err(|e| e.to_string())?;
        used.extend(
            re.captures_iter(&text)
                .filter_map(|m| m[1].parse::<i64>().ok()),
        );
    }
    let base = used.into_iter().filter(|&n| n >= 12).min();
    let first = own.iter().position(|e| e.label().starts_with("CHOICE"));
    Ok((first, base))
}

/// 話題の番号 → 名前。場所の台本の <E377>・<E378> で出る最小番号が表の先頭
pub(super) fn topic_data(dir: &Path, sce: &str) -> crate::Result<(Option<i64>, Vec<Entry>)> {
    let mut ids = Vec::new();
    let re1 = regex::Regex::new(r"<E377 [0-9]+ ([0-9]+) ").expect("re");
    let re2 = regex::Regex::new(r"<E378 [0-9]+ ([0-9]+) ([0-9]+) ").expect("re");
    for e in fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        let f = e.file_name().to_string_lossy().into_owned();
        if !f.starts_with(&format!("_{sce}_bg")) {
            continue;
        }
        let text = fs::read_to_string(e.path()).map_err(|e| e.to_string())?;
        ids.extend(
            re1.captures_iter(&text)
                .filter_map(|m| m[1].parse::<i64>().ok()),
        );
        for m in re2.captures_iter(&text) {
            ids.extend([m[1].parse().unwrap_or(0), m[2].parse().unwrap_or(0)]);
        }
    }
    let path = dir
        .parent()
        .and_then(Path::parent)
        .unwrap_or(dir)
        .join(format!("msg/topic_{sce}_jpn.txt"));
    let entries = if ids.is_empty() || !path.exists() {
        vec![]
    } else {
        read_gmd_text(&path)?
    };
    Ok((ids.into_iter().min(), entries))
}

/// 進み具合のフラグが、物語のファイルのどこで最初に立つか。物語の外でも立つなら other とする
pub(super) fn flags(
    dir: &Path,
    story: &[String],
) -> crate::Result<(HashMap<String, usize>, HashSet<String>)> {
    let mut first: HashMap<String, usize> = HashMap::new();
    let mut other = HashSet::new();
    let re = regex::Regex::new(r"<E028 ([0-9]+) ([0-9]+)>").expect("re");
    for e in fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        let f = e.file_name().to_string_lossy().into_owned();
        let idx = story
            .iter()
            .position(|s| f.ends_with(&format!("_{s}_jpn.txt")));
        let text = fs::read_to_string(e.path()).map_err(|e| e.to_string())?;
        for m in re.captures_iter(&text) {
            let flag = format!("f{}_{}", &m[1], &m[2]);
            match idx {
                Some(i) => {
                    first
                        .entry(flag)
                        .and_modify(|x| *x = (*x).min(i))
                        .or_insert(i);
                }
                None => {
                    other.insert(flag);
                }
            }
        }
    }
    Ok((first, other))
}

/// つながないファイルの法廷記録の増減を、その前の（無ければ後の）つなぐファイルに移す
pub(super) fn move_skipped_gains(
    mut gains: HashMap<String, Vec<Step>>,
    all: &[String],
    kept: &HashSet<String>,
) -> HashMap<String, Vec<Step>> {
    for (i, f) in all.iter().enumerate() {
        if kept.contains(f) {
            continue;
        }
        let Some(g) = gains.remove(f) else { continue };
        let to = all[..i]
            .iter()
            .rev()
            .find(|x| kept.contains(*x))
            .or_else(|| all[i..].iter().find(|x| kept.contains(*x)));
        if let Some(to) = to {
            gains.entry((*to).clone()).or_default().extend(g);
        }
    }
    gains
}
