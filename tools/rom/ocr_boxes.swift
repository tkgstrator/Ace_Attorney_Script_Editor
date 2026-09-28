// macOS の文字認識（Vision）で画像の日本語を読み、1 字ごとの横の範囲も出す（choice_text.py 用）。
//   swiftc -O tools/rom/ocr_boxes.swift -o <実行ファイル> && <実行ファイル> <画像>...
// 画像ごとに「# ファイル名」の行を出し、続けて認識したかたまりごとに:
//   t<TAB>順位<TAB>文字列                    候補（最大 3 つ。順位 0 がいちばん確からしいもの）
//   c<TAB>文字<TAB>左端<TAB>右端              順位 0 の候補の 1 字ごとの範囲（0〜1、左が 0）
// かたまりは左から順に出す。
import Foundation
import Vision

let paths = Array(CommandLine.arguments.dropFirst())
if paths.isEmpty {
    FileHandle.standardError.write("使い方: ocr_boxes <画像>...\n".data(using: .utf8)!)
    exit(2)
}

for path in paths {
    print("# \(path)")
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["ja-JP"]
    request.usesLanguageCorrection = true
    let handler = VNImageRequestHandler(url: URL(fileURLWithPath: path), options: [:])
    do {
        try handler.perform([request])
    } catch {
        FileHandle.standardError.write("読めません: \(path): \(error)\n".data(using: .utf8)!)
        continue
    }
    let obs = (request.results ?? []).sorted { $0.boundingBox.minX < $1.boundingBox.minX }
    for o in obs {
        let cands = o.topCandidates(3)
        for (i, c) in cands.enumerated() {
            print("t\t\(i)\t\(c.string)")
        }
        guard let best = cands.first else { continue }
        let s = best.string
        var i = s.startIndex
        while i < s.endIndex {
            let j = s.index(after: i)
            if let box = try? best.boundingBox(for: i..<j) {
                let b = box.boundingBox
                print("c\t\(s[i..<j])\t" + String(format: "%.4f\t%.4f", Double(b.minX), Double(b.maxX)))
            }
            i = j
        }
    }
}
