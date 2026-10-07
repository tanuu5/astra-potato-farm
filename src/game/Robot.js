// アストラ：じゃがいも農家に転身した、ゆるい AI ロボット。
// 畑しごと（収穫 → 植える → 穴を埋める → 耕す）を自分で選んで動く。緑のもの（緑のアレ・サトウキビ・スイカ）をこわがる。
//   状態：work（畑しごと）／scare（サトウキビにびっくり）／panic（家へ逃げる）／hide（家でふるえる）／
//         flung（爆発で飛ばされた）／sulk（しょんぼり）／toBed（寝に行く）／sleep（寝ている）
import * as THREE from 'three';
import { createAstraModel, itemMesh } from './models.js';
import { Emote } from './fx.js';
import { B, BLOCKS, isFarm } from './world/blocks.js';
import { LAYOUT, GY, inRect } from './world/World.js';
import { findPath } from './nav.js';
import { moveBody, applyGravity } from './physics.js';
import { damp, dampAngle, clamp } from '../core/math.js';
import { entityMaterial, setEntityLight } from './world/materials.js';

const PX = 1 / 16;
export const HOUSE_IN = { x0: 28, x1: 32, z0: 20, z1: 23 };
const REPAIR_ZONE = { x0: 14, x1: 46, z0: 15, z1: 46 }; // アストラが昼に穴を埋めに行く範囲（台地のほぼ全部）
const SPOT = {
  hide: [31.5, 21.6],
  bedSide: [29.5, 21.5],
  bed: [28.5, GY + 1 + 9 / 16 + 0.18, 21.45],
  wake: [29.6, 22.4],
};
const SPEED = { work: 1.9, panic: 4.6 };

