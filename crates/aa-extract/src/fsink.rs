//! 書き出し先をファイルにする Sink

use std::path::PathBuf;

use aa_rom::Sink;

pub struct FileSink {
    pub root: PathBuf,
    pub count: usize,
    pub quiet: bool,
}

impl FileSink {
    pub fn new(root: PathBuf) -> Self {
        FileSink {
            root,
            count: 0,
            quiet: false,
        }
    }
}

pub fn write(root: &std::path::Path, path: &str, data: &[u8]) {
    let dst = root.join(path);
    if let Some(p) = dst.parent() {
        std::fs::create_dir_all(p)
            .unwrap_or_else(|e| panic!("フォルダーを作れません: {}: {e}", p.display()));
    }
    std::fs::write(&dst, data).unwrap_or_else(|e| panic!("書き出せません: {}: {e}", dst.display()));
}

impl Sink for FileSink {
    fn put(&mut self, path: &str, data: Vec<u8>) {
        write(&self.root, path, &data);
        self.count += 1;
    }
    fn log(&mut self, msg: &str) {
        if !self.quiet {
            println!("{msg}");
        }
    }
}
