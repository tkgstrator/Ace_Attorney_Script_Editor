// macOS の文字認識（Vision）で画像の日本語を読む（small_font_ocr.py 用。ocr.swift に x 座標を足したもの）。
//   swift tools/rom/small_font_ocr.swift <画像>...
// 画像ごとに「# ファイル名」の行を出し、続けて認識したかたまりを「y座標<TAB>x座標<TAB>文字列」で出す
// （y は中心、x は左端。どちらも 0〜1 で、上・左が 0）。同じ行が複数のかたまりに分かれることがあるので、x で並べ直して使う。
import Foundation
import Vision

let paths = Array(CommandLine.arguments.dropFirst())
if paths.isEmpty {
    FileHandle.standardError.write("使い方: swift tools/rom/small_font_ocr.swift <画像>...\n".data(using: .utf8)!)
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
    for obs in request.results ?? [] {
        guard let text = obs.topCandidates(1).first?.string else { continue }
        let b = obs.boundingBox
        print(String(format: "%.4f\t%.4f\t", 1 - Double(b.midY), Double(b.minX)) + text)
    }
}
