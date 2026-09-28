import {
  firstVisible,
  instrBeat,
  nextVisible,
  resumeStep,
  testimonyBeat,
  visibleOptions,
  visibleStatements,
} from './beat.ts';
import { cloneData } from './clone.ts';
import { EngineError } from './errors.ts';
import { applyInlineCommand, enterStatement, execSimple } from './exec.ts';
import { type ExprEnv, evalExpr } from './expr.ts';
import { inspectFrame, returnFromInspect } from './inspect.ts';
import { examineAt, investigateBeat, personAt } from './investigation.ts';
import { holds, kindOf, type RecordKind, recordName } from './present.ts';
import { plainBgm as bgmMarks, type InlineCommand } from './rich.ts';
import { initialState, migrateState, stateEnv } from './state.ts';
import type {
  Beat,
  CompiledScenario,
  EngineEvent,
  Expr,
  GameState,
  Instr,
  PlaceScene,
  ResumeTarget,
  Scene,
  Snapshot,
  TestimonyScene,
  Value,
} from './types.ts';

const STEP_LIMIT = 100_000;

export { EngineError };

/**
 * シナリオの実行器。描画や入力を持たず、状態の遷移だけを扱う。
 *
 * 表示側は `beat` を見て画面を作り、プレイヤーの操作に応じて
 * advance / back / press / present / choose（探索編では examine / move / talk / present）を呼ぶ。
 */
export class Engine {
  readonly scenario: CompiledScenario;
  #state: GameState;
  #events: EngineEvent[] = [];
  #listeners = new Set<() => void>();
  /** 状態が変わるたびに増える番号。表示側で「別の Beat になったか」の判定に使う */
  serial = 0;

  constructor(scenario: CompiledScenario, snapshot?: Snapshot) {
    this.scenario = scenario;
    if (snapshot) {
      if (snapshot.scenario !== scenario.id)
        throw new EngineError(`別のシナリオのセーブデータです: ${snapshot.scenario}`);
      this.#state = migrateState(cloneData(snapshot.state), scenario);
    } else {
      this.#state = initialState(scenario);
      this.#enter(scenario.startScene);
    }
    this.#settle();
  }

  get state(): Readonly<GameState> {
    return this.#state;
  }

