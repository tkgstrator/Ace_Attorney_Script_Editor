//! DS 版フォントの文字の並び（charset.py）。台詞の文字コード = フォントの番号 + 128。128 未満は命令。

/// 番号 0 から順に並ぶ文字（漢字の手前まで）
pub const LAYOUT: &str = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!?あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんがぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽぁぃぅぇぉゃゅょっアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポァィゥェォャュョッヴ．☞「」（）『』“”▼▲：、，＋／＊’ー・。％‥～《》＆☆♪　‐″［］＄＃＞＜＝■éá；";
/// 漢字の始まり（「人」）
pub const KANJI_START: usize = 269;
/// 同じ字形を別の文字にも使う（テキスト側の表記ゆれの吸収）
pub const ALIASES: &[(char, char)] = &[('…', '‥'), ('―', 'ー'), ('—', 'ー'), ('〜', '～'), ('!', '！'), ('?', '？')];
/// 台詞のデータでの文字コードの足し分
pub const CODE_BASE: u16 = 128;

/// LAYOUT を 1 文字ずつに分けたもの
pub fn layout_chars() -> Vec<char> {
    LAYOUT.chars().collect()
}

#[cfg(test)]
mod tests {
    #[test]
    fn kanji_start() {
        assert_eq!(super::layout_chars().len(), super::KANJI_START);
    }
}
