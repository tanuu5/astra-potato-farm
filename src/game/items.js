// 地面に落ちたアイテム（じゃがいも・火薬・緑のじゃがいも）。ぽんと飛び出して、回りながら浮き、近づくと吸いこまれる。
import * as THREE from 'three';
import { itemMesh } from './models.js';
import { entityMaterial, setEntityLight } from './world/materials.js';
import { BLOCKS } from './world/blocks.js';

const TILE = { potato: 'item_potato', powder: 'item_powder', green: 'item_green' };

export class Drops {
  constructor(game) {
    this.game = game;
    this.list = [];
  }

  spawn(kind, x, y, z, { vx, vy, vz, delay = 0.35 } = {}) {
    const mat = entityMaterial(this.game.atlas.texture);
    const m = itemMesh(this.game.atlas, TILE[kind], mat);
    m.scale.setScalar(0.32);
    m.position.set(x, y, z);
    this.game.scene.add(m);
    this.list.push({
      kind, m, mat,
      pos: new THREE.Vector3(x, y, z),
      vel: new THREE.Vector3(vx ?? (Math.random() - 0.5) * 2.4, vy ?? 3.2 + Math.random() * 1.6, vz ?? (Math.random() - 0.5) * 2.4),
      age: 0, delay, spin: Math.random() * 6, ground: false,
    });
  }

  update(dt) {
    const g = this.game, w = g.world;
    const pl = g.player;
    const target = new THREE.Vector3(pl.pos.x, pl.pos.y + 0.9, pl.pos.z);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const d = this.list[i];
      d.age += dt;
      const p = d.pos;
      const toP = target.clone().sub(p);
      const dist = toP.length();
      if (pl.alive && d.age > d.delay && dist < 2.6) {
        // 吸いこまれる
        d.vel.lerp(toP.normalize().multiplyScalar(9), Math.min(1, dt * 10));
        p.addScaledVector(d.vel, dt);
        if (dist < 0.6) { g.collect(d.kind); this.remove(i); continue; }
      } else {
        d.vel.y -= 16 * dt;
        d.vel.x *= Math.exp(-(d.ground ? 6 : 0.8) * dt);
        d.vel.z *= Math.exp(-(d.ground ? 6 : 0.8) * dt);
        const nx = p.x + d.vel.x * dt, nz = p.z + d.vel.z * dt;
        // 横：ブロックの中に入らない
        if (!BLOCKS[w.get(Math.floor(nx), Math.floor(p.y), Math.floor(p.z))].solid) p.x = nx; else d.vel.x *= -0.3;
        if (!BLOCKS[w.get(Math.floor(p.x), Math.floor(p.y), Math.floor(nz))].solid) p.z = nz; else d.vel.z *= -0.3;
        p.y += d.vel.y * dt;
        const gy = w.groundBelow(p.x, p.y + 0.3, p.z) + 0.12;
        if (p.y < gy) { p.y = gy; d.vel.y = d.vel.y < -3 ? -d.vel.y * 0.25 : 0; d.ground = true; }
        else d.ground = false;
      }
      d.spin += dt * 2;
      d.m.position.set(p.x, p.y + 0.1 + Math.sin(d.age * 3 + d.spin) * 0.05, p.z);
      d.m.rotation.y = d.spin;
      const [sk, bl] = w.lightAt(p.x, p.y + 0.2, p.z);
      setEntityLight(d.mat, sk, bl);
      if (d.age > 120) this.remove(i);
    }
  }

  remove(i) {
    const d = this.list[i];
    this.game.scene.remove(d.m);
    d.mat.dispose();
    this.list.splice(i, 1);
  }

  clear() { for (let i = this.list.length - 1; i >= 0; i--) this.remove(i); }
}
