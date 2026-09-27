// 法廷記録。証拠品ファイルと人物ファイルの 2 つのタブがあり、それぞれ一覧と詳細の表示を持つ。
// DS 版では下画面に出ていたものを、メイン画面に重ねて出す（配置・色は DS 版の下画面に合わせ、背景ごと不透明に描く）。
import { heldProfiles, type Engine } from '@gyakusai/core';
import { RECORD_PER_PAGE, REC_COLORS as C, UI, hit, type Rect } from './layout.ts';
import type { Labels } from './options.ts';
import type { Painter } from './painter.ts';
import { RECORD_CARD, drawCard, nameText } from './record-card.ts';
import * as Parts from './record-parts.ts';

export type RecordTab = 'evidence' | 'profile';

export class CourtRecord {
  open = false;
  tab: RecordTab = 'evidence';
  detail = false;
  #sel: Record<RecordTab, number> = { evidence: 0, profile: 0 };

  /** 今のタブに並ぶ項目（証拠品 ID か人物 ID） */
  items(engine: Engine, tab = this.tab): string[] {
    if (tab === 'evidence') return engine.state.evidence;
    // 人物ファイルに加えた人物だけ（加えた順）
    return heldProfiles(engine.scenario, engine.state);
  }

  selected(engine: Engine): number {
    return Math.min(this.#sel[this.tab], Math.max(0, this.items(engine).length - 1));
  }

  show(engine: Engine, tab: RecordTab = this.tab) {
    this.open = true;
    this.tab = tab;
    this.detail = false;
    this.#sel[tab] = Math.min(this.#sel[tab], Math.max(0, this.items(engine, tab).length - 1));
  }

  #switchTab(engine: Engine) {
    this.show(engine, this.tab === 'evidence' ? 'profile' : 'evidence');
  }

