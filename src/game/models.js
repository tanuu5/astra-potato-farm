// 生きものとアイテムの形（箱の組み合わせ・ドット絵の皮）。ゲームとモデル確認台（dev/viewer）の両方から使う。
// 単位：1 ドット = 1/16 ブロック。皮のテクスチャは「箱の展開図」（上・下・左・前・右・後ろ）の並びで描く。
// モデルは +Z を向き、足もとが y = 0。
import * as THREE from 'three';
import { entityMaterial } from './world/materials.js';
import { mulberry32 } from '../core/rng.js';

const PX = 1 / 16;

// ------------------------------------------------------------------ 皮（canvas）
class Skin {
  constructor(w, h, seed = 1) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w; this.canvas.height = h;
    this.g = this.canvas.getContext('2d');
    this.r = mulberry32(seed);
    this.W = w; this.H = h;
  }
  rect(x, y, w, h, c) { this.g.fillStyle = c; this.g.fillRect(x, y, w, h); }
  px(x, y, c) { this.g.fillStyle = c; this.g.fillRect(x, y, 1, 1); }
  noise(x, y, w, h, pal) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, pal[Math.floor(this.r() * pal.length)]); }
  /** 箱の展開図の各面の位置 { top, bottom, left(-x), front(+z), right(+x), back(-z) } = [x, y, w, h] */
  static layout(u, v, w, h, d) {
    return {
      top: [u + d, v, w, d], bottom: [u + d + w, v, w, d],
      left: [u, v + d, d, h], front: [u + d, v + d, w, h], right: [u + d + w, v + d, d, h], back: [u + 2 * d + w, v + d, w, h],
    };
  }
  /** 箱の全部の面を pal のノイズで塗る（あとから前の面などを描き足す）。 */
  boxNoise(u, v, w, h, d, pal) {
    const L = Skin.layout(u, v, w, h, d);
    for (const k of Object.keys(L)) this.noise(...L[k], pal);
    return L;
  }
  texture() {
    const t = new THREE.CanvasTexture(this.canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    return t;
  }
}

/**
 * 箱の形。w, h, d はドット、(ox, oy, oz) は箱の最小の角の位置（ドット、部品の回転の中心から）。
 * (u, v) は皮の展開図の左上。面ごとの陰（上 1.0、横 0.6〜0.8、下 0.5）を shade に入れる。
 */
