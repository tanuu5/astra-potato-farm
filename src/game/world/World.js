// ボクセルの世界：ブロックの並び、島の生成、光（空の光・ランタンの光）、視線の当たり（raycast）、歩ける床の高さ。
// 座標はブロック 1 個 = 1。ブロック (x, y, z) は [x, x+1] × [y, y+1] × [z, z+1] を占める。
import { B, BLOCKS, isCrop } from './blocks.js';
import { mulberry32 } from '../../core/rng.js';
import { smoothstep, lerp } from '../../core/math.js';

export const WX = 64, WY = 32, WZ = 64;
export const CHUNK = 16;
export const SEA = 8;      // 海の水は y < SEA（水面は y = 7 の上）
export const GY = 9;       // 台地の地面（草）の y。立つ高さは 10
const N = WX * WY * WZ;

// 島の上の配置（生成とゲームの両方で使う）
export const LAYOUT = {
  center: [32, 32],
  fieldA: { x0: 21, x1: 29, z0: 30, z1: 38, water: [25, 34] },
  fieldB: { x0: 31, x1: 39, z0: 30, z1: 38, water: [35, 34] },
  pathX: 30,
  house: { x0: 27, x1: 33, z0: 19, z1: 24, door: [30, 24] },
  bed: [28, 20],                     // ベッドは (28,20) と (28,21)
  box: [34, 25],                     // 出荷箱
  pond: [42.5, 42.5],
  farmZone: { x0: 19, x1: 41, z0: 28, z1: 40 },   // アストラが働く範囲
  spawn: [30.5, GY + 1, 27.5],       // プレイヤーが出てくる場所（家の前）
  posts: [[20, 29], [40, 29], [20, 39], [40, 39]],
};

// ---- 値ノイズ（生成用）
function hash2(x, y, s) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s, oct = 3) {
  let sum = 0, amp = 1, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { sum += amp * vnoise(x * f, y * f, s + i * 17); norm += amp; amp *= 0.5; f *= 2; }
  return sum / norm;
}

const inRect = (x, z, r, pad = 0) => x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad;

export class World {
  constructor(seed = 20261007) {
    this.seed = seed;
    this.data = new Uint8Array(N);
    this.base = null;            // 生成した直後の並び（セーブの差分と、穴を埋めるときの元の形）
    this.sky = new Uint8Array(N);
    this.blk = new Uint8Array(N);
    this.floor = new Int8Array(WX * WZ);   // 歩ける床の高さ（立つ y）。-1 は立てない
    this.water = new Uint8Array(WX * WZ); // 床が水の中なら 1
    this.dirty = new Set();       // 作り直すチャンク（cx + cz * 4）
    this.lightDirty = false;
    this.navDirty = new Set();
    this.spawnCells = [];         // 緑のアレが出てくる候補
    this.pigCells = [];
  }

  idx(x, y, z) { return x + WX * (z + WZ * y); }
  inside(x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < WX && y < WY && z < WZ; }
  get(x, y, z) {
    if (y < 0) return B.BEDROCK;
    if (x < 0 || z < 0 || x >= WX || z >= WZ || y >= WY) return B.AIR;
    return this.data[x + WX * (z + WZ * y)];
  }
  def(x, y, z) { return BLOCKS[this.get(x, y, z)]; }
  baseAt(x, y, z) { return this.inside(x, y, z) ? this.base[this.idx(x, y, z)] : B.AIR; }

