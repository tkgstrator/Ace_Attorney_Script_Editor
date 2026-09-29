//! aes_keys.txt（`slot0x2CKeyX=…` と `generatorConstant=…` の行）を読み、NCCH の鍵を作る。鍵の値は表示しない。

use std::collections::HashMap;

pub struct Keys(HashMap<String, u128>);

impl Keys {
    pub fn parse(text: &str) -> crate::Result<Keys> {
        let mut m = HashMap::new();
        for line in text.lines() {
            let line = line.trim();
            if line.starts_with('#') {
                continue;
            }
            if let Some((k, v)) = line.split_once('=') {
                // 128 ビットに収まらない値（RSA の鍵など）は使わないので飛ばす
                if let Ok(v) = u128::from_str_radix(v.trim(), 16) {
                    m.insert(k.trim().to_string(), v);
                }
            }
        }
        Ok(Keys(m))
    }

    pub fn get(&self, name: &str) -> crate::Result<u128> {
        self.0
            .get(name)
            .copied()
            .ok_or(format!("鍵ファイルに {name} がありません"))
    }

    /// 3DS の鍵の作り方: KeyN = ROL((ROL(KeyX, 2) ^ KeyY) + C, 87)
    pub fn scramble(&self, key_x: u128, key_y: u128) -> crate::Result<[u8; 16]> {
        let c = self.get("generatorConstant")?;
        Ok((key_x.rotate_left(2) ^ key_y)
            .wrapping_add(c)
            .rotate_left(87)
            .to_be_bytes())
    }
}
