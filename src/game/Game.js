// アストラのじゃがいも畑：ゲーム全体のまとめ役。
//   - 状態は STATES の表（title / intro / play / paused / dead / report / ending）。画面・HUD・入力・曲の出し入れは setState() が表を見て行う
//   - step(dt) で 1 コマ進める（入力 → 状態ごとの処理 → 世界の更新 → 入力の endFrame）。描画は render() だけ
//   - 1 日 = 昼（畑しごと）→ 夕方（アストラは家へ）→ 夜（緑のアレが増える）→ 朝 → 報告。5 日でおしまい
import * as THREE from 'three';
import { t } from '../core/i18n.js';
import { events } from '../core/events.js';
import { createStore } from '../core/save.js';
import { clamp, damp, lerp } from '../core/math.js';
import { buildAtlas } from './world/atlas.js';
import { World, LAYOUT, GY, WX, WZ, inRect } from './world/World.js';
import { Mesher } from './world/Mesher.js';
import { B, BLOCKS, isCrop, isFarm, cropStage, needsSupport } from './world/blocks.js';
import { shared } from './world/materials.js';
import { Sky } from './Sky.js';
import { Player } from './Player.js';
import { Robot } from './Robot.js';
import { Green, Pig } from './Mobs.js';
import { Drops } from './items.js';
import { Particles, FloatTexts, selectionBox } from './fx.js';
import { Talk } from './talk.js';
import { drawFace } from './models.js';
import { GameHud } from '../ui/GameHud.js';
import { addGameModals, fillReport, fillEnding, fillEndless } from '../ui/GameModals.js';
import { settings } from '../core/settings.js';

// 1 日ごとの設定：目標（収穫する数）、昼と夜の長さ（秒）、出てくる緑のアレの数
export const DAYS = [
  { goal: 40, day: 170, night: 50, mobsDay: 1, mobsNight: 3 },
  { goal: 70, day: 145, night: 55, mobsDay: 2, mobsNight: 4 },
  { goal: 100, day: 145, night: 60, mobsDay: 3, mobsNight: 6 },
  { goal: 130, day: 145, night: 65, mobsDay: 4, mobsNight: 8 },
  { goal: 160, day: 145, night: 75, mobsDay: 5, mobsNight: 9, boss: true },
];
const DUSK = 12, DAWN = 7;
const REACH = 4.8;
const RANKS = [0, 300, 600, 900];   // 合計収穫数の称号のしきい
// 持ちもの（持ちもの欄の 1〜5）。右クリック（つかう）の動作は、持っているもので決まる
export const TOOLS = ['sword', 'hoe', 'potato', 'dirt', 'powder'];

// title：タイトルを出す ／ hud：ゲーム中の表示 ／ touch：タッチの操作 ／ input：play・actions・menu ／ music：曲 ／ modal：開く画面 ／ duck：曲を下げる
export const STATES = {
  title: { title: true, input: 'menu', music: 'title' },
  intro: { input: 'menu', modal: 'intro', music: 'title' },
  play: { hud: true, touch: true, input: 'play' },
  paused: { hud: true, input: 'menu', modal: 'pause', duck: true },
  dead: { hud: true, input: 'actions' },
  report: { input: 'menu', modal: 'report', music: 'report' },
  ending: { input: 'menu', modal: 'ending', music: 'ending' },
};

export class Game {
  constructor({ renderer, input, audio, screens, touch, ui }) {
    Object.assign(this, { renderer, input, audio, screens, touch });
    // run：ストーリーの続き ／ endless：エンドレスじゃがいモードの続き（別の枠）／ cleared：5 日間をクリアした
    this.save = createStore('astra-potato-farm.save', { best: 0, run: null, cleared: false, endless: null, endlessBest: null }, 1);
    this.mode = 'story';
    this.time = 0;
    this.state = 'title';
    this.atlas = buildAtlas();

    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(0x8ec3ff);
    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 520);
    this.camera.name = 'camera';
    scene.add(this.camera);

    this.world = new World();
    this.mesher = new Mesher(this.world, this.atlas);
    scene.add(this.mesher.group);
    this.sky = new Sky(scene, this.atlas);
    this.particles = new Particles(scene);
    this.floats = new FloatTexts(scene);
    this.sel = selectionBox();
    scene.add(this.sel);

    this.player = new Player(this, this.camera);
    this.robot = new Robot(this);
    this.mobs = [];
    this.pigs = [];
    this.drops = new Drops(this);
    this.crops = new Map();
    this.reserved = new Set();

    this.hud = new GameHud(ui, {
      atlas: this.atlas,
      drawFace,
      glyphCtx: () => ({ device: input.device, padType: settings.padType === 'auto' ? input.padType : settings.padType }),
      onSlot: (k) => { if (this.state === 'play') this.selectTool(k); },
    });
    this.talk = new Talk({
      onLine: (text) => {
        this.hud.chat(text, 'astra', t('name.astra'));
        this.audio.sfx('robot_talk', { pos: this.robot.body.pos, refDistance: 6, n: Math.min(6, 2 + Math.floor(text.length / 10)) });
      },
      onSys: (text, kind) => this.hud.chat(text, kind),
    });
    addGameModals(screens, this.atlas);
    screens.cb.onAction = (act) => this.onAction(act);

    renderer.setScene(scene, this.camera);
    renderer.renderer.toneMapping = THREE.NoToneMapping;
    renderer.setLook({ exposure: 1, bloomStrength: 0.32, bloomRadius: 0.4, bloomThreshold: 0.92, vignette: 0.22, saturation: 1.06, contrast: 1.02 });
    const onResize = () => {
      const r = renderer.renderer;
      const v = new THREE.Vector2();
      r.getDrawingBufferSize(v);
      this.particles.setScale(v.y, this.camera.fov);
    };
    renderer.onResize = onResize;
    onResize();