  /** ブロックを置き換える。見た目・光・歩ける床の作り直しを予約する。 */
  set(x, y, z, id) {
    if (!this.inside(x, y, z)) return;
    const i = this.idx(x, y, z);
    const old = this.data[i];
    if (old === id) return;
    this.data[i] = id;
    const a = BLOCKS[old], b = BLOCKS[id];
    if (a.opaque !== b.opaque || a.light !== b.light || a.skyAtten !== b.skyAtten) this.lightDirty = true;
    this.markDirty(x, z);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, nz = z + dz;
      if (nx >= 0 && nz >= 0 && nx < WX && nz < WZ) this.navDirty.add(nx + nz * WX);
    }
  }

  markDirty(x, z) {
    const cx = x >> 4, cz = z >> 4;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      // AO と光は隣のブロックも見るので、チャンクの端なら隣のチャンクも
      const ex = (x + dx) >> 4, ez = (z + dz) >> 4;
      if (ex < 0 || ez < 0 || ex >= WX / CHUNK || ez >= WZ / CHUNK) continue;
      if (ex !== cx || ez !== cz || (dx === 0 && dz === 0)) this.dirty.add(ex + ez * (WX / CHUNK));
    }
  }

  // ------------------------------------------------------------------ 生成
  generate() {
    const S = this.seed;
    const rng = mulberry32(S);
    const d = this.data;
    d.fill(0);
    const [cx, cz] = LAYOUT.center;
    const top = new Int8Array(WX * WZ);
    for (let z = 0; z < WZ; z++) for (let x = 0; x < WX; x++) {
      const dx = x + 0.5 - cx, dz = z + 0.5 - cz;
      const r = Math.hypot(dx, dz);
      const ang = Math.atan2(dz, dx);
      const R = 27.5 + (fbm(Math.cos(ang) * 1.6 + 7, Math.sin(ang) * 1.6 + 7, S, 2) - 0.5) * 7;
      const t = r / R;
      let h;
      if (t >= 1) h = SEA - 2 - Math.min(3, (t - 1) * 14);
      else {
        const hill = fbm(x * 0.09, z * 0.09, S + 1, 3);
        const shore = smoothstep(1.0, 0.86, t);
        const ring = smoothstep(0.5, 0.7, t) * (1 - smoothstep(0.84, 0.97, t));
        h = SEA - 1 + shore * 2.2 + ring * (hill * 6.5 + 0.5) + (hill - 0.5) * 1.2 * shore;
        const flat = 1 - smoothstep(15.5, 19.5, r);
        h = lerp(h, GY, flat);
      }
      const gy = Math.max(2, Math.min(WY - 8, Math.round(h)));
      top[x + z * WX] = gy;
      const beach = gy <= SEA && t > 0.75;
      for (let y = 0; y <= gy; y++) {
        let id;
        if (y === 0) id = B.BEDROCK;
        else if (y < gy - 3) id = B.STONE;
        else if (y < gy) id = beach || gy < SEA - 1 ? B.SAND : B.DIRT;
        else id = beach || gy < SEA - 1 ? (gy < SEA - 2 && hash2(x, z, S + 5) < 0.25 ? B.GRAVEL : B.SAND) : B.GRASS;
        d[this.idx(x, y, z)] = id;
      }
      for (let y = gy + 1; y < SEA; y++) d[this.idx(x, y, z)] = B.WATER;
    }

    const put = (x, y, z, id) => { if (this.inside(x, y, z)) d[this.idx(x, y, z)] = id; };
    const at = (x, y, z) => (this.inside(x, y, z) ? d[this.idx(x, y, z)] : B.AIR);

    // 畑（A は耕して植えてある、B はまだ草地）と、水路
    const A = LAYOUT.fieldA, Bf = LAYOUT.fieldB;
    for (let z = A.z0; z <= A.z1; z++) for (let x = A.x0; x <= A.x1; x++) {
      put(x, GY, z, B.FARM_WET);
      const col = x - A.x0;
      let crop = -1;
      if (col <= 1) crop = 3;
      else if (col <= 5) crop = Math.floor(rng() * 3);
      if (crop >= 0) put(x, GY + 1, z, B.POTATO0 + crop);
    }
    put(A.water[0], GY, A.water[1], B.WATER);
    put(A.water[0], GY + 1, A.water[1], B.AIR);
    put(Bf.water[0], GY, Bf.water[1], B.WATER);
    // 小道（家から畑のあいだへ）
    for (let z = LAYOUT.house.z1 + 1; z <= A.z1 + 1; z++) put(LAYOUT.pathX, GY, z, B.PATH);
    for (let x = A.x0 - 1; x <= Bf.x1 + 1; x++) put(x, GY, A.z0 - 1, B.PATH);

    // 家（アストラの家。チェストは置かない）
    const H = LAYOUT.house;
    for (let z = H.z0; z <= H.z1; z++) for (let x = H.x0; x <= H.x1; x++) {
      put(x, GY, z, B.COBBLE);
      const edge = x === H.x0 || x === H.x1 || z === H.z0 || z === H.z1;
      const corner = (x === H.x0 || x === H.x1) && (z === H.z0 || z === H.z1);
      for (let y = GY + 1; y <= GY + 3; y++) put(x, y, z, edge ? (corner ? B.LOG : B.PLANKS) : B.AIR);
    }
    for (const [x, z] of [[30, H.z0], [H.x0, 21], [H.x0, 22], [H.x1, 21], [H.x1, 22], [28, H.z1], [32, H.z1]]) put(x, GY + 2, z, B.GLASS);
    put(H.door[0], GY + 1, H.door[1], B.AIR);
    put(H.door[0], GY + 2, H.door[1], B.AIR);
    for (let k = 0; k < 4; k++) {
      for (let z = H.z0 - 1 + k; z <= H.z1 + 1 - k; z++) for (let x = H.x0 - 1 + k; x <= H.x1 + 1 - k; x++) put(x, GY + 4 + k, z, k % 2 ? B.PLANKS : B.COBBLE);
    }
    put(LAYOUT.bed[0], GY + 1, LAYOUT.bed[1], B.BED);
    put(LAYOUT.bed[0], GY + 1, LAYOUT.bed[1] + 1, B.BED_FOOT);
    put(32, GY + 1, 20, B.LANTERN);
    put(32, GY + 1, 23, B.HAY);
    // 家のまわり
    put(LAYOUT.box[0], GY + 1, LAYOUT.box[1], B.BOX);
    put(35, GY + 1, 21, B.HAY); put(35, GY + 1, 22, B.HAY); put(35, GY + 2, 21, B.HAY);
    put(29, GY + 1, 25, B.LANTERN); put(31, GY + 1, 25, B.LANTERN);
    for (const [x, z] of LAYOUT.posts) { put(x, GY + 1, z, B.LOG); put(x, GY + 2, z, B.LANTERN); }

    // 池とサトウキビ（アストラがこわがる）
    const [px, pz] = LAYOUT.pond;
    for (let z = Math.floor(pz - 5); z <= pz + 5; z++) for (let x = Math.floor(px - 5); x <= px + 5; x++) {
      const r = Math.hypot(x + 0.5 - px, z + 0.5 - pz);
      if (r <= 2.7) { put(x, GY, z, B.WATER); if (r <= 1.6) put(x, GY - 1, z, B.WATER); for (let y = GY + 1; y < GY + 4; y++) put(x, y, z, B.AIR); }
      else if (r <= 3.7 && at(x, GY, z) === B.GRASS) put(x, GY, z, B.SAND);
    }
    for (let z = Math.floor(pz - 5); z <= pz + 5; z++) for (let x = Math.floor(px - 5); x <= px + 5; x++) {
      if (at(x, GY, z) !== B.SAND) continue;
      const nearWater = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => at(x + a, GY, z + b) === B.WATER);
      if (nearWater && rng() < 0.55) { const h = 2 + Math.floor(rng() * 2); for (let k = 1; k <= h; k++) put(x, GY + k, z, B.CANE); }
    }
    // スイカ（緑。アストラは育てない）
    let melons = 0;
    for (let tries = 0; tries < 80 && melons < 2; tries++) {
      const a = rng() * Math.PI * 2, r = 4.6 + rng();
      const x = Math.floor(px + Math.cos(a) * r), z = Math.floor(pz + Math.sin(a) * r);
      if (at(x, GY, z) === B.GRASS && at(x, GY + 1, z) === B.AIR && !inRect(x, z, LAYOUT.farmZone)) { put(x, GY + 1, z, B.MELON); melons++; }
    }

    // 木（台地のまわりと丘）
    const trees = [];
    const keepOut = (x, z) => inRect(x, z, LAYOUT.farmZone, 2) || inRect(x, z, H, 3) || Math.hypot(x - px, z - pz) < 7;
    for (let tries = 0; tries < 400 && trees.length < 20; tries++) {
      const x = 3 + Math.floor(rng() * (WX - 6)), z = 3 + Math.floor(rng() * (WZ - 6));
      const gy = top[x + z * WX];
      const r = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
      if (r < 14 || gy < SEA || at(x, gy, z) !== B.GRASS || keepOut(x, z)) continue;
      if (trees.some(([a, b]) => Math.hypot(a - x, b - z) < 4.2)) continue;
      trees.push([x, z]);
      const h = 4 + Math.floor(rng() * 2);
      put(x, gy, z, B.DIRT);
      for (let k = 1; k <= h; k++) put(x, gy + k, z, B.LOG);
      for (let ly = gy + h - 2; ly <= gy + h + 1; ly++) {
        const rad = ly >= gy + h ? 1 : 2;
        for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
          if (Math.abs(dx) === rad && Math.abs(dz) === rad && (ly === gy + h + 1 || rng() < 0.5)) continue;
          if (at(x + dx, ly, z + dz) === B.AIR) put(x + dx, ly, z + dz, B.LEAVES);
        }
      }
    }

    // 草と花
    for (let z = 1; z < WZ - 1; z++) for (let x = 1; x < WX - 1; x++) {
      const gy = top[x + z * WX];
      if (at(x, gy, z) !== B.GRASS || at(x, gy + 1, z) !== B.AIR) continue;
      if (inRect(x, z, LAYOUT.farmZone, 1) || inRect(x, z, H, 2) || x === LAYOUT.pathX) continue;
      const n = fbm(x * 0.2, z * 0.2, S + 9, 2);
      const v = rng();
      if (v < 0.03) put(x, gy + 1, z, rng() < 0.5 ? B.FLOWER_R : B.FLOWER_Y);
      else if (v < 0.03 + n * 0.32) put(x, gy + 1, z, B.TALLGRASS);
    }

    this.base = d.slice();
    this.recomputeLight(true);
    this.computeNav();
    this.collectSpawns();
    for (let i = 0; i < (WX / CHUNK) * (WZ / CHUNK); i++) this.dirty.add(i);
  }

  collectSpawns() {
    const [cx, cz] = LAYOUT.center;
    this.spawnCells = [];
    this.pigCells = [];
    for (let z = 2; z < WZ - 2; z++) for (let x = 2; x < WX - 2; x++) {
      const i = x + z * WX;
      const f = this.floor[i];
      if (f < SEA || this.water[i]) continue;
      if (BLOCKS[this.get(x, f - 1, z)].cutout) continue;
      const r = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
      if (r > 17 && r < 27) this.spawnCells.push(i);
      if (r > 12 && r < 22 && !inRect(x, z, LAYOUT.farmZone, 2)) this.pigCells.push(i);
    }
  }

  /** 生成した直後からの変化（セーブ用）。[[番号, id], …] */
  diff() {
    const out = [];
    for (let i = 0; i < N; i++) if (this.data[i] !== this.base[i]) out.push(i, this.data[i]);
    return out;
  }
  applyDiff(flat) {
    this.data.set(this.base);
    for (let k = 0; k + 1 < flat.length; k += 2) {
      const i = flat[k], id = flat[k + 1];
      if (i >= 0 && i < N && BLOCKS[id]) this.data[i] = id;
    }
    this.recomputeLight(true);
    this.computeNav();
    for (let i = 0; i < (WX / CHUNK) * (WZ / CHUNK); i++) this.dirty.add(i);
  }

  // ------------------------------------------------------------------ 光
  /** 空の光とランタンの光を全部計算し直す。変わったところのチャンクを作り直しに入れる。 */
  recomputeLight(all = false) {
    const oldSky = all ? null : this.sky.slice();
    const oldBlk = all ? null : this.blk.slice();
    const sky = this.sky, blk = this.blk, d = this.data;
    sky.fill(0); blk.fill(0);
    const opaque = new Uint8Array(BLOCKS.length), atten = new Uint8Array(BLOCKS.length), emit = new Uint8Array(BLOCKS.length);
    BLOCKS.forEach((b, i) => { if (b) { opaque[i] = b.opaque ? 1 : 0; atten[i] = b.skyAtten; emit[i] = b.light; } });
    const Q = new Int32Array(1 << 20);
    const MASK = Q.length - 1;
    const PLANE = WX * WZ;

    const bfs = (L, head, tail) => {
      while (head !== tail) {
        const i = Q[head]; head = (head + 1) & MASK;
        const lv = L[i];
        if (lv <= 1) continue;
        const x = i % WX, z = ((i / WX) | 0) % WZ, y = (i / PLANE) | 0;
        const nb = [x > 0 ? i - 1 : -1, x < WX - 1 ? i + 1 : -1, z > 0 ? i - WX : -1, z < WZ - 1 ? i + WX : -1, y > 0 ? i - PLANE : -1, y < WY - 1 ? i + PLANE : -1];
        for (let k = 0; k < 6; k++) {
          const j = nb[k];
          if (j < 0) continue;
          const id = d[j];
          if (opaque[id]) continue;
          const nl = lv - 1 - atten[id];
          if (nl > L[j]) { L[j] = nl; Q[tail] = j; tail = (tail + 1) & MASK; }
        }
      }
    };

    let tail = 0;
    for (let z = 0; z < WZ; z++) for (let x = 0; x < WX; x++) {
      let L = 15;
      for (let y = WY - 1; y >= 0; y--) {
        const i = x + WX * (z + WZ * y);
        const id = d[i];
        if (opaque[id]) break;
        L -= atten[id];
        if (L <= 0) break;
        sky[i] = L;
        Q[tail] = i; tail = (tail + 1) & MASK;
      }
    }
    bfs(sky, 0, tail);
    tail = 0;
    for (let i = 0; i < N; i++) if (emit[d[i]]) { blk[i] = emit[d[i]]; Q[tail++] = i; }
    bfs(blk, 0, tail);
    this.lightDirty = false;

    if (oldSky) {
      const per = WX / CHUNK;
      for (let i = 0; i < N; i++) {
        if (sky[i] !== oldSky[i] || blk[i] !== oldBlk[i]) {
          const x = i % WX, z = ((i / WX) | 0) % WZ;
          this.dirty.add((x >> 4) + (z >> 4) * per);
          // 頂点の光は隣のブロックも混ぜるので、端なら隣のチャンクも
          if ((x & 15) === 0 && x > 0) this.dirty.add(((x - 1) >> 4) + (z >> 4) * per);
          if ((x & 15) === 15 && x < WX - 1) this.dirty.add(((x + 1) >> 4) + (z >> 4) * per);
          if ((z & 15) === 0 && z > 0) this.dirty.add((x >> 4) + ((z - 1) >> 4) * per);
          if ((z & 15) === 15 && z < WZ - 1) this.dirty.add((x >> 4) + ((z + 1) >> 4) * per);
        }
      }
    }
  }

  /** その場所の明るさ（0〜15 の空の光とランタンの光）。範囲の外は空の光 15。 */
  lightAt(x, y, z) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (!this.inside(x, y, z)) return [y >= 0 ? 15 : 0, 0];
    const i = this.idx(x, y, z);
    return [this.sky[i], this.blk[i]];
  }

  // ------------------------------------------------------------------ 歩ける床
  floorAt(x, z) {
    // 下から見て、ぶつかるブロックの上に 2 マスの空きがある最初の高さ
    for (let y = 1; y < WY - 2; y++) {
      const below = BLOCKS[this.get(x, y - 1, z)];
      if (!below.solid) continue;
      if (BLOCKS[this.get(x, y, z)].solid || BLOCKS[this.get(x, y + 1, z)].solid) continue;
      return y;
    }
    return -1;
  }
  computeNav() {
    for (let z = 0; z < WZ; z++) for (let x = 0; x < WX; x++) this.updateNavCell(x, z);
    this.navDirty.clear();
  }
  updateNavCell(x, z) {
    const i = x + z * WX;
    const f = this.floorAt(x, z);
    this.floor[i] = f;
    this.water[i] = f >= 0 && (this.get(x, f, z) === B.WATER || this.get(x, f - 1, z) === B.WATER) ? 1 : 0;
  }
  flushNav() {
    if (!this.navDirty.size) return;
    for (const i of this.navDirty) this.updateNavCell(i % WX, (i / WX) | 0);
    this.navDirty.clear();
  }

  /** 上から見て、いちばん上の「乗れるもの」の上面の高さ（落ちてくるアイテムなど）。 */
  groundBelow(x, y, z) {
    const bx = Math.floor(x), bz = Math.floor(z);
    for (let by = Math.min(WY - 1, Math.floor(y)); by >= 0; by--) {
      const b = BLOCKS[this.get(bx, by, bz)];
      if (b.solid && by + b.h <= y + 1e-3) return by + b.h;
    }
    return 0;
  }

  // ------------------------------------------------------------------ 視線
  /**
   * DDA で視線の先のブロックを探す。pick(id) が true のブロックで止まる（既定は空気と水以外）。
   * 戻り値 { x, y, z, id, nx, ny, nz, dist } か null。n は当たった面の向き（そのブロックの外側）。
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist, pick = (id) => id !== B.AIR && id !== B.WATER) {
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0, sy = dy > 0 ? 1 : dy < 0 ? -1 : 0, sz = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const adx = Math.abs(dx) || 1e-9, ady = Math.abs(dy) || 1e-9, adz = Math.abs(dz) || 1e-9;
    let tx = sx > 0 ? (x + 1 - ox) / adx : sx < 0 ? (ox - x) / adx : Infinity;
    let ty = sy > 0 ? (y + 1 - oy) / ady : sy < 0 ? (oy - y) / ady : Infinity;
    let tz = sz > 0 ? (z + 1 - oz) / adz : sz < 0 ? (oz - z) / adz : Infinity;
    const ddx = 1 / adx, ddy = 1 / ady, ddz = 1 / adz;
    let nx = 0, ny = 0, nz = 0, t = 0;
    for (let n = 0; n < 64 && t <= maxDist; n++) {
      const id = this.get(x, y, z);
      if (pick(id, x, y, z)) {
        // 背の低いブロック（作物・畑）は、上のほうを素通りする
        const b = BLOCKS[id];
        const hTop = isCrop(id) ? 0.25 + 0.2 * (id - B.POTATO0) : b.h;
        if (hTop >= 0.999 || this._hitsLow(ox, oy, oz, dx, dy, dz, x, y, z, hTop, t)) return { x, y, z, id, nx, ny, nz, dist: t };
      }
      if (tx < ty && tx < tz) { x += sx; t = tx; tx += ddx; nx = -sx; ny = 0; nz = 0; }
      else if (ty < tz) { y += sy; t = ty; ty += ddy; nx = 0; ny = -sy; nz = 0; }
      else { z += sz; t = tz; tz += ddz; nx = 0; ny = 0; nz = -sz; }
      if (y < 0 || y >= WY + 2) break;
    }
    return null;
  }
  _hitsLow(ox, oy, oz, dx, dy, dz, x, y, z, h, t0) {
    // 光線が [x,x+1]×[y,y+h]×[z,z+1] を通るか（入った点 t0 から、出る点まで）
    let tmin = t0, tmax = Infinity;
    const slab = (o, d, lo, hi) => {
      if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
      let a = (lo - o) / d, b = (hi - o) / d;
      if (a > b) [a, b] = [b, a];
      tmin = Math.max(tmin, a); tmax = Math.min(tmax, b);
      return tmin <= tmax;
    };
    return slab(ox, dx, x, x + 1) && slab(oy, dy, y, y + h) && slab(oz, dz, z, z + 1);
  }
}

export { inRect };
