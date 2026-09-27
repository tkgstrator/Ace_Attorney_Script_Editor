// コンパイル済みのシナリオ（IR）を、調べるのに使う形にしたもの。
// ID（フラグ・証拠品・シーン・調べた印）はすべて番号にする。表示だけの命令は Nop にまとめる。

/// フラグの値（JS の boolean / number / string と、まだ値のない undefined）
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum FVal {
    Undef,
    Bool(bool),
    Num(f64),
    /// 文字列（Model::strings の番号）
    Str(u32),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BinOp {
    And, Or, Eq, Ne, Lt, Le, Gt, Ge, Add, Sub,
}

#[derive(Clone, Debug)]
pub enum Expr {
    Lit(FVal),
    Var(u32),
    /// ライフ（名前が life の変数）
    Life,
    Has(u32),
    Visited(u32),
    Seen(u32),
    Not(Box<Expr>),
    Bin(BinOp, Box<Expr>, Box<Expr>),
    /// 真偽の変数だけの式を、真理値表にしたもの（fast.rs。解析では元の式 orig を使う）
    Table(Box<Table>),
}

/// 真理値表にした式。vars[i] の真偽を i ビット目にした番号で bits を引く
#[derive(Clone, Debug)]
pub struct Table {
    pub orig: Expr,
    pub vars: Vec<TableVar>,
    pub bits: Vec<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TableVar {
    /// 真偽しか取らないフラグ（値のないことはない）
    Flag(u32),
    Has(u32),
    Visited(u32),
    Seen(u32),
}

/// 止まる命令の種類（Beat の kind に対応する）
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StopKind {
    Line, Shout, Banner, Card, Wait, Fade,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResumeTo {
    Next, Stay, First, CrossIntro, AfterReading,
}

#[derive(Clone, Debug)]
pub struct Opt {
    pub when: Option<Expr>,
    pub to: u32,
}

#[derive(Clone, Debug)]
pub enum Op {
    /// 表示・音だけで、状態（調べるのに使うもの）を変えない命令。name は元の命令名
    Nop(&'static str),
    Stop(StopKind),
    Choice(Vec<Opt>),
    /// options は IR の並び（証拠品の番号, pc）。profiles は人物ファイルの正解（人物ファイルの番号, pc）で、
    /// None なら人物ファイルはつきつけられない
    Demand { prompt: String, speaker: bool, options: Vec<(u32, u32)>, profiles: Option<Vec<(u32, u32)>>, wrong: u32 },
    /// 法廷記録を使えなくする（true）・使えるようにする（false）。ui の record（ほかの ui は Nop）
    Lock(bool),
    Set(u32, FVal),
    Add(u32, f64),
    Give(u32),
    Take(u32),
    Jump(u32),
    JumpUnless(Expr, u32),
    Random(Vec<u32>),
    /// シーンへ（番号。存在しないシーンは scenes.len() 以上で、名前は Model::missing_scenes）
    Goto(u32),
    Investigate(u32),
    Menu,
    Resume(ResumeTo),
    InspectEnd,
    End,
    Gameover,
    Penalty(f64),
}

impl Op {
    /// 元の命令名（エラーの文に使う）
    pub fn name(&self) -> &'static str {
        match self {
            Op::Nop(n) => n,
            Op::Stop(k) => match k {
                StopKind::Line => "say", StopKind::Shout => "shout", StopKind::Banner => "banner",
                StopKind::Card => "card", StopKind::Wait => "wait", StopKind::Fade => "fade",
            },
            Op::Choice(_) => "choice", Op::Demand { .. } => "demand", Op::Set(..) => "set", Op::Add(..) => "add",
            Op::Give(_) => "give", Op::Take(_) => "take", Op::Jump(_) => "jump", Op::JumpUnless(..) => "jumpUnless",
            Op::Random(_) => "random", Op::Goto(_) => "goto", Op::Investigate(_) => "investigate", Op::Menu => "menu",
            Op::Resume(_) => "resume", Op::InspectEnd => "inspectEnd", Op::End => "end", Op::Gameover => "gameover",
            Op::Penalty(_) => "penalty", Op::Lock(_) => "ui",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Statement {
    pub when: Option<Expr>,
    pub press: Option<u32>,
    pub present: Vec<(u32, u32)>,
    pub before: Option<u32>,
}

#[derive(Clone, Debug)]
pub struct Testimony {
    pub title: String,
    pub statements: Vec<Statement>,
    pub after: Option<u32>,
    pub reading: Option<u32>,
    pub looping: Option<u32>,
    pub wrong: u32,
}

#[derive(Clone, Debug)]
pub struct Examine {
    /// 調べた印の番号
    pub seen: u32,
    pub name: Option<String>,
    pub area: [i64; 4],
    pub when: Option<Expr>,
    pub pc: u32,
}

#[derive(Clone, Debug)]
pub struct Talk {
    pub seen: u32,
    pub topic: String,
    pub when: Option<Expr>,
    pub pc: u32,
}

#[derive(Clone, Debug)]
pub struct Place {
    pub name: String,
    pub person: Vec<Option<Expr>>,
    pub enter: Option<u32>,
    pub examine: Vec<Examine>,
    pub examine_default: u32,
    pub talk: Vec<Talk>,
    pub present: Vec<(u32, u32)>,
    /// 人物ファイルをつきつけたとき（人物ファイルの番号, pc）
    pub present_profile: Vec<(u32, u32)>,
    pub present_wrong: u32,
    pub moves: Vec<(u32, Option<Expr>)>,
}

#[derive(Clone, Debug)]
pub enum Kind {
    Dialogue,
    Testimony(Testimony),
    Place(Place),
}

#[derive(Clone, Debug)]
pub struct Scene {
    pub id: String,
    pub kind: Kind,
    pub program: Vec<Op>,
    /// 速く進めるための表（fast.rs）: pc から Nop を飛ばした先の pc
    pub nop_end: Vec<u32>,
    /// 止まる命令（Stop）の pc から、Nop と Stop だけが続く間の、最後の Stop の pc と、その間の Stop の数
    pub stop_run: Vec<(u32, u32)>,
    /// 台詞・日時の表示のうち、詳しく調べるのを次の台詞・日時の表示に回せるもの（その間は Nop と Stop だけ。
    /// verify-inspect.ts の deferrable）
    pub defer: Vec<bool>,
    /// 台詞・日時の表示から、次に調べられる所までの命令の読み書き（defer.rs の segment。台詞・日時の表示の pc だけ）
    pub segment: Vec<Option<crate::defer::Access>>,
    /// 台詞・日時の表示ごとに、どの場所も後に回せる状態を変えうる証拠品（ビットは Model の inspect_effective の並び）
    pub trivial: Vec<u64>,
}

impl Scene {
    pub fn testimony(&self) -> Option<&Testimony> {
        if let Kind::Testimony(t) = &self.kind { Some(t) } else { None }
    }
    pub fn place(&self) -> Option<&Place> {
        if let Kind::Place(p) = &self.kind { Some(p) } else { None }
    }
}

/// 法廷記録の項目（証拠品と、人物ファイルの人物）。人物ファイルは証拠品の後ろに並べ、同じく「持っている」ものとして扱う
#[derive(Clone, Debug)]
pub struct Evidence {
    /// 証拠品 ID か人物 ID
    pub id: String,
    pub name: String,
    /// 詳しく調べるシーンの番号
    pub inspect: Option<u32>,
    /// 人物ファイルか
    pub profile: bool,
    /// 詳しく調べると状態を変えうるか（Model の inspect_effective に入っているか）と、その並びの番号
    pub effective: bool,
    pub effective_index: Option<usize>,
}

#[derive(Clone, Debug)]
pub struct Part {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub scenes: Vec<u32>,
}

#[derive(Clone, Debug)]
pub struct Model {
    pub id: String,
    pub flag_names: Vec<String>,
    /// 初めの値（IR の flags にないフラグは Undef）
    pub flag_init: Vec<FVal>,
    /// IR の flags に書かれているフラグの数（番号がこれより小さいもの）
    pub declared_flags: usize,
    pub strings: Vec<String>,
    pub evidence: Vec<Evidence>,
    pub scenes: Vec<Scene>,
    /// visited() に書かれた ID のうち、シーンでないもの（番号は scenes.len() から）
    pub extra_visit: Vec<String>,
    /// 調べた印の ID
    pub seen_ids: Vec<String>,
    pub start_scene: u32,
    /// 最初に持っている証拠品と、人物ファイルに載っている人物
    pub start_evidence: Vec<u32>,
    /// 人物ファイルをつきつけられる所（人物のいる場所・人物ファイルを認める要求）があるか
    pub profile_points: bool,
    /// 詳しく調べると状態を変えうる証拠品（verify-inspect.ts の effective。証拠品の並び）と、詳しく調べられる証拠品すべて
    pub inspect_effective: Vec<u32>,
    pub inspect_all: Vec<u32>,
    /// 詳しく調べるシーンの、選択肢の項目ごとの「試さなくてよいか」（状態を変えない。シーンの番号ごと）
    pub inspect_skip: Vec<Vec<bool>>,
    /// 文章送りだけの場面で詳しく調べるのを試すかの下ごしらえと、調べて状態が変わるかの結果の覚え（defer.rs）
    pub defer: crate::defer::DeferInfo,
    pub gameover_scene: Option<u32>,
    pub max_life: f64,
    pub parts: Vec<Part>,
    /// 存在しないシーンへの参照の名前（シーンの番号が scenes.len() + i のもの）
    pub missing_scenes: Vec<String>,
}

impl Model {
    pub fn visit_count(&self) -> usize {
        self.scenes.len() + self.extra_visit.len()
    }
    pub fn scene_index(&self, id: &str) -> Option<u32> {
        self.scenes.iter().position(|s| s.id == id).map(|i| i as u32)
    }
    /// 存在しないシーンの参照の名前
    pub fn scene_name(&self, i: u32) -> &str {
        let n = self.scenes.len();
        if (i as usize) < n { &self.scenes[i as usize].id } else { &self.missing_scenes[i as usize - n] }
    }
    pub fn is_profile(&self, x: u32) -> bool {
        self.evidence[x as usize].profile
    }
    pub fn flag_index(&self, name: &str) -> Option<u32> {
        self.flag_names.iter().position(|s| s == name).map(|i| i as u32)
    }
}
