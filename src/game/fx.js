// 見た目の小物：四角い粒（土・煙・きらきら）、浮かぶ数字（+3）、頭の上のふきだし（！や ♪）、狙っているブロックの枠。
import * as THREE from 'three';

const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

// ------------------------------------------------------------------ 粒
export class Particles {
  constructor(scene, max = 1500) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.alpha = new Float32Array(max);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.base = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.uniforms = { uScale: { value: 400 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute float alpha; attribute float size; attribute vec3 color;
        uniform float uScale; varying vec3 vCol; varying float vA;
        void main() {
          vCol = color; vA = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(size * uScale / max(-mv.z, 0.1), 1.0, 256.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vCol; varying float vA;
        void main() { if (vA < 0.01) discard; gl_FragColor = vec4(vCol, clamp(vA, 0.0, 1.0)); }`,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(g, m);
    this.points.name = 'particles';
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.geo = g;
  }

  setScale(drawHeight, fovDeg) { this.uniforms.uScale.value = drawHeight / (2 * Math.tan((fovDeg * Math.PI) / 360)); }

  /** p = { x, y, z, vx, vy, vz, color（hex か [r,g,b] 線形）, size, life, grav, drag, grow, bright } */
  spawn(p) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([p.vx || 0, p.vy || 0, p.vz || 0], i * 3);
    const c = Array.isArray(p.color) ? p.color : lin(p.color ?? 0xffffff);
    const k = p.bright ?? 1;
    this.col.set([c[0] * k, c[1] * k, c[2] * k], i * 3);
    this.base[i] = p.size ?? 0.1;
    this.size[i] = this.base[i];
    this.life[i] = p.life ?? 1;
    this.age[i] = 0;
    this.grav[i] = p.grav ?? 12;
    this.drag[i] = p.drag ?? 1;
    this.grow[i] = p.grow ?? 0;
    this.alpha[i] = p.alpha ?? 1;
  }

  /** ブロックが壊れたときの破片。 */
  burst(x, y, z, color, n = 14, bright = 1, spread = 1) {
    const c = lin(color);
    for (let i = 0; i < n; i++) {
      const v = 0.75 + Math.random() * 0.35;
      this.spawn({
        x: x + Math.random() * spread, y: y + Math.random() * spread, z: z + Math.random() * spread,
        vx: (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 3, vz: (Math.random() - 0.5) * 3,
        color: [c[0] * v, c[1] * v, c[2] * v], size: 0.07 + Math.random() * 0.06, life: 0.5 + Math.random() * 0.5, grav: 14, drag: 0.5, bright,
      });
    }
  }

  /** 煙（白〜灰色の大きめの粒が広がって消える）。 */
  smoke(x, y, z, n = 10, r = 0.5, bright = 1, big = 1) {
    for (let i = 0; i < n; i++) {
      const g = 0.75 + Math.random() * 0.25;
      this.spawn({
        x: x + (Math.random() - 0.5) * r * 2, y: y + (Math.random() - 0.3) * r * 2, z: z + (Math.random() - 0.5) * r * 2,
        vx: (Math.random() - 0.5) * 2 * big, vy: 0.5 + Math.random() * 1.5, vz: (Math.random() - 0.5) * 2 * big,
        color: [g, g, g], size: (0.25 + Math.random() * 0.3) * big, life: 0.6 + Math.random() * 0.7, grav: -0.5, drag: 2, grow: 0.6 * big, bright, alpha: 0.9,
      });
    }
  }

  sparkle(x, y, z, n = 10, color = 0xfff2a0) {
    for (let i = 0; i < n; i++) {
      this.spawn({
        x: x + Math.random(), y: y + Math.random() * 0.8, z: z + Math.random(),
        vx: (Math.random() - 0.5) * 0.6, vy: 0.8 + Math.random() * 1.2, vz: (Math.random() - 0.5) * 0.6,
        color, size: 0.06 + Math.random() * 0.05, life: 0.6 + Math.random() * 0.5, grav: 0.5, drag: 1, bright: 1.2,
      });
    }
  }

  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this._kill(i); continue; }
      const j = i * 3;
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[j] *= dr; this.vel[j + 2] *= dr;
      this.vel[j + 1] = this.vel[j + 1] * dr - this.grav[i] * dt;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      const k = this.age[i] / this.life[i];
      this.size[i] = this.base[i] * (1 + this.grow[i] * k * 3);
      if (this.grow[i] > 0) this.alpha[i] = 0.9 * (1 - k);
      else this.alpha[i] = k > 0.75 ? (1 - k) * 4 : 1;
      i++;
    }
    for (const a of ['position', 'color', 'alpha', 'size']) this.geo.attributes[a].needsUpdate = true;
    this.geo.setDrawRange(0, this.n);
  }

  _kill(i) {
    const last = --this.n;
    if (i === last) return;
    for (const [arr, w] of [[this.pos, 3], [this.col, 3], [this.vel, 3]]) for (let k = 0; k < w; k++) arr[i * w + k] = arr[last * w + k];
    for (const arr of [this.alpha, this.size, this.life, this.age, this.grav, this.drag, this.grow, this.base]) arr[i] = arr[last];
  }

  clear() { this.n = 0; this.geo.setDrawRange(0, 0); }
}

// ------------------------------------------------------------------ 文字・ふきだしのスプライト
const PIXEL_FONT = '"DotGothic16", "Hiragino Maru Gothic ProN", monospace';

function canvasTexture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

const textCache = new Map();
function textTexture(text, color) {
  const key = text + '|' + color;
  if (textCache.has(key)) return textCache.get(key);
  const c = document.createElement('canvas');
  c.width = 128; c.height = 48;
  const g = c.getContext('2d');
  g.font = `bold 34px ${PIXEL_FONT}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(0,0,0,0.75)';
  g.fillText(text, 67, 27);
  g.fillStyle = color;
  g.fillText(text, 64, 24);
  const t = canvasTexture(c);
  textCache.set(key, t);
  return t;
}

export class FloatTexts {
  constructor(scene) { this.scene = scene; this.items = []; }
  add(text, x, y, z, color = '#ffe27a') {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture(text, color), transparent: true, depthTest: false, toneMapped: false }));
    s.name = 'float';
    s.scale.set(1.2, 0.45, 1);
    s.position.set(x, y, z);
    s.renderOrder = 20;
    this.scene.add(s);
    this.items.push({ s, t: 0, y });
  }
  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      it.s.position.y = it.y + it.t * 0.9;
      it.s.material.opacity = it.t > 0.9 ? Math.max(0, 1 - (it.t - 0.9) / 0.5) : 1;
      if (it.t > 1.4) { this.scene.remove(it.s); it.s.material.dispose(); this.items.splice(i, 1); }
    }
  }
  clear() { for (const it of this.items) this.scene.remove(it.s); this.items = []; }
}

