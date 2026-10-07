// 16×16 のドット絵を canvas で描き、1 枚のテクスチャ（タイルの並び）にまとめる。画像ファイルは使わない。
//   buildAtlas() → { texture, uv(name), iconURL(name), tileCanvas(name) }
// タイルの描き方は TILES に「名前 → 描く関数」で書く。乱数はタイルごとに決まった種を使うので、毎回同じ絵になる。
import * as THREE from 'three';
import { mulberry32, hashString } from '../../core/rng.js';

export const TILE = 16;
const COLS = 16;
const SIZE = TILE * COLS;

const rgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const c255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
const mul = (c, k) => [c255(c[0] * k), c255(c[1] * k), c255(c[2] * k)];

class Painter {
  constructor(seed) {
    this.d = new Uint8ClampedArray(TILE * TILE * 4);
    const r = mulberry32(seed);
    this.r = r;
  }
  ri(n) { return Math.floor(this.r() * n); }
  set(x, y, c, a = 255) {
    if (x < 0 || y < 0 || x >= TILE || y >= TILE) return;
    const i = (y * TILE + x) * 4;
    const col = typeof c === 'number' ? rgb(c) : c;
    this.d[i] = col[0]; this.d[i + 1] = col[1]; this.d[i + 2] = col[2]; this.d[i + 3] = a;
  }
  get(x, y) { const i = (y * TILE + x) * 4; return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]]; }
  alpha(x, y) { return x < 0 || y < 0 || x >= TILE || y >= TILE ? 0 : this.d[(y * TILE + x) * 4 + 3]; }
  fill(c, a = 255) { for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) this.set(x, y, c, a); }
  noise(pal, x0 = 0, y0 = 0, x1 = TILE, y1 = TILE) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.set(x, y, pal[this.ri(pal.length)]);
  }
  /** 中身のある画素のまわりを 1 画素ぶん縁どる（アイテムの絵）。 */
  outline(c) {
    const add = [];
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      if (this.alpha(x, y)) continue;
      if (this.alpha(x - 1, y) > 200 || this.alpha(x + 1, y) > 200 || this.alpha(x, y - 1) > 200 || this.alpha(x, y + 1) > 200) add.push([x, y]);
    }
    for (const [x, y] of add) this.set(x, y, c);
  }
  /** 楕円を塗る。 */
  ellipse(cx, cy, rx, ry, pal) {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) this.set(x, y, pal[this.ri(pal.length)]);
    }
  }
}

const PAL = {
  grass: [0x5d9e3a, 0x6aae43, 0x77bb4c, 0x548f33, 0x63a33e, 0x6aae43],
  dirt: [0x8a6142, 0x7a5539, 0x966b4a, 0x6e4c33, 0x825c3e],
  stone: [0x7d7d7d, 0x747474, 0x868686, 0x6c6c6c, 0x7a7a7a],
  sand: [0xdbd3a0, 0xd2c994, 0xe3dbab, 0xcbc28c],
  leaves: [0x3f8a2a, 0x4a9a32, 0x357a22, 0x56a83a, 0x2f6e1e],
  plank: [0xa47d4c, 0x9a7446, 0xae8655, 0xa37a49],
  potato: [0xd6ad62, 0xc99c52, 0xd9b36c],
  greenPotato: [0xa8b85a, 0x9aac4e, 0xb2c266],
};

// 作物の葉っぱ（じゃがいもの段階）。h：上端の行、n：株の数
function cropPlant(p, top, stems, leafy) {
  const greens = [0x4f9a2e, 0x5fae3a, 0x3e8424, 0x6cbc44];
  for (const sx of stems) {
    for (let y = 15; y >= top; y--) {
      p.set(sx, y, 0x3e8424);
      if (leafy && (15 - y) % 2 === 1) {
        const w = Math.min(3, 1 + Math.floor((y - top) / 3));
        for (let k = 1; k <= w; k++) {
          if (p.r() < 0.85) p.set(sx - k, y - (k > 1 ? 1 : 0), greens[p.ri(greens.length)]);
          if (p.r() < 0.85) p.set(sx + k, y - (k > 1 ? 1 : 0), greens[p.ri(greens.length)]);
        }
      }
    }
    p.set(sx, top - 1, greens[3]);
  }
}