  get beat(): Beat {
    const s = this.#state;
    if (s.mode === 'investigate')
      return investigateBeat(this.scenario, this.#place(), s, (e) => this.#test(e));
    const test = (e: Expr | undefined) => this.#test(e);
    if (s.mode === 'testimony') return testimonyBeat(this.scenario, this.#testimony(), s, test);
    return instrBeat(this.scenario, this.#instr(), s, test);
  }

  /** 証拠品をつきつけられる場面か */
  get canPresent(): boolean {
    const b = this.beat;
    return (
      b.kind === 'demand' ||
      (b.kind === 'statement' && b.cross) ||
      (b.kind === 'investigate' && b.present)
    );
  }

  /** 人物ファイルもつきつけられる場面か（探偵パートの人物と、人物ファイルを認めるつきつけの要求） */
  get canPresentProfile(): boolean {
    const b = this.beat;
    return (b.kind === 'demand' && !!b.profiles) || (b.kind === 'investigate' && b.present);
  }

  // ---- プレイヤーの操作 ------------------------------------------------------

  /** 文章送り。証言中は次の証言へ進む */
  advance(): void {
    const s = this.#state;
    if (s.mode === 'testimony') {
      const t = this.#testimony();
      switch (s.phase) {
        case 'intro':
          if (t.reading !== undefined) this.#run(t.reading);
          else
            this.#toStatement(
              'reading',
              firstVisible(t, (e) => this.#test(e)),
            );
          break;
        case 'crossIntro':
          this.#toStatement(
            'cross',
            firstVisible(t, (e) => this.#test(e)),
          );
          break;
        case 'reading': {
          const next = nextVisible(t, s.statement, (e) => this.#test(e));
          if (next !== null) this.#toStatement('reading', next);
          else if (t.after !== undefined) this.#run(t.after);
          else s.phase = 'crossIntro';
          break;
        }
        case 'cross':
          this.#resume('next');
          break;
      }
    } else {
      const ins = this.#instr();
      if (ins.op === 'choice' || ins.op === 'demand')
        throw new EngineError(`${ins.op} では advance できません`);
      if (ins.op === 'end' || ins.op === 'gameover') return;
      s.pc++;
    }
    this.#settle();
  }

  /** 尋問中に一つ前の証言へ戻る */
  back(): void {
    const s = this.#state;
    this.#requireCross('back');
    const visible = visibleStatements(this.#testimony(), (e) => this.#test(e));
    const i = visible.indexOf(s.statement);
    if (i > 0) {
      s.statement = visible[i - 1]!;
      this.#changed();
    }
  }

  press(): void {
    this.#requireCross('press');
    const st = this.#testimony().statements[this.#state.statement]!;
    if (st.press === undefined) throw new EngineError('この証言はゆさぶれません');
    this.#run(st.press);
    this.#settle();
  }

  /** 法廷記録の項目をつきつける。kind を省くと、証拠品の ID なら証拠品、そうでなければ人物ファイル */
  present(id: string, kind: RecordKind = kindOf(this.scenario, id)): void {
    const s = this.#state;
    if (!holds(this.scenario, s, id, kind)) {
      throw new EngineError(
        kind === 'evidence'
          ? `持っていない証拠品です: ${id}`
          : `人物ファイルに載っていない人物です: ${id}`,
      );
    }
    const profile = kind === 'profile';
    const name = recordName(this.scenario, id, kind);
    if (s.mode === 'testimony') {
      this.#requireCross('present');
      if (profile) throw new EngineError('尋問では人物ファイルをつきつけられません');
      const t = this.#testimony();
      const target = t.statements[s.statement]!.present[id];
      s.vars = { evidence: name };
      this.#run(target ?? t.wrong);
    } else if (s.mode === 'investigate') {
      const place = this.#place();
      if (personAt(place, (e) => this.#test(e)) === null)
        throw new EngineError('この場所には証拠品をつきつける相手がいません');
      s.vars = { evidence: name };
      this.#run((profile ? place.presentProfile?.[id] : place.present[id]) ?? place.presentWrong);
    } else {
      const ins = this.#instr();
      if (ins.op !== 'demand') throw new EngineError('今は証拠品をつきつけられません');
      if (profile && !ins.profiles)
        throw new EngineError('このつきつけの要求では人物ファイルをつきつけられません');
      s.vars = { evidence: name };
      s.pc = (profile ? ins.profiles![id] : ins.options[id]) ?? ins.wrong;
    }
    this.#settle();
  }

  choose(index: number): void {
    const ins = this.#state.mode === 'run' ? this.#instr() : null;
    if (ins?.op !== 'choice') throw new EngineError('選択肢は表示されていません');
    const opt = visibleOptions(ins, (e) => this.#test(e))[index];
    if (!opt) throw new EngineError(`選択肢の番号が範囲外です: ${index}`);
    this.#state.pc = opt.to;
    this.#settle();
  }

  // ---- 探索編 --------------------------------------------------------------------

  /** 画面上の点（256×192 ドットの座標）を調べる */
  examine(x: number, y: number): void {
    const hit = examineAt(this.#requirePlace('examine'), x, y, (e) => this.#test(e));
    if (hit.seen) this.#markSeen(hit.seen);
    this.#run(hit.pc);
    this.#settle();
  }

  /** 別の場所へ移動する */
  move(place: string): void {
    const b = this.beat;
    if (b.kind !== 'investigate' || !b.move.some((m) => m.id === place))
      throw new EngineError(`ここからは移動できません: ${place}`);
    this.#goPlace(place);
    this.#settle();
  }

  /** 話題を選んで話す */
  talk(topic: string): void {
    const place = this.#requirePlace('talk');
    const b = this.beat;
    const t = place.talk.find((x) => x.id === topic);
    if (!t || b.kind !== 'investigate' || !b.talk.some((x) => x.id === topic))
      throw new EngineError(`今は選べない話題です: ${topic}`);
    this.#markSeen(t.id);
    this.#run(t.pc);
    this.#settle();
  }

  /**
   * 法廷記録の証拠品を詳しく調べる（法廷記録を開ける場面で、Beat の inspect にあるものだけ）。
   * 調べ終えると、調べ始めた場面（台詞・証言・選択肢・つきつけの要求・探偵メニュー）に戻る
   */
  inspect(evidence: string): void {
    const b = this.beat;
    if (!('inspect' in b) || !b.inspect?.includes(evidence)) {
      throw new EngineError(`今は詳しく調べられません: ${evidence}`);
    }
    const from = inspectFrame(this.#state);
    this.#enter(this.scenario.evidence[evidence]!.inspect!);
    this.#state.inspectFrom = from;
    this.#settle();
  }

  /**
   * 文の途中の [show] / [location] を、表示側がその文字まで来たときに状態へ反映する。
   * 同じ Beat のままなので、serial は変えない（文字送りをやり直さない）
   */
  applyInline(cmd: InlineCommand): void {
    applyInlineCommand(cmd, this.#state);
  }

  // ---- 保存・デバッグ -----------------------------------------------------------

  snapshot(): Snapshot {
    return { version: 1, scenario: this.scenario.id, state: cloneData(this.#state) };
  }

  /** デバッグ用: 任意のシーンへ飛ぶ（フラグや証拠品はそのまま。探索編の場所なら、来たときのブロックか探偵メニューから） */
  jumpTo(scene: string): void {
    if (this.scenario.scenes[scene]?.kind === 'place') this.#goPlace(scene);
    else this.#enter(scene);
    this.#settle();
  }

  /** デバッグ用: フラグを書き換える */
  setFlag(name: string, value: Value): void {
    this.#state.flags[name] = value;
    this.#changed();
  }

  /** 前回の呼び出し以降に起きた演出用イベントを取り出す */
  drainEvents(): EngineEvent[] {
    const e = this.#events;
    this.#events = [];
    return e;
  }

  subscribe(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  // ---- 内部 ----------------------------------------------------------------------

  #scene(): Scene {
    const sc = this.scenario.scenes[this.#state.scene];
    if (!sc) throw new EngineError(`存在しないシーンです: ${this.#state.scene}`);
    return sc;
  }

  #place(): PlaceScene {
    const sc = this.#scene();
    if (sc.kind !== 'place') throw new EngineError(`探索編の場所ではありません: ${sc.id}`);
    return sc;
  }

  #requirePlace(action: string): PlaceScene {
    if (this.#state.mode !== 'investigate')
      throw new EngineError(`探偵メニューでないと ${action} できません`);
    return this.#place();
  }

  #markSeen(id: string) {
    if (!this.#state.seen.includes(id)) this.#state.seen.push(id);
  }

  /** 場所へ行く。来たときのブロックがあれば実行し、なければすぐ探偵メニュー */
  #goPlace(id: string) {
    this.#enter(id);
    const place = this.#place();
    if (place.enter !== undefined) this.#run(place.enter);
    else this.#toMenu();
  }

  /** 今の場所の探偵メニューにする（背景と、その場所にいる人物を表示する） */
  #toMenu() {
    const s = this.#state;
    const place = this.#place();
    s.mode = 'investigate';
    s.vars = {};
    s.stage.location = place.background;
    s.stage.character = personAt(place, (e) => this.#test(e));
    if (!s.visited.includes(place.id)) s.visited.push(place.id);
  }

  #testimony(): TestimonyScene {
    const sc = this.#scene();
    if (sc.kind !== 'testimony') throw new EngineError(`証言のシーンではありません: ${sc.id}`);
    return sc;
  }

  #instr(): Instr {
    const ins = this.#scene().program[this.#state.pc];
    if (!ins) throw new EngineError(`${this.#state.scene} の命令 ${this.#state.pc} がありません`);
    return ins;
  }

  #requireCross(action: string) {
    const s = this.#state;
    if (s.mode !== 'testimony' || s.phase !== 'cross')
      throw new EngineError(`尋問中でないと ${action} できません`);
  }

  #env: ExprEnv = stateEnv(() => this.#state);

  #test(e: Expr | undefined): boolean {
    return e === undefined || !!evalExpr(e, this.#env);
  }

  #toStatement(phase: 'reading' | 'cross', index: number) {
    const bad = enterStatement(this.#testimony(), this.#state, phase, index, this.#events);
    if (bad) throw new EngineError(`証言の前のブロックに止まる命令があります: ${bad}`);
  }

  #run(pc: number) {
    this.#state.mode = 'run';
    this.#state.pc = pc;
  }

  #resume(to: ResumeTarget) {
    const s = this.#state;
    s.vars = {};
    const r = resumeStep(this.#testimony(), s, to, (e) => this.#test(e));
    if (r === 'crossIntro') {
      s.mode = 'testimony';
      s.phase = 'crossIntro';
    } else if ('run' in r) this.#run(r.run);
    else this.#toStatement('cross', r.statement);
  }

  #enter(scene: string) {
    const s = this.#state;
    const sc = this.scenario.scenes[scene];
    if (!sc) throw new EngineError(`存在しないシーンです: ${scene}`);
    // 探索編の場所から出るときは、場所の背景をやめる（法廷なら立ち位置で背景が決まる）
    if (this.scenario.scenes[s.scene]?.kind === 'place' && sc.kind !== 'place') {
      s.stage.location = null;
      s.stage.character = null;
    }
    s.scene = scene;
    s.pc = 0;
    s.vars = {};
    s.inspectFrom = null;
    s.stage.evidence = null;
    // 場所は、来たときのブロックで visited(場所) を「初めてか」の判定に使えるよう、探偵メニューに着いたときに記録する
    if (sc.kind !== 'place' && !s.visited.includes(scene)) s.visited.push(scene);
    if (sc.kind === 'testimony') {
      s.mode = 'testimony';
      s.phase = 'intro';
      s.statement = 0;
    } else if (sc.kind === 'place') {
      s.stage.location = sc.background;
      s.stage.character = null;
      s.mode = 'run';
    } else s.mode = 'run';
  }

  /** 停止する命令（台詞・選択肢など）に着くまで命令を実行する */
  #settle() {
    const s = this.#state;
    for (let n = 0; n < STEP_LIMIT; n++) {
      if (s.mode === 'testimony' || s.mode === 'investigate') break;
      const ins = this.#instr();
      switch (ins.op) {
        case 'say':
          // 心の声（青字）では立ち絵を切り替えない
          if (
            this.scenario.autoShow &&
            ins.speaker &&
            ins.color !== 'blue' &&
            s.stage.character !== ins.speaker
          ) {
            s.stage.character = ins.speaker;
            s.stage.pose = null;
          }
          // 文中で BGM を切り替えるときは、セーブデータに残るよう状態も切り替えておく（鳴らすのは表示側）
          for (const m of bgmMarks(ins.text)) s.stage.bgm = m;
          this.#changed();
          return;
        case 'shout':
        case 'banner':
        case 'card':
        case 'choice':
        case 'demand':
        case 'end':
        case 'gameover':
        case 'wait':
          this.#changed();
          return;
        case 'fade':
          if (!ins.wait) {
            execSimple(ins, s, this.#events);
            s.pc++;
            break;
          } // 止まらないフェード
          s.stage.fade = ins.dir === 'out' ? ins.color : null;
          this.#events.push({ type: 'fade', dir: ins.dir, color: ins.color, frames: ins.frames });
          this.#changed();
          return;
        case 'jump':
          s.pc = ins.to;
          break;
        case 'random':
          s.pc = ins.to[Math.floor(Math.random() * ins.to.length)] ?? s.pc + 1;
          break;
        case 'jumpUnless':
          s.pc = this.#test(ins.cond) ? s.pc + 1 : ins.to;
          break;
        case 'goto':
          this.#enter(ins.scene);
          break;
        case 'resume':
          this.#resume(ins.to);
          break;
        case 'investigate':
          this.#goPlace(ins.place);
          break;
        case 'menu':
          this.#toMenu();
          break;
        case 'inspectEnd': {
          const f = s.inspectFrom;
          if (!f) throw new EngineError('詳しく調べるブロックの外で inspectEnd に来ました');
          if (returnFromInspect(s, f)) this.#toMenu();
          break;
        }
        case 'penalty':
          s.life = Math.max(0, s.life - ins.amount);
          this.#events.push({ type: 'penalty', amount: ins.amount, life: s.life });
          if (s.life > 0) {
            s.pc++;
            break;
          }
          if (this.scenario.gameoverScene) {
            this.#enter(this.scenario.gameoverScene);
            break;
          }
          this.#changed();
          throw new EngineError('ライフが尽きましたが、gameover シーンが定義されていません');
        default:
          if (execSimple(ins, s, this.#events)) s.pc++;
          else throw new EngineError(`実行できない命令です: ${ins.op}`);
      }
    }
    if (s.mode === 'run')
      throw new EngineError(`${STEP_LIMIT} 命令を実行しても止まりません（無限ループの可能性）`);
    this.#changed();
  }

  #changed() {
    this.serial++;
    for (const fn of this.#listeners) fn();
  }
}
