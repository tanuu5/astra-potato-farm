// 緑のアレ（近づいて、シューッといって、爆発する）と、ブタ（ただ歩いている）。
import * as THREE from 'three';
import { createGreenModel, createPigModel } from './models.js';
import { findPath } from './nav.js';
import { moveBody, applyGravity } from './physics.js';
import { damp, dampAngle } from '../core/math.js';
import { setEntityLight } from './world/materials.js';
import { LAYOUT, GY, WX } from './world/World.js';
import { HOUSE_IN } from './Robot.js';

const houseCell = (i) => { const x = i % WX, z = (i / WX) | 0; return x >= HOUSE_IN.x0 && x <= HOUSE_IN.x1 && z >= HOUSE_IN.z0 - 0 && z <= HOUSE_IN.z1 + 1; };

export class Green {
  constructor(game, x, z, { big = false, night = false } = {}) {
    this.game = game;
    this.big = big;
    this.model = createGreenModel({ big });
    this.root = this.model.root;
    game.scene.add(this.root);
    const s = this.model.baseScale;
    this.body = { pos: new THREE.Vector3(x, game.world.floor[Math.floor(x) + Math.floor(z) * WX] || GY + 1, z), vel: new THREE.Vector3(), hw: 0.3 * s, h: 0.8 * s, onGround: false, step: 1.05, inWater: false };
    this.hp = big ? 14 : 3;
    this.maxHp = this.hp;
    this.speed = big ? 1.8 : night ? 2.75 : 2.45;
    this.fuseTime = big ? 2.4 : 1.5;
    this.radius = big ? 4.3 : 2.9;
    this.fuse = 0;
    this.state = 'emerge';
    this.stateT = 0;
    this.yaw = Math.atan2(LAYOUT.center[0] - x, LAYOUT.center[1] - z);
    this.repathT = 0;
    this.path = null;
    this.target = null;
    this.hurt = 0;
    this.stun = 0;
    this.phase = Math.random() * 6;
    this.t = 0;
    this.dead = false;
    this.root.position.copy(this.body.pos);
  }

  get pos() { return this.body.pos; }
  get center() { return new THREE.Vector3(this.body.pos.x, this.body.pos.y + this.body.h * 0.5, this.body.pos.z); }

  /** 狙うもの：近いプレイヤーかアストラ、いなければ畑の作物。 */
  pickTarget() {
    const g = this.game, p = this.body.pos;
    const cands = [];
    if (g.player.alive) cands.push({ kind: 'player', pos: g.player.pos, d: p.distanceTo(g.player.pos) });
    if (g.robot.exposed) cands.push({ kind: 'robot', pos: g.robot.body.pos, d: p.distanceTo(g.robot.body.pos) });
    cands.sort((a, b) => a.d - b.d);
    if (cands.length && cands[0].d < 16) return cands[0];
    const crop = g.nearestCrop(p);
    if (crop) return { kind: 'crop', pos: new THREE.Vector3(crop[0] + 0.5, GY + 1, crop[1] + 0.5), d: 0 };
    return { kind: 'farm', pos: new THREE.Vector3(LAYOUT.fieldA.water[0] + 0.5, GY + 1, LAYOUT.fieldA.water[1] + 2.5), d: 0 };
  }

  hit(dmg, from, knock = 1) {
    if (this.dead || this.state === 'emerge' || this.state === 'leave') return false;
    this.hp -= dmg;
    this.hurt = 0.35;
    this.fuse = 0;
    this.stun = 0.45;
    const d = new THREE.Vector3(this.body.pos.x - from.x, 0, this.body.pos.z - from.z);
    if (d.lengthSq() < 1e-4) d.set(0, 0, 1);
    d.normalize().multiplyScalar((this.big ? 3 : 8.5) * knock);
    this.body.vel.set(d.x, this.big ? 3 : 5.5, d.z);
    this.body.onGround = false;
    if (this.state === 'fuse') this.state = 'chase';
    if (this.hp <= 0) { this.dead = true; this.state = 'dead'; }
    return true;
  }

  /** 朝になったら地面にもぐって帰る。 */
  leave() { if (!this.dead && this.state !== 'leave') { this.state = 'leave'; this.stateT = 0; this.fuse = 0; } }