export function boxGeometry(w, h, d, u, v, texW, texH, ox = -w / 2, oy = 0, oz = -d / 2, inflate = 0) {
  const x0 = (ox - inflate) * PX, x1 = (ox + w + inflate) * PX;
  const y0 = (oy - inflate) * PX, y1 = (oy + h + inflate) * PX;
  const z0 = (oz - inflate) * PX, z1 = (oz + d + inflate) * PX;
  const L = Skin.layout(u, v, w, h, d);
  const pos = [], uv = [], shade = [], idx = [];
  const face = (corners, rect, sh, mirror = false) => {
    const [rx, ry, rw, rh] = rect;
    const u0 = rx / texW, u1 = (rx + rw) / texW, vTop = 1 - ry / texH, vBot = 1 - (ry + rh) / texH;
    const uvs = mirror ? [[u1, vBot], [u0, vBot], [u0, vTop], [u1, vTop]] : [[u0, vBot], [u1, vBot], [u1, vTop], [u0, vTop]];
    const n = pos.length / 3;
    for (let k = 0; k < 4; k++) { pos.push(...corners[k]); uv.push(...uvs[k]); shade.push(sh); }
    idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
  };
  face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], L.front, 0.85);
  face([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], L.back, 0.7);
  face([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], L.right, 0.62);
  face([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], L.left, 0.62);
  face([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], L.top, 1.0);
  face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], L.bottom, 0.5);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('shade', new THREE.Float32BufferAttribute(shade, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** 部品（回転の中心となる Group と、その中の箱）。 */
function part(name, parent, mat, skin, { size, uv, at = [0, 0, 0], off, inflate = 0 }) {
  const [w, h, d] = size;
  const pivot = new THREE.Group();
  pivot.name = name;
  pivot.position.set(at[0] * PX, at[1] * PX, at[2] * PX);
  const o = off || [-w / 2, 0, -d / 2];
  const mesh = new THREE.Mesh(boxGeometry(w, h, d, uv[0], uv[1], skin.W, skin.H, o[0], o[1], o[2], inflate), mat);
  mesh.name = name + 'Box';
  pivot.add(mesh);
  parent.add(pivot);
  return pivot;
}

// ------------------------------------------------------------------ アストラ（ゆるいロボット）
const FACES = ['normal', 'happy', 'scared', 'sad', 'sleep', 'surprise', 'work', 'blink'];

export function drawFace(g, kind, t = 0) {
  g.fillStyle = '#152038'; g.fillRect(0, 0, 16, 12);
  g.fillStyle = '#1d2c4c'; g.fillRect(1, 1, 14, 10);
  const c = kind === 'scared' ? '#8ff4ff' : kind === 'sad' ? '#7fb4ff' : '#6ff0ff';
  g.fillStyle = c;
  const eye = (x, pattern) => pattern.forEach((row, j) => [...row].forEach((ch, i) => { if (ch === '#') g.fillRect(x + i, 3 + j, 1, 1); }));
  const E = {
    normal: ['.##.', '####', '####', '.##.'],
    blink: ['....', '....', '####', '....'],
    happy: ['.##.', '#..#', '....', '....'],
    work: ['....', '####', '####', '....'],
    scared: ['#..#', '.##.', '.##.', '#..#'],
    sad: ['....', '##..', '.###', '....'],
    sleep: ['....', '....', '####', '....'],
    surprise: ['####', '#..#', '#..#', '####'],
  }[kind] || ['.##.', '####', '####', '.##.'];
  const R = kind === 'sad' ? ['....', '..##', '###.', '....'] : E;
  eye(2, E);
  eye(10, R);
  // 口・頬
  if (kind === 'happy' || kind === 'work') { g.fillRect(6, 8, 4, 1); g.fillRect(5, 7, 1, 1); g.fillRect(10, 7, 1, 1); }
  else if (kind === 'scared') { g.fillRect(5, 9, 6, 1); g.fillRect(6, 8, 1, 1); g.fillRect(8, 8, 1, 1); g.fillRect(10, 8, 1, 1); }
  else if (kind === 'sad') { g.fillRect(6, 9, 4, 1); g.fillRect(5, 10, 1, 1); g.fillRect(10, 10, 1, 1); }
  else if (kind === 'surprise') { g.fillRect(7, 8, 2, 2); }
  else if (kind === 'sleep') { g.fillRect(7, 9, 2, 1); }
  else g.fillRect(7, 9, 2, 1);
  if (kind === 'happy') { g.fillStyle = '#ff8fb0'; g.fillRect(1, 8, 2, 1); g.fillRect(13, 8, 2, 1); }
  if (kind === 'scared') { g.fillStyle = '#9fd8ff'; g.fillRect(14, 2 + (Math.floor(t * 8) % 3), 1, 2); }
}

export function createAstraModel() {
  const skin = new Skin(64, 64, 101);
  const white = ['#eeeae0', '#e6e2d8', '#f2efe6', '#e9e5db'];
  const gray = ['#b9bcc4', '#aeb1b9', '#c2c5cc'];
  // 頭 10×8×8 at (0,0)
  const H = skin.boxNoise(0, 0, 10, 8, 8, white);
  skin.rect(...H.front, '#d8d4ca');
  skin.rect(H.front[0], H.front[1] + 7, 10, 1, '#c8c4ba');
  for (const k of ['left', 'right']) { skin.rect(H[k][0] + 3, H[k][1] + 3, 2, 2, '#ff9a4d'); skin.px(H[k][0] + 3, H[k][1] + 3, '#ffc08a'); }
  skin.rect(H.back[0] + 2, H.back[1] + 2, 6, 1, '#c8c4ba'); skin.rect(H.back[0] + 2, H.back[1] + 4, 6, 1, '#c8c4ba');
  // アンテナ 1×4×1 at (40,0)、玉 2×2×2 at (44,0)
  skin.boxNoise(40, 0, 1, 4, 1, gray);
  skin.boxNoise(44, 0, 2, 2, 2, ['#ffffff']);
  // 胴 8×7×5 at (0,16)
  const Bd = skin.boxNoise(0, 16, 8, 7, 5, white);
  skin.rect(Bd.front[0] + 2, Bd.front[1] + 2, 4, 3, '#2a3550');
  skin.px(Bd.front[0] + 3, Bd.front[1] + 3, '#ffcf6a'); skin.px(Bd.front[0] + 4, Bd.front[1] + 3, '#d6ad62');
  skin.rect(Bd.front[0], Bd.front[1] + 6, 8, 1, '#c8c4ba');
  // 腕 2×6×2 at (28,16)
  const Ar = skin.boxNoise(28, 16, 2, 6, 2, white);
  for (const k of ['front', 'back', 'left', 'right']) skin.rect(Ar[k][0], Ar[k][1] + 5, Ar[k][2], 1, '#9aa0aa');
  // 足 3×3×3 at (40,16)
  skin.boxNoise(40, 16, 3, 3, 3, ['#8a8f9a', '#7e838e', '#959aa4']);
  // 背中の袋（じゃがいも入り）9×9×5 at (0,32)
  const burlap = ['#d8b880', '#cdae74', '#e0c28c', '#c4a46a'];
  const S = skin.boxNoise(0, 32, 9, 9, 5, burlap);
  skin.rect(S.top[0], S.top[1], 9, 5, '#7a5a34');
  for (const [x, y] of [[0, 1], [3, 0], [5, 2], [7, 1], [2, 3], [6, 3]]) { skin.rect(S.top[0] + x, S.top[1] + y, 2, 2, '#e8bd6a'); skin.px(S.top[0] + x, S.top[1] + y, '#f4d68e'); }
  // 口をしばったひもと、縫い目
  for (const k of ['back', 'left', 'right', 'front']) { skin.rect(S[k][0], S[k][1] + 1, S[k][2], 1, '#8a5a2a'); }
  for (let i = 1; i < 9; i += 2) { skin.px(S.back[0] + i, S.back[1] + 5, '#a8865a'); skin.px(S.back[0] + 4, S.back[1] + 3 + (i % 4), '#a8865a'); }
  // 背中の袋のつぎあて
  skin.rect(S.back[0] + 5, S.back[1] + 5, 3, 3, '#a8c0d8'); skin.px(S.back[0] + 5, S.back[1] + 5, '#c8d8e8');
  // 麦わら帽子：てっぺん 7×3×7 at (28,32)、つば 14×1×14 at (0,48)
  const straw = ['#e8c66a', '#dcb85a', '#f0d27a', '#d4ae52'];
  const Hc = skin.boxNoise(28, 32, 7, 3, 7, straw);
  for (const k of ['front', 'back', 'left', 'right']) skin.rect(Hc[k][0], Hc[k][1] + 2, Hc[k][2], 1, '#d9534f');
  skin.boxNoise(0, 48, 14, 1, 14, straw);

  const tex = skin.texture();
  const mat = entityMaterial(tex);
  const root = new THREE.Group();
  root.name = 'astra';
  const body = new THREE.Group(); body.name = 'bodyRoot'; root.add(body);
  const legL = part('legL', body, mat, skin, { size: [3, 3, 3], uv: [40, 16], at: [-2, 3, 0], off: [-1.5, -3, -1.5] });
  const legR = part('legR', body, mat, skin, { size: [3, 3, 3], uv: [40, 16], at: [2, 3, 0], off: [-1.5, -3, -1.5] });
  const torso = part('torso', body, mat, skin, { size: [8, 7, 5], uv: [0, 16], at: [0, 3, 0] });
  const armL = part('armL', torso, mat, skin, { size: [2, 6, 2], uv: [28, 16], at: [-5, 6.5, 0], off: [-1, -6, -1] });
  const armR = part('armR', torso, mat, skin, { size: [2, 6, 2], uv: [28, 16], at: [5, 6.5, 0], off: [-1, -6, -1] });
  const sack = part('sack', torso, mat, skin, { size: [9, 9, 5], uv: [0, 32], at: [0, 1, -2.5], off: [-4.5, 0, -5] });
  const head = part('head', torso, mat, skin, { size: [10, 8, 8], uv: [0, 0], at: [0, 7, 0] });
  const antenna = part('antenna', head, mat, skin, { size: [1, 4, 1], uv: [40, 0], at: [1.5, 8, -1] });
  const ballMat = new THREE.MeshBasicMaterial({ color: 0x6ff0ff, toneMapped: false });
  const ball = new THREE.Mesh(new THREE.BoxGeometry(2.2 * PX, 2.2 * PX, 2.2 * PX), ballMat);
  ball.name = 'antennaBall';
  ball.position.y = 5 * PX;
  antenna.add(ball);
  const hat = new THREE.Group(); hat.name = 'hat'; hat.position.set(0, 8 * PX, 0); hat.rotation.z = -0.08; head.add(hat);
  part('hatTop', hat, mat, skin, { size: [7, 3, 7], uv: [28, 32], at: [0, 0.5, 0] });
  part('hatBrim', hat, mat, skin, { size: [14, 1, 14], uv: [0, 48], at: [0, 0, 0] });
  // 顔の画面（光る）
  const fc = document.createElement('canvas');
  fc.width = 16; fc.height = 12;
  const fg = fc.getContext('2d');
  const faceTex = new THREE.CanvasTexture(fc);
  faceTex.colorSpace = THREE.SRGBColorSpace;
  faceTex.magFilter = THREE.NearestFilter;
  faceTex.minFilter = THREE.NearestFilter;
  faceTex.generateMipmaps = false;
  const faceMat = new THREE.MeshBasicMaterial({ map: faceTex, toneMapped: false });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(8 * PX, 6 * PX), faceMat);
  screen.name = 'screen';
  screen.position.set(0, 4 * PX, 4 * PX + 0.002);
  head.add(screen);

  let face = '';
  let faceT = 0;
  const setFace = (k, t = 0) => {
    if (k === face && k !== 'scared') return;
    if (k === 'scared' && Math.floor(t * 8) === Math.floor(faceT * 8) && face === k) return;
    face = k; faceT = t;
    drawFace(fg, k, t);
    faceTex.needsUpdate = true;
  };
  setFace('normal');

  const parts = { body, torso, head, armL, armR, legL, legR, sack, antenna, hat, ball, screen };
  return {
    root, parts, mat, faceMat, ballMat, setFace, FACES,
    get face() { return face; },
    /** 体の明るさ（0〜15）。 */
    setLight(sky, blk) { mat.uniforms.uLight.value.set(sky / 15, blk / 15); const k = Math.max(0.35, Math.max(sky / 15, blk / 15)); faceMat.color.setScalar(Math.min(1, k + 0.4)); },
    setAntenna(hex) { ballMat.color.setHex(hex); },
    setSack(n) { const s = 0.75 + Math.min(1, n / 150) * 0.6; sack.scale.set(s, s, s); },
  };
}

// ------------------------------------------------------------------ 緑のアレ
export function createGreenModel({ big = false } = {}) {
  const skin = new Skin(64, 32, big ? 303 : 202);
  const greens = ['#6cbc4c', '#5cae40', '#78c858', '#52a03a', '#66b448', '#88d466'];
  const Bd = skin.boxNoise(0, 0, 10, 9, 8, greens);
  // 顔：まるい目（白い光）と、ふにゃっとした口。ほっぺは明るい緑
  const [fx, fy] = Bd.front;
  for (const ex of [2, 6]) { skin.rect(fx + ex, fy + 2, 2, 3, '#10180c'); skin.px(fx + ex, fy + 2, '#f4fff0'); }
  for (const [x, y] of [[3, 7], [4, 6], [5, 7], [6, 6]]) skin.px(fx + x, fy + y, '#10180c');
  skin.rect(fx + 1, fy + 5, 1, 1, '#a8f088'); skin.rect(fx + 8, fy + 5, 1, 1, '#a8f088');
  // 背中の模様
  for (const [x, y] of [[2, 2], [6, 3], [4, 6]]) skin.rect(Bd.back[0] + x, Bd.back[1] + y, 2, 2, '#46902e');
  skin.boxNoise(40, 0, 4, 4, 4, ['#4e9a34', '#448a2c', '#56a83a']);
  const tex = skin.texture();
  const mat = entityMaterial(tex);
  const root = new THREE.Group();
  root.name = big ? 'bigGreen' : 'green';
  const scale = new THREE.Group(); scale.name = 'scale'; root.add(scale);
  const body = part('body', scale, mat, skin, { size: [10, 9, 8], uv: [0, 0], at: [0, 4, 0] });
  const legs = [];
  for (const [i, x, z] of [[0, -3, 2], [1, 3, 2], [2, -3, -2], [3, 3, -2]]) {
    legs.push(part('leg' + i, scale, mat, skin, { size: [4, 4, 4], uv: [40, 0], at: [x, 4, z], off: [-2, -4, -2] }));
  }
  const s = big ? 2.4 : 1.5;
  scale.scale.setScalar(s);
  return { root, scale, body, legs, mat, baseScale: s, height: 13 * PX * s, width: 10 * PX * s };
}

// ------------------------------------------------------------------ ブタ
export function createPigModel() {
  const skin = new Skin(64, 32, 404);
  const pink = ['#f0a8a8', '#e89c9c', '#f4b2b2', '#e29494'];
  skin.boxNoise(0, 0, 10, 8, 14, pink);
  const head = skin.boxNoise(0, 22, 8, 7, 3, pink);
  skin.rect(head.front[0] + 1, head.front[1] + 2, 2, 1, '#2a1a1a'); skin.rect(head.front[0] + 5, head.front[1] + 2, 2, 1, '#2a1a1a');
  skin.px(head.front[0] + 1, head.front[1] + 2, '#ffffff'); skin.px(head.front[0] + 6, head.front[1] + 2, '#ffffff');
  const sn = skin.boxNoise(24, 22, 4, 3, 1, ['#e48a96']);
  skin.px(sn.front[0] + 1, sn.front[1] + 1, '#a8505a'); skin.px(sn.front[0] + 2, sn.front[1] + 1, '#a8505a');
  skin.boxNoise(48, 16, 3, 4, 3, ['#e29494', '#d88a8a']);
  const tex = skin.texture();
  const mat = entityMaterial(tex);
  const root = new THREE.Group();
  root.name = 'pig';
  const body = part('body', root, mat, skin, { size: [10, 8, 14], uv: [0, 0], at: [0, 4, 0] });
  const hd = part('head', root, mat, skin, { size: [8, 7, 3], uv: [0, 22], at: [0, 6, 7], off: [-4, 0, 0] });
  part('snout', hd, mat, skin, { size: [4, 3, 1], uv: [24, 22], at: [0, 1, 3], off: [-2, 0, 0] });
  const legs = [];
  for (const [i, x, z] of [[0, -3, 5], [1, 3, 5], [2, -3, -5], [3, 3, -5]]) legs.push(part('leg' + i, root, mat, skin, { size: [3, 4, 3], uv: [48, 16], at: [x, 4, z], off: [-1.5, -4, -1.5] }));
  return { root, body, head: hd, legs, mat };
}

// ------------------------------------------------------------------ アイテム（ドット絵に厚みをつけた形）
const itemGeoCache = new Map();
/** 16×16 のタイルの絵から、厚さ 1 ドットの形を作る（マイクラのアイテムと同じ作り）。 */
export function itemGeometry(atlas, name) {
  if (itemGeoCache.has(name)) return itemGeoCache.get(name);
  const img = atlas.images[name];
  const [u0, v0, u1, v1] = atlas.uv(name);
  const du = (u1 - u0) / 16, dv = (v1 - v0) / 16;
  const a = (x, y) => (x < 0 || y < 0 || x > 15 || y > 15 ? 0 : img.data[(y * 16 + x) * 4 + 3]);
  const pos = [], uv = [], shade = [], idx = [];
  const T = 0.5 * PX;
  const quad = (c, uvs, sh) => {
    const n = pos.length / 3;
    for (let k = 0; k < 4; k++) { pos.push(...c[k]); uv.push(...uvs[k]); shade.push(sh); }
    idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
  };
  // 前と後ろ（1 枚の絵）
  const X0 = -0.5, X1 = 0.5, Y0 = -0.5, Y1 = 0.5;
  quad([[X0, Y0, T], [X1, Y0, T], [X1, Y1, T], [X0, Y1, T]], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], 1);
  quad([[X1, Y0, -T], [X0, Y0, -T], [X0, Y1, -T], [X1, Y1, -T]], [[u1, v0], [u0, v0], [u0, v1], [u1, v1]], 0.75);
  // ふち（となりが透明な画素の辺）
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (a(x, y) < 128) continue;
    const px0 = -0.5 + x / 16, px1 = px0 + 1 / 16;
    const py1 = 0.5 - y / 16, py0 = py1 - 1 / 16;
    const cu = u0 + (x + 0.5) * du, cv = v1 - (y + 0.5) * dv;
    const uvs = [[cu, cv], [cu, cv], [cu, cv], [cu, cv]];
    if (a(x - 1, y) < 128) quad([[px0, py0, -T], [px0, py0, T], [px0, py1, T], [px0, py1, -T]], uvs, 0.6);
    if (a(x + 1, y) < 128) quad([[px1, py0, T], [px1, py0, -T], [px1, py1, -T], [px1, py1, T]], uvs, 0.6);
    if (a(x, y - 1) < 128) quad([[px0, py1, T], [px1, py1, T], [px1, py1, -T], [px0, py1, -T]], uvs, 0.95);
    if (a(x, y + 1) < 128) quad([[px0, py0, -T], [px1, py0, -T], [px1, py0, T], [px0, py0, T]], uvs, 0.5);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('shade', new THREE.Float32BufferAttribute(shade, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  itemGeoCache.set(name, g);
  return g;
}

export function itemMesh(atlas, name, mat) {
  const m = new THREE.Mesh(itemGeometry(atlas, name), mat || entityMaterial(atlas.texture));
  m.name = 'item_' + name;
  return m;
}

/** 手に持つブロック（小さな立方体。面ごとにタイルの絵）。大きさ 1（中心が原点）。 */
export function blockItemGeometry(atlas, tex) {
  const key = 'block:' + JSON.stringify(tex);
  if (itemGeoCache.has(key)) return itemGeoCache.get(key);
  const T = (k) => atlas.uv(typeof tex === 'string' ? tex : tex[k]);
  const pos = [], uv = [], shade = [], idx = [];
  const face = (c, name, sh) => {
    const [u0, v0, u1, v1] = T(name);
    const n = pos.length / 3;
    const uvs = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    for (let k = 0; k < 4; k++) { pos.push(...c[k]); uv.push(...uvs[k]); shade.push(sh); }
    idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
  };
  const a = -0.5, b = 0.5;
  face([[a, a, b], [b, a, b], [b, b, b], [a, b, b]], 'side', 0.85);
  face([[b, a, a], [a, a, a], [a, b, a], [b, b, a]], 'side', 0.7);
  face([[b, a, b], [b, a, a], [b, b, a], [b, b, b]], 'side', 0.62);
  face([[a, a, a], [a, a, b], [a, b, b], [a, b, a]], 'side', 0.62);
  face([[a, b, b], [b, b, b], [b, b, a], [a, b, a]], 'top', 1);
  face([[a, a, a], [b, a, a], [b, a, b], [a, a, b]], 'bottom', 0.5);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('shade', new THREE.Float32BufferAttribute(shade, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  itemGeoCache.set(key, g);
  return g;
}
