//! `aa-ctr --only yaml` の入口。script/・tables/・hit/・romfs/table/・exefs/code.bin を読んで第 1〜5 話の YAML を作る。
//! tools/convert/ctr/index.ts の Rust 版。出力先は指定しなければ `<out>/../../extracted/aa6/converted/epN.yaml`。

use super::block::{char_id, NameEntry, State};
use super::file::convert_file;
use super::gmd::{label_map, read_gmd_text, Entry};
use super::prune::{drop_unread_sets, read_names};
use super::record::{load_gains, load_record};
use super::tables::{load_code_tables, load_script_ids};
use super::{Conv, Step};
use serde_json::{json, Map, Value};
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

pub struct YamlArgs {
    /// aa-ctr の --out（例 assets/extracted-rs/aa6）
    pub root: PathBuf,
    /// None なら 1〜5
    pub episode: Option<i64>,
    /// None なら `assets/extracted/aa6/converted/epN.yaml`（root の祖先から推測）
    pub out: Option<PathBuf>,
}

#[path = "index_input.rs"]
mod input;
use input::*;

pub fn run(a: &YamlArgs) -> crate::Result<Vec<PathBuf>> {
    let eps: Vec<i64> = a.episode.map_or_else(|| (1..=5).collect(), |e| vec![e]);
    let mut written = Vec::new();
    for ep in eps {
        // 1 話だけなら --yaml-out の名前をそのまま使い、全話なら同じ親に epN.yaml を作る
        let out = match (a.episode, a.out.as_deref()) {
            (Some(_), p) => p.map(Path::to_path_buf),
            (None, Some(p)) => Some(
                p.parent()
                    .unwrap_or_else(|| Path::new("."))
                    .join(format!("ep{ep}.yaml")),
            ),
            (_, None) => None,
        };
        written.push(convert_episode(&a.root, ep, out.as_deref())?);
    }
    Ok(written)
}