  update(dt) {
    const g = this.game;
    this.t += dt;
    this.stateT += dt;
    this.hurt = Math.max(0, this.hurt - dt);
    this.stun = Math.max(0, this.stun - dt);
    const p = this.body.pos;
    let moving = false;
    if (this.state === 'emerge') {
      // 地面から出てくる
      const k = Math.min(1, this.stateT / 1.0);
      this.root.position.set(p.x, p.y - (1 - k) * this.body.h * 1.1, p.z);
      if (this.stateT < 0.9 && Math.random() < 0.5) g.particles.burst(p.x - 0.5, p.y - 0.1, p.z - 0.5, 0x7a5539, 1, 1);
      if (k >= 1) { this.state = 'chase'; this.stateT = 0; }
      this.animate(dt, false);
      return;
    }
    if (this.state === 'leave') {
      const k = Math.min(1, this.stateT / 1.2);
      this.root.position.set(p.x, p.y - k * this.body.h * 1.2, p.z);
      if (Math.random() < 0.4) g.particles.burst(p.x - 0.5, p.y - 0.1, p.z - 0.5, 0x7a5539, 1, 1);
      if (k >= 1) this.dead = true;
      this.animate(dt, false);
      return;
    }

    this.repathT -= dt;
    if (this.repathT <= 0 && this.stun <= 0) {
      this.repathT = 0.7 + Math.random() * 0.3;
      this.target = this.pickTarget();
      const t = this.target;
      const r = findPath(g.world, p.x, p.z, t.pos.x, t.pos.z, { near: t.kind === 'crop' ? 0 : 1, maxNodes: 2200, blocked: houseCell });
      this.path = r.path;
      this.pathI = 0;
    }
    const t = this.target;
    if (this.state === 'chase' && t && this.stun <= 0) {
      const dist = t.kind === 'crop' || t.kind === 'farm' ? Math.hypot(t.pos.x - p.x, t.pos.z - p.z) : p.distanceTo(t.pos);
      const close = t.kind === 'crop' ? dist < 0.9 : t.kind === 'farm' ? dist < 1.5 : dist < (this.big ? 3.0 : 2.3);
      if (close) {
        this.state = 'fuse';
        this.stateT = 0;
        g.onFuse(this);
      } else {
        // 道をたどる（道がなければまっすぐ）
        let tx = t.pos.x, tz = t.pos.z;
        if (this.path && this.pathI < this.path.length) {
          const [cx, cz] = this.path[this.pathI];
          tx = cx + 0.5; tz = cz + 0.5;
          if (Math.hypot(tx - p.x, tz - p.z) < 0.4) this.pathI++;
        }
        const dx = tx - p.x, dz = tz - p.z;
        const d = Math.hypot(dx, dz) || 1;
        this.body.vel.x = damp(this.body.vel.x, (dx / d) * this.speed, 8, dt);
        this.body.vel.z = damp(this.body.vel.z, (dz / d) * this.speed, 8, dt);
        this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 8, dt);
        moving = true;
      }
    }
    if (this.state === 'fuse') {
      this.body.vel.x = damp(this.body.vel.x, 0, 10, dt);
      this.body.vel.z = damp(this.body.vel.z, 0, 10, dt);
      if (t) this.yaw = dampAngle(this.yaw, Math.atan2(t.pos.x - p.x, t.pos.z - p.z), 8, dt);
      // 狙った相手が離れたら、やめて追いかける
      const away = t && (t.kind === 'player' || t.kind === 'robot') && p.distanceTo(t.pos) > (this.big ? 6 : 4.5);
      if (away) {
        this.fuse -= dt * 1.5;
        if (this.fuse <= 0) { this.fuse = 0; this.state = 'chase'; g.onDefuse(this); }
      } else this.fuse += dt;
      if (this.fuse >= this.fuseTime) { g.explode(this); return; }
    }
    if (this.stun > 0) {
      this.body.vel.x *= Math.exp(-2.5 * dt);
      this.body.vel.z *= Math.exp(-2.5 * dt);
    }
    applyGravity(this.body, dt);
    if (this.body.inWater) this.body.vel.y = Math.max(this.body.vel.y, 2);
    const r = moveBody(g.world, this.body, dt);
    if ((r.hitX || r.hitZ) && this.body.onGround && moving) this.body.vel.y = 7.5;
    this.root.position.copy(p);
    this.animate(dt, moving);
  }

  animate(dt, moving) {
    const M = this.model;
    this.phase += dt * (moving ? 9 : 2);
    const sw = Math.sin(this.phase);
    const amp = moving ? 0.6 : 0.05;
    M.legs[0].rotation.x = sw * amp; M.legs[3].rotation.x = sw * amp;
    M.legs[1].rotation.x = -sw * amp; M.legs[2].rotation.x = -sw * amp;
    M.body.rotation.z = Math.sin(this.t * 3) * 0.03;
    let s = M.baseScale;
    let flash = 0;
    if (this.state === 'fuse') {
      const k = this.fuse / this.fuseTime;
      s *= 1 + k * 0.22 + Math.sin(this.t * 30) * 0.02 * k;
      flash = Math.sin(this.t * (8 + k * 30)) > 0 ? 0.25 + k * 0.6 : 0;
    }
    M.scale.scale.set(s, s * (1 - (this.state === 'fuse' ? 0.04 : 0)), s);
    M.mat.uniforms.uFlash.value = flash;
    M.mat.uniforms.uHurt.value = this.hurt > 0 ? 1 : 0;
    this.root.rotation.y = this.yaw;
    const p = this.body.pos;
    const [sk, bl] = this.game.world.lightAt(p.x, p.y + 0.5, p.z);
    setEntityLight(M.mat, sk, bl);
  }

  dispose() { this.game.scene.remove(this.root); }
}

