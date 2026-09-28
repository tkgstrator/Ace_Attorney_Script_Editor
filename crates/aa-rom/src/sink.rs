//! 書き出し先。中核はファイルに触らず、(相対パス, 中身) をここへ渡すだけにする。

/// 書き出したものを受け取る側（コマンドならファイルに書き、ブラウザーなら JS に渡す）
pub trait Sink {
    /// 出力の根からの相対パス（区切りは `/`）と中身
    fn put(&mut self, path: &str, data: Vec<u8>);
    /// 進み具合の表示（既定では何もしない）
    fn log(&mut self, _msg: &str) {}
}

/// メモリーに貯めるだけの書き出し先
#[derive(Default)]
pub struct MemSink {
    pub files: Vec<(String, Vec<u8>)>,
    pub logs: Vec<String>,
}

impl Sink for MemSink {
    fn put(&mut self, path: &str, data: Vec<u8>) {
        self.files.push((path.to_string(), data));
    }
    fn log(&mut self, msg: &str) {
        self.logs.push(msg.to_string());
    }
}

/// 前に付けるパスを足して別の書き出し先へ渡す
pub struct Prefixed<'a> {
    pub inner: &'a mut dyn Sink,
    pub prefix: String,
}

impl Sink for Prefixed<'_> {
    fn put(&mut self, path: &str, data: Vec<u8>) {
        let p = format!("{}/{}", self.prefix, path);
        self.inner.put(&p, data);
    }
    fn log(&mut self, msg: &str) {
        self.inner.log(msg);
    }
}
