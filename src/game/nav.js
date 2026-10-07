// 地面のマス（x, z）の上での道さがし（A*）。world.floor（立つ高さ）の差が 1 以内なら隣へ進める。
// ななめは、両どなりが通れるときだけ（角を切らない）。
import { WX, WZ } from './world/World.js';

class Heap {
  constructor() { this.a = []; this.p = []; }
  get size() { return this.a.length; }
  push(v, pr) {
    const a = this.a, p = this.p;
    a.push(v); p.push(pr);
    let i = a.length - 1;
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (p[j] <= pr) break;
      a[i] = a[j]; p[i] = p[j]; i = j;
    }
    a[i] = v; p[i] = pr;
  }
  pop() {
    const a = this.a, p = this.p;
    const top = a[0];
    const lv = a.pop(), lp = p.pop();
    if (a.length) {
      let i = 0;
      const n = a.length;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mp = lp;
        if (l < n && p[l] < mp) { m = l; mp = p[l]; }
        if (r < n && p[r] < mp) { m = r; mp = p[r]; }
        if (m === i) break;
        a[i] = a[m]; p[i] = p[m]; i = m;
      }
      a[i] = lv; p[i] = lp;
    }
    return top;
  }
}

const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
const gScore = new Float32Array(WX * WZ);
const came = new Int32Array(WX * WZ);
const stamp = new Uint32Array(WX * WZ);
let gen = 1;

/**
 * (sx, sz) から (tx, tz) への道。goal(i) を渡すと「そのマスに着いたら終わり」にできる。
 * 戻り値はマスの列 [[x, z], …]（最初のマスは含まない）か null。
 * opts.blocked(i)：通らないマス（家の中など）
 */
export function findPath(world, sx, sz, tx, tz, opts = {}) {
  const { maxNodes = 3000, avoidWater = true, near = 0, blocked = null } = opts;
  const floor = world.floor, water = world.water;
  const ok = (x, z) => {
    if (x < 1 || z < 1 || x >= WX - 1 || z >= WZ - 1) return false;
    const i = x + z * WX;
    if (floor[i] < 0) return false;
    if (avoidWater && water[i]) return false;
    if (blocked && blocked(i)) return false;
    return true;
  };
  sx = Math.floor(sx); sz = Math.floor(sz); tx = Math.floor(tx); tz = Math.floor(tz);
  const start = sx + sz * WX, target = tx + tz * WX;
  if (sx < 0 || sz < 0 || sx >= WX || sz >= WZ) return { path: [], reached: false };
  gen++;
  const heap = new Heap();
  const h = (x, z) => { const dx = Math.abs(x - tx), dz = Math.abs(z - tz); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
  stamp[start] = gen; gScore[start] = 0; came[start] = -1;
  heap.push(start, h(sx, sz));
  let expanded = 0;
  let best = start, bestH = h(sx, sz);
  while (heap.size) {
    const cur = heap.pop();
    const cx = cur % WX, cz = (cur / WX) | 0;
    const hc = h(cx, cz);
    if (hc < bestH) { bestH = hc; best = cur; }
    if (cur === target || hc <= near) { best = cur; break; }
    if (++expanded > maxNodes) break;
    const fc = floor[cur];
    for (const [dx, dz, cost] of DIRS) {
      const nx = cx + dx, nz = cz + dz;
      if (!ok(nx, nz)) continue;
      const ni = nx + nz * WX;
      if (Math.abs(floor[ni] - fc) > 1) continue;
      if (dx && dz) {
        // 角を切らない：両どなりも通れて、高さもそろっていること
        const a = cx + dx + cz * WX, b = cx + (cz + dz) * WX;
        if (!ok(cx + dx, cz) || !ok(cx, cz + dz)) continue;
        if (Math.abs(floor[a] - fc) > 0 || Math.abs(floor[b] - fc) > 0 || floor[ni] !== fc) continue;
      }
      const up = floor[ni] > fc ? 0.6 : 0;
      const g = gScore[cur] + cost + up;
      if (stamp[ni] === gen && g >= gScore[ni]) continue;
      stamp[ni] = gen; gScore[ni] = g; came[ni] = cur;
      heap.push(ni, g + h(nx, nz) * 1.05);
    }
  }
  if (best === start) return { path: [], reached: h(sx, sz) <= Math.max(near, 0.01) };
  // 目的地に届かなくても、いちばん近づけたところまでの道を返す
  const path = [];
  for (let i = best; i !== start && i >= 0; i = came[i]) path.push([i % WX, (i / WX) | 0]);
  path.reverse();
  return { path, reached: bestH <= Math.max(near, 0.01) || best === target };
}