export class Robot {
  constructor(game) {
    this.game = game;
    this.model = createAstraModel();
    this.root = this.model.root;
    game.scene.add(this.root);
    this.body = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), hw: 0.3, h: 1.2, onGround: false, step: 1.05, inWater: false };
    this.emote = new Emote(this.root, 1.65);
    // 手に持つもの（クワ・じゃがいも）
    this.handMat = entityMaterial(game.atlas.texture);
    this.hand = new THREE.Group();
    this.hand.name = 'hand';
    this.hand.position.set(0, -5.5 * PX, 0.5 * PX);
    this.model.parts.armR.add(this.hand);
    this.handItems = {};
    for (const n of ['item_hoe', 'item_potato']) {
      const m = itemMesh(game.atlas, n, this.handMat);
      m.scale.setScalar(0.42);
      m.rotation.set(0, Math.PI / 2, n === 'item_hoe' ? Math.PI * 0.75 : 0);
      m.position.set(0, -0.1, 0.12);
      m.visible = false;
      this.hand.add(m);
      this.handItems[n] = m;
    }
    this.reset();
  }

  reset(pos = [27.5, GY + 1, 31.5]) {
    this.body.pos.set(pos[0], pos[1], pos[2]);
    this.body.vel.set(0, 0, 0);
    this.yaw = 0;
    this.headYaw = 0;
    this.state = 'work';
    this.stateT = 0;
    this.task = null;
    this.path = null;
    this.thinkT = 1;
    this.talkT = 25;
    this.scareCool = 15;
    this.checkT = 0;
    this.calmT = 0;
    this.sulkDur = 10;
    this.walk = 0;
    this.phase = 0;
    this.t = 0;
    this.stuckT = 0;
    this.lastPos = new THREE.Vector3().copy(this.body.pos);
    this.root.rotation.set(0, 0, 0);
    this.blinkT = 2;
    this.emote.hide();
    this.setHand(null);
  }

  /** HUD に出す様子。 */
  get status() {
    const s = this.state;
    if (s === 'panic' || s === 'hide' || s === 'scare') return 'scared';
    if (s === 'sulk' || s === 'flung') return 'sulk';
    if (s === 'sleep' || s === 'toBed') return 'sleep';
    if (s === 'work' && this.task && this.task.type !== 'wander') return 'work';
    return 'idle';
  }
  get inHouse() { const p = this.body.pos; return inRect(Math.floor(p.x), Math.floor(p.z), HOUSE_IN); }
  /** 緑のアレに狙われる場所にいるか（家の中・寝ているときは狙われない）。 */
  get exposed() { return !this.inHouse && this.state !== 'sleep'; }

  setState(s) {
    this.state = s;
    this.stateT = 0;
    if (s !== 'work') { this.task = null; this.setHand(null); }
  }

  setHand(name) { for (const [k, m] of Object.entries(this.handItems)) m.visible = k === name; }

  // ------------------------------------------------------------------ 歩く
  goTo(x, z, near = 0.6) {
    const r = findPath(this.game.world, this.body.pos.x, this.body.pos.z, x, z, { near: Math.max(0, near - 0.5), maxNodes: 2500 });
    this.path = r.path;
    this.pathI = 0;
    this.goal = [x, z, near];
    this.stuckT = 0;
    this.lastPos.copy(this.body.pos);
    return r.reached || r.path.length > 0;
  }

  /** 道をたどる。'arrived' / 'moving' / 'stuck' */
  follow(dt, speed) {
    const p = this.body.pos;
    if (!this.goal) return 'arrived';
    let tx, tz;
    if (this.path && this.pathI < this.path.length) {
      const [cx, cz] = this.path[this.pathI];
      tx = cx + 0.5; tz = cz + 0.5;
      if (Math.hypot(tx - p.x, tz - p.z) < 0.35) { this.pathI++; return this.follow(dt, speed); }
    } else {
      tx = this.goal[0]; tz = this.goal[1];
      if (Math.hypot(tx - p.x, tz - p.z) <= this.goal[2]) { this.goal = null; return 'arrived'; }
    }
    const dx = tx - p.x, dz = tz - p.z;
    const d = Math.hypot(dx, dz) || 1;
    this.wantVel(dx / d * speed, dz / d * speed, dt);
    this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 10, dt);
    // 進まなくなったら、跳んでみて、だめならあきらめる
    this.stuckT += dt;
    if (this.stuckT > 1.2) {
      const moved = this.lastPos.distanceTo(p);
      this.lastPos.copy(p);
      this.stuckT = 0;
      if (moved < 0.25) {
        this.stuckN = (this.stuckN || 0) + 1;
        if (this.body.onGround) this.body.vel.y = 7.5;
        if (this.stuckN > 2) {
          this.stuckN = 0;
          this.goal = null;
          // 穴に落ちて出られないときは、家の前へワープ（ロボットなので）
          if (p.y < GY + 0.6) this.warpHome();
          return 'stuck';
        }
      } else this.stuckN = 0;
    }
    return 'moving';
  }

  wantVel(vx, vz, dt, k = 12) {
    this.body.vel.x = damp(this.body.vel.x, vx, k, dt);
    this.body.vel.z = damp(this.body.vel.z, vz, k, dt);
  }

  // ------------------------------------------------------------------ しごとを選ぶ
  findTask() {
    const g = this.game, w = g.world, Z = LAYOUT.farmZone;
    const p = this.body.pos;
    let best = null;
    let emptyFarm = 0;
    const consider = (type, x, y, z, score) => { if (!best || score < best.score) best = { type, x, y, z, score }; };
    for (let z = Z.z0; z <= Z.z1; z++) for (let x = Z.x0; x <= Z.x1; x++) {
      const below = w.get(x, GY, z), at = w.get(x, GY + 1, z);
      const d = Math.hypot(x + 0.5 - p.x, z + 0.5 - p.z);
      if (g.isReserved(x, z)) continue;
      if (at === B.POTATO3) consider('harvest', x, GY + 1, z, d);
      else if (isFarm(below) && at === B.AIR) {
        emptyFarm++;
        if (g.stock > 3) consider('plant', x, GY + 1, z, d + 0.6);
      }
    }
    // 穴埋め：畑のまわりと家の前まで（穴に植えてしまった作物も、埋めて元の地面に戻す）
    const R = REPAIR_ZONE;
    for (let z = R.z0; z <= R.z1; z++) for (let x = R.x0; x <= R.x1; x++) {
      if (g.isReserved(x, z)) continue;
      const hole = this.holeAt(x, z);
      if (hole >= 0) consider('repair', x, hole, z, Math.hypot(x + 0.5 - p.x, z + 0.5 - p.z) + 1.5);
    }
    if (!best || (best.type !== 'harvest' && best.type !== 'repair' && emptyFarm < 3 && g.stock > 6)) {
      // 畑を広げる（B の畑から）
      for (const F of [LAYOUT.fieldA, LAYOUT.fieldB]) {
        for (let z = F.z0; z <= F.z1; z++) for (let x = F.x0; x <= F.x1; x++) {
          const below = w.get(x, GY, z), at = w.get(x, GY + 1, z);
          if ((below === B.GRASS || below === B.DIRT) && (at === B.AIR || BLOCKS[at].plant && at !== B.CANE)) {
            const d = Math.hypot(x + 0.5 - p.x, z + 0.5 - p.z);
            if (!best || best.type === 'plant' || best.type === 'till') consider('till', x, GY, z, d + 8);
          }
        }
      }
    }
    return best;
  }

  /** その柱で、穴（爆発で消えた地面）のいちばん下の高さ（なければ -1）。 */
  holeAt(x, z) {
    for (let y = GY - 4; y <= GY + 6; y++) if (this.game.isHole(x, y, z)) return y;
    return -1;
  }

  startTask(task) {
    this.task = { ...task, phase: 'go', actT: 0 };
    this.game.reserve(task.x, task.z, true);
    const near = task.type === 'repair' ? 1.6 : 1.25;
    if (!this.goTo(task.x + 0.5, task.z + 0.5, near)) { this.endTask(); this.thinkT = 1.5; }
  }
  endTask() {
    if (this.task) this.game.reserve(this.task.x, this.task.z, false);
    this.task = null;
    this.setHand(null);
  }

  doTask(t) {
    const g = this.game, w = g.world;
    if (t.type === 'harvest') { if (w.get(t.x, t.y, t.z) === B.POTATO3) g.harvest(t.x, t.y, t.z, 'robot'); }
    else if (t.type === 'plant') { if (isFarm(w.get(t.x, t.y - 1, t.z)) && w.get(t.x, t.y, t.z) === B.AIR && g.stock > 2) g.plant(t.x, t.y, t.z, 'robot'); }
    else if (t.type === 'till') g.till(t.x, t.y, t.z, 'robot');
    else if (t.type === 'repair') g.repair(t.x, t.y, t.z, 'robot');
  }

  // ------------------------------------------------------------------ できごと
  /** 爆発で飛ばされる。 */
  fling(from, power) {
    const p = this.body.pos;
    const d = new THREE.Vector3(p.x - from.x, 0, p.z - from.z);
    if (d.lengthSq() < 1e-4) d.set(1, 0, 0);
    d.normalize().multiplyScalar(5 + power * 4);
    this.body.vel.set(d.x, 7 + power * 3, d.z);
    this.body.onGround = false;
    if (this.state === 'sleep') this.root.rotation.set(0, 0, 0);
    this.endTask();
    this.setState('flung');
    this.emote.show('!', 1.2);
    this.game.say('astra.flung', { cool: 0 });
  }

  /** はげます（しょんぼりのとき、話しかけると早く元気になる）。 */
  cheer() {
    if (this.state !== 'sulk') return false;
    this.sulkDur = Math.min(this.sulkDur, this.stateT + 1.2);
    this.emote.show('heart', 1.5);
    this.game.say('astra.cheered', { random: true, cool: 0 });
    return true;
  }

  goToBed() {
    if (this.state === 'sleep' || this.state === 'toBed') return;
    this.endTask();
    this.setState('toBed');
    this.goTo(SPOT.bedSide[0], SPOT.bedSide[1], 0.5);
  }

  wake() {
    this.root.rotation.set(0, 0, 0);
    this.body.pos.set(SPOT.wake[0], GY + 1, SPOT.wake[1]);
    this.body.vel.set(0, 0, 0);
    this.yaw = 0;
    this.setState('work');
    this.thinkT = 2.5;
    this.emote.show('note', 2);
  }

  warpHome() {
    const g = this.game;
    g.particles.smoke(this.body.pos.x, this.body.pos.y + 0.5, this.body.pos.z, 10, 0.4);
    this.body.pos.set(SPOT.wake[0], GY + 1, SPOT.wake[1] + 2.5);
    this.body.vel.set(0, 0, 0);
    g.particles.sparkle(this.body.pos.x - 0.5, this.body.pos.y, this.body.pos.z - 0.5, 12, 0x8ff4ff);
    g.say('astra.warp', { cool: 30 });
  }

  /** 寝た状態で置く（夜から始めるとき・確認用）。 */
  sleepNow() {
    this.endTask();
    this.setState('sleep');
    this.body.vel.set(0, 0, 0);
  }

  // ------------------------------------------------------------------ 毎フレーム
  update(dt) {
    const g = this.game;
    this.t += dt;
    this.stateT += dt;
    this.scareCool -= dt;
    this.talkT -= dt;
    this.checkT -= dt;
    const p = this.body.pos;

    // 緑のアレが近い → 逃げる
    if (this.checkT <= 0) {
      this.checkT = 0.25;
      if (['work', 'scare'].includes(this.state) && g.robotCanPanic) {
        const m = g.nearestMob(p, true);
        if (m && (m.dist < 8 || (m.mob.state === 'fuse' && m.dist < 12))) this.panic(m.mob);
      }
    }

    let speed = 0;
    switch (this.state) {
      case 'work': speed = this.updateWork(dt); break;
      case 'scare':
        this.wantVel(0, 0, dt);
        if (this.stateT > 1.7 && !this.saidOk) { this.saidOk = true; g.say(this.scareKind === 'melon' ? 'astra.melonOk' : 'astra.caneOk', { random: true }); this.emote.show('sweat', 1.5); }
        if (this.stateT > 3.0) this.setState('work');
        break;
      case 'panic': {
        const r = this.follow(dt, SPEED.panic);
        speed = SPEED.panic;
        if (r !== 'moving' || this.inHouse && Math.hypot(p.x - SPOT.hide[0], p.z - SPOT.hide[1]) < 1.2) this.setState('hide');
        break;
      }
      case 'hide': {
        this.wantVel(0, 0, dt);
        const m = g.nearestMob(p, true);
        this.calmT = !m || m.dist > 12 ? this.calmT + dt : 0;
        if (g.isNightish) { this.goToBed(); break; }
        if (this.calmT > 3 && this.stateT > 2) { g.say('astra.calm', { random: true }); this.setState('work'); this.thinkT = 1; }
        break;
      }
      case 'flung':
        this.root.rotation.x += dt * 9;
        if (this.body.onGround && this.stateT > 0.3) {
          this.root.rotation.x = 0;
          this.setState('sulk');
          this.sulkDur = 9 + Math.random() * 3;
          g.say('astra.sulk', { random: true, delay: 1.2 });
        }
        break;
      case 'sulk':
        this.wantVel(0, 0, dt);
        if (Math.floor(this.stateT / 3) !== Math.floor((this.stateT - dt) / 3)) this.emote.show('rain', 2);
        if (this.stateT > this.sulkDur) {
          g.say('astra.recover', { random: true });
          this.emote.show('note', 1.5);
          this.setState('work');
          this.thinkT = 0.5;
          if (g.isNightish) this.goToBed();
        }
        break;
      case 'toBed': {
        const r = this.follow(dt, SPEED.work * 1.1);
        speed = SPEED.work;
        if (r !== 'moving' || this.stateT > 25) { this.setState('sleep'); this.body.vel.set(0, 0, 0); }
        break;
      }
      case 'sleep':
        if (Math.floor(this.stateT / 3) !== Math.floor((this.stateT - dt) / 3)) this.emote.show('zzz', 2.4);
        break;
    }

    // 体を動かす
    if (this.state === 'sleep') {
      p.set(SPOT.bed[0], SPOT.bed[1], SPOT.bed[2]);
      this.body.vel.set(0, 0, 0);
    } else {
      applyGravity(this.body, dt);
      if (this.body.inWater) this.body.vel.y = Math.max(this.body.vel.y, 2.5);
      if (this.state === 'flung') { this.body.vel.x *= Math.exp(-0.6 * dt); this.body.vel.z *= Math.exp(-0.6 * dt); }
      moveBody(g.world, this.body, dt);
    }
    this.animate(dt, speed);
  }

  updateWork(dt) {
    const g = this.game;
    const t = this.task;
    if (g.isNightish && !g.titleMode) { this.goToBed(); return 0; }
    // ひとりごと
    if (this.talkT <= 0) { this.talkT = 26 + Math.random() * 22; g.say('astra.idle', { random: true }); }
    if (!t) {
      this.wantVel(0, 0, dt);
      this.thinkT -= dt;
      if (this.thinkT <= 0) {
        const nt = this.restNext ? null : this.findTask();
        this.restNext = false;
        if (nt) this.startTask(nt);
        else this.startWander();
      }
      this.lookAtPlayer(dt);
      return 0;
    }
    if (t.phase === 'go') {
      const r = this.follow(dt, t.type === 'wander' ? SPEED.work * 0.75 : SPEED.work);
      // 緑のもの（サトウキビ・スイカ）にびっくりする
      if (this.scareCool <= 0) {
        const kind = this.greenNearby();
        if (kind) { this.startScare(kind); return 0; }
      }
      if (r === 'arrived') {
        t.phase = 'act';
        t.actT = { harvest: 1.6, plant: 1.0, till: 1.8, repair: 1.2, wander: 2.5 + Math.random() * 2.5 }[t.type];
        this.setHand(t.type === 'till' || t.type === 'repair' ? 'item_hoe' : t.type === 'plant' ? 'item_potato' : null);
        if (t.type === 'wander' && Math.random() < 0.35) this.emote.show('note', 1.6);
      } else if (r === 'stuck') { this.endTask(); this.thinkT = 1.2; }
      return t.type === 'wander' ? SPEED.work * 0.75 : SPEED.work;
    }
    // その場で作業
    this.wantVel(0, 0, dt);
    if (t.type !== 'wander') this.yaw = dampAngle(this.yaw, Math.atan2(t.x + 0.5 - this.body.pos.x, t.z + 0.5 - this.body.pos.z), 12, dt);
    else this.lookAtPlayer(dt);
    t.actT -= dt;
    if (t.actT <= 0) {
      this.doTask(t);
      this.endTask();
      // ひと仕事ごとに、ひと息つく（ときどき長めに休んで、ぶらぶらする）
      this.thinkT = 0.8 + Math.random() * 0.8;
      if (t.type !== 'wander' && Math.random() < 0.18) this.restNext = true;
    }
    return 0;
  }

  startWander() {
    const Z = LAYOUT.farmZone;
    const r = Math.random();
    let x, z;
    if (r < 0.22) { const a = Math.random() * Math.PI * 2; x = LAYOUT.pond[0] + Math.cos(a) * 4.2; z = LAYOUT.pond[1] + Math.sin(a) * 4.2; }
    else { x = Z.x0 + 1 + Math.random() * (Z.x1 - Z.x0 - 2); z = Z.z0 + Math.random() * (Z.z1 - Z.z0); }
    this.task = { type: 'wander', x: Math.floor(x), z: Math.floor(z), y: GY + 1, phase: 'go' };
    if (!this.goTo(x, z, 0.8)) { this.task = null; this.thinkT = 2; }
  }

  greenNearby() {
    const w = this.game.world;
    const p = this.body.pos;
    const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
    for (let y = by; y <= by + 1; y++) for (let z = bz - 2; z <= bz + 2; z++) for (let x = bx - 2; x <= bx + 2; x++) {
      const g = BLOCKS[w.get(x, y, z)].green;
      if (g) return g;
    }
    return null;
  }

  startScare(kind) {
    this.scareKind = kind;
    this.scareCool = 40 + Math.random() * 25;
    this.saidOk = false;
    this.endTask();
    this.setState('scare');
    this.emote.show('!', 1.6);
    this.game.say(kind === 'melon' ? 'astra.melon' : 'astra.cane', { random: true, cool: 0 });
    this.game.audio.sfx('robot_scream', { pos: this.body.pos, refDistance: 4 });
  }

  panic(mob) {
    void mob;
    this.endTask();
    this.setState('panic');
    this.emote.show('!', 1.2);
    this.game.say(mob.big ? 'astra.boss' : 'astra.panic', { random: true, cool: 6 });
    this.game.audio.sfx('robot_scream', { pos: this.body.pos, refDistance: 4 });
    this.goTo(SPOT.hide[0], SPOT.hide[1], 0.6);
  }

  lookAtPlayer(dt) {
    const pl = this.game.player;
    const p = this.body.pos;
    const d = Math.hypot(pl.pos.x - p.x, pl.pos.z - p.z);
    let want = 0;
    if (d < 5 && !this.game.titleMode) {
      const a = Math.atan2(pl.pos.x - p.x, pl.pos.z - p.z) - this.yaw;
      want = clamp(Math.atan2(Math.sin(a), Math.cos(a)), -0.9, 0.9);
    }
    this.headYaw = damp(this.headYaw, want, 6, dt);
  }

  // ------------------------------------------------------------------ 見た目
  animate(dt, speed) {
    const m = this.model;
    const P = m.parts;
    const p = this.body.pos;
    const s = this.state;
    const horiz = Math.hypot(this.body.vel.x, this.body.vel.z);
    this.walk = damp(this.walk, Math.min(1, horiz / 2), 10, dt);
    this.phase += dt * (5 + horiz * 2.6);
    const sw = Math.sin(this.phase);
    const t = this.t;
    // 姿勢を戻してから足す
    P.body.position.set(0, 0, 0);
    P.torso.rotation.set(0, 0, 0);
    P.head.rotation.set(0, this.headYaw, 0);
    P.legL.rotation.set(sw * 0.8 * this.walk, 0, 0);
    P.legR.rotation.set(-sw * 0.8 * this.walk, 0, 0);
    P.armL.rotation.set(-sw * 0.6 * this.walk, 0, -0.08);
    P.armR.rotation.set(sw * 0.6 * this.walk, 0, 0.08);
    P.body.position.y = Math.abs(sw) * 0.5 * PX * this.walk;
    let face = 'normal';
    let antenna = 0x6ff0ff;
    let jitter = 0;

    if (s === 'work' && this.task?.phase === 'act' && this.task.type !== 'wander') {
      const k = Math.sin(t * 11);
      P.armR.rotation.x = -1.3 + k * 0.7;
      P.armL.rotation.x = -0.4;
      P.torso.rotation.x = 0.18;
      P.head.rotation.x = 0.3;
      face = 'work';
    } else if (s === 'work' && this.task?.type === 'wander' && this.task.phase === 'act') {
      P.head.rotation.z = Math.sin(t * 1.4) * 0.12;
      P.armL.rotation.z = -0.25 + Math.sin(t * 2) * 0.1;
      face = 'happy';
    } else if (s === 'work' && !this.task) {
      P.head.rotation.z = Math.sin(t * 1.2) * 0.06;
    } else if (s === 'panic') {
      P.armL.rotation.set(0, 0, -2.6 + Math.sin(t * 25) * 0.3);
      P.armR.rotation.set(0, 0, 2.6 - Math.sin(t * 25 + 1) * 0.3);
      face = 'scared';
      antenna = 0xff4a3a;
    } else if (s === 'hide' || s === 'scare') {
      P.armL.rotation.set(-1.4, 0, 0.5);
      P.armR.rotation.set(-1.4, 0, -0.5);
      P.head.rotation.x = 0.25;
      P.torso.rotation.x = 0.12;
      face = s === 'scare' && this.stateT < 0.5 ? 'surprise' : s === 'scare' && this.saidOk ? 'happy' : 'scared';
      antenna = s === 'scare' && this.saidOk ? 0xffd34a : 0xff4a3a;
      jitter = s === 'scare' && this.saidOk ? 0 : 0.025;
    } else if (s === 'flung') {
      P.armL.rotation.set(0, 0, -2.4);
      P.armR.rotation.set(0, 0, 2.4);
      face = 'surprise';
      antenna = 0xff4a3a;
    } else if (s === 'sulk') {
      P.body.position.y = -2.5 * PX;
      P.legL.rotation.set(-1.45, 0, -0.15);
      P.legR.rotation.set(-1.45, 0, 0.15);
      P.head.rotation.x = 0.45;
      P.armL.rotation.set(-0.5, 0, 0.2);
      P.armR.rotation.set(-0.5, 0, -0.2);
      face = 'sad';
      antenna = 0x6a7aa0;
    } else if (s === 'sleep') {
      face = 'sleep';
      antenna = 0x3a5a8a;
    }
    // まばたき
    this.blinkT -= dt;
    if (face === 'normal' && this.blinkT < 0.12) face = 'blink';
    if (this.blinkT <= 0) this.blinkT = 2 + Math.random() * 3;
    m.setFace(face, t);
    m.setAntenna(antenna);
    m.setSack(this.game.stock);

    this.root.position.set(p.x + (jitter ? (Math.random() - 0.5) * jitter * 2 : 0), p.y, p.z + (jitter ? (Math.random() - 0.5) * jitter * 2 : 0));
    if (s === 'sleep') {
      this.root.rotation.set(-Math.PI / 2, 0, 0, 'YXZ');
      this.root.rotation.y = 0;
    } else if (s !== 'flung') {
      this.root.rotation.set(0, this.yaw, 0);
    } else this.root.rotation.y = this.yaw;
    // 明るさ
    const [sk, bl] = this.game.world.lightAt(p.x, p.y + 0.6, p.z);
    m.setLight(sk, bl);
    setEntityLight(this.handMat, sk, bl);
    this.emote.update(dt, t);
    void speed;
  }
}
