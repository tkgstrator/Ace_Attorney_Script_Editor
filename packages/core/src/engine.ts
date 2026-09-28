import {
  firstVisible,
  instrBeat,
  nextVisible,
  testimonyBeat,
  visibleOptions,
  visibleStatements,
} from './beat.ts';
import { cloneData } from './clone.ts';
import { EngineError } from './errors.ts';
import { applyInlineCommand } from './exec.ts';
import { inspectFrame } from './inspect.ts';
import { examineAt, investigateBeat, personAt } from './investigation.ts';
import { Machine } from './machine.ts';
import { holds, kindOf, type RecordKind, recordName } from './present.ts';
import type { InlineCommand } from './rich.ts';
import { initialState, migrateState } from './state.ts';
import type {
  Beat,
  CompiledScenario,
  EngineEvent,
  Expr,
  GameState,
  Snapshot,
  Value,
} from './types.ts';

export { EngineError };

/**
 * シナリオの実行器。描画や入力を持たず、状態の遷移だけを扱う。
 *
 * 表示側は `beat` を見て画面を作り、プレイヤーの操作に応じて
 * advance / back / press / present / choose（探索編では examine / move / talk / present）を呼ぶ。
 */
export class Engine {
  readonly scenario: CompiledScenario;
  /** 状態と、命令を実行して止まる場面まで進める処理 */
  readonly #m: Machine;
  #listeners = new Set<() => void>();
  /** 状態が変わるたびに増える番号。表示側で「別の Beat になったか」の判定に使う */
  serial = 0;

  constructor(scenario: CompiledScenario, snapshot?: Snapshot) {
    this.scenario = scenario;
    const changed = () => this.#changed();
    if (snapshot) {
      if (snapshot.scenario !== scenario.id)
        throw new EngineError(`別のシナリオのセーブデータです: ${snapshot.scenario}`);
      this.#m = new Machine(scenario, migrateState(cloneData(snapshot.state), scenario), changed);
    } else {
      this.#m = new Machine(scenario, initialState(scenario), changed);
      this.#m.enter(scenario.startScene);
    }
    this.#m.settle();
  }

  get state(): Readonly<GameState> {
    return this.#m.state;
  }

