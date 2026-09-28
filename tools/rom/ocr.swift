// macOS の文字認識（Vision）で画像の日本語を読む。
//   swift tools/rom/ocr.swift <画像>...
// 画像ごとに「# ファイル名」の行を出し、続けて認識した行を上から順に「y座標<TAB>文字列」で出す（y は 0〜1、上が 0）。
import Foundation
import Vision

let paths = Array(CommandLine.arguments.dropFirst())
if paths.isEmpty {
    FileHandle.standardError.write("使い方: swift tools/rom/ocr.swift <画像>...\n".data(using: .utf8)!)
    exit(2)
}

for path in paths {
    print("# \(path)")
    let url = URL(fileURLWithPath: path)
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["ja-JP"]
    request.usesLanguageCorrection = true
    let handler = VNImageRequestHandler(url: url, options: [:])
    do {
        try handler.perform([request])
    } catch {
        FileHandle.standardError.write("読めません: \(path): \(error)\n".data(using: .utf8)!)
        continue
    }
    let lines = (request.results ?? []).compactMap { obs -> (Double, String)? in
        guard let text = obs.topCandidates(1).first?.string else { return nil }
        return (1 - Double(obs.boundingBox.midY), text)
    }.sorted { $0.0 < $1.0 }
    for (y, text) in lines {
        print(String(format: "%.4f", y) + "\t" + text)
    }
}