pub fn convert_episode(
    root: &Path,
    episode: i64,
    explicit_out: Option<&Path>,
) -> crate::Result<PathBuf> {
    if !(1..=5).contains(&episode) {
        return Err(format!("--episode は 1〜5 です（{episode}）"));
    }
    let ep = episode - 1;
    let sce = format!("sce{ep:0>2}");
    let dir = root.join("script/romfs/script/_output");
    let (all, files) = story_files(&dir, &sce)?;
    if files.is_empty() {
        return Err(format!(
            "{} に _{sce}_c*_jpn.txt がありません",
            dir.display()
        ));
    }
    let cmn = root.join("script/arc/archive/msg_cmn_jpn/msg");
    let names = read_gmd_text(&cmn.join("name_jpn.txt"))?
        .into_iter()
        .map(|e| NameEntry {
            label: e.label.unwrap_or_default(),
            name: e.text,
        })
        .collect();
    let common = read_gmd_text(&cmn.join("choice_common_jpn.txt"))?;
    let own = read_gmd_text(&root.join(format!("script/romfs/msg/choice_{sce}_jpn.txt")))?;
    let (own_first, choice_base) = choice_meta(&dir, &files, &own)?;
    let record = load_record(&cmn, &load_code_tables(&root.join("exefs/code.bin"))?)?;
    let script_ids = load_script_ids(&root.join("romfs/table").join(script_table_file(ep)))?;
    let tables = script_tables(root, ep, script_ids.clone())?;
    let short: Vec<String> = files.iter().map(|f| short_of(&sce, f)).collect();
    let converted: HashSet<String> = short.iter().cloned().collect();
    let gains = move_skipped_gains(
        load_gains(&dir.join(format!("_{sce}_preset_jpn.txt")), &record)?,
        &all.iter().map(|f| short_of(&sce, f)).collect::<Vec<_>>(),
        &converted,
    );
    let bg_scripts = load_script_ids(&root.join("romfs/table/APP_PARAM_ID_SCRIPT_BG.prp"))?;
    let chr_scripts = load_script_ids(&root.join("romfs/table/APP_PARAM_ID_SCRIPT_CHR.prp"))?;
    let bg_names = label_map(&read_gmd_text(&cmn.join("bg_jpn.txt"))?);
    let (topic_base, topic_entries) = topic_data(&dir, &sce)?;
    let (flag_first, flag_other) = flags(&dir, &short)?;

    let conv = Conv {
        episode,
        ep,
        sce: sce.clone(),
        dir: dir.clone(),
        script_root: root.join("script"),
        names,
        common,
        own,
        own_first,
        choice_base,
        record,
        gains,
        script_ids,
        tables,
        short: short.clone(),
        converted,
        bg_scripts,
        chr_scripts,
        bg_names,
        topic_base,
        topic_entries,
        flag_first,
        flag_other,
        story: short.clone(),
        games: super::games::Games {
            root: root.to_path_buf(),
        },
        st: State::default(),
        called: RefCell::default(),
        active: RefCell::default(),
        cache: RefCell::default(),
        places: RefCell::default(),
        inv_scenes: RefCell::default(),
        meta: RefCell::default(),
    };
    let mut scenes = Map::new();
    let mut gameovers = Vec::new();
    let mut orig_ref = HashSet::new();
    for (i, f) in files.iter().enumerate() {
        let r = convert_file(
            &conv,
            &read_gmd_text(&dir.join(f))?,
            &short[i],
            short.get(i + 1).map(String::as_str),
        );
        for (id, s) in r.scenes {
            scenes.insert(id, s);
        }
        orig_ref.extend(r.orig_ref);
        if let Some(g) = r.gameover {
            gameovers.push(g);
        }
    }
    let gameover = if gameovers.is_empty() {
        None
    } else {
        let id = "gameover_by_file".to_string();
        let mut s: Vec<Value> = gameovers
            .iter()
            .enumerate()
            .map(|(i, to)| json!({"if": format!("gameover_at == {}", i + 1), "then": [{"goto": to}]}))
            .collect();
        s.push(json!({"goto": gameovers[0]}));
        scenes.insert(id.clone(), json!(s));
        Some(id)
    };
    let places_before = conv.places.borrow().clone();
    let inv_before = conv.inv_scenes.borrow().clone();
    let scenes_before = scenes.clone();
    super::reduce::drop_redundant(
        &mut scenes,
        &[scenes_before, places_before, inv_before],
        &[short.first().cloned(), gameover.clone()],
        &orig_ref,
        &conv.called.borrow(),
    );
    let mut trees = vec![
        Value::Object(scenes.clone()),
        Value::Object(conv.places.borrow().clone()),
        Value::Object(conv.inv_scenes.borrow().clone()),
    ];
    let mut read = HashSet::new();
    for t in &trees {
        read_names(t, &mut read);
    }
    for t in &mut trees {
        drop_unread_sets(t, &read);
    }
    scenes = trees.remove(0).as_object().cloned().unwrap_or_default();
    let places = trees.remove(0).as_object().cloned().unwrap_or_default();
    let inv_scenes = trees.remove(0).as_object().cloned().unwrap_or_default();
    let mut flag_names: Vec<String> = conv
        .st
        .flags
        .borrow()
        .iter()
        .filter(|f| read.contains(*f))
        .cloned()
        .collect();
    flag_names.sort();

    let all_text = serde_json::to_string(&[
        Value::Object(scenes.clone()),
        Value::Object(places.clone()),
        Value::Object(inv_scenes.clone()),
    ])
    .unwrap_or_default();
    // TS と同じく、台詞で使った人物を名前欄の番号順に入れ、人物ファイルを使うなら profile を足す。
    // 名前欄にいない人物ファイル（cast の番号だけにある人）は人物ファイルの名前を表示名にする
    let used_names = conv.st.used_names.borrow();
    let mut chars = Map::new();
    for n in 0..conv.names.len() {
        if !used_names.contains(&n) {
            continue;
        }
        let e = &conv.names[n];
        chars.insert(char_id(e), json!({"name": e.name}));
    }
    for (id, p) in &conv.record.profiles {
        if !all_text.contains(&format!("\"{id}\"")) {
            continue;
        }
        if let Some(c) = chars.get_mut(id).and_then(Value::as_object_mut) {
            // 既存の順序を保ったまま profile を足す（TS の `characters[id] = {...}` と同じ）
            c.insert("profile".into(), p.clone());
        } else {
            chars.insert(id.clone(), json!({"name": p["name"], "profile": p}));
        }
    }
    let evidence: Map<String, Value> = conv
        .record
        .evidence
        .iter()
        .filter(|(id, _)| all_text.contains(&format!("\"{id}\"")))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    let lines = |id: &str| all_text.matches(&format!("\"{id}\":")).count();
    let player = ["p000", "p002", "p003"]
        .into_iter()
        .max_by_key(|id| lines(id))
        .unwrap_or("p000");
    let title = label_map(&read_gmd_text(&cmn.join("title_jpn.txt"))?)
        .get(&format!("SCE_TITLE0{ep}"))
        .cloned()
        .unwrap_or_else(|| format!("第{episode}話"));
    let mut flags = Map::new();
    for f in flag_names {
        flags.insert(f, json!(false));
    }
    if gameover.is_some() {
        flags.insert("gameover_at".into(), json!(0));
    }
    let mut root_obj = Map::new();
    root_obj.insert("id".into(), json!(format!("ep{episode}")));
    root_obj.insert("title".into(), json!(title));
    root_obj.insert("player".into(), json!(player));
    root_obj.insert("life".into(), json!(100));
    root_obj.insert(
        "defaults".into(),
        json!({"penalty": 20, "autoShow": false, "autoPause": false}),
    );
    root_obj.insert("characters".into(), Value::Object(chars));
    root_obj.insert("evidence".into(), Value::Object(evidence));
    root_obj.insert("flags".into(), Value::Object(flags));
    root_obj.insert(
        "start".into(),
        json!({"scene": short[0], "evidence": [], "profiles": []}),
    );
    if let Some(g) = &gameover {
        root_obj.insert("gameover".into(), json!(g));
    }
    if places.is_empty() {
        root_obj.insert("scenes".into(), Value::Object(scenes));
    } else {
        root_obj.insert("parts".into(), json!([
            {"id": "story", "kind": "trial", "title": "物語", "scenes": scenes},
            {"id": "investigation", "kind": "investigation", "title": "探偵パート", "scenes": inv_scenes, "places": places},
        ]));
    }
    let out = explicit_out
        .map(Path::to_path_buf)
        .unwrap_or_else(|| root_from(root).join(format!("ep{episode}.yaml")));
    if let Some(p) = out.parent() {
        fs::create_dir_all(p).map_err(|e| format!("{}: {e}", p.display()))?;
    }
    fs::write(&out, super::yaml::to_yaml(&Value::Object(root_obj)))
        .map_err(|e| format!("{}: {e}", out.display()))?;
    Ok(out)
}
