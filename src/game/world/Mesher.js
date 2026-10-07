// チャンク（16×16 の柱）ごとに、見えている面だけを 1 つの形にまとめる。
// 不透明（opaque）・切り抜き（葉・草・作物・ガラス・ランタン）・水 の 3 つに分ける。
// 頂点ごとに「面の陰 × 角の暗さ（AO）」と「まわりの光の平均（なめらかな光）」を持たせる。
import * as THREE from 'three';
import { BLOCKS, B } from './blocks.js';
import { WX, WY, WZ, CHUNK } from './World.js';
import { worldMaterial, waterMaterial } from './materials.js';

const FACES = [
  { n: [1, 0, 0], o: [1, 0, 1], u: [0, 0, -1], v: [0, 1, 0], shade: 0.6, key: 'side' },
  { n: [-1, 0, 0], o: [0, 0, 0], u: [0, 0, 1], v: [0, 1, 0], shade: 0.6, key: 'side' },
  { n: [0, 0, 1], o: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], shade: 0.8, key: 'side' },
  { n: [0, 0, -1], o: [1, 0, 0], u: [-1, 0, 0], v: [0, 1, 0], shade: 0.8, key: 'side' },
  { n: [0, 1, 0], o: [0, 1, 1], u: [1, 0, 0], v: [0, 0, -1], shade: 1.0, key: 'top' },
  { n: [0, -1, 0], o: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1], shade: 0.5, key: 'bottom' },
];
const AO = [0.42, 0.62, 0.8, 1.0];
const INSET = 0.0004;