  get beat(): Beat {
    const s = this.#m.state;
    if (s.mode === 'investigate')
      return investigateBeat(this.scenario, this.#m.place(), s, (e) => this.#m.test(e));
    const test = (e: Expr | undefined) => this.#m.test(e);
    if (s.mode === 'testimony') return testimonyBeat(this.scenario, this.#m.testimony(), s, test);
    return instrBeat(this.scenario, this.#m.instr(), s, test);
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
    if (b.kind === 'statement' && b.cross) {
      const t = this.scenario.scenes[this.state.scene];
      return t?.kind === 'testimony' && !!t.statements[this.state.statement]?.presentProfile;
    }
    return (b.kind === 'demand' && !!b.profiles) || (b.kind === 'investigate' && b.present);
  }

  // ---- プレイヤーの操作 ------------------------------------------------------

  /** 文章送り。証言中は次の証言へ進む */
  advance(): void {
    const s = this.#m.state;
    if (s.mode === 'testimony') {
      const t = this.#m.testimony();
      switch (s.phase) {
        case 'intro':
          if (t.reading !== undefined) this.#m.run(t.reading);
          else
            this.#m.toStatement(
              'reading',
              firstVisible(t, (e) => this.#m.test(e)),
            );
          break;
        case 'crossIntro':
          this.#m.toStatement(
            'cross',
            firstVisible(t, (e) => this.#m.test(e)),
          );
          break;
        case 'reading': {
          const next = nextVisible(t, s.statement, (e) => this.#m.test(e));
          if (next !== null) this.#m.toStatement('reading', next);
          else if (t.after !== undefined) this.#m.run(t.after);
          else s.phase = 'crossIntro';
          break;
        }
        case 'cross':
          this.#m.resume('next');
          break;
      }
    } else {
      const ins = this.#m.instr();
      if (ins.op === 'choice' || ins.op === 'demand')
        throw new EngineError(`${ins.op} では advance できません`);
      if (ins.op === 'end' || ins.op === 'gameover') return;
      s.pc++;
    }
    this.#m.settle();
  }

  /** 尋問中に一つ前の証言へ戻る */
  back(): void {
    const s = this.#m.state;
    this.#m.requireCross('back');
    const visible = visibleStatements(this.#m.testimony(), (e) => this.#m.test(e));
    const i = visible.indexOf(s.statement);
    if (i > 0) {
      s.statement = visible[i - 1]!;
      this.#changed();
    }
  }

  press(): void {
    this.#m.requireCross('press');
    const st = this.#m.testimony().statements[this.#m.state.statement]!;
    if (st.press === undefined) throw new EngineError('この証言はゆさぶれません');
    this.#m.run(st.press);
    this.#m.settle();
  }

  /** 法廷記録の項目をつきつける。kind を省くと、証拠品の ID なら証拠品、そうでなければ人物ファイル */
  present(id: string, kind: RecordKind = kindOf(this.scenario, id)): void {
    const s = this.#m.state;
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
      this.#m.requireCross('present');
      const t = this.#m.testimony();
      const st = t.statements[s.statement]!;
      if (profile && !st.presentProfile)
        throw new EngineError('この証言では人物ファイルをつきつけられません');
      const target = profile ? st.presentProfile![id] : st.present[id];
      s.vars = { evidence: name };
      this.#m.run(target ?? t.wrong);
    } else if (s.mode === 'investigate') {
      const place = this.#m.place();
      if (personAt(place, (e) => this.#m.test(e)) === null)
        throw new EngineError('この場所には証拠品をつきつける相手がいません');
      s.vars = { evidence: name };
      this.#m.run((profile ? place.presentProfile?.[id] : place.present[id]) ?? place.presentWrong);
    } else {
      const ins = this.#m.instr();
      if (ins.op !== 'demand') throw new EngineError('今は証拠品をつきつけられません');
      if (profile && !ins.profiles)
        throw new EngineError('このつきつけの要求では人物ファイルをつきつけられません');
      s.vars = { evidence: name };
      s.pc = (profile ? ins.profiles![id] : ins.options[id]) ?? ins.wrong;
    }
    this.#m.settle();
  }

  /** サイコ・ロックのつきつけをやめる（つきつけの要求に giveUp があるときだけ） */
  giveUp(): void {
    const ins = this.#m.state.mode === 'run' ? this.#m.instr() : null;
    if (ins?.op !== 'demand' || ins.giveUp === undefined)
      throw new EngineError('今はやめられません');
    this.#m.state.pc = ins.giveUp;
    this.#m.settle();
  }

  choose(index: number): void {
    const ins = this.#m.state.mode === 'run' ? this.#m.instr() : null;
    if (ins?.op !== 'choice') throw new EngineError('選択肢は表示されていません');
    const opt = visibleOptions(ins, (e) => this.#m.test(e))[index];
    if (!opt) throw new EngineError(`選択肢の番号が範囲外です: ${index}`);
    this.#m.state.pc = opt.to;
    this.#m.settle();
  }

  // ---- 探索編 --------------------------------------------------------------------

  /** 画面上の点（256×192 ドットの座標）を調べる */
  examine(x: number, y: number): void {
    const hit = examineAt(this.#m.requirePlace('examine'), x, y, (e) => this.#m.test(e));
    if (hit.seen) this.#m.markSeen(hit.seen);
    this.#m.run(hit.pc);
    this.#m.settle();
  }

  /** 別の場所へ移動する */
  move(place: string): void {
    const b = this.beat;
    if (b.kind !== 'investigate' || !b.move.some((m) => m.id === place))
      throw new EngineError(`ここからは移動できません: ${place}`);
    this.#m.goPlace(place);
    this.#m.settle();
  }

  /** 話題を選んで話す */
  talk(topic: string): void {
    const place = this.#m.requirePlace('talk');
    const b = this.beat;
    const t = place.talk.find((x) => x.id === topic);
    if (!t || b.kind !== 'investigate' || !b.talk.some((x) => x.id === topic))
      throw new EngineError(`今は選べない話題です: ${topic}`);
    this.#m.markSeen(t.id);
    this.#m.run(t.pc);
    this.#m.settle();
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
    const from = inspectFrame(this.#m.state);
    this.#m.enter(this.scenario.evidence[evidence]!.inspect!);
    this.#m.state.inspectFrom = from;
    this.#m.settle();
  }

  /**
   * 文の途中の [show] / [location] を、表示側がその文字まで来たときに状態へ反映する。
   * 同じ Beat のままなので、serial は変えない（文字送りをやり直さない）
   */
  applyInline(cmd: InlineCommand): void {
    applyInlineCommand(cmd, this.#m.state);
  }

  // ---- 保存・デバッグ -----------------------------------------------------------

  snapshot(): Snapshot {
    return { version: 1, scenario: this.scenario.id, state: cloneData(this.#m.state) };
  }

  /** デバッグ用: 任意のシーンへ飛ぶ（フラグや証拠品はそのまま。探索編の場所なら、来たときのブロックか探偵メニューから） */
  jumpTo(scene: string): void {
    if (this.scenario.scenes[scene]?.kind === 'place') this.#m.goPlace(scene);
    else this.#m.enter(scene);
    this.#m.settle();
  }

  /** デバッグ用: フラグを書き換える */
  setFlag(name: string, value: Value): void {
    this.#m.state.flags[name] = value;
    this.#changed();
  }

  /** 前回の呼び出し以降に起きた演出用イベントを取り出す */
  drainEvents(): EngineEvent[] {
    const e = this.#m.events;
    this.#m.events = [];
    return e;
  }

  subscribe(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  // ---- 内部 ----------------------------------------------------------------------

  #changed() {
    this.serial++;
    for (const fn of this.#listeners) fn();
  }
}