export class Pig {
  constructor(game, x, z) {
    this.game = game;
    this.model = createPigModel();
    this.root = this.model.root;
    game.scene.add(this.root);
    this.body = { pos: new THREE.Vector3(x, GY + 2, z), vel: new THREE.Vector3(), hw: 0.4, h: 0.85, onGround: false, step: 1.05, inWater: false };
    this.yaw = Math.random() * 6;
    this.wantYaw = this.yaw;
    this.walkT = 0;
    this.idleT = 1 + Math.random() * 3;
    this.run = 0;
    this.hurt = 0;
    this.phase = 0;
    this.t = 0;
  }
  get pos() { return this.body.pos; }

  hit(from) {
    this.hurt = 0.35;
    this.run = 3;
    const d = new THREE.Vector3(this.body.pos.x - from.x, 0, this.body.pos.z - from.z).normalize();
    this.body.vel.set(d.x * 6, 4.5, d.z * 6);
    this.wantYaw = Math.atan2(d.x, d.z);
    this.game.audio.sfx('pig', { pos: this.body.pos });
    return true;
  }

  update(dt) {
    const g = this.game;
    this.t += dt;
    this.hurt = Math.max(0, this.hurt - dt);
    this.run = Math.max(0, this.run - dt);
    let speed = 0;
    if (this.run > 0) {
      speed = 4.2;
      if (Math.random() < dt * 1.5) this.wantYaw += (Math.random() - 0.5) * 2;
    } else if (this.walkT > 0) {
      this.walkT -= dt;
      speed = 1.2;
    } else {
      this.idleT -= dt;
      if (this.idleT <= 0) {
        this.idleT = 2 + Math.random() * 5;
        this.walkT = 1 + Math.random() * 2.5;
        // 畑に入らないよう、出発点のほうへ向かいがち
        const home = g.world.pigCells[(this.home ??= Math.floor(Math.random() * g.world.pigCells.length))];
        const hx = (home % WX) + 0.5, hz = ((home / WX) | 0) + 0.5;
        const toHome = Math.atan2(hx - this.body.pos.x, hz - this.body.pos.z);
        this.wantYaw = Math.random() < 0.6 ? toHome + (Math.random() - 0.5) : Math.random() * Math.PI * 2;
        if (Math.random() < 0.3) g.audio.sfx('pig', { pos: this.body.pos, vel: 0.5 });
      }
    }
    this.yaw = dampAngle(this.yaw, this.wantYaw, 5, dt);
    if (this.hurt <= 0.1 || this.body.onGround) {
      this.body.vel.x = damp(this.body.vel.x, Math.sin(this.yaw) * speed, 6, dt);
      this.body.vel.z = damp(this.body.vel.z, Math.cos(this.yaw) * speed, 6, dt);
    }
    // 水と畑のほうへは行かない
    const ahead = Math.floor(this.body.pos.x + Math.sin(this.yaw) * 0.9) + Math.floor(this.body.pos.z + Math.cos(this.yaw) * 0.9) * WX;
    if (speed > 0 && (g.world.water[ahead] || g.isFarmCell(ahead))) { this.wantYaw += Math.PI * (0.6 + Math.random() * 0.8); this.body.vel.x *= 0.2; this.body.vel.z *= 0.2; }
    applyGravity(this.body, dt);
    if (this.body.inWater) this.body.vel.y = Math.max(this.body.vel.y, 2.5);
    const r = moveBody(g.world, this.body, dt);
    if ((r.hitX || r.hitZ) && this.body.onGround && speed > 0) this.body.vel.y = 7;
    // 見た目
    const M = this.model;
    const horiz = Math.hypot(this.body.vel.x, this.body.vel.z);
    this.phase += dt * (3 + horiz * 4);
    const sw = Math.sin(this.phase) * Math.min(0.7, horiz * 0.4);
    M.legs[0].rotation.x = sw; M.legs[3].rotation.x = sw; M.legs[1].rotation.x = -sw; M.legs[2].rotation.x = -sw;
    M.head.rotation.x = Math.sin(this.t * 0.7) * 0.08;
    M.mat.uniforms.uHurt.value = this.hurt > 0 ? 1 : 0;
    this.root.position.copy(this.body.pos);
    this.root.rotation.y = this.yaw;
    const p = this.body.pos;
    const [sk, bl] = g.world.lightAt(p.x, p.y + 0.5, p.z);
    setEntityLight(M.mat, sk, bl);
  }

  dispose() { this.game.scene.remove(this.root); }
}