class Buf {
  constructor() { this.pos = []; this.uv = []; this.light = []; this.idx = []; this.n = 0; }
  quad(p, uv, L, flip = false) {
    for (let k = 0; k < 4; k++) {
      this.pos.push(p[k][0], p[k][1], p[k][2]);
      this.uv.push(uv[k][0], uv[k][1]);
      this.light.push(L[k][0], L[k][1], L[k][2]);
    }
    const n = this.n;
    if (flip) this.idx.push(n, n + 1, n + 3, n + 1, n + 2, n + 3);
    else this.idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
    this.n += 4;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('light', new THREE.Float32BufferAttribute(this.light, 3));
    g.setIndex(this.n > 65000 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

export class Mesher {
  constructor(world, atlas) {
    this.world = world;
    this.atlas = atlas;
    this.group = new THREE.Group();
    this.group.name = 'world';
    this.mats = {
      opaque: worldMaterial(atlas.texture, 'opaque'),
      cutout: worldMaterial(atlas.texture, 'cutout'),
      water: waterMaterial(atlas.water),
    };
    this.chunks = [];
    const per = WX / CHUNK;
    for (let cz = 0; cz < WZ / CHUNK; cz++) for (let cx = 0; cx < per; cx++) {
      const c = { cx, cz, meshes: {} };
      for (const k of ['opaque', 'cutout', 'water']) {
        const m = new THREE.Mesh(new THREE.BufferGeometry(), this.mats[k]);
        m.name = `chunk_${cx}_${cz}_${k}`;
        m.matrixAutoUpdate = false;
        m.frustumCulled = true;
        if (k === 'water') m.renderOrder = 2;
        if (k === 'cutout') m.renderOrder = 1;
        this.group.add(m);
        c.meshes[k] = m;
      }
      this.chunks.push(c);
    }
    // タイルの UV を先に引いておく
    this.uvCache = new Map();
  }

  tileUV(name) {
    let u = this.uvCache.get(name);
    if (!u) { u = this.atlas.uv(name); this.uvCache.set(name, u); }
    return u;
  }

  /** 作り直しが要るチャンクを作り直す（max 個まで）。 */
  update(max = 16) {
    const w = this.world;
    if (w.lightDirty) w.recomputeLight();
    let n = 0;
    for (const i of [...w.dirty]) {
      if (n++ >= max) break;
      w.dirty.delete(i);
      this.build(this.chunks[i]);
    }
  }

  build(c) {
    const w = this.world;
    const bufs = { opaque: new Buf(), cutout: new Buf(), water: new Buf() };
    const x0 = c.cx * CHUNK, z0 = c.cz * CHUNK;
    const data = w.data;
    for (let y = 0; y < WY; y++) for (let z = z0; z < z0 + CHUNK; z++) for (let x = x0; x < x0 + CHUNK; x++) {
      const id = data[x + WX * (z + WZ * y)];
      if (!id) continue;
      const b = BLOCKS[id];
      switch (b.shape) {
        case 'cube': case 'low': case 'half': this.cube(b.cutout ? bufs.cutout : bufs.opaque, x, y, z, id, b); break;
        case 'cross': this.cross(bufs.cutout, x, y, z, b); break;
        case 'crop': this.crop(bufs.cutout, x, y, z, b); break;
        case 'lantern': this.lantern(bufs.cutout, x, y, z, b); break;
        case 'water': this.water(bufs.water, x, y, z); break;
        default: break;
      }
    }
    for (const k of ['opaque', 'cutout', 'water']) {
      const m = c.meshes[k];
      m.geometry.dispose();
      m.geometry = bufs[k].n ? bufs[k].geometry() : new THREE.BufferGeometry();
      m.visible = bufs[k].n > 0;
    }
  }

  // ---- 光と AO
  occ(x, y, z) { const b = BLOCKS[this.world.get(x, y, z)]; return b.full || b.cutout && !b.glass ? 1 : 0; }
  lightCell(x, y, z) {
    const w = this.world;
    if (y >= WY) return [15, 0, true];
    if (y < 0) return [0, 0, false];
    if (x < 0 || z < 0 || x >= WX || z >= WZ) return [15, 0, true];
    const i = x + WX * (z + WZ * y);
    if (BLOCKS[w.data[i]].opaque) return [0, 0, false];
    return [w.sky[i], w.blk[i], true];
  }
  /** 面の頂点の光：外側のマスと、その横・縦・ななめの 4 マスの平均（不透明は数えない）。 */
  vertexLight(ox, oy, oz, U, V, su, sv, shade, own) {
    const s1 = this.occ(ox + U[0] * su, oy + U[1] * su, oz + U[2] * su);
    const s2 = this.occ(ox + V[0] * sv, oy + V[1] * sv, oz + V[2] * sv);
    const cc = this.occ(ox + U[0] * su + V[0] * sv, oy + U[1] * su + V[1] * sv, oz + U[2] * su + V[2] * sv);
    const ao = s1 && s2 ? 0 : 3 - (s1 + s2 + cc);
    let sky = 0, blk = 0, cnt = 0;
    const add = (x, y, z) => { const l = this.lightCell(x, y, z); if (l[2]) { sky += l[0]; blk += l[1]; cnt++; } };
    add(ox, oy, oz);
    if (!s1) add(ox + U[0] * su, oy + U[1] * su, oz + U[2] * su);
    if (!s2) add(ox + V[0] * sv, oy + V[1] * sv, oz + V[2] * sv);
    if (!(s1 && s2) && !cc) add(ox + U[0] * su + V[0] * sv, oy + U[1] * su + V[1] * sv, oz + U[2] * su + V[2] * sv);
    if (!cnt) { sky = own[0]; blk = own[1]; cnt = 1; }
    return { L: [shade * AO[ao], sky / cnt / 15, blk / cnt / 15], ao };
  }

  cube(buf, x, y, z, id, b) {
    const w = this.world;
    const h = b.h;
    const own = this.lightCell(x, y, z);
    for (const f of FACES) {
      const nx = x + f.n[0], ny = y + f.n[1], nz = z + f.n[2];
      const nid = w.get(nx, ny, nz);
      const nb = BLOCKS[nid];
      const lowTop = f.n[1] === 1 && h < 1;
      if (!lowTop) {
        if (nb.full) continue;
        if (nid === id && (b.cutout || b.glass)) { if (b.glass) continue; }
        if (f.n[1] === 1 && (nb.shape === 'low' || nb.shape === 'half')) continue; // 上に畑などが乗っている
      }
      const tex = typeof b.tex === 'string' ? b.tex : b.tex[f.key];
      const [u0, v0, u1, v1] = this.tileUV(tex);
      const sideH = f.n[1] === 0 ? h : 1;
      const p = [];
      for (let k = 0; k < 4; k++) {
        const a = k === 1 || k === 2 ? 1 : 0, c = k >= 2 ? 1 : 0;
        let px = f.o[0] + f.u[0] * a + f.v[0] * c;
        let py = f.o[1] + f.u[1] * a + f.v[1] * c * sideH;
        let pz = f.o[2] + f.u[2] * a + f.v[2] * c;
        if (f.n[1] === 1) py = h;
        p.push([x + px, y + py, z + pz]);
      }
      const vt = f.n[1] === 0 ? v0 + (v1 - v0) * sideH : v1;
      const uv = [[u0 + INSET, v0 + INSET], [u1 - INSET, v0 + INSET], [u1 - INSET, vt - INSET], [u0 + INSET, vt - INSET]];
      // 低いブロックの上面は自分のマスの上（ny）を外側として光を見る
      const ox = nx, oy = ny, oz = nz;
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      const L = [], aos = [];
      for (let k = 0; k < 4; k++) {
        const r = this.vertexLight(ox, oy, oz, f.u, f.v, corners[k][0], corners[k][1], f.shade, own);
        L.push(r.L); aos.push(r.ao);
      }
      const flip = aos[0] + aos[2] < aos[1] + aos[3];
      buf.quad(p, uv, L, flip);
    }
  }

  plantLight(x, y, z) {
    const l = this.lightCell(x, y, z);
    return l[2] ? [l[0] / 15, l[1] / 15] : [1, 0];
  }

  cross(buf, x, y, z, b) {
    const [u0, v0, u1, v1] = this.tileUV(b.tex);
    const below = BLOCKS[this.world.get(x, y - 1, z)];
    const yo = below.shape === 'low' ? y - 1 / 16 : y;
    const [s, k] = this.plantLight(x, y, z);
    const L = [[0.9, s, k], [0.9, s, k], [0.9, s, k], [0.9, s, k]];
    const d = 0.45;
    const uv = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    const q = (ax, az, bx, bz) => buf.quad([[x + ax, yo, z + az], [x + bx, yo, z + bz], [x + bx, yo + 1, z + bz], [x + ax, yo + 1, z + az]], uv, L);
    q(0.5 - d, 0.5 - d, 0.5 + d, 0.5 + d);
    q(0.5 - d, 0.5 + d, 0.5 + d, 0.5 - d);
  }

  crop(buf, x, y, z, b) {
    const [u0, v0, u1, v1] = this.tileUV(b.tex);
    const yo = y - 1 / 16;
    const [s, k] = this.plantLight(x, y, z);
    const L = [[0.92, s, k], [0.92, s, k], [0.92, s, k], [0.92, s, k]];
    const uv = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    for (const o of [4 / 16, 12 / 16]) {
      buf.quad([[x + o, yo, z], [x + o, yo, z + 1], [x + o, yo + 1, z + 1], [x + o, yo + 1, z]], uv, L);
      buf.quad([[x, yo, z + o], [x + 1, yo, z + o], [x + 1, yo + 1, z + o], [x, yo + 1, z + o]], uv, L);
    }
  }

  lantern(buf, x, y, z) {
    const [u0, v0, u1, v1] = this.tileUV('lantern');
    const du = u1 - u0, dv = v1 - v0;
    const a = 5 / 16, c = 11 / 16, top = 8 / 16;
    const L = (sh) => [[sh, 1, 1], [sh, 1, 1], [sh, 1, 1], [sh, 1, 1]];
    const side = [[u0 + du * a, v0], [u0 + du * c, v0], [u0 + du * c, v0 + dv * top], [u0 + du * a, v0 + dv * top]];
    const lid = [[u0 + du * a, v1 - dv * 6 / 16], [u0 + du * c, v1 - dv * 6 / 16], [u0 + du * c, v1], [u0 + du * a, v1]];
    const X0 = x + a, X1 = x + c, Z0 = z + a, Z1 = z + c, Y0 = y, Y1 = y + top;
    buf.quad([[X0, Y0, Z1], [X1, Y0, Z1], [X1, Y1, Z1], [X0, Y1, Z1]], side, L(0.95));
    buf.quad([[X1, Y0, Z0], [X0, Y0, Z0], [X0, Y1, Z0], [X1, Y1, Z0]], side, L(0.95));
    buf.quad([[X1, Y0, Z1], [X1, Y0, Z0], [X1, Y1, Z0], [X1, Y1, Z1]], side, L(0.9));
    buf.quad([[X0, Y0, Z0], [X0, Y0, Z1], [X0, Y1, Z1], [X0, Y1, Z0]], side, L(0.9));
    buf.quad([[X0, Y1, Z1], [X1, Y1, Z1], [X1, Y1, Z0], [X0, Y1, Z0]], lid, L(1));
  }

  water(buf, x, y, z) {
    const w = this.world;
    const above = w.get(x, y + 1, z);
    const h = above === B.WATER ? 1 : 14 / 16;
    const own = this.lightCell(x, y, z);
    const lt = (cx, cy, cz, sh) => { const l = this.lightCell(cx, cy, cz); const s = l[2] ? l : own; return [sh, s[0] / 15, s[1] / 15]; };
    if (above !== B.WATER && !BLOCKS[above].full) {
      const L = lt(x, y + 1, z, 1);
      buf.quad([[x, y + h, z + 1], [x + 1, y + h, z + 1], [x + 1, y + h, z], [x, y + h, z]],
        [[x, z + 1], [x + 1, z + 1], [x + 1, z], [x, z]], [L, L, L, L]);
    }
    for (const f of FACES) {
      if (f.n[1] !== 0) continue;
      const nid = w.get(x + f.n[0], y, z + f.n[2]);
      if (nid === B.WATER || BLOCKS[nid].full) continue;
      const L = lt(x + f.n[0], y, z + f.n[2], f.shade);
      const p = [];
      for (let k = 0; k < 4; k++) {
        const a = k === 1 || k === 2 ? 1 : 0, c = k >= 2 ? 1 : 0;
        p.push([x + f.o[0] + f.u[0] * a, y + c * h, z + f.o[2] + f.u[2] * a]);
      }
      const uu = (pt) => (f.n[0] !== 0 ? pt[2] : pt[0]);
      buf.quad(p, p.map((pt) => [uu(pt), pt[1]]), [L, L, L, L]);
    }
  }
}
