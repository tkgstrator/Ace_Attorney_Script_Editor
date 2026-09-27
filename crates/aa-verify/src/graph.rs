// 状態のグラフ（状態は 0 からの番号）と、抜け出せない状態のかたまりの検出（verify-graph.ts と同じ）。

/// 状態 i の行き先は targets の first[i]..last[i] に並ぶ（展開した順に詰めて入れる）
#[derive(Default)]
pub struct Graph {
    first: Vec<u32>,
    last: Vec<u32>,
    pub targets: Vec<u32>,
}

impl Graph {
    fn fit(&mut self, i: usize) {
        if self.first.len() <= i {
            self.first.resize(i + 1, 0);
            self.last.resize(i + 1, 0);
        }
    }
    /// 状態 i の行き先を並べ始める。続けて add で行き先を足す
    pub fn open(&mut self, i: u32) {
        self.fit(i as usize);
        let n = self.targets.len() as u32;
        self.first[i as usize] = n;
        self.last[i as usize] = n;
    }
    pub fn add(&mut self, i: u32, to: u32) {
        self.targets.push(to);
        self.last[i as usize] = self.targets.len() as u32;
    }
    pub fn from(&self, i: u32) -> u32 {
        self.first.get(i as usize).copied().unwrap_or(0)
    }
    pub fn to(&self, i: u32) -> u32 {
        self.last.get(i as usize).copied().unwrap_or(0)
    }
    pub fn succ(&self, i: u32) -> &[u32] {
        &self.targets[self.from(i) as usize..self.to(i) as usize]
    }
    pub fn memory(&self) -> usize {
        (self.first.capacity() + self.last.capacity() + self.targets.capacity()) * 4
    }
}

/// 出ていく先のない、終わりを含まない強連結成分（抜け出せない状態のかたまり）。
/// Tarjan の方法を、再帰を使わずに書いたもの（TS 版と同じ順に見つける）
pub fn traps(g: &Graph, n: usize, goal: impl Fn(u32) -> bool) -> Vec<Vec<u32>> {
    const NO: i32 = -1;
    let mut index = vec![NO; n];
    let mut low = vec![0i32; n];
    let mut comp = vec![NO; n];
    let mut on_stack = vec![false; n];
    let mut stack: Vec<u32> = vec![];
    let mut work: Vec<(u32, u32)> = vec![];
    let mut found = vec![];
    let (mut counter, mut comps) = (0i32, 0i32);
    for root in 0..n as u32 {
        if index[root as usize] != NO { continue; }
        let open = |v: u32, index: &mut [i32], low: &mut [i32], stack: &mut Vec<u32>, on: &mut [bool], work: &mut Vec<(u32, u32)>, counter: &mut i32| {
            index[v as usize] = *counter;
            low[v as usize] = *counter;
            *counter += 1;
            stack.push(v);
            on[v as usize] = true;
            work.push((v, g.from(v)));
        };
        open(root, &mut index, &mut low, &mut stack, &mut on_stack, &mut work, &mut counter);
        while let Some(&(v, e)) = work.last() {
            if e < g.to(v) {
                work.last_mut().unwrap().1 = e + 1;
                let w = g.targets[e as usize];
                if index[w as usize] == NO {
                    open(w, &mut index, &mut low, &mut stack, &mut on_stack, &mut work, &mut counter);
                } else if on_stack[w as usize] {
                    low[v as usize] = low[v as usize].min(index[w as usize]);
                }
                continue;
            }
            work.pop();
            if let Some(&(p, _)) = work.last() { low[p as usize] = low[p as usize].min(low[v as usize]); }
            if low[v as usize] == index[v as usize] {
                // かたまりが決まった時点で、行き先のかたまりもすべて決まっている
                let mut c = vec![];
                loop {
                    let x = stack.pop().unwrap();
                    on_stack[x as usize] = false;
                    comp[x as usize] = comps;
                    c.push(x);
                    if x == v { break; }
                }
                let trap = c.iter().all(|&v| !goal(v) && g.succ(v).iter().all(|&w| comp[w as usize] == comps));
                if trap { found.push(c); }
                comps += 1;
            }
        }
    }
    found
}