  #move(engine: Engine, delta: number, wrap = true) {
    const n = this.items(engine).length;
    if (n === 0) return;
    const next = this.#sel[this.tab] + delta;
    this.#sel[this.tab] = wrap ? (next + n) % n : Math.min(n - 1, Math.max(0, next));
  }

  /** 今のタブの項目をつきつけられるか（人物ファイルは、探偵パートと人物ファイルを認めるつきつけの要求だけ） */
  canPresent(engine: Engine): boolean {
    const ok = this.tab === 'evidence' ? engine.canPresent : engine.canPresentProfile;
    return ok && this.items(engine).length > 0;
  }

  /** 右上のタブで、もう一方のファイルに切り替えられるか（つきつけるときは、両方をつきつけられる場面だけ） */
  #canSwitch(engine: Engine): boolean {
    return !engine.canPresent || engine.canPresentProfile;
  }

  #present(engine: Engine) {
    if (!this.canPresent(engine)) return;
    const id = this.items(engine)[this.selected(engine)];
    if (!id) return;
    this.open = false;
    engine.present(id, this.tab);
  }

  /** 詳細で見ている証拠品を、今詳しく調べられるならその ID（法廷記録を開ける場面で、Beat の inspect にあるもの） */
  inspectable(engine: Engine): string | null {
    if (!this.detail || this.tab !== 'evidence') return null;
    const b = engine.beat;
    const id = this.items(engine)[this.selected(engine)];
    return id && 'inspect' in b && b.inspect?.includes(id) ? id : null;
  }

  #inspect(engine: Engine) {
    const id = this.inspectable(engine);
    if (!id) return;
    this.open = false;
    engine.inspect(id);
  }

  // ---- 入力 ------------------------------------------------------------------------

  /** 開いているときのキー操作。処理したら true */
  key(engine: Engine, key: string): boolean {
    if (key === 'ArrowLeft') this.#move(engine, -1);
    else if (key === 'ArrowRight') this.#move(engine, 1);
    else if (key === 'ArrowUp' && !this.detail) this.#move(engine, -4, false);
    else if (key === 'ArrowDown' && !this.detail) this.#move(engine, 4, false);
    else if (key === 'Enter' || key === ' ') {
      if (!this.detail) this.detail = this.items(engine).length > 0;
      else this.#present(engine);
    } else if (key === 'Tab' || key === 'r' || key === 'R') this.#switchTab(engine);
    else if (key === 'e' || key === 'E') this.#inspect(engine);
    else if (key === 'x' || key === 'X' || key === 'Escape') {
      if (this.detail) this.detail = false; else this.open = false;
    } else return false;
    return true;
  }

  /** 開いているときのクリック */
  click(engine: Engine, x: number, y: number) {
    const R = UI.rec;
    if (hit(R.back, x, y)) { this.open = false; return; }
    const present = this.canPresent(engine);
    if (this.#canSwitch(engine) && hit(R.switchTab, x, y)) { this.#switchTab(engine); return; }
    if (present && hit(R.presentBtn, x, y)) { this.#present(engine); return; }
    if (this.inspectable(engine) && hit(R.inspectBtn, x, y)) { this.#inspect(engine); return; }
    if (this.detail) {
      if (hit(R.itemL, x, y)) this.#move(engine, -1);
      else if (hit(R.itemR, x, y)) this.#move(engine, 1);
      else if (hit(R.icon, x, y)) this.detail = false;
      return;
    }
    const items = this.items(engine);
    const sel = this.selected(engine);
    const page = Math.floor(sel / RECORD_PER_PAGE);
    const pages = Math.max(1, Math.ceil(items.length / RECORD_PER_PAGE));
    if (hit(R.pageL, x, y)) { this.#sel[this.tab] = ((page + pages - 1) % pages) * RECORD_PER_PAGE; return; }
    if (hit(R.pageR, x, y)) { this.#sel[this.tab] = ((page + 1) % pages) * RECORD_PER_PAGE; return; }
    for (let i = 0; i < RECORD_PER_PAGE; i++) {
      const idx = page * RECORD_PER_PAGE + i;
      const c = R.cell(i);
      // マスの間（8 ドット）は半分ずつ、隣のマスの当たりに含める
      if (idx >= items.length || !hit({ x: c.x - 4, y: c.y - 4, w: c.w + 8, h: c.h + 8 }, x, y)) continue;
      // 選んでいる項目をもう一度クリックすると詳細を開く
      if (sel === idx) this.detail = true; else this.#sel[this.tab] = idx;
    }
  }

  // ---- 描画 ------------------------------------------------------------------------

  render(p: Painter, engine: Engine, labels: Labels, frame: number) {
    const R = UI.rec;
    const items = this.items(engine);
    const sel = this.selected(engine);
    const present = this.canPresent(engine);

    // 後ろのゲームの画面は見せない（DS 版の下画面と同じく、専用の背景に描く）
    Parts.background(p);
    const id = items[sel];
    if (this.detail && id) this.#renderDetail(p, engine, id);
    else this.#renderList(p, engine, items, sel, frame);
    Parts.stripes(p);

    // 上の見出しとタブ、下の「もどる」。DS 版の部品の絵（Assets.ui）があればそれを置き、なければ図形と文字で描く
    // （DS 版では帯の絵が題の札より手前に出る）
    Parts.topBar(p, present);
    if (!Parts.uiTitle(p, this.tab)) {
      const title = this.tab === 'evidence' ? labels.evidenceFile : labels.profileFile;
      titleText(p, title, R.title.x + 4, 13, R.title.w - 6, C.titleEdge);
    }
    Parts.uiTopPlate(p, present);
    // つきつけるときは、人物ファイルもつきつけられる場面（探偵パートなど）だけ、もう一方のファイルへのタブを出す
    // （DS 版と同じ。キーの Tab ではいつでも切り替えられる）
    if (this.#canSwitch(engine) && !Parts.putUi(p, this.tab === 'evidence' ? 'toProfile' : 'toEvidence', 176, 0)) {
      Parts.drawSwitchTab(p);
      this.#switchLabel(p, this.tab === 'evidence' ? labels.profileFile : labels.evidenceFile);
    }
    if (present && !Parts.putUi(p, 'present', 88, 0)) {
      Parts.drawPresentButton(p);
      buttonText(p, labels.present, 128, 15);
    }
    Parts.bottomBar(p);
    Parts.uiBottomPlate(p);
    if (!Parts.putUi(p, 'back', 0, 160)) {
      Parts.drawBackButton(p);
      buttonText(p, labels.back, 36, 176);
    }
    // 詳しく調べられる証拠品の詳細では、右下に「調べる」（DS 版では 3D の画面を開く）
    if (this.inspectable(engine)) {
      const b = R.inspectBtn;
      p.rect(b.x, b.y, b.w, b.h, C.btnOuter);
      p.rect(b.x + 1, b.y + 1, b.w - 2, b.h - 2, C.btnEdge);
      p.rect(b.x + 2, b.y + 2, b.w - 4, b.h - 4, C.btnFill);
      buttonText(p, labels.examine, b.x + b.w / 2, b.y + b.h / 2);
    }
  }

  /** 右上のタブの文字（先頭に薄い色の ➡） */
  #switchLabel(p: Painter, label: string) {
    const arrow = [[3, 3], [3, 4], [0, 6], [0, 8], [0, 6], [3, 4], [3, 3]] as const;
    const x0 = 183, y0 = 11;
    arrow.forEach(([a, b], i) => p.rect(x0 + a - 1, y0 + i - 1, b - a + 3, 3, C.btnTextEdge));
    arrow.forEach(([a, b], i) => p.rect(x0 + a, y0 + i, b - a + 1, 1, C.btnArrow));
    titleText(p, label, 192, 10, 62, C.btnTextEdge);
  }

  #nameOf(engine: Engine, id: string): string {
    if (this.tab === 'evidence') return engine.scenario.evidence[id]?.name ?? id;
    const ch = engine.scenario.characters[id];
    return ch?.profile?.name ?? ch?.name ?? id;
  }

  /** 名前の帯・一覧に出す名前（人物は年齢を付ける） */
  #label(engine: Engine, id: string): string {
    const name = this.#nameOf(engine, id);
    const age = this.tab === 'profile' ? engine.scenario.characters[id]?.profile?.age : undefined;
    return age !== undefined ? `${name}（${age}）` : name;
  }

  #icon(p: Painter, engine: Engine, id: string, r: Rect) {
    if (this.tab === 'evidence') p.evidenceIcon(engine.scenario.evidence[id]?.icon ?? id, this.#nameOf(engine, id), r.x, r.y, r.w / 32);
    else p.face(id, this.#nameOf(engine, id), r.x, r.y, r.w === 64 ? 64 : 40, engine.scenario.characters[id]?.profile?.icon);
  }

  #renderDetail(p: Painter, engine: Engine, id: string) {
    const R = UI.rec;
    const W = R.wood;
    p.rect(W.x, W.y, W.w, W.h, C.panel);
    Parts.frieze(p, R.friezeTop);
    Parts.frieze(p, R.friezeBottom);
    const desc = this.tab === 'evidence'
      ? engine.scenario.evidence[id]?.description ?? ''
      : engine.scenario.characters[id]?.profile?.description ?? '';
    drawCard(p, RECORD_CARD, { tab: this.tab, label: this.#label(engine, id), description: desc, drawIcon: r => this.#icon(p, engine, id, r) });
    Parts.sideButton(p, R.itemL, 'left');
    Parts.sideButton(p, R.itemR, 'right');
  }

  #renderList(p: Painter, engine: Engine, items: string[], sel: number, frame: number) {
    const R = UI.rec;
    const cur = items[sel];
    Parts.frame(p, R.nameBar);
    const bar = { x: R.nameBar.x + 2, y: R.nameBar.y + 2, w: R.nameBar.w - 3, h: R.nameBar.h - 3 };
    p.rect(bar.x, bar.y, bar.w, bar.h, C.nameBar);
    if (cur) nameText(p, this.tab, this.#label(engine, cur), R.nameCx.list, bar.y, bar.h);
    Parts.panel(p);
    const page = Math.floor(sel / RECORD_PER_PAGE);
    for (let i = 0; i < RECORD_PER_PAGE; i++) {
      const idx = page * RECORD_PER_PAGE + i;
      const c = R.cell(i);
      const id = items[idx];
      if (!id) { Parts.emptyCell(p, c); continue; }
      p.rect(c.x, c.y, c.w, c.h, C.cellFill);
      this.#icon(p, engine, id, c);
      // 選んでいる項目の枠（DS 版では点滅する）
      if (idx === sel && (frame >> 5) % 4 !== 3) Parts.frame(p, { x: c.x - 2, y: c.y - 2, w: c.w + 3, h: c.h + 3 });
    }
    const pages = Math.ceil(items.length / RECORD_PER_PAGE);
    Parts.sideButton(p, R.pageL, 'left', pages > 1);
    Parts.sideButton(p, R.pageR, 'right', pages > 1);
  }
}

/**
 * 見出しとタブの文字（白、縁取り）。点の上端を y に、x から maxW ドットに収める。
 * 収まらないとき（細い字のフォントがないとき）は、横に縮めて描く
 */
function titleText(p: Painter, label: string, x: number, y: number, maxW: number, edge: string) {
  const t = p.fonts.title ?? p.fonts.small;
  const w = t.measure(label);
  const ctx = p.ctx;
  ctx.save();
  if (w > maxW) {
    ctx.translate(x, 0);
    ctx.scale(maxW / w, 1);
    ctx.translate(-x, 0);
  }
  t.draw(label, x, y - t.font.ink.top, { color: C.titleText, outline: edge });
  ctx.restore();
}


/** 茶色のボタンの文字（白、濃い茶色の縁取り）。(cx, cy) が文字の中心 */
function buttonText(p: Painter, label: string, cx: number, cy: number) {
  const t = p.fonts.text;
  t.draw(label, cx, t.centerY(cy - 8, 16), { color: C.btnText, outline: C.btnTextEdge, align: 'center' });
}