function heart(p, kind) {
  const shape = [
    '.XX...XX.',
    'XooX.XooX',
    'XoooXoooX',
    'XoooooooX',
    '.XoooooX.',
    '..XoooX..',
    '...XoX...',
    '....X....',
  ];
  shape.forEach((row, y) => [...row].forEach((ch, x) => {
    const X = x + 3, Y = y + 4;
    if (ch === 'X') p.set(X, Y, 0x1a1a1a);
    else if (ch === 'o') {
      const filled = kind === 'full' || (kind === 'half' && x < 4.5);
      if (filled) p.set(X, Y, y < 2 && (x === 1 || x === 2 || x === 6) ? 0xff9a9a : 0xe02828);
      else p.set(X, Y, 0x3a2626);
    }
  }));
}

export const TILES = {
  grass_top(p) {
    p.noise(PAL.grass);
    for (let i = 0; i < 10; i++) p.set(p.ri(16), p.ri(16), 0x84c858);
  },
  grass_side(p) {
    p.noise(PAL.dirt);
    for (let x = 0; x < 16; x++) {
      const depth = 3 + (p.r() < 0.5 ? 1 : 0) + (p.r() < 0.2 ? 1 : 0);
      for (let y = 0; y < depth; y++) p.set(x, y, PAL.grass[p.ri(PAL.grass.length)]);
    }
  },
  dirt(p) {
    p.noise(PAL.dirt);
    for (let i = 0; i < 5; i++) p.set(p.ri(16), p.ri(16), 0x9a8a7a);
  },
  farm_dry(p) {
    p.noise([0x7a5636, 0x704e31, 0x845d3b]);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (y % 4 === 0) p.set(x, y, p.r() < 0.8 ? 0x5a3e27 : 0x654630);
      else if (y % 4 === 1) p.set(x, y, p.r() < 0.6 ? 0x8f6843 : 0x845d3b);
    }
    for (let i = 0; i < 16; i++) { p.set(i, 15, 0x5a3e27); p.set(0, i, 0x5a3e27); p.set(15, i, 0x654630); }
  },
  farm_wet(p) {
    p.noise([0x4f3522, 0x48301f, 0x573a26]);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (y % 4 === 0) p.set(x, y, p.r() < 0.8 ? 0x2f1f13 : 0x3a2718);
      else if (y % 4 === 1) p.set(x, y, p.r() < 0.6 ? 0x664833 : 0x5a3e2a);
    }
    for (let i = 0; i < 16; i++) { p.set(i, 15, 0x2f1f13); p.set(0, i, 0x2f1f13); p.set(15, i, 0x3a2718); }
  },
  path_top(p) {
    p.noise([0x9c7f4a, 0xa88b55, 0x93774a, 0xb09560, 0x9f824d]);
  },
  path_side(p) {
    p.noise(PAL.dirt);
    for (let x = 0; x < 16; x++) for (let y = 0; y < 2 + (p.r() < 0.4 ? 1 : 0); y++) p.set(x, y + 1, [0x9c7f4a, 0xa88b55][p.ri(2)]);
    for (let x = 0; x < 16; x++) p.set(x, 0, 0x000000, 0);
  },
  stone(p) {
    p.noise(PAL.stone);
    for (let i = 0; i < 6; i++) { const x = p.ri(14), y = p.ri(16); p.set(x, y, 0x5f5f5f); p.set(x + 1, y, 0x666666); }
  },
  cobble(p) {
    const seeds = Array.from({ length: 8 }, () => [p.r() * 16, p.r() * 16, 0.85 + p.r() * 0.3]);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      let d1 = 1e9, d2 = 1e9, best = 0;
      for (let i = 0; i < seeds.length; i++) {
        for (const ox of [-16, 0, 16]) for (const oy of [-16, 0, 16]) {
          const dx = x + 0.5 - (seeds[i][0] + ox), dy = y + 0.5 - (seeds[i][1] + oy);
          const d = Math.hypot(dx, dy);
          if (d < d1) { d2 = d1; d1 = d; best = i; } else if (d < d2) d2 = d;
        }
      }
      if (d2 - d1 < 1.0) p.set(x, y, 0x4a4a4a);
      else p.set(x, y, mul(rgb(0x8a8a8a), seeds[best][2] * (0.92 + p.r() * 0.12)));
    }
  },
  sand(p) { p.noise(PAL.sand); },
  gravel(p) { p.noise([0x847c78, 0x6e6866, 0x9a928c, 0x5c5654, 0x8a7f72]); },
  bedrock(p) { p.noise([0x3a3a3a, 0x555555, 0x2a2a2a, 0x6a6a6a]); },
  water(p) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const w = Math.sin((x + y * 0.5) * 0.8) + Math.sin(y * 1.3 + x * 0.2);
      p.set(x, y, w > 1.3 ? 0x5f8fe8 : w > 0.6 ? 0x4876d6 : 0x3a62c4, 190);
    }
  },
  log_side(p) {
    const cols = Array.from({ length: 16 }, () => [0x6b5233, 0x5a442a, 0x7a5f3c, 0x634b2e][p.ri(4)]);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, mul(rgb(cols[x]), 0.9 + p.r() * 0.2));
    for (let i = 0; i < 4; i++) { const x = p.ri(16), y = p.ri(12); for (let k = 0; k < 4; k++) p.set(x, y + k, 0x4a3820); }
  },
  log_top(p) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)) + (p.r() - 0.5) * 0.6;
      if (d >= 7) p.set(x, y, [0x5a442a, 0x6b5233][p.ri(2)]);
      else p.set(x, y, Math.floor(d) % 2 ? 0xb08d57 : 0x9c7a48);
    }
  },
  leaves(p) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (p.r() < 0.2) p.set(x, y, 0, 0);
      else p.set(x, y, PAL.leaves[p.ri(PAL.leaves.length)]);
    }
  },
  planks(p) {
    for (let y = 0; y < 16; y++) {
      const row = Math.floor(y / 4);
      for (let x = 0; x < 16; x++) {
        const joint = row % 2 ? 4 : 11;
        if (y % 4 === 3) p.set(x, y, 0x7a5a34);
        else if (x === joint) p.set(x, y, 0x86643a);
        else p.set(x, y, mul(rgb(PAL.plank[p.ri(PAL.plank.length)]), 0.95 + p.r() * 0.1));
      }
    }
  },
  glass(p) {
    p.fill(0, 0);
    for (let i = 0; i < 16; i++) { p.set(i, 0, 0xd5ecf0); p.set(i, 15, 0xb9d6dc); p.set(0, i, 0xd5ecf0); p.set(15, i, 0xb9d6dc); }
    for (const [x, y] of [[3, 3], [4, 2], [2, 4], [5, 5], [11, 12], [12, 11]]) p.set(x, y, 0xffffff);
  },
  lantern(p) {
    p.fill(0, 0);
    // 側面（下半分 8 行、横 5〜10）
    for (let y = 8; y < 16; y++) for (let x = 5; x < 11; x++) {
      const edge = x === 5 || x === 10 || y === 8 || y === 15;
      p.set(x, y, edge ? 0x3a3a44 : y < 10 ? 0x55555f : [0xffd27a, 0xfff0b0, 0xffc860][p.ri(3)]);
    }
    // ふた（上面：横 5〜10、縦 0〜5）
    for (let y = 0; y < 6; y++) for (let x = 5; x < 11; x++) p.set(x, y, x === 5 || x === 10 || y === 0 || y === 5 ? 0x2e2e36 : 0x4a4a55);
    p.set(7, 2, 0xffe08a); p.set(8, 3, 0xffe08a);
  },
  tallgrass(p) {
    p.fill(0, 0);
    for (let i = 0; i < 9; i++) {
      let x = 1 + p.ri(14);
      const h = 5 + p.ri(9);
      const lean = p.r() < 0.5 ? -1 : 1;
      for (let k = 0; k < h; k++) {
        if (k > h * 0.6 && p.r() < 0.3) x += lean;
        p.set(x, 15 - k, [0x5d9e3a, 0x4f8a30, 0x6aae43, 0x77bb4c][p.ri(4)]);
      }
    }
  },
  flower_r(p) { flower(p, [0xd23a3a, 0xe85050, 0xb82a2a], 0xf0d040); },
  flower_y(p) { flower(p, [0xf0d040, 0xf8e070, 0xe0b830], 0xd88a20); },
  cane(p) {
    p.fill(0, 0);
    for (const sx of [2, 7, 12]) {
      const off = p.ri(4);
      for (let y = 0; y < 16; y++) {
        const joint = (y + off) % 5 === 0;
        p.set(sx, y, joint ? 0x5e9a36 : 0x9ad868);
        p.set(sx + 1, y, joint ? 0x4e862c : 0x7bbf48);
      }
      const ly = 3 + p.ri(8);
      p.set(sx + 2, ly, 0x7bbf48); p.set(sx + 3, ly - 1, 0x8fcf5a);
      p.set(sx - 1, ly + 3, 0x7bbf48); p.set(sx - 2, ly + 2, 0x8fcf5a);
    }
  },
  potato0(p) { p.fill(0, 0); cropPlant(p, 14, [3, 8, 12], false); },
  potato1(p) { p.fill(0, 0); cropPlant(p, 10, [2, 6, 10, 13], true); },
  potato2(p) { p.fill(0, 0); cropPlant(p, 6, [2, 6, 9, 13], true); },
  potato3(p) {
    p.fill(0, 0);
    cropPlant(p, 4, [2, 6, 9, 13], true);
    for (const [x, y] of [[1, 13], [4, 14], [7, 13], [11, 14], [13, 13]]) {
      p.set(x, y, 0xd6ad62); p.set(x + 1, y, 0xc99c52); p.set(x, y + 1, 0xb88a48); p.set(x + 1, y + 1, 0xd6ad62);
    }
    for (const [x, y] of [[2, 3], [9, 3], [13, 4], [6, 5]]) { p.set(x, y, 0xf4f0ff); p.set(x, y - 1, 0xc8b8f0); }
  },
  bed_top(p) {
    p.noise([0xb83232, 0xa82a2a, 0xc03a3a]);
    for (let y = 1; y < 6; y++) for (let x = 2; x < 14; x++) p.set(x, y, y === 5 ? 0xc8c8c8 : [0xe8e8e8, 0xf0f0f0, 0xdcdcdc][p.ri(3)]);
    for (let i = 0; i < 16; i++) { p.set(i, 0, 0x8a6a40); p.set(0, i, 0x8a6a40); p.set(15, i, 0x8a6a40); }
  },
  bed_foot(p) {
    p.noise([0xb83232, 0xa82a2a, 0xc03a3a]);
    for (let y = 0; y < 16; y += 5) for (let x = 1; x < 15; x++) if ((x + y) % 3 === 0) p.set(x, y, 0x9a2424);
    for (let i = 0; i < 16; i++) { p.set(i, 15, 0x8a6a40); p.set(0, i, 0x8a6a40); p.set(15, i, 0x8a6a40); }
  },
  bed_side(p) {
    p.noise([0xb83232, 0xa82a2a]);
    for (let y = 9; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, x < 3 || x > 12 ? 0x6e5232 : 0x8a6a40);
  },
  hay_top(p) {
    p.noise([0xc9a43a, 0xd8b24a, 0xb8932f, 0xe0bd55]);
    for (let i = 0; i < 16; i++) { p.set(i, 0, 0x9a7a2a); p.set(i, 15, 0x9a7a2a); p.set(0, i, 0x9a7a2a); p.set(15, i, 0x9a7a2a); }
  },
  hay_side(p) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, x % 3 === 0 ? 0xb8932f : [0xd8b24a, 0xc9a43a, 0xe0bd55][p.ri(3)]);
    for (let x = 0; x < 16; x++) { p.set(x, 3, 0x9a3a2a); p.set(x, 12, 0x9a3a2a); }
  },
  box_top(p) {
    TILES.planks(p);
    for (let y = 4; y < 12; y++) for (let x = 3; x < 13; x++) p.set(x, y, y === 4 || y === 11 || x === 3 || x === 12 ? 0x5a4026 : 0x2a1e12);
  },
  box_side(p) {
    p.noise(PAL.plank);
    for (let i = 0; i < 16; i++) for (const k of [0, 1, 14, 15]) { p.set(i, k, 0x6e5232); p.set(k, i, 0x6e5232); }
    // じゃがいもの印（出荷箱）
    p.ellipse(8, 8.5, 4, 3, PAL.potato);
    p.set(6, 8, 0x9c7438); p.set(9, 9, 0x9c7438); p.set(8, 7, 0x9c7438);
  },
  melon_top(p) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      p.set(x, y, Math.floor(d * 0.9 + p.r() * 0.6) % 2 ? 0x6f9a2a : 0x7fae34);
    }
    p.set(7, 7, 0x4a6a1a); p.set(8, 8, 0x4a6a1a);
  },
  melon_side(p) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const s = Math.floor((x + (p.r() < 0.15 ? 1 : 0)) / 2) % 2;
      p.set(x, y, s ? 0x4f7a1c : [0x86b83a, 0x7aac30][p.ri(2)]);
    }
  },

  // ---- アイテム
  item_potato(p) {
    p.fill(0, 0);
    p.ellipse(8, 8.5, 5.6, 4.4, PAL.potato);
    for (const [x, y] of [[5, 7], [9, 10], [10, 6], [7, 11]]) p.set(x, y, 0x9c7438);
    p.set(5, 6, 0xf0d090); p.set(6, 5, 0xf0d090);
    p.outline(0x6e4e24);
  },
  item_green(p) {
    p.fill(0, 0);
    p.ellipse(8, 8.5, 5.6, 4.4, PAL.greenPotato);
    for (const [x, y] of [[5, 7], [9, 10], [10, 6], [7, 11]]) p.set(x, y, 0x6a7a2a);
    p.set(5, 6, 0xd8e890); p.set(6, 5, 0xd8e890);
    p.outline(0x46521c);
  },
  item_powder(p) {
    p.fill(0, 0);
    for (let y = 6; y < 14; y++) {
      const w = Math.min(6, 1 + (y - 6));
      for (let x = 8 - w; x < 8 + w; x++) if (p.r() < 0.92 || y > 9) p.set(x, y, [0x4a4a4a, 0x5a5a5a, 0x3a3a3a, 0x6a6a6a, 0x7a7a7a][p.ri(5)]);
    }
    p.set(8, 5, 0x5a5a5a);
    p.outline(0x1e1e1e);
  },
  item_sword(p) {
    p.fill(0, 0);
    for (let i = 0; i < 9; i++) {
      p.set(5 + i, 10 - i, 0xe6edf0);
      p.set(6 + i, 10 - i, 0xb7c2c8);
      p.set(5 + i, 9 - i, 0xc9d3d8);
    }
    p.set(14, 1, 0xe6edf0);
    for (const [x, y] of [[3, 9], [4, 10], [5, 11], [6, 12], [4, 11]]) p.set(x, y, 0x6b4a2a);
    for (const [x, y] of [[3, 13], [2, 13], [3, 12], [2, 14]]) p.set(x, y, 0x5a3c20);
    p.outline(0x262a2e);
  },
  item_hoe(p) {
    p.fill(0, 0);
    for (let i = 0; i < 10; i++) p.set(3 + i, 13 - i, i % 3 ? 0x8a6238 : 0x6b4a2a);
    for (const [x, y] of [[9, 2], [10, 2], [11, 2], [12, 3], [13, 3], [12, 2], [13, 4]]) p.set(x, y, 0xc9d3d8);
    p.outline(0x262a2e);
  },
  /** 土のブロック（持ちもの欄の絵：ななめから見た小さな立方体）。 */
  item_dirt(p) {
    p.fill(0, 0);
    const top = [0x6aae43, 0x5d9e3a, 0x77bb4c], left = [0x7a5539, 0x6e4c33, 0x825c3e], right = [0x966b4a, 0x8a6142, 0x9c7248];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const cx = x - 7.5;
      const topY = 4 + Math.abs(cx) * 0.5; // 上面のひし形の下の縁
      const upY = 4 - (7.5 - Math.abs(cx)) * 0.5;
      if (Math.abs(cx) > 7) continue;
      if (y >= upY + 0.5 && y < topY + 0.5) p.set(x, y, top[p.ri(3)]);
      else if (y >= topY + 0.5 && y < topY + 8.5) {
        const grassRim = y < topY + 2;
        p.set(x, y, grassRim ? top[p.ri(3)] : cx < 0 ? left[p.ri(3)] : right[p.ri(3)]);
      }
    }
    p.outline(0x2a1e12);
  },
  heart_full(p) { p.fill(0, 0); heart(p, 'full'); },
  heart_half(p) { p.fill(0, 0); heart(p, 'half'); },
  heart_empty(p) { p.fill(0, 0); heart(p, 'empty'); },
};

