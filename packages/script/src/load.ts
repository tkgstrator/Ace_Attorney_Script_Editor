import { type Document, isNode, LineCounter, parseDocument } from 'yaml';
import { type CompileResult, compile, type Diagnostic, type Path } from './compile.ts';
import { checkFontGlyphs } from './verify-font.ts';
import { checkTextFit } from './verify-text-fit.ts';

export interface LoadOptions {
  /** DS 版フォント（tools/rom で ROM から取り出したもの）に無い文字も診断に含める */
  checkFont?: boolean;
  /** 画面の枠（台詞の 16 字 × 2 行・選択肢のボタン・証拠品の説明など）に収まらない文も警告に含める */
  checkFit?: boolean;
}

/** YAML のテキストを読み込み、コンパイルする。診断には行・桁が付く */
export function loadScenario(source: string, opts?: LoadOptions): CompileResult {
  const lineCounter = new LineCounter();
  const doc = parseDocument(source, { lineCounter, prettyErrors: false });
  if (doc.errors.length > 0) {
    return {
      scenario: null,
      diagnostics: doc.errors.map((e) => {
        const pos = lineCounter.linePos(e.pos[0]);
        return {
          severity: 'error',
          message: `YAML の構文エラー: ${e.message.split('\n')[0]}`,
          path: [],
          line: pos.line,
          column: pos.col,
        };
      }),
    };
  }
  const js = doc.toJS();
  const result = compile(js);
  if (opts?.checkFont) result.diagnostics.push(...checkFontGlyphs(js));
  if (opts?.checkFit) result.diagnostics.push(...checkTextFit(js));
  for (const d of result.diagnostics) Object.assign(d, locate(doc, lineCounter, d.path));
  result.diagnostics.sort(
    (a, b) => (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0),
  );
  return result;
}

/** パスが指す YAML ノードの位置を探す。見つからなければ親をたどる */
function locate(doc: Document, lc: LineCounter, path: Path): Pick<Diagnostic, 'line' | 'column'> {
  for (let n = path.length; n >= 0; n--) {
    const node = doc.getIn(path.slice(0, n), true);
    if (isNode(node) && node.range) {
      const pos = lc.linePos(node.range[0]);
      return { line: pos.line, column: pos.col };
    }
  }
  return {};
}

export function formatDiagnostic(d: Diagnostic, file = ''): string {
  const where =
    d.line !== undefined ? `${file}:${d.line}:${d.column}` : `${file}:${d.path.join('.')}`;
  return `${where} ${d.severity === 'error' ? 'エラー' : '警告'}: ${d.message}`;
}