// 頭の上のふきだし（16×16 のドット絵）
const EMOTES = {
  '!': ['......##......', '......##......', '......##......', '......##......', '......##......', '..............', '......##......'],
  '?': ['....######....', '...##....##...', '.........##...', '.......###....', '......##......', '..............', '......##......'],
  note: ['.......####...', '.......#..#...', '.......#......', '.......#......', '....####......', '...#####......', '....###.......'],
  zzz: ['..######......', '......#.......', '.....#..####..', '....#.....#...', '..######.#....', '........####..', '..............'],
  sweat: ['......#.......', '.....###......', '....#####.....', '....#####.....', '.....###......', '..............', '..............'],
  heart: ['...##..##.....', '..####.####...', '..#########...', '...#######....', '....#####.....', '.....###......', '......#.......'],
  dots: ['..............', '..............', '..............', '..............', '.##..##..##...', '.##..##..##...', '..............'],
  rain: ['...######.....', '.##########...', '############..', '.##########...', '..#..#..#.....', '.#..#..#......', '..............'],
};
const EMOTE_COLOR = { '!': '#e83a2a', '?': '#3a6ae8', note: '#3a6ae8', zzz: '#6a6aa8', sweat: '#4aa8e8', heart: '#e84a7a', dots: '#444444', rain: '#6a7a8a' };
const emoteCache = new Map();
export function emoteTexture(kind) {
  if (emoteCache.has(kind)) return emoteCache.get(kind);
  const c = document.createElement('canvas');
  c.width = 18; c.height = 14;
  const g = c.getContext('2d');
  g.fillStyle = '#222'; g.fillRect(1, 0, 16, 11); g.fillRect(0, 1, 18, 9); g.fillRect(6, 11, 4, 1); g.fillRect(7, 12, 2, 1);
  g.fillStyle = '#fff'; g.fillRect(1, 1, 16, 9); g.fillRect(7, 10, 2, 1);
  g.fillStyle = EMOTE_COLOR[kind] || '#222';
  (EMOTES[kind] || EMOTES['?']).forEach((row, y) => [...row].forEach((ch, x) => { if (ch === '#') g.fillRect(x + 2, y + 2, 1, 1); }));
  const t = canvasTexture(c);
  t.minFilter = THREE.NearestFilter;
  emoteCache.set(kind, t);
  return t;
}

export class Emote {
  constructor(parent, y = 1.9) {
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: emoteTexture('!'), transparent: true, depthTest: true, toneMapped: false }));
    this.sprite.name = 'emote';
    this.sprite.scale.set(0.6, 0.47, 1);
    this.sprite.position.y = y;
    this.sprite.visible = false;
    this.sprite.renderOrder = 15;
    this.y = y;
    parent.add(this.sprite);
    this.t = 0;
    this.kind = null;
  }
  show(kind, dur = 2) {
    this.kind = kind;
    this.sprite.material.map = emoteTexture(kind);
    this.sprite.material.needsUpdate = true;
    this.sprite.visible = true;
    this.t = dur;
  }
  hide() { this.t = 0; this.sprite.visible = false; this.kind = null; }
  update(dt, time) {
    if (this.t <= 0) return;
    this.t -= dt;
    this.sprite.position.y = this.y + Math.sin(time * 6) * 0.04;
    if (this.t <= 0) this.hide();
  }
}

// ------------------------------------------------------------------ 狙っているブロックの枠
export function selectionBox() {
  const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  const m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }));
  m.name = 'selection';
  m.visible = false;
  m.renderOrder = 6;
  return m;
}
