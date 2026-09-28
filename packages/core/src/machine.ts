// Engine の中身: 状態と、命令を実行して止まる場面まで進める処理（シーンへ入る・証言へ移る・探偵メニューにする など）。
// プレイヤーの操作を受けるのは Engine（engine.ts）で、ここは Engine からだけ使う（パッケージの外には出さない）。
import { resumeStep } from './beat.ts';
import { EngineError } from './errors.ts';
import { enterStatement, execSimple } from './exec.ts';
import { type ExprEnv, evalExpr } from './expr.ts';
import { returnFromInspect } from './inspect.ts';
import { personAt } from './investigation.ts';
import { plainBgm as bgmMarks } from './rich.ts';
import { stateEnv } from './state.ts';
import type {
  CompiledScenario,
  EngineEvent,
  Expr,
  GameState,
  Instr,
  PlaceScene,
  ResumeTarget,
  Scene,
  TestimonyScene,
} from './types.ts';

const STEP_LIMIT = 100_000;

export class Machine {
  readonly scenario: CompiledScenario;
  readonly state: GameState;
  /** 前回取り出して以降に起きた演出用イベント（Engine の drainEvents で入れ替える） */
  events: EngineEvent[] = [];
  /** 状態が変わったことを Engine に知らせる */
  readonly #changed: () => void;
  readonly #env: ExprEnv = stateEnv(() => this.state);

  constructor(scenario: CompiledScenario, state: GameState, changed: () => void) {
    this.scenario = scenario;
    this.state = state;
    this.#changed = changed;
  }

  test(e: Expr | undefined): boolean {
    return e === undefined || !!evalExpr(e, this.#env);
  }

  scene(): Scene {
    const sc = this.scenario.scenes[this.state.scene];
    if (!sc) throw new EngineError(`存在しないシーンです: ${this.state.scene}`);
    return sc;
  }

  place(): PlaceScene {
    const sc = this.scene();
    if (sc.kind !== 'place') throw new EngineError(`探索編の場所ではありません: ${sc.id}`);
    return sc;
  }

  requirePlace(action: string): PlaceScene {
    if (this.state.mode !== 'investigate')
      throw new EngineError(`探偵メニューでないと ${action} できません`);
    return this.place();
  }

  markSeen(id: string) {
    if (!this.state.seen.includes(id)) this.state.seen.push(id);
  }

  /** 場所へ行く。来たときのブロックがあれば実行し、なければすぐ探偵メニュー */
  goPlace(id: string) {
    this.enter(id);
    const place = this.place();
    if (place.enter !== undefined) this.run(place.enter);
    else this.toMenu();
  }

  /** 今の場所の探偵メニューにする（背景と、その場所にいる人物を表示する） */
  toMenu() {
    const s = this.state;
    const place = this.place();
    s.mode = 'investigate';
    s.vars = {};
    s.stage.location = place.background;
    s.stage.character = personAt(place, (e) => this.test(e));
    if (!s.visited.includes(place.id)) s.visited.push(place.id);
  }

  testimony(): TestimonyScene {
    const sc = this.scene();
    if (sc.kind !== 'testimony') throw new EngineError(`証言のシーンではありません: ${sc.id}`);
    return sc;
  }

  instr(): Instr {
    const ins = this.scene().program[this.state.pc];
    if (!ins) throw new EngineError(`${this.state.scene} の命令 ${this.state.pc} がありません`);
    return ins;
  }

  requireCross(action: string) {
    const s = this.state;
    if (s.mode !== 'testimony' || s.phase !== 'cross')
      throw new EngineError(`尋問中でないと ${action} できません`);
  }

  toStatement(phase: 'reading' | 'cross', index: number) {
    const bad = enterStatement(this.testimony(), this.state, phase, index, this.events);
    if (bad) throw new EngineError(`証言の前のブロックに止まる命令があります: ${bad}`);
  }

  run(pc: number) {
    this.state.mode = 'run';
    this.state.pc = pc;
  }

  resume(to: ResumeTarget) {
    const s = this.state;
    s.vars = {};
    const r = resumeStep(this.testimony(), s, to, (e) => this.test(e));
    if (r === 'crossIntro') {
      s.mode = 'testimony';
      s.phase = 'crossIntro';
    } else if ('run' in r) this.run(r.run);
    else this.toStatement('cross', r.statement);
  }

  enter(scene: string) {
    const s = this.state;
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
  settle() {
    const s = this.state;
    for (let n = 0; n < STEP_LIMIT; n++) {
      if (s.mode === 'testimony' || s.mode === 'investigate') break;
      const ins = this.instr();
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
            execSimple(ins, s, this.events);
            s.pc++;
            break;
          } // 止まらないフェード
          s.stage.fade = ins.dir === 'out' ? ins.color : null;
          this.events.push({ type: 'fade', dir: ins.dir, color: ins.color, frames: ins.frames });
          this.#changed();
          return;
        case 'jump':
          s.pc = ins.to;
          break;
        case 'random':
          s.pc = ins.to[Math.floor(Math.random() * ins.to.length)] ?? s.pc + 1;
          break;
        case 'jumpUnless':
          s.pc = this.test(ins.cond) ? s.pc + 1 : ins.to;
          break;
        case 'goto':
          this.enter(ins.scene);
          break;
        case 'resume':
          this.resume(ins.to);
          break;
        case 'investigate':
          this.goPlace(ins.place);
          break;
        case 'menu':
          this.toMenu();
          break;
        case 'inspectEnd': {
          const f = s.inspectFrom;
          if (!f) throw new EngineError('詳しく調べるブロックの外で inspectEnd に来ました');
          if (returnFromInspect(s, f)) this.toMenu();
          break;
        }
        case 'penalty':
          s.life = Math.max(0, s.life - ins.amount);
          this.events.push({ type: 'penalty', amount: ins.amount, life: s.life });
          if (s.life > 0) {
            s.pc++;
            break;
          }
          if (this.scenario.gameoverScene) {
            this.enter(this.scenario.gameoverScene);
            break;
          }
          this.#changed();
          throw new EngineError('ライフが尽きましたが、gameover シーンが定義されていません');
        default:
          if (execSimple(ins, s, this.events)) s.pc++;
          else throw new EngineError(`実行できない命令です: ${ins.op}`);
      }
    }
    if (s.mode === 'run')
      throw new EngineError(`${STEP_LIMIT} 命令を実行しても止まりません（無限ループの可能性）`);
    this.#changed();
  }
}
