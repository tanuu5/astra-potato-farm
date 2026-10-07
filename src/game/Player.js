// プレイヤー：一人称の移動（歩く・走る・跳ぶ・泳ぐ）、体力、手に持つ物（剣・クワ・じゃがいも・火薬）と振る動き。
import * as THREE from 'three';
import { moveBody, applyGravity } from './physics.js';
import { itemMesh, blockItemGeometry } from './models.js';
import { entityMaterial, setEntityLight } from './world/materials.js';
import { clamp, damp } from '../core/math.js';
import { BLOCKS } from './world/blocks.js';

const WALK = 4.3, SPRINT = 5.9, JUMP = 8.6;

export class Player {
  constructor(game, camera) {
    this.game = game;
    this.camera = camera;
    this.body = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), hw: 0.3, h: 1.8, onGround: false, step: 1.05, inWater: false };
    this.eye = 1.62;
    this.yaw = Math.PI;
    this.pitch = 0;
    this.maxHp = 20;
    this.hp = 20;
    this.alive = true;
    // 手に持つ物（カメラの子）
    this.handMat = entityMaterial(game.atlas.texture);
    this.hand = new THREE.Group();
    this.hand.name = 'viewHand';
    camera.add(this.hand);
    // 持ちもの：剣・クワ・じゃがいも・火薬はドット絵に厚み、土は小さなブロック
    this.items = {};
    for (const n of ['sword', 'hoe', 'potato', 'powder']) {
      const m = itemMesh(game.atlas, 'item_' + n, this.handMat);
      m.visible = false;
      this.hand.add(m);
      this.items[n] = m;
    }
    const dirt = new THREE.Mesh(blockItemGeometry(game.atlas, { top: 'grass_top', side: 'grass_side', bottom: 'dirt' }), this.handMat);
    dirt.name = 'item_dirt';
    dirt.visible = false;
    this.hand.add(dirt);
    this.items.dirt = dirt;
    this.tool = 'sword';   // 選んでいる持ちもの（Game が決める）
    this.held = 'sword';   // 手に見えているもの（食べるときなどは一時的にじゃがいも）
    this.showT = 0;
    this.reset([0, 10, 0]);
  }

  get pos() { return this.body.pos; }

  reset(at, yaw = Math.PI) {
    this.body.pos.set(at[0], at[1], at[2]);
    this.body.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = -0.08;
    this.hp = this.maxHp;
    this.alive = true;
    this.hurtT = 0;
    this.sinceHurt = 10;
    this.regenT = 0;
    this.swing = 1;
    this.bob = 0;
    this.bobAmt = 0;
    this.stepT = 0;
    this.eyeOff = 0;
    this.sprinting = false;
    this.deadT = 0;
  }

  /** 手に持つ物を一時的に替える（食べるときのじゃがいもなど）。 */
  show(name, t = 0.6) { this.held = name; this.showT = t; }

  /** 持ちものを選ぶ（持ちかえの動き付き）。 */
  setTool(name) {
    if (this.tool === name) return;
    this.tool = name;
    if (this.showT <= 0) this.held = name;
    this.equipT = 0.18;
  }

  swingHand() { this.swing = 0; }

  damage(n, from) {
    if (!this.alive || n <= 0) return;
    this.hp = Math.max(0, this.hp - n);
    this.hurtT = 0.5;
    this.sinceHurt = 0;
    if (from) {
      const d = new THREE.Vector3(this.body.pos.x - from.x, 0, this.body.pos.z - from.z);
      if (d.lengthSq() < 1e-4) d.set(0, 0, 1);
      d.normalize().multiplyScalar(Math.min(14, 4 + n * 0.8));
      this.body.vel.x += d.x; this.body.vel.z += d.z;
      this.body.vel.y = Math.max(this.body.vel.y, 5 + n * 0.15);
      this.body.onGround = false;
    }
    if (this.hp <= 0) this.alive = false;
  }

  heal(n) { this.hp = Math.min(this.maxHp, this.hp + n); }

  update(dt, input, allowMove = true) {
    const b = this.body;
    if (allowMove && this.alive) {
      this.yaw -= input.look.x;
      this.pitch = clamp(this.pitch - input.look.y, -1.55, 1.55);
    }
    const mv = allowMove && this.alive ? input.move : { x: 0, y: 0 };
    const len = Math.hypot(mv.x, mv.y);
    this.sprinting = allowMove && (input.down('sprint') || (input.device === 'touch' && len > 0.95)) && mv.y > 0.3;
    const sp = (this.sprinting ? SPRINT : WALK) * (b.inWater ? 0.55 : 1);
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = -fz, rz = fx;
    const wx = (fx * mv.y + rx * mv.x) * sp, wz = (fz * mv.y + rz * mv.x) * sp;
    const k = b.onGround ? 14 : b.inWater ? 4 : 3.2;
    b.vel.x = damp(b.vel.x, wx, k, dt);
    b.vel.z = damp(b.vel.z, wz, k, dt);
    if (allowMove && this.alive && input.down('jump')) {
      if (b.inWater) b.vel.y = Math.max(b.vel.y, 3.2);
      else if (b.onGround && !this.game.grace) { b.vel.y = JUMP; b.onGround = false; this.game.audio.sfx('jump'); }
    }
    const wasGround = b.onGround, fallV = b.vel.y;
    applyGravity(b, dt);
    const r = moveBody(this.game.world, b, dt);
    if (r.stepped) this.eyeOff -= r.stepped;
    this.eyeOff = damp(this.eyeOff, 0, 14, dt);
    if (!wasGround && b.onGround && fallV < -6) this.game.audio.sfx('land', { vel: Math.min(1, -fallV / 16) });
    // 足音
    const horiz = Math.hypot(b.vel.x, b.vel.z);
    this.bobAmt = damp(this.bobAmt, b.onGround && horiz > 0.5 ? Math.min(1, horiz / WALK) : 0, 10, dt);
    this.bob += dt * horiz * 1.9;
    if (b.onGround && horiz > 1) {
      this.stepT -= dt * horiz;
      if (this.stepT <= 0) {
        this.stepT = 2.2;
        const under = this.game.world.get(Math.floor(b.pos.x), Math.floor(b.pos.y - 0.05), Math.floor(b.pos.z));
        this.game.audio.sfx('step', { kind: BLOCKS[under]?.particle === 0xdbd3a0 ? 'sand' : 'grass' });
      }
    }
    if (b.inWater && !this.wasInWater) this.game.audio.sfx('splash');
    this.wasInWater = b.inWater;
    // 体力：しばらく当たらなければ少しずつ戻る
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.sinceHurt += dt;
    if (this.alive && this.hp < this.maxHp && this.sinceHurt > 5) {
      this.regenT += dt;
      if (this.regenT > 2.5) { this.regenT = 0; this.heal(1); }
    }
    this.swing = Math.min(1, this.swing + dt * 3.2);
    this.showT -= dt;
    if (this.showT <= 0) this.held = this.tool;
    this.equipT = Math.max(0, (this.equipT || 0) - dt);
  }

  /** カメラと手の位置。 */
  updateCamera(dt, time) {
    const b = this.body;
    const cam = this.camera;
    const bobY = Math.abs(Math.sin(this.bob)) * 0.055 * this.bobAmt;
    const bobX = Math.cos(this.bob) * 0.035 * this.bobAmt;
    cam.position.set(b.pos.x, b.pos.y + this.eye + this.eyeOff + bobY, b.pos.z);
    cam.rotation.set(this.pitch, this.yaw, Math.sin(this.bob) * 0.006 * this.bobAmt, 'YXZ');
    if (!this.alive) {
      this.deadT += dt;
      cam.position.y = b.pos.y + Math.max(0.25, this.eye - this.deadT * 3);
      cam.rotation.z = Math.min(1.2, this.deadT * 2.5);
    } else this.deadT = 0;
    const fov = this.sprinting ? 78 : 72;
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov = damp(cam.fov, fov, 8, dt); cam.updateProjectionMatrix(); }
    // 手
    for (const [n, m] of Object.entries(this.items)) m.visible = n === this.held && this.alive;
    const s = this.swing;
    const sw = Math.sin(s * Math.PI);
    const sw2 = Math.sin(Math.sqrt(s) * Math.PI);
    const h = this.hand;
    h.position.set(0.4 + bobX - sw2 * 0.14, -0.36 - bobY * 0.6 + sw * 0.06, -0.62 - sw * 0.12);
    const m = this.items[this.held];
    if (m) {
      const k = this.held;
      const tool = k === 'sword' || k === 'hoe';
      if (k === 'dirt') {
        m.scale.setScalar(0.17);
        m.rotation.set(0.25 - sw * 0.6, 0.75, 0.05);
        m.position.set(-0.02, -0.02, 0);
      } else {
        m.scale.setScalar(tool ? 0.3 : 0.2);
        m.rotation.set(tool ? 0.15 - sw * 1.2 : -0.3 - sw * 0.6, tool ? -1.15 : -0.5, tool ? 0.1 + sw2 * 0.5 : -0.2);
        m.position.set(0, tool ? 0.04 : -0.02, 0);
      }
    }
    // 持ちかえたときは、下から出てくる
    h.position.y -= (this.equipT || 0) * 1.6;
    h.rotation.set(0, 0, Math.sin(time * 1.3) * 0.01);
    const [sk, bl] = this.game.world.lightAt(b.pos.x, b.pos.y + this.eye, b.pos.z);
    setEntityLight(this.handMat, sk, bl);
  }

  /** 目の位置と向き（狙いの光線）。 */
  ray() {
    const cam = this.camera;
    const o = cam.position.clone();
    const d = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    return { o, d };
  }
}