function flower(p, petals, center) {
  p.fill(0, 0);
  for (let y = 8; y < 16; y++) p.set(7, y, 0x3e8424);
  p.set(6, 11, 0x4f9a2e); p.set(5, 10, 0x5fae3a); p.set(8, 12, 0x4f9a2e); p.set(9, 11, 0x5fae3a);
  for (const [x, y] of [[7, 4], [6, 5], [8, 5], [7, 6], [6, 4], [8, 6], [6, 6], [8, 4]]) p.set(x, y, petals[p.ri(petals.length)]);
  p.set(7, 5, center);
  p.set(5, 5, petals[0]); p.set(9, 5, petals[0]); p.set(7, 3, petals[0]); p.set(7, 7, petals[0]);
}

let atlas = null;

export function buildAtlas() {
  if (atlas) return atlas;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  const index = {};
  const images = {};
  Object.keys(TILES).forEach((name, i) => {
    const p = new Painter(hashString('tile:' + name));
    TILES[name](p);
    const img = new ImageData(p.d, TILE, TILE);
    images[name] = img;
    const col = i % COLS, row = Math.floor(i / COLS);
    ctx.putImageData(img, col * TILE, row * TILE);
    index[name] = i;
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;

  // 水だけは別の 1 枚（くり返して流す）
  const wc = document.createElement('canvas');
  wc.width = wc.height = TILE;
  wc.getContext('2d').putImageData(images.water, 0, 0);
  const water = new THREE.CanvasTexture(wc);
  water.colorSpace = THREE.SRGBColorSpace;
  water.magFilter = THREE.NearestFilter;
  water.minFilter = THREE.NearestFilter;
  water.generateMipmaps = false;
  water.wrapS = water.wrapT = THREE.RepeatWrapping;

  const icons = {};
  atlas = {
    texture,
    water,
    canvas,
    images,
    /** タイルの UV の四隅 [u0, v0, u1, v1]（v0 が下）。 */
    uv(name) {
      const i = index[name];
      if (i === undefined) throw new Error('タイルがありません: ' + name);
      const col = i % COLS, row = Math.floor(i / COLS);
      const u0 = (col * TILE) / SIZE, u1 = ((col + 1) * TILE) / SIZE;
      const v1 = 1 - (row * TILE) / SIZE, v0 = 1 - ((row + 1) * TILE) / SIZE;
      return [u0, v0, u1, v1];
    },
    /** HTML に出すアイコン（data URL）。 */
    iconURL(name) {
      if (icons[name]) return icons[name];
      const c = document.createElement('canvas');
      c.width = c.height = TILE;
      c.getContext('2d').putImageData(images[name], 0, 0);
      return (icons[name] = c.toDataURL());
    },
  };
  return atlas;
}