    this.titleMode = true;
    this.titleAng = 0.6;
    this.shake = 0;
    this.flash = 0;
    this.fade = 0;
    this.grace = 0;
    this.attackCool = 0;
    this.useCool = 0;
    this.eatCool = 0;
    this.target = null;
    this.targetMob = null;
    this.targetRobot = false;
    this.useDecision = null;
    this.tool = 'sword';
    this.stock = 6;
    this.powder = 0;
    this.green = 0;
    this.dayIndex = 0;
    this.clock = 30;
    this.phase = 'day';
    this.today = this.freshToday();
    this.totals = { harvest: 0, kills: 0, booms: 0, stars: 0, green: 0 };
  }

  say(key, opts) { return this.titleMode ? false : this.talk.say(key, opts); }

  freshToday() { return { harvest: 0, kills: 0, booms: 0, lost: 0, goalDone: false }; }

  /** 読み込み：世界を作って、最初の形を作る。 */
  async init() {
    await document.fonts?.ready;
    this.world.generate();
    this.rebuildCrops();
    this.mesher.update(999);
    this.spawnPigs();
    this.robot.reset();
    this.player.reset(LAYOUT.spawn);
    this.updateTitleCamera(0);
    this.sky.update(0.12, this.camera, 0, 0);
    this.screens.setContinue(!!this.save.data.run);
    this.screens.setEndless?.(!!this.save.data.cleared);
    this.updateBestLabel();
    this.setSplash();
    this.setState('title');
  }

  // ------------------------------------------------------------------ 状態
  setState(s) {
    const S = STATES[s];
    if (!S) throw new Error('状態がありません: ' + s);
    const prev = this.state;
    this.state = s;
    this.screens.showTitle(!!S.title);
    this.hud.show(!!S.hud);
    this.touch.setVisible(!!S.touch);
    this.input.mode = S.input || 'menu';
    if (!S.modal) this.screens.closeAll();
    else if (!this.screens.isOpen(S.modal)) { this.screens.closeAll(); this.screens.open(S.modal); }
    if (S.music) this.audio.music(S.music);
    this.audio.duck(!!S.duck);
    if (s !== 'play' && s !== 'paused' && s !== 'dead') this.input.unlockPointer?.();
    this[`enter_${s}`]?.(prev);
    if (prev !== s) events.emit('state', { from: prev, to: s });
  }

  enter_title() {
    this.titleMode = true;
    this.mode = 'story';
    this.screens.setContinue(!!this.save.data.run);
    this.screens.setEndless?.(!!this.save.data.cleared);
    this.updateBestLabel();
    this.setSplash();
    this.audio.setAmbience({ wind: 0.3 });
    this.audio.loop('birds', 'bird', { period: 2.6, jitter: 1.6 });
    this.audio.stopLoop('crickets');
  }
  enter_play(prev) {
    this.grace = 0.25;
    this.titleMode = false;
    if (prev !== 'paused') this.updateMusic(true);
  }
  enter_paused() { this.audio.sfx('pause'); }
  enter_dead() { this.deadT = 0; this.hud.setDead(true); this.audio.sfx('hurt', { big: true }); }

  /** はじめから（あらすじを見せてから 1 日目）。 */
  start() {
    this.mode = 'story';
    this.tool = 'sword';
    this.player.setTool('sword');
    this.save.data.run = null;
    this.save.save();
    this.newWorld();
    this.stock = 6; this.powder = 0; this.green = 0;
    this.totals = { harvest: 0, kills: 0, booms: 0, stars: 0, green: 0 };
    this.tut = { step: 0, harvest: 0, plant: 0, till: 0 };
    this.setState('intro');
  }

  /** つづきから（その日の朝から）。 */
  continueGame() {
    const r = this.save.data.run;
    if (!r) { this.start(); return; }
    this.mode = 'story';
    this.loadRun(r);
    this.startDay(r.day, { fromSave: true });
    this.setState('play');
  }

  /** エンドレスじゃがいモード：fresh なら新しい島の 1 日目から、そうでなければセーブの日の朝から。 */
  startEndless(fresh = false) {
    const r = this.save.data.endless;
    this.mode = 'endless';
    if (r && !fresh) {
      this.loadRun(r);
      this.startDay(r.day, { fromSave: true });
    } else {
      this.newWorld();
      this.tool = 'sword';
      this.player.setTool('sword');
      this.stock = 6; this.powder = 0; this.green = 0;
      this.totals = { harvest: 0, kills: 0, booms: 0, stars: 0, green: 0 };
      this.tut = null;
      this.startDay(0, { endlessHello: true });
    }
    this.setState('play');
    this.lockPointer?.();
  }

  /** やりなおす（一時停止から）：この日の朝のセーブから。 */
  retry() { if (this.mode === 'endless') this.startEndless(); else this.continueGame(); }

  reset() {
    // タイトルへ戻るとき：世界を作り直して、タイトルの景色にする
    this.newWorld();
    this.titleMode = true;
    this.hud.clearChat();
    this.renderer.setFx({ fade: 0, flash: 0 });
  }

  newWorld() {
    for (const m of this.mobs) m.dispose();
    this.mobs = [];
    this.drops.clear();
    this.particles.clear();
    this.floats.clear();
    this.reserved.clear();
    this.world.generate();
    this.rebuildCrops();
    this.mesher.update(999);
    this.robot.reset();
    this.player.reset(LAYOUT.spawn);
    this.spawnPigs();
    this.talk.reset();
    this.hud.clearChat();
    this.tut = null;
  }

  loadRun(r) {
    this.newWorld();
    this.world.applyDiff(r.diff || []);
    this.world.collectSpawns();
    this.rebuildCrops();
    this.mesher.update(999);
    this.stock = r.stock ?? 6;
    this.powder = r.powder ?? 0;
    this.green = r.green ?? 0;
    this.totals = { harvest: 0, kills: 0, booms: 0, stars: 0, green: 0, ...(r.totals || {}) };
    this.tut = null;
  }

  saveRun() {
    this.save.data[this.mode === 'endless' ? 'endless' : 'run'] = {
      day: this.dayIndex, stock: this.stock, powder: this.powder, green: this.green,
      totals: { ...this.totals }, diff: this.world.diff(),
    };
    this.save.save();
  }

  /** その日の設定。6 日目からは（エンドレス）少しずつ増やす。5 日ごとに大きいのが来る。 */
  dayConfig(i) {
    if (i < DAYS.length) return DAYS[i];
    const n = i + 1;
    return {
      goal: Math.min(200, 40 + 30 * (n - 1)), day: 145, night: Math.min(80, 60 + n),
      mobsDay: Math.min(6, 1 + Math.floor(n / 2)), mobsNight: Math.min(12, 3 + Math.floor(n * 0.9)), boss: n % 5 === 0,
    };
  }

  get lastDay() { return this.mode === 'story' && this.dayIndex >= DAYS.length - 1; }

  onAction(act) {
    if (act === 'introGo') { this.startDay(0); this.setState('play'); this.lockPointer?.(); }
    else if (act === 'nextDay') {
      if (this.lastDay) this.finish();
      else { this.startDay(this.dayIndex + 1); this.setState('play'); this.lockPointer?.(); }
    } else if (act === 'endlessGo') {
      // エンディングから：同じ畑のまま 6 日目へ
      this.mode = 'endless';
      this.startDay(DAYS.length, { endlessStart: true });
      this.setState('play');
      this.lockPointer?.();
    } else if (act === 'endless') {
      if (this.save.data.endless) { fillEndless(this.screens, this.save.data.endless.day + 1); this.screens.open('endless'); }
      else this.startEndless(true);
    } else if (act === 'endlessContinue') this.startEndless(false);
    else if (act === 'endlessNew') this.startEndless(true);
  }

  // ------------------------------------------------------------------ 1 日
  startDay(i, { fromSave = false, endlessStart = false, endlessHello = false } = {}) {
    this.dayIndex = i;
    this.cfg = this.dayConfig(i);
    this.clock = 0;
    this.phase = 'day';
    this.today = this.freshToday();
    for (const m of this.mobs) m.dispose();
    this.mobs = [];
    this.schedule = this.buildSchedule(this.cfg, i);
    this.robot.reset([29.5, GY + 1, 27.5]);
    if (i > 0 || fromSave) this.robot.wake();
    this.player.reset(LAYOUT.spawn);
    this.talk.reset();
    this.hud.clearChat();
    this.renderer.setFx({ fade: 0, flash: 0 });
    this.fade = 0;
    this.hud.setDead(false);
    if (i === 0 && !fromSave && this.tut) {
      ['astra.hello.0', 'astra.hello.1', 'astra.hello.2', 'astra.hello.3', 'astra.hello.4'].forEach((k, n) => this.talk.say(k, { delay: 1.5 + n * 0.2, cool: 0 }));
    } else {
      this.tut = null;
      this.morningLine(i, { endlessStart, endlessHello });
    }
    this.hud.banner(t(this.mode === 'endless' ? 'banner.dayEndless' : 'banner.day', { n: i + 1 }), t('banner.daySub', { m: this.cfg.goal }), 3.6);
    this.audio.sfx('morning');
    this.saveRun();
    this.updateMusic(true);
  }

  /** 朝のアストラのひとこと（ストーリーは日ごと、エンドレスの 6 日目からは日数に合わせて）。 */
  morningLine(i, { endlessStart = false, endlessHello = false } = {}) {
    const n = i + 1;
    const say = (k, o = {}) => this.talk.say(k, { delay: 1.2, cool: 0, ...o });
    if (endlessHello) { say('astra.endless.hello'); return; }
    if (endlessStart) { say('astra.endless.start'); return; }
    if (i < DAYS.length && !(this.mode === 'endless' && this.cfg.boss)) {
      say('astra.morning.' + i);
      if (i === 1) this.talk.say('astra.lesson', { delay: 1.4, cool: 0 });
      return;
    }
    if (this.cfg.boss) say('astra.endless.boss', { vars: { n } });
    else if (n % 10 === 0) say('astra.endless.milestone', { vars: { n } });
    else say('astra.endless.morning', { random: true, vars: { n } });
  }

  buildSchedule(cfg, i) {
    const list = [];
    const start = i === 0 ? 1e9 : 35, end = cfg.day - 15;
    for (let k = 0; k < cfg.mobsDay; k++) list.push({ t: start + ((end - start) * (k + 0.3 + Math.random() * 0.4)) / cfg.mobsDay });
    if (i === 0) for (let k = 0; k < cfg.mobsDay; k++) list[k].t = 130 + k * 15; // 1 日目：あそびかたが済んでいなくても、ここで 1 体
    const ns = cfg.day + DUSK;
    for (let k = 0; k < cfg.mobsNight; k++) list.push({ t: ns + 3 + ((cfg.night - 14) * (k + Math.random() * 0.6)) / cfg.mobsNight });
    if (cfg.boss) list.push({ t: ns + cfg.night * 0.35, big: true });
    return list.sort((a, b) => a.t - b.t);
  }

  get dayLength() { return this.cfg.day + DUSK + this.cfg.night + DAWN; }
  get isNightish() { return this.phase === 'dusk' || this.phase === 'night'; }
  get robotCanPanic() { return !this.titleMode; }

  /** 見た目の時刻（0〜1）。 */
  get skyTime() {
    if (this.titleMode) return 0.13;
    const c = this.cfg, k = this.clock;
    if (k < c.day) return 0.02 + 0.44 * (k / c.day);
    if (k < c.day + DUSK) return 0.46 + 0.12 * ((k - c.day) / DUSK);
    if (k < c.day + DUSK + c.night) return 0.58 + 0.36 * ((k - c.day - DUSK) / c.night);
    return 0.94 + 0.08 * Math.min(1, (k - c.day - DUSK - c.night) / DAWN);
  }

  updateDay(dt) {
    const c = this.cfg;
    this.clock += dt;
    const k = this.clock;
    const phase = k < c.day ? 'day' : k < c.day + DUSK ? 'dusk' : k < c.day + DUSK + c.night ? 'night' : 'dawn';
    if (phase !== this.phase) {
      this.phase = phase;
      if (phase === 'dusk') {
        this.talk.sys('sys.dusk');
        this.talk.say('astra.dusk', { cool: 0 });
        this.robot.goToBed();
      } else if (phase === 'night') {
        this.hud.banner(t('banner.night'), t(c.boss ? 'banner.nightSubBoss' : 'banner.nightSub'), 3.2);
        this.audio.sfx('night');
        this.updateMusic();
      } else if (phase === 'dawn') {
        for (const m of this.mobs) m.leave();
        this.talk.sys('sys.dawn');
        this.audio.sfx('morning');
        this.updateMusic();
      }
    }
    // 緑のアレ
    let alive = this.mobs.filter((m) => !m.dead && m.state !== 'leave').length;
    const cap = phase === 'night' ? 5 : 3;
    let spawned = 0;
    while (this.schedule.length && k >= this.schedule[0].t) {
      if (phase === 'dawn') { this.schedule.shift(); continue; }
      const s = this.schedule[0];
      // 一度に出すのは 1 体まで。多すぎるときは少し待たせる
      if ((alive >= cap && !s.big) || spawned >= 1) { s.t = Math.max(s.t, k) + (spawned ? 1.5 : 4); this.schedule.sort((a, b) => a.t - b.t); break; }
      this.schedule.shift();
      if (this.spawnMob({ big: !!s.big })) { alive++; spawned++; }
    }
    // あそびかた（1 日目）
    this.updateTutorial();
    if (k >= this.dayLength) this.endDay();
  }

  updateTutorial() {
    const T = this.tut;
    if (!T || T.step < 0) return;
    if (T.step === 0 && T.harvest >= 3) { T.step = 1; this.talk.say('astra.tut.harvest', { cool: 0 }); this.audio.sfx('ding'); }
    else if (T.step === 1 && T.plant >= 3) { T.step = 2; this.talk.say('astra.tut.plant', { cool: 0 }); this.audio.sfx('ding'); }
    else if (T.step === 2 && T.till >= 2) {
      T.step = 3; this.talk.say('astra.tut.till', { cool: 0 }); this.audio.sfx('ding');
      T.mobAt = this.clock + 6;
    } else if (T.step === 3) {
      if (T.mobAt && this.clock >= T.mobAt) {
        T.mobAt = 0;
        T.mob = this.spawnMob({ near: true });
        this.talk.say('astra.tut.mob', { cool: 0, delay: 0.5 });
        // 予定していた昼の 1 体はこれに替える
        this.schedule = this.schedule.filter((s) => s.t > this.cfg.day);
      }
      if (T.mob && (T.mob.dead || !this.mobs.includes(T.mob))) {
        T.step = -1;
        this.talk.say('astra.tut.done', { cool: 0, delay: 1 });
        this.talk.sys('sys.goalHint', { m: this.cfg.goal });
      }
    }
  }

  objectiveText() {
    const T = this.tut;
    if (T && T.step >= 0) {
      if (T.step === 0) return t('obj.harvest', { n: Math.min(3, T.harvest), m: 3 });
      if (T.step === 1) return t('obj.plant', { n: Math.min(3, T.plant), m: 3 });
      if (T.step === 2) return t('obj.till', { n: Math.min(2, T.till), m: 2 });
      return t('obj.mob');
    }
    if (this.mobs.some((m) => m.big && !m.dead)) return t('obj.boss');
    if (this.phase === 'night' || this.phase === 'dusk') return t('obj.night');
    if (this.phase === 'dawn') return '';
    return this.today.goalDone ? t('obj.done') : '';
  }

  endDay() {
    const c = this.cfg;
    const ok = this.today.harvest >= c.goal;
    if (ok) this.totals.stars++;
    for (const m of this.mobs) m.dispose();
    this.mobs = [];
    const last = this.lastDay;
    if (this.mode === 'endless') {
      const b = this.save.data.endlessBest || { day: 0, harvest: 0 };
      this.save.data.endlessBest = { day: Math.max(b.day, this.dayIndex + 1), harvest: Math.max(b.harvest, this.totals.harvest) };
    }
    const line = t(`astra.report.${ok ? 'good' : 'ok'}.${Math.floor(Math.random() * 3)}`);
    fillReport(this.screens, { day: this.dayIndex + 1, harvest: this.today.harvest, kills: this.today.kills, booms: this.today.booms, goal: c.goal, line, last, endless: this.mode === 'endless' });
    // 夜のあいだにアストラが穴を埋めておく（畑のまわり）
    this.repairAll();
    if (!last) {
      // つぎの日の朝として保存（いま「つづきから」を選ぶと、つぎの日から）
      const keep = this.dayIndex;
      this.dayIndex = keep + 1;
      this.saveRun();
      this.dayIndex = keep;
    }
    this.audio.sfx(ok ? 'goal' : 'ding');
    this.setState('report');
  }

  finish() {
    const total = this.totals.harvest;
    let rank = 0;
    for (let i = 0; i < RANKS.length; i++) if (total >= RANKS[i]) rank = i;
    const newBest = total > (this.save.data.best || 0);
    if (newBest) this.save.data.best = total;
    const unlocked = !this.save.data.cleared;
    this.save.data.cleared = true;
    this.save.data.run = null;
    this.save.save();
    fillEnding(this.screens, { harvest: total, kills: this.totals.kills, stars: this.totals.stars, green: this.totals.green, rank, best: this.save.data.best, newBest, unlocked });
    this.setState('ending');
  }

  updateMusic(force = false) {
    if (this.state !== 'play' && !force) return;
    const night = this.phase === 'night' || this.phase === 'dusk';
    const id = night ? (this.cfg?.boss ? 'boss' : 'night') : 'day';
    this.audio.music(id, { crossfade: 2 });
    if (night) {
      this.audio.setAmbience({ wind: 0.18, crickets: 0.8 });
      this.audio.stopLoop('birds');
    } else {
      this.audio.setAmbience({ wind: 0.28 });
      this.audio.loop('birds', 'bird', { period: 2.4, jitter: 1.6 });
    }
  }

  // ------------------------------------------------------------------ 出てくるもの
  spawnPigs() {
    for (const p of this.pigs) p.dispose();
    this.pigs = [];
    const cells = this.world.pigCells;
    for (let i = 0; i < 3 && cells.length; i++) {
      const c = cells[Math.floor((i + 0.5) / 3 * cells.length + Math.random() * 20) % cells.length];
      this.pigs.push(new Pig(this, (c % WX) + 0.5, ((c / WX) | 0) + 0.5));
    }
  }

  spawnMob({ big = false, near = false } = {}) {
    const w = this.world;
    const pl = this.player.pos, rb = this.robot.body.pos;
    let best = null;
    for (let tries = 0; tries < 60; tries++) {
      const i = w.spawnCells[Math.floor(Math.random() * w.spawnCells.length)];
      if (i === undefined) break;
      const x = (i % WX) + 0.5, z = ((i / WX) | 0) + 0.5;
      const f = w.floor[i];
      const dp = Math.hypot(x - pl.x, z - pl.z), dr = Math.hypot(x - rb.x, z - rb.z);
      if (w.lightAt(x, f, z)[1] >= 8) continue;
      if (dp < (near ? 10 : 13) || dr < 10) continue;
      if (near && dp > 22) continue;
      best = [x, z];
      break;
    }
    if (!best) return null;
    const m = new Green(this, best[0], best[1], { big, night: this.phase === 'night' });
    this.mobs.push(m);
    // お知らせは続けて出さない（夜にまとめて来ると、チャット欄が埋まるので）
    // ガイドなし（設定）：お知らせと出てくる音を出さない（大きいのはイベントなので出す）
    const guide = settings.mobGuide !== 'off';
    if (big || (guide && this.time - (this.lastMobMsg ?? -99) > 10)) { this.lastMobMsg = this.time; this.talk.sys(big ? 'sys.boss' : 'sys.mob', null, 'warn'); }
    if (guide || big) this.audio.sfx(big ? 'boss_spawn' : 'mob_spawn', { pos: m.pos, refDistance: 8 });
    if (big) this.hud.banner(t('banner.boss'), t('banner.bossSub'), 3.2);
    return m;
  }

  nearestMob(pos) {
    let best = null;
    for (const m of this.mobs) {
      if (m.dead || m.state === 'leave') continue;
      const d = Math.hypot(m.pos.x - pos.x, m.pos.z - pos.z);
      if (!best || d < best.dist) best = { mob: m, dist: d };
    }
    return best;
  }

  nearestCrop(pos) {
    let best = null, bd = Infinity;
    for (const i of this.crops.keys()) {
      const x = i % WX, z = Math.floor(i / WX) % WZ;
      const d = (x + 0.5 - pos.x) ** 2 + (z + 0.5 - pos.z) ** 2;
      if (d < bd) { bd = d; best = [x, z]; }
    }
    return best;
  }

  isFarmCell(i) {
    if (i < 0 || i >= WX * WZ) return false;
    const x = i % WX, z = (i / WX) | 0;
    return isFarm(this.world.get(x, GY, z)) || inRect(x, z, LAYOUT.farmZone);
  }

  reserve(x, z, on) { const k = x + z * WX; if (on) this.reserved.add(k); else this.reserved.delete(k); }
  isReserved(x, z) { return this.reserved.has(x + z * WX); }

  // ------------------------------------------------------------------ 畑
  rebuildCrops() {
    this.crops.clear();
    const w = this.world;
    for (let y = 1; y < 20; y++) for (let z = 0; z < WZ; z++) for (let x = 0; x < WX; x++) {
      if (isCrop(w.get(x, y, z))) this.crops.set(w.idx(x, y, z), Math.random() * 0.6);
    }
  }

  growCrops(dt) {
    const w = this.world;
    for (const [i, prog] of this.crops) {
      const id = w.data[i];
      if (!isCrop(id)) { this.crops.delete(i); continue; }
      const st = id - B.POTATO0;
      if (st >= 3) continue;
      const below = w.data[i - WX * WZ];
      const wet = BLOCKS[below]?.wet;
      // 1 段 約 25 秒（水の近く）、約 50 秒（乾いた畑）。株ごとに少しばらつく
      const jitter = 0.8 + ((i * 2654435761) >>> 0) % 1000 / 2500;
      const np = prog + dt * (wet ? 1 / 25 : 1 / 50) * jitter;
      if (np >= 1) {
        const x = i % WX, z = Math.floor(i / WX) % WZ, y = Math.floor(i / (WX * WZ));
        w.set(x, y, z, id + 1);
        this.crops.set(i, 0);
        if (st + 1 === 3 && Math.random() < 0.3) this.particles.sparkle(x, y, z, 2, 0xd6ad62);
      } else this.crops.set(i, np);
    }
  }

  potatoYield() {
    const r = Math.random();
    return r < 0.25 ? 1 : r < 0.7 ? 2 : r < 0.94 ? 3 : 4;
  }

  /** 収穫（熟したもの）。who = 'player' ならアイテムが飛び出す、'robot' なら袋へ。 */
  harvest(x, y, z, who) {
    const w = this.world;
    if (w.get(x, y, z) !== B.POTATO3) return 0;
    const n = this.potatoYield();
    w.set(x, y, z, B.AIR);
    this.crops.delete(w.idx(x, y, z));
    const lb = this.lightBright(x, y, z);
    this.particles.burst(x, y, z, 0x5d9e3a, 10, lb, 0.8);
    this.audio.sfx('harvest', { pos: { x: x + 0.5, y: y + 0.5, z: z + 0.5 } });
    const rare = Math.random() < 0.035;
    if (who === 'player') {
      for (let k = 0; k < n; k++) this.drops.spawn('potato', x + 0.5, y + 0.4, z + 0.5);
      if (rare) this.drops.spawn('green', x + 0.5, y + 0.5, z + 0.5);
      if (this.tut) this.tut.harvest++;
    } else {
      this.stock += n;
      this.floats.add('+' + n, x + 0.5, y + 1.3, z + 0.5);
      if (rare) { this.green++; this.totals.green++; this.talk.say('astra.greenPotato', { cool: 30 }); this.robot.emote.show('!', 1.5); }
    }
    this.countHarvest(n);
    return n;
  }

  countHarvest(n) {
    this.today.harvest += n;
    this.totals.harvest += n;
    if (!this.today.goalDone && this.cfg && this.today.harvest >= this.cfg.goal && !this.titleMode) {
      this.today.goalDone = true;
      this.hud.banner(t('banner.goal'), t('banner.goalSub'), 2.8);
      this.audio.sfx('goal');
      this.talk.say('astra.goal', { random: true, cool: 0, delay: 0.8 });
    }
  }

  plant(x, y, z, who) {
    const w = this.world;
    if (!isFarm(w.get(x, y - 1, z)) || w.get(x, y, z) !== B.AIR || this.stock <= 0) return false;
    if (this.isHole(x, y, z)) return false; // 穴の底の畑には植えない（先に埋める）
    this.stock--;
    w.set(x, y, z, B.POTATO0);
    this.crops.set(w.idx(x, y, z), 0);
    this.audio.sfx('plant', { pos: { x: x + 0.5, y: y + 0.2, z: z + 0.5 } });
    this.particles.burst(x + 0.2, y - 0.05, z + 0.2, 0x7a5539, 5, this.lightBright(x, y, z), 0.6);
    if (who === 'player' && this.tut) this.tut.plant++;
    return true;
  }

  isWetSpot(x, y, z) {
    const w = this.world;
    for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) for (const dy of [0, 1]) if (w.get(x + dx, y + dy, z + dz) === B.WATER) return true;
    return false;
  }

  till(x, y, z, who) {
    const w = this.world;
    const id = w.get(x, y, z), up = w.get(x, y + 1, z);
    if (id !== B.GRASS && id !== B.DIRT) return false;
    if (up !== B.AIR && !(BLOCKS[up].plant && up !== B.CANE)) return false;
    if (this.isHole(x, y + 1, z)) return false; // 穴の底は耕さない（先に埋める）
    if (up !== B.AIR) w.set(x, y + 1, z, B.AIR);
    w.set(x, y, z, this.isWetSpot(x, y, z) ? B.FARM_WET : B.FARM);
    this.audio.sfx('till', { pos: { x: x + 0.5, y: y + 1, z: z + 0.5 } });
    this.particles.burst(x, y + 0.9, z, 0x7a5539, 8, this.lightBright(x, y + 1, z), 1);
    if (who === 'player' && this.tut) this.tut.till++;
    return true;
  }

  /** 穴（爆発で消えた地面）か：元は地面で、いまは空気・草・作物のマス。 */
  isHole(x, y, z) {
    const w = this.world;
    if (!w.inside(x, y, z)) return false;
    const base = w.baseAt(x, y, z);
    if (!BLOCKS[base].restore && !isFarm(base)) return false;
    const cur = w.get(x, y, z);
    return cur !== B.WATER && !BLOCKS[cur].solid;
  }

  /** 穴を埋めるときに戻すブロック（畑だったところは土。上がまだ穴なら草ではなく土）。 */
  restoreId(x, y, z) {
    const base = this.world.baseAt(x, y, z);
    let id = isFarm(base) ? B.DIRT : BLOCKS[base].restore;
    if (id === B.GRASS && (BLOCKS[this.world.get(x, y + 1, z)].solid || this.isHole(x, y + 1, z))) id = B.DIRT;
    return id;
  }

  /** 穴を 1 マス埋める。中に植えてしまった作物は、じゃがいもに戻る。 */
  repair(x, y, z, who = 'player') {
    const w = this.world;
    if (!this.isHole(x, y, z)) return false;
    const cur = w.get(x, y, z);
    if (isCrop(cur)) {
      this.crops.delete(w.idx(x, y, z));
      if (who === 'player') this.drops.spawn('potato', x + 0.5, y + 1.1, z + 0.5);
      else this.stock++;
    }
    const id = this.restoreId(x, y, z);
    w.set(x, y, z, id);
    // 下の草は、上に積んだので土に
    if (w.get(x, y - 1, z) === B.GRASS) w.set(x, y - 1, z, B.DIRT);
    this.audio.sfx('place', { pos: { x: x + 0.5, y: y + 0.5, z: z + 0.5 } });
    this.particles.burst(x, y + 0.9, z, BLOCKS[id].particle, 6, this.lightBright(x, y + 1, z), 1);
    if (who === 'player' && this.tut) this.tut.fill = (this.tut.fill || 0) + 1;
    return true;
  }

  /** 島じゅうの穴を全部埋める（夜のあいだにアストラがやっておく）。穴に植えた作物はじゃがいもに戻す。 */
  repairAll() {
    const w = this.world;
    let n = 0;
    for (let y = 1; y < 24; y++) for (let z = 0; z < WZ; z++) for (let x = 0; x < WX; x++) {
      if (!this.isHole(x, y, z)) continue;
      const cur = w.get(x, y, z);
      if (isCrop(cur)) { this.crops.delete(w.idx(x, y, z)); this.stock++; }
      w.set(x, y, z, this.restoreId(x, y, z));
      n++;
    }
    return n;
  }

  fertilize(x, y, z) {
    const w = this.world;
    const id = w.get(x, y, z);
    if (!isCrop(id) || id === B.POTATO3 || this.powder <= 0) return false;
    this.powder--;
    const st = Math.min(3, cropStage(id) + (Math.random() < 0.45 ? 2 : 1));
    w.set(x, y, z, B.POTATO0 + st);
    this.crops.set(w.idx(x, y, z), 0);
    this.particles.sparkle(x, y, z, 12, 0xb8ff8a);
    this.audio.sfx('fertilize', { pos: { x: x + 0.5, y: y + 0.5, z: z + 0.5 } });
    return true;
  }

  collect(kind) {
    if (kind === 'potato') this.stock++;
    else if (kind === 'powder') {
      this.powder++;
      if (!this.powderHinted) { this.powderHinted = true; this.talk.sys('sys.powder'); this.talk.say('astra.powder', { cool: 0, delay: 0.8 }); }
    } else if (kind === 'green') {
      this.green++; this.totals.green++;
      this.talk.sys('sys.greenPotato');
      this.talk.say('astra.greenPotato', { cool: 30, delay: 0.6 });
    }
    this.audio.sfx('pickup', { pitch: 0.9 + Math.random() * 0.3 });
  }

  lightBright(x, y, z) {
    const [s, b] = this.world.lightAt(x, y, z);
    return Math.max(0.12, Math.max((s / 15) ** 1.6 * shared.uSky.value, (b / 15) ** 1.7));
  }

  // ------------------------------------------------------------------ 緑のアレ
  onFuse(m) {
    this.audio.sfx('hiss', { pos: m.pos, refDistance: 3, big: m.big });
  }
  onDefuse() {}

  explode(m) {
    const w = this.world;
    const c = m.center;
    const r = m.radius;
    const R = Math.ceil(r + 1);
    const removed = [];
    let lost = 0;
    const cx = Math.floor(c.x), cy = Math.floor(c.y), cz = Math.floor(c.z);
    for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const x = cx + dx, y = cy + dy, z = cz + dz;
      const id = w.get(x, y, z);
      if (!id || !BLOCKS[id].blast || y <= 1) continue;
      const d = Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y, z + 0.5 - c.z);
      if (d > r - Math.random() * 0.9) continue;
      removed.push([x, y, z, id]);
    }
    for (const [x, y, z, id] of removed) {
      if (isCrop(id)) {
        lost++;
        if (id === B.POTATO3 || Math.random() < 0.35) this.drops.spawn('potato', x + 0.5, y + 0.5, z + 0.5, { vy: 5 + Math.random() * 3 });
      }
      w.set(x, y, z, B.AIR);
    }
    // 支えがなくなった草・作物も消える
    for (const [x, y, z] of removed) {
      for (let yy = y + 1; yy < y + 4; yy++) {
        const up = w.get(x, yy, z);
        if (!needsSupport(up)) break;
        if (isCrop(up)) lost++;
        w.set(x, yy, z, B.AIR);
      }
    }
    const lb = this.lightBright(c.x, c.y + 1, c.z);
    this.particles.smoke(c.x, c.y, c.z, m.big ? 60 : 36, r * 0.5, Math.max(0.35, lb), m.big ? 1.8 : 1.2);
    removed.slice(0, 22).forEach(([x, y, z, id]) => this.particles.burst(x, y, z, BLOCKS[id].particle, 4, lb, 1));
    this.audio.sfx('explode', { pos: c, refDistance: 6, big: m.big, dur: m.big ? 1.8 : 1.2 });
    const pd = this.player.pos.distanceTo(c);
    this.shake = Math.max(this.shake, Math.max(0, 1 - pd / (m.big ? 28 : 18)) * (m.big ? 1.6 : 1));
    this.flash = Math.max(this.flash, Math.max(0, 1 - pd / 14) * 0.55);
    // プレイヤー
    const pc = this.player.pos.clone(); pc.y += 0.9;
    const dd = pc.distanceTo(c);
    const dmg = Math.round(Math.max(0, 1 - dd / (r * 1.9)) * (m.big ? 24 : 15));
    if (dmg > 0 && this.state === 'play') { this.player.damage(dmg, c); this.hud.hurt(Math.min(1, 0.4 + dmg / 15)); this.audio.sfx('hurt'); }
    // アストラ
    const rb = this.robot.body.pos;
    const rd = Math.hypot(rb.x - c.x, rb.y + 0.6 - c.y, rb.z - c.z);
    if (rd < r * 1.7 && this.robot.state !== 'flung') this.robot.fling(c, 1 - rd / (r * 1.7));
    // ほかの緑のアレ・ブタ
    for (const o of this.mobs) {
      if (o === m || o.dead) continue;
      const od = o.center.distanceTo(c);
      if (od < r * 1.6 && o.hit(m.big ? 6 : 2, c, 1.3) && o.dead) this.onMobKilled(o, 'boom');
    }
    for (const p of this.pigs) if (p.pos.distanceTo(c) < r * 1.8) p.hit(c);
    this.today.booms++;
    this.totals.booms++;
    this.today.lost += lost;
    m.dead = true;
    this.removeMob(m);
    if (lost > 0 && !this.robot.state.match(/sleep|flung/)) this.talk.say('astra.farmHit', { random: true, delay: 1.6, cool: 12 });
    events.emit('explode', { lost });
  }

  removeMob(m) {
    m.dispose();
    const i = this.mobs.indexOf(m);
    if (i >= 0) this.mobs.splice(i, 1);
  }

  onMobKilled(m, by = 'player') {
    const c = m.center;
    this.particles.smoke(c.x, c.y - 0.2, c.z, m.big ? 30 : 14, 0.4, Math.max(0.4, this.lightBright(c.x, c.y, c.z)), m.big ? 1.3 : 0.8);
    this.audio.sfx('poof', { pos: c });
    const n = m.big ? 6 : 1 + (Math.random() < 0.5 ? 1 : 0);
    for (let k = 0; k < n; k++) this.drops.spawn('powder', c.x, c.y, c.z);
    if (m.big) for (let k = 0; k < 10; k++) this.drops.spawn('potato', c.x, c.y + 0.3, c.z, { vy: 5 + Math.random() * 3 });
    this.today.kills++;
    this.totals.kills++;
    this.removeMob(m);
    if (by === 'player') {
      this.talk.sys(m.big ? 'sys.bossKill' : 'sys.kill');
      const rd = this.robot.body.pos.distanceTo(c);
      if (rd < 16 && !['sleep', 'flung', 'sulk', 'toBed'].includes(this.robot.state) && (this.thankCool ?? 0) <= this.time) {
        this.thankCool = this.time + 25;
        this.talk.say(m.big ? 'astra.bossThanks' : 'astra.thanks', { random: !m.big, delay: 0.8, cool: 0 });
        this.stock += 1;
        const rp = this.robot.body.pos;
        this.floats.add('+1', rp.x, rp.y + 1.9, rp.z);
        this.robot.emote.show('heart', 1.8);
      }
    }
  }

  // ------------------------------------------------------------------ 毎フレーム
  step(dt) {
    const input = this.input;
    input.update(dt);
    this.time += dt;
    this[`update_${this.state}`]?.(dt);
    const live = this.state === 'play' || this.state === 'dead' || this.titleMode && (this.state === 'title' || this.state === 'intro');
    if (live) this.updateWorld(dt);
    this.updateView(dt);
    this.audio.listen(this.camera);
    this.audio.tick(dt);
    input.endFrame();
  }

  update_title() {
    if (this.input.menu.back && this.screens.back()) this.audio.sfx('ui_back');
  }
  update_intro() {
    if (this.input.menu.back) { this.audio.sfx('ui_back'); this.setState('title'); }
  }

  update_paused() {
    const input = this.input;
    if (input.menu.back || input.menu.start || input.pressed('pause')) {
      if (this.screens.top !== this.screens.modals.pause) { this.screens.back(); this.audio.sfx('ui_back'); }
      else { this.setState('play'); this.lockPointer?.(); }
    }
  }

  update_dead(dt) {
    this.deadT += dt;
    this.player.update(dt, this.input, false);
    this.updateDay(dt);
    this.fade = Math.min(0.55, this.deadT * 0.4);
    if (this.deadT > 2.8 && this.state === 'dead') {
      this.player.reset(LAYOUT.spawn);
      this.hud.setDead(false);
      this.fade = 0;
      this.talk.say('astra.death', { cool: 0, delay: 0.5 });
      this.setState('play');
    }
  }

  update_play(dt) {
    const input = this.input;
    if (input.pressed('pause') || input.menu.start) { this.setState('paused'); return; }
    this.grace = Math.max(0, this.grace - dt);
    this.player.update(dt, input, true);
    this.updateTargeting();
    this.handleActions(dt);
    this.updateDay(dt);
    if (!this.player.alive && this.state === 'play') this.setState('dead');
  }

  // 狙っているもの（ブロック・緑のアレ・ブタ・アストラ）
  updateTargeting() {
    const { o, d } = this.player.ray();
    this.target = this.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, REACH + 0.5);
    if (this.target && this.target.dist > REACH) this.target = null;
    const bd = this.target ? this.target.dist : REACH;
    // 生きもの（箱と光線）
    let best = null, bt = Math.min(bd, 4.2);
    const test = (ent, x, y, z, hw, h) => {
      const tt = rayBox(o, d, x - hw, y, z - hw, x + hw, y + h, z + hw);
      if (tt !== null && tt < bt) { bt = tt; best = ent; }
    };
    for (const m of this.mobs) if (!m.dead && m.state !== 'emerge') test(m, m.pos.x, m.pos.y, m.pos.z, m.body.hw + 0.12, m.body.h + 0.1);
    for (const p of this.pigs) test(p, p.pos.x, p.pos.y, p.pos.z, 0.5, 0.95);
    const rb = this.robot.body.pos;
    test(this.robot, rb.x, rb.y, rb.z, 0.4, 1.35);
    // ねらいを少し助ける（近くの緑のアレが、照準のそばにいれば当てる）
    if (!best) {
      let ba = 0.32;
      for (const m of this.mobs) {
        if (m.dead || m.state === 'emerge') continue;
        const v = m.center.sub(o);
        const dist = v.length();
        if (dist > 3.6 || dist > bd + 0.5) continue;
        const a = v.normalize().angleTo(d);
        if (a < ba) { ba = a; best = m; }
      }
    }
    this.targetMob = best instanceof Green ? best : null;
    this.targetPig = best instanceof Pig ? best : null;
    this.targetRobot = best === this.robot;
    if (best) this.target = null;
  }

  /** 持ちもの tool で、狙っているブロックにできること（なければ null）。off：できないけれど理由を出すもの。 */
  useFor(tool, tg) {
    const w = this.world, id = tg.id;
    const above = w.get(tg.x, tg.y + 1, tg.z);
    switch (tool) {
      case 'hoe':
        if ((id === B.GRASS || id === B.DIRT) && (above === B.AIR || (BLOCKS[above].plant && above !== B.CANE))) {
          return this.isHole(tg.x, tg.y + 1, tg.z) ? { act: 'holeFirst', off: true } : { act: 'till' };
        }
        return null;
      case 'potato':
        if (isFarm(id) && above === B.AIR) {
          if (this.isHole(tg.x, tg.y + 1, tg.z)) return { act: 'holeFirst', off: true };
          return this.stock > 0 ? { act: 'plant' } : { act: 'noSeed', off: true };
        }
        return null;
      case 'powder':
        if (isCrop(id) && id !== B.POTATO3) return this.powder > 0 ? { act: 'fertilize' } : { act: 'noPowder', off: true };
        return null;
      case 'dirt': {
        // 穴に植えてしまった作物・草：そのマスを埋める
        if (!BLOCKS[id].solid && this.isHole(tg.x, tg.y, tg.z) && !this.cellBlocked(tg.x, tg.y, tg.z)) return { act: 'fill', at: [tg.x, tg.y, tg.z] };
        // 狙った面のとなりが穴なら、そこを埋める
        const f = [tg.x + tg.nx, tg.y + tg.ny, tg.z + tg.nz];
        if (this.isHole(...f)) return this.cellBlocked(...f) ? { act: 'blocked', off: true } : { act: 'fill', at: f };
        return null;
      }
      default:
        return null;
    }
  }

  decideUse() {
    if (this.targetRobot) return { act: this.robot.state === 'sulk' ? 'cheer' : 'talk' };
    const tg = this.target;
    if (!tg) return null;
    if (tg.id === B.POTATO3) return { act: 'harvest' };
    const u = this.useFor(this.tool, tg);
    if (u) return u;
    // ほかの持ちものならできる → 持ちかえの案内
    for (const k of TOOLS) {
      if (k === this.tool) continue;
      const v = this.useFor(k, tg);
      if (v && !v.off) return { act: 'switch', tool: k, want: v.act, off: true };
    }
    if (tg.id === B.BOX) return { act: 'box' };
    if (tg.id === B.BED || tg.id === B.BED_FOOT) return { act: 'bed' };
    return null;
  }

  /** 持ちものを選ぶ（1〜5・ホイール・LB/RB・持ちもの欄をタップ）。 */
  selectTool(k) {
    if (!TOOLS.includes(k) || this.tool === k) return;
    this.tool = k;
    this.player.setTool(k);
    this.audio.sfx('ui_move');
    if (this.tut) this.tut.switched = true;
  }

  promptLabel(u) {
    if (u.act === 'switch') return t('prompt.switch', { item: t('item.' + u.tool), act: t('prompt.' + u.want) });
    return t('prompt.' + u.act);
  }

  decideAttack() {
    if (this.targetMob || this.targetPig) return { act: 'attack' };
    if (this.targetRobot) return { act: 'bonk' };
    const tg = this.target;
    if (!tg) return null;
    if (tg.id === B.POTATO3) return { act: 'harvest' };
    if (isCrop(tg.id)) return { act: 'pick' };
    if (BLOCKS[tg.id].plant) return { act: 'cut' };
    return null;
  }

  cellBlocked(x, y, z) {
    const inside = (p, hw, h) => x + 1 > p.x - hw && x < p.x + hw && z + 1 > p.z - hw && z < p.z + hw && y + 1 > p.y && y < p.y + h;
    if (inside(this.player.pos, 0.3, 1.8)) return true;
    if (inside(this.robot.body.pos, 0.3, 1.2)) return true;
    return this.mobs.some((m) => inside(m.pos, m.body.hw, m.body.h));
  }

  handleActions(dt) {
    const input = this.input;
    this.attackCool -= dt;
    this.useCool -= dt;
    this.eatCool -= dt;
    // 持ちかえ：1〜5、ホイール、LB / RB
    for (let i = 0; i < TOOLS.length; i++) if (input.keysPressed.has('Digit' + (i + 1)) || input.keysPressed.has('Numpad' + (i + 1))) this.selectTool(TOOLS[i]);
    // ホイールはトラックパッドだと続けて届くので、少し間をあける
    this.wheelCool = Math.max(0, (this.wheelCool || 0) - dt);
    let wheel = 0;
    if (input.wheel && this.wheelCool <= 0) { wheel = Math.sign(input.wheel); this.wheelCool = 0.14; }
    const step = (input.pressed('slotNext') ? 1 : 0) - (input.pressed('slotPrev') ? 1 : 0) + wheel;
    if (step) this.selectTool(TOOLS[(TOOLS.indexOf(this.tool) + step + TOOLS.length) % TOOLS.length]);
    const use = this.decideUse();
    const atk = this.decideAttack();
    this.useDecision = use;
    // 案内（照準の下）。持ちかえればできるときは、持ちものの番号を出す
    if (this.targetMob) this.hud.setPrompt('attack', t('prompt.attack'));
    else if (use && !use.off) this.hud.setPrompt('use', this.promptLabel(use));
    else if (atk) this.hud.setPrompt('attack', t('prompt.' + atk.act));
    else if (use?.act === 'switch') this.hud.setPrompt('slot:' + (TOOLS.indexOf(use.tool) + 1), this.promptLabel(use), true);
    else if (use) this.hud.setPrompt('use', this.promptLabel(use), true);
    else this.hud.setPrompt(null, '');
    this.touch.setLabel('use', use && !use.off ? this.promptLabel(use) : null);
    this.touch.setLabel('attack', atk && atk.act !== 'attack' && atk.act !== 'bonk' ? t('prompt.' + atk.act) : null);
    // 選択の枠
    const tg = this.target;
    if (tg) {
      const b = BLOCKS[tg.id];
      const h = isCrop(tg.id) ? 0.25 + 0.2 * cropStage(tg.id) : b.shape === 'lantern' ? 0.5 : b.h;
      this.sel.visible = true;
      this.sel.scale.set(1.004, h + 0.004, 1.004);
      this.sel.position.set(tg.x + 0.5, tg.y + h / 2 - (isCrop(tg.id) ? 1 / 16 : 0), tg.z + 0.5);
    } else this.sel.visible = false;
    if (this.grace > 0) return;
    // 左：たたく・収穫
    if ((input.down('attack') || input.pressed('attack')) && this.attackCool <= 0) {
      this.attackCool = 0.36;
      this.player.swingHand();
      this.doAttack(atk);
    }
    // 右：つかう
    if ((input.down('use') || input.pressed('use')) && this.useCool <= 0 && use) {
      const did = this.doUse(use, input.pressed('use'));
      this.useCool = did ? 0.24 : 0.12;
    }
    if (input.pressed('eat') && this.eatCool <= 0) this.eat();
  }

  doAttack(atk) {
    const pl = this.player;
    this.audio.sfx('swing');
    if (!atk) return;
    if (atk.act === 'attack' && this.targetMob) {
      const m = this.targetMob;
      const crit = pl.body.vel.y < -1 && !pl.body.onGround;
      const dmg = crit ? 2 : 1;
      // 剣だと大きくはじき飛ばせる（ほかの持ちものでも、たたくことはできる）
      m.hit(dmg, pl.pos, (pl.sprinting ? 1.5 : 1) * (this.tool === 'sword' ? 1 : 0.6));
      this.audio.sfx('hit', { pos: m.pos, crit });
      const c = m.center;
      this.particles.burst(c.x - 0.3, c.y - 0.2, c.z - 0.3, crit ? 0xffffff : 0x5aa83e, crit ? 10 : 6, 1, 0.6);
      if (m.dead) this.onMobKilled(m, 'player');
      return;
    }
    if (atk.act === 'attack' && this.targetPig) {
      this.targetPig.hit(pl.pos);
      this.talk.say('astra.pig', { cool: 40, delay: 0.5 });
      return;
    }
    if (atk.act === 'bonk') {
      this.robot.emote.show('?', 1.2);
      this.audio.sfx('bonk', { pos: this.robot.body.pos });
      this.talk.say('astra.bonk', { random: true, cool: 6 });
      return;
    }
    const tg = this.target;
    if (!tg) return;
    if (atk.act === 'harvest') this.harvest(tg.x, tg.y, tg.z, 'player');
    else if (atk.act === 'pick') {
      // 育ちきる前に抜いた：植えたじゃがいもだけ戻る
      this.world.set(tg.x, tg.y, tg.z, B.AIR);
      this.crops.delete(this.world.idx(tg.x, tg.y, tg.z));
      this.drops.spawn('potato', tg.x + 0.5, tg.y + 0.3, tg.z + 0.5);
      this.particles.burst(tg.x, tg.y, tg.z, 0x5d9e3a, 6, this.lightBright(tg.x, tg.y, tg.z), 0.8);
      this.audio.sfx('pluck', { pos: { x: tg.x + 0.5, y: tg.y + 0.3, z: tg.z + 0.5 } });
    } else if (atk.act === 'cut') {
      const id = tg.id;
      let y = tg.y;
      // サトウキビは上の段もいっしょに
      while (this.world.get(tg.x, y + 1, tg.z) === id && id === B.CANE) y++;
      for (let yy = y; yy >= tg.y; yy--) this.world.set(tg.x, yy, tg.z, B.AIR);
      this.particles.burst(tg.x, tg.y, tg.z, BLOCKS[id].particle, 8, this.lightBright(tg.x, tg.y, tg.z), 0.8);
      this.audio.sfx('pluck', { pos: { x: tg.x + 0.5, y: tg.y + 0.3, z: tg.z + 0.5 } });
      if (id === B.CANE) this.talk.say('astra.caneBroken', { cool: 60, delay: 0.6 });
    }
  }

  doUse(u, fresh) {
    const tg = this.target;
    const pl = this.player;
    switch (u.act) {
      case 'harvest': pl.swingHand(); return this.harvest(tg.x, tg.y, tg.z, 'player') > 0;
      case 'plant': pl.swingHand(); return this.plant(tg.x, tg.y + 1, tg.z, 'player');
      case 'till': pl.swingHand(); return this.till(tg.x, tg.y, tg.z, 'player');
      case 'fertilize': pl.swingHand(); return this.fertilize(tg.x, tg.y, tg.z);
      case 'fill': pl.swingHand(); return this.repair(...u.at, 'player');
      case 'talk': if (fresh) { this.robot.emote.show('note', 1.4); this.talk.say(this.robot.state === 'hide' ? 'astra.talkHide' : this.robot.state === 'sleep' ? 'astra.talkSleep' : 'astra.talk', { random: true, cool: 1.5 }); } return fresh;
      case 'cheer': if (fresh) this.robot.cheer(); return fresh;
      case 'box': if (fresh) { this.talk.sys('sys.box'); this.talk.say('astra.box', { cool: 20, delay: 0.4 }); } return fresh;
      case 'bed': if (fresh) this.talk.say('astra.bed', { cool: 20 }); return fresh;
      case 'noSeed': if (fresh) this.talk.sys('sys.noSeed'); return false;
      case 'holeFirst': if (fresh) this.talk.sys('sys.holeFirst'); return false;
      case 'noPowder': if (fresh) this.talk.sys('sys.noPowder'); return false;
      default: return false;
    }
  }

  eat() {
    const pl = this.player;
    if (pl.hp >= pl.maxHp) { this.talk.sys('sys.full'); this.eatCool = 0.6; return; }
    if (this.stock <= 0) { this.talk.sys('sys.noSeed'); this.eatCool = 0.6; return; }
    this.stock--;
    pl.heal(5);
    pl.show('potato', 0.7);
    pl.swingHand();
    this.eatCool = 0.9;
    this.audio.sfx('eat');
    const cam = this.camera;
    const f = new THREE.Vector3(0, -0.25, -0.6).applyQuaternion(cam.quaternion).add(cam.position);
    this.particles.burst(f.x - 0.15, f.y - 0.1, f.z - 0.15, 0xd6ad62, 6, 1, 0.3);
  }

  // ------------------------------------------------------------------ 世界の更新
  updateWorld(dt) {
    this.world.flushNav();
    this.talk.update(dt);
    if (!this.titleMode) this.growCrops(dt);
    else this.growCrops(dt * 0.5);
    this.robot.update(dt);
    for (const m of [...this.mobs]) {
      m.update(dt);
      if (m.dead && this.mobs.includes(m)) this.removeMob(m);
    }
    for (const p of this.pigs) p.update(dt);
    if (!this.titleMode) this.drops.update(dt);
    this.mesher.update(4);
  }

  /** カメラ・空・粒・表示（止まっているときも描けるように毎回）。 */
  updateView(dt) {
    const tm = this.titleMode && (this.state === 'title' || this.state === 'intro');
    if (tm) this.updateTitleCamera(dt);
    else this.player.updateCamera(dt, this.time);
    this.player.hand.visible = !tm && (this.state === 'play' || this.state === 'dead' || this.state === 'paused');
    // 揺れ
    if (this.shake > 0.001) {
      const s = this.shake * 0.22;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 2.2);
    }
    this.camera.updateMatrixWorld(true);
    shared.uTime.value = this.time;
    this.sky.update(this.skyTime, this.camera, dt, this.time);
    // 霧（夜は少し近く）
    const night = 1 - shared.uSky.value;
    shared.uFogNear.value = lerp(30, 20, night);
    shared.uFogFar.value = lerp(66, 50, night);
    if (this.state !== 'paused' && this.state !== 'report' && this.state !== 'ending') {
      this.particles.update(dt);
      this.floats.update(dt);
    }
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.renderer.setFx({ flash: this.flash, flashColor: '#fff6e0', fade: this.fade, fadeColor: '#3a0808', time: this.time });
    if (this.state === 'play' || this.state === 'dead' || this.state === 'paused') this.updateHud(dt);
    this.hud.update(dt);
  }

  updateTitleCamera(dt) {
    this.titleAng += dt * 0.045;
    const a = this.titleAng;
    const cx = 30.5, cz = 31.5, r = 16;
    this.camera.position.set(cx + Math.sin(a) * r, 16.5, cz + Math.cos(a) * r);
    this.camera.rotation.order = 'YXZ';
    this.camera.lookAt(cx, 10.2, cz);
    if (Math.abs(this.camera.fov - 60) > 0.01) { this.camera.fov = 60; this.camera.updateProjectionMatrix(); }
    this.sel.visible = false;
  }

  updateHud() {
    const hud = this.hud;
    const pl = this.player;
    hud.setHearts(pl.hp, pl.maxHp);
    hud.setInventory({ stock: this.stock, powder: this.powder, green: this.green });
    hud.setHeld(this.tool);
    if (this.cfg) {
      hud.setDay(this.dayIndex + 1, this.phase, clamp(this.clock / this.dayLength), this.mode === 'endless');
      hud.setGoal(this.today.harvest, this.cfg.goal);
    }
    hud.setObjective(this.objectiveText());
    const st = this.robot.status;
    hud.setRobot(st, this.robot.model.face || 'normal', this.time);
    // 画面の外の緑のアレ
    const list = [];
    const cam = this.camera;
    const inv = cam.matrixWorldInverse;
    for (const m of this.mobs) {
      if (m.dead || m.state === 'leave') continue;
      const c = m.center;
      if (c.distanceTo(cam.position) > 40) continue;
      const ndc = c.clone().project(cam);
      const v = c.clone().applyMatrix4(inv);
      if (v.z < 0 && Math.abs(ndc.x) < 0.95 && Math.abs(ndc.y) < 0.92) continue;
      let dx = v.x, dy = v.y;
      if (v.z > 0) { dx = v.x; dy = -Math.abs(v.y) - 0.01; }
      const l = Math.hypot(dx, dy) || 1;
      dx /= l; dy /= l;
      list.push({ x: 0.5 + dx * 0.44, y: 0.5 - dy * 0.4, ang: Math.atan2(dx, dy), fuse: m.state === 'fuse', big: m.big });
    }
    hud.setArrows(settings.mobGuide === 'off' ? [] : list);
  }

  render(dt) { this.renderer.render(dt); }

  updateBestLabel() {
    const el = document.querySelector('#title .best');
    if (!el) return;
    const lines = [];
    if (this.save.data.best) lines.push(t('title.best', { n: this.save.data.best }));
    const eb = this.save.data.endlessBest;
    if (eb?.day) lines.push(t('title.bestEndless', { d: eb.day, n: eb.harvest }));
    el.textContent = lines.join('　');
  }

  setSplash() {
    const el = document.querySelector('#title .splash');
    if (!el) return;
    let n = 0;
    while (t('splash.' + n) !== 'splash.' + n) n++;
    const k = 'splash.' + Math.floor(Math.random() * Math.max(1, n));
    el.dataset.i18n = k;
    el.textContent = t(k);
  }

  /** window.__dev.state() に出す値。 */
  snapshot() {
    const p = this.player.pos, r = this.robot.body.pos;
    const f = (v) => +v.toFixed(2);
    return {
      state: this.state, mode: this.mode, day: this.dayIndex + 1, phase: this.phase, clock: f(this.clock),
      hp: this.player.hp, stock: this.stock, powder: this.powder, green: this.green,
      today: { ...this.today }, goal: this.cfg?.goal, totals: { ...this.totals }, tut: this.tut ? this.tut.step : null,
      crops: this.crops.size, mature: [...this.crops.keys()].filter((i) => this.world.data[i] === B.POTATO3).length,
      mobs: this.mobs.map((m) => ({ s: m.state, big: m.big, hp: m.hp, p: [f(m.pos.x), f(m.pos.y), f(m.pos.z)] })),
      robot: { s: this.robot.state, task: this.robot.task?.type || null, p: [f(r.x), f(r.y), f(r.z)] },
      player: [f(p.x), f(p.y), f(p.z)], yaw: f(this.player.yaw), pitch: f(this.player.pitch),
      target: this.target ? { id: this.target.id, at: [this.target.x, this.target.y, this.target.z] } : this.targetMob ? 'mob' : this.targetRobot ? 'robot' : null,
      use: this.useDecision?.act || null,
    };
  }

  // ---- 確認用（__dev.extra.game から）
  debugSkip(sec) { if (this.cfg) this.clock += sec; }
  debugLook(x, y, z) {
    const e = this.player.pos.clone(); e.y += this.player.eye;
    const d = new THREE.Vector3(x, y, z).sub(e);
    this.player.yaw = Math.atan2(-d.x, -d.z);
    this.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  }
}

/** 光線と箱の交わり（入る距離。当たらなければ null）。 */
function rayBox(o, d, x0, y0, z0, x1, y1, z1) {
  let tmin = 0, tmax = Infinity;
  for (const [oo, dd, a, b] of [[o.x, d.x, x0, x1], [o.y, d.y, y0, y1], [o.z, d.z, z0, z1]]) {
    if (Math.abs(dd) < 1e-9) { if (oo < a || oo > b) return null; continue; }
    let t1 = (a - oo) / dd, t2 = (b - oo) / dd;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}
