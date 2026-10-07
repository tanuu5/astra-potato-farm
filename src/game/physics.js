// 体（箱）を世界のブロックにぶつけながら動かす。軸ごとに動かして、ぶつかったらブロックの面で止める。
// 段差（1 ブロックまで）は、地面に立っているときだけ自動で上る。
//   body = { pos: Vector3（足もとの中心）, vel: Vector3, hw（横幅の半分）, h（高さ）, onGround, step（上れる段差）, inWater }
import { BLOCKS, B } from './world/blocks.js';
import { WX, WZ } from './world/World.js';

const EPS = 1e-4;

/** 箱に重なっているブロックを cb(x, y, z, top) で返す。 */
function overlaps(world, x0, y0, z0, x1, y1, z1, cb) {
  const bx0 = Math.floor(x0), bx1 = Math.floor(x1 - EPS);
  const by0 = Math.floor(y0) - 1, by1 = Math.floor(y1 - EPS);
  const bz0 = Math.floor(z0), bz1 = Math.floor(z1 - EPS);
  for (let y = by0; y <= by1; y++) for (let z = bz0; z <= bz1; z++) for (let x = bx0; x <= bx1; x++) {
    const b = BLOCKS[world.get(x, y, z)];
    if (!b.solid) continue;
    const top = y + b.h;
    if (top > y0 + EPS && y < y1 - EPS) cb(x, y, z, top);
  }
}

export function collides(world, body, px = body.pos.x, py = body.pos.y, pz = body.pos.z) {
  let hit = false;
  overlaps(world, px - body.hw, py, pz - body.hw, px + body.hw, py + body.h, pz + body.hw, () => { hit = true; });
  return hit;
}

function sweep(world, body, axis, d) {
  if (d === 0) return false;
  const p = body.pos;
  p[axis] += d;
  let hit = false;
  let limit = d > 0 ? Infinity : -Infinity;
  overlaps(world, p.x - body.hw, p.y, p.z - body.hw, p.x + body.hw, p.y + body.h, p.z + body.hw, (x, y, z, top) => {
    hit = true;
    if (axis === 'y') limit = d < 0 ? Math.max(limit, top) : Math.min(limit, y);
    else if (axis === 'x') limit = d > 0 ? Math.min(limit, x) : Math.max(limit, x + 1);
    else limit = d > 0 ? Math.min(limit, z) : Math.max(limit, z + 1);
  });
  if (hit) {
    if (axis === 'y') p.y = d < 0 ? limit + EPS : limit - body.h - EPS;
    else p[axis] = d > 0 ? limit - body.hw - EPS : limit + body.hw + EPS;
  }
  return hit;
}

/**
 * dt 秒ぶん動かす（重力は呼ぶ側で vel.y に足しておく）。
 * 戻り値 { hitX, hitZ, stepped }。body.onGround と body.inWater を更新する。
 */
export function moveBody(world, body, dt) {
  const p = body.pos, v = body.vel;
  // 縦
  const wasGround = body.onGround;
  const hy = sweep(world, body, 'y', v.y * dt);
  body.onGround = hy && v.y <= 0;
  if (hy) v.y = 0;
  // 横（段差は自動で上る）
  const ox = p.x, oy = p.y, oz = p.z;
  const dx = v.x * dt, dz = v.z * dt;
  let hx = sweep(world, body, 'x', dx);
  let hz = sweep(world, body, 'z', dz);
  let stepped = 0;
  if ((hx || hz) && (body.onGround || wasGround) && body.step > 0) {
    // ぶつかった段の高さだけ持ち上げて、もう一度横に動かす（扉のように上が低いところでも通れるように、必要なぶんだけ）
    let top = -Infinity;
    overlaps(world, ox + dx - body.hw, oy, oz + dz - body.hw, ox + dx + body.hw, oy + body.h, oz + dz + body.hw, (x, y, z, t) => { top = Math.max(top, t); });
    const need = top - oy;
    if (need > 0 && need <= body.step) {
      const bx = p.x, by = p.y, bz = p.z;
      p.set(ox, oy, oz);
      if (!sweep(world, body, 'y', need + 0.002)) {
        const hx2 = sweep(world, body, 'x', dx);
        const hz2 = sweep(world, body, 'z', dz);
        sweep(world, body, 'y', -need - 0.05);
        const got = Math.hypot(p.x - ox, p.z - oz), had = Math.hypot(bx - ox, bz - oz);
        if (got > had + 1e-4) { stepped = p.y - oy; hx = hx2; hz = hz2; body.onGround = true; }
        else p.set(bx, by, bz);
      } else p.set(bx, by, bz);
    }
  }
  if (hx) v.x = 0;
  if (hz) v.z = 0;
  // 世界の外に出ない
  const m = body.hw + 0.2;
  if (p.x < m) { p.x = m; v.x = Math.max(0, v.x); }
  if (p.x > WX - m) { p.x = WX - m; v.x = Math.min(0, v.x); }
  if (p.z < m) { p.z = m; v.z = Math.max(0, v.z); }
  if (p.z > WZ - m) { p.z = WZ - m; v.z = Math.min(0, v.z); }
  if (p.y < -4) { p.y = 12; v.y = 0; }
  body.inWater = world.get(Math.floor(p.x), Math.floor(p.y + 0.3), Math.floor(p.z)) === B.WATER;
  body.headInWater = world.get(Math.floor(p.x), Math.floor(p.y + body.h * 0.85), Math.floor(p.z)) === B.WATER;
  return { hitX: hx, hitZ: hz, stepped };
}

/** 重力と水の抵抗をかける。 */
export function applyGravity(body, dt, g = 28) {
  if (body.inWater) {
    body.vel.y = Math.max(body.vel.y - g * 0.18 * dt, -2.2);
    body.vel.y *= Math.exp(-2 * dt);
  } else body.vel.y = Math.max(body.vel.y - g * dt, -40);
}
