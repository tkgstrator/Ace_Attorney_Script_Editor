use super::*;

impl Ctx for FCtx<'_, '_> {
    fn state(&self) -> &State {
        &self.f.conv.st
    }
    fn names(&self) -> &[NameEntry] {
        &self.f.conv.names
    }
    fn choice_text(&self, id: i64) -> String {
        self.f.conv.choice_text(id)
    }
    fn jump(&self, n: i64) -> Vec<Step> {
        let f = self.f;
        let label = f.label_of(n);
        let idx = usize::try_from(n).ok();
        if let (Some(exam), Some(i)) = (&f.exam, idx) {
            if exam.resume.contains(&i) {
                let Some(stack) = &self.stack else {
                    return vec![json!({"goto": f.testimony})];
                };
                // L_EXAM_RESET などは、ゆさぶりを全部終えたかの判定（<E051>… <E050>）を持つことがあるので展開する
                if i == exam.start || stack.contains(&i) {
                    return vec![];
                }
                let mut st = stack.clone();
                st.push(i);
                return convert_block(&f.blocks[i], &FCtx { f, stack: Some(st) }, Some(i));
            }
        }
        if skip_label(label) {
            return vec![json!({"native": "E004", "args": [n]})];
        }
        let i = idx.expect("label exists");
        let inlinable = f.exam.is_some()
            && label != Some(f.entry.as_str())
            && label != Some("L_GAMEOVER")
            && !f
                .exam
                .as_ref()
                .is_some_and(|e| e.answers.iter().any(|a| a.0 == n));
        if let (Some(stack), true) = (&self.stack, inlinable) {
            if stack.contains(&i) {
                return vec![json!({"goto": f.testimony})];
            }
            f.inlined.borrow_mut().insert(i);
            let mut st = stack.clone();
            st.push(i);
            return convert_block(&f.blocks[i], &FCtx { f, stack: Some(st) }, Some(i));
        }
        f.push_pending(i);
        vec![json!({"goto": f.id_of(label.expect("label"))})]
    }
    fn end(&self) -> Vec<Step> {
        let mut v = self.f.at_end.clone();
        v.push(match &self.f.next {
            Some(n) => json!({"goto": n}),
            None => json!({"end": true}),
        });
        v
    }
    fn reveal(&self, msg: i64) -> Option<String> {
        self.f.reveal_flag.get(&msg).cloned()
    }
    fn game(&self) -> Vec<Step> {
        self.f
            .solved("spirit_vision", &["L_MAIN2", "L_PO_OK"], None)
    }
    fn point_out(&self, self_label: Option<usize>) -> Option<Step> {
        let g = &self.f.conv.games;
        let po = self.f.point_out_index(self_label)?;
        let pick = g.point_out(po)?;
        for fl in g.point_out_flags(po) {
            self.f.conv.st.add_flag(&fl);
        }
        Some(pick)
    }
    fn spot_name(&self, label: i64, spot: i64) -> String {
        crate::conv::games::spot_label(self.f.entries, label, spot)
    }
    fn choices_at(&self, label: Option<usize>) -> Vec<(i64, i64)> {
        label
            .and_then(|n| self.f.choices_at.get(&(n as i64)).cloned())
            .unwrap_or_default()
    }
    fn script(&self, sce: i64, idx: i64) -> Vec<Step> {
        let mut v = self.f.at_end.clone();
        v.extend(self.f.conv.script(sce, idx));
        v
    }
    fn call(&self, sce: i64, idx: i64, label: Option<&str>) -> Vec<Step> {
        self.f.conv.call(sce, idx, label)
    }
    fn call_local(&self, n: i64) -> Vec<Step> {
        let f = self.f;
        let Some(i) = usize::try_from(n).ok().filter(|&i| i < f.blocks.len()) else {
            return vec![];
        };
        if f.calling.borrow().contains(&n) {
            return vec![];
        }
        f.calling.borrow_mut().insert(n);
        let steps = convert_block(
            &f.blocks[i],
            &FCtx {
                f,
                stack: self.stack.clone(),
            },
            Some(i),
        );
        f.calling.borrow_mut().remove(&n);
        steps
    }
    fn hub(&self) -> Option<(i64, i64)> {
        None
    }
    fn perceive_choice(&self) -> bool {
        self.f.conv.episode <= 4
    }
    fn end_invest(&self) -> Vec<Step> {
        vec![json!({"native": "E394", "args": []})]
    }
    fn free_roam(&self, place: i64, n: i64) -> Vec<Step> {
        let f = self.f;
        let hub = f.file_re.captures(&f.file);
        let label = f.label_of(n);
        let (Some(hub), Some(label)) = (hub, label) else {
            return vec![json!({"native": "E393", "args": [place, n]})];
        };
        f.push_pending(n as usize);
        let end = vec![json!({"goto": f.id_of(label)})];
        let places = f.map_places.take();
        let flags = f.end_flags.take();
        f.conv.investigate(
            &f.file,
            (hub[1].parse().unwrap_or(0), hub[2].parse().unwrap_or(0)),
            end,
            place,
            &places,
            &flags,
        )
    }
    fn map_place(&self, place: i64) {
        self.f.map_places.borrow_mut().push(place);
    }
    fn end_flag(&self, flag: &str) {
        self.f.end_flags.borrow_mut().push(flag.to_string());
    }
    fn topics(&self, _swap: bool, _args: &[i64]) -> Vec<Step> {
        vec![]
    }
    fn record_id(&self, kind: i64, idx: i64) -> Option<String> {
        self.f.conv.record_id(kind, idx)
    }
}
