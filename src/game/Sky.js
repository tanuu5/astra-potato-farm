// 空：色のグラデーション（ドーム）、四角い太陽と月、星、平たい雲、島のまわりの海。
// 時間帯（0〜1：0 が日の出、0.25 が真昼、0.5 が日の入り、0.75 が真夜中）で色と明るさを変える。
import * as THREE from 'three';
import { shared, oceanMaterial } from './world/materials.js';
import { WX, WZ, SEA } from './world/World.js';
import { mulberry32 } from '../core/rng.js';
import { clamp, lerp, smoothstep } from '../core/math.js';

const C = (hex) => new THREE.Color(hex);
// 時間帯ごとの色（キー：時刻）
const KEYS = [
  { t: 0.0, top: C(0x3a5a9a), hor: C(0xf4a97a), sky: 0.55, tint: C(0xffd2b0) },
  { t: 0.06, top: C(0x5d93e0), hor: C(0xbfe0ff), sky: 1.0, tint: C(0xffffff) },
  { t: 0.44, top: C(0x5d93e0), hor: C(0xbfe0ff), sky: 1.0, tint: C(0xffffff) },
  { t: 0.5, top: C(0x4a5f9a), hor: C(0xf59a6a), sky: 0.7, tint: C(0xffc49a) },
  { t: 0.56, top: C(0x0b1028), hor: C(0x222850), sky: 0.2, tint: C(0x8fa0e0) },
  { t: 0.94, top: C(0x0b1028), hor: C(0x222850), sky: 0.2, tint: C(0x8fa0e0) },
  { t: 1.0, top: C(0x3a5a9a), hor: C(0xf4a97a), sky: 0.55, tint: C(0xffd2b0) },
];

export function skyAt(t) {
  t = ((t % 1) + 1) % 1;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].t < t) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const k = clamp((t - a.t) / Math.max(1e-6, b.t - a.t));
  return {
    top: a.top.clone().lerp(b.top, k),
    hor: a.hor.clone().lerp(b.hor, k),
    sky: lerp(a.sky, b.sky, k),
    tint: a.tint.clone().lerp(b.tint, k),
  };
}

function squareTexture(draw, size = 32) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

export class Sky {
  constructor(scene, atlas) {
    this.group = new THREE.Group();
    this.group.name = 'sky';
    scene.add(this.group);
    this.uniforms = { uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uGlow: { value: new THREE.Color(0xffb070) }, uGlowAmt: { value: 0 } };
    const dome = new THREE.Mesh(new THREE.SphereGeometry(300, 24, 16), new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop, uHor, uSun, uGlow; uniform float uGlowAmt; varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir + vec3(0.0, 1e-4, 0.0));
          float h = clamp(d.y, -1.0, 1.0);
          vec3 col = mix(uHor, uTop, smoothstep(-0.05, 0.55, h));
          col = mix(col, uHor * 0.55, smoothstep(0.0, -0.4, h));
          float g = max(dot(d, normalize(uSun + vec3(0.0, 1e-4, 0.0))), 0.0);
          col += uGlow * pow(g, 6.0) * uGlowAmt * (1.0 - smoothstep(0.1, 0.6, abs(h)));
          gl_FragColor = vec4(col, 1.0);
        }`,
      side: THREE.BackSide, depthWrite: false, depthTest: false,
    }));
    dome.name = 'skyDome';
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    this.group.add(dome);
    this.dome = dome;

    // 太陽と月（四角い）
    const sunTex = squareTexture((g, s) => {
      g.fillStyle = 'rgba(255,240,170,0.35)'; g.fillRect(0, 0, s, s);
      g.fillStyle = '#fff7c8'; g.fillRect(6, 6, s - 12, s - 12);
      g.fillStyle = '#ffffff'; g.fillRect(9, 9, s - 18, s - 18);
    });
    const moonTex = squareTexture((g, s) => {
      g.fillStyle = 'rgba(200,210,255,0.2)'; g.fillRect(0, 0, s, s);
      g.fillStyle = '#e8ecf8'; g.fillRect(8, 8, s - 16, s - 16);
      g.fillStyle = '#b8c0d8'; g.fillRect(11, 12, 4, 4); g.fillRect(17, 17, 5, 4); g.fillRect(14, 20, 3, 2);
    });
    const mk = (tex, size) => {
      // 太陽・月・星は透明物として世界のあとに描かれるので、奥行きを見て地形や葉に隠れるようにする（depthTest: true）
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: true, fog: false, toneMapped: false }));
      m.renderOrder = -9;
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    };
    this.sun = mk(sunTex, 20);
    this.sun.name = 'sun';
    this.moon = mk(moonTex, 15);
    this.moon.name = 'moon';

    // 星
    const rnd = mulberry32(7);
    const pos = [];
    for (let i = 0; i < 500; i++) {
      const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const y = Math.abs(u) * 0.95 + 0.05;
      pos.push(Math.cos(a) * r * 250, y * 250, Math.sin(a) * r * 250);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, depthTest: true, fog: false }));
    this.stars.name = 'stars';
    this.stars.renderOrder = -9;
    this.stars.frustumCulled = false;
    this.group.add(this.stars);

    // 雲：ドットの雲を描いた 1 枚を、空の高いところでくり返して流す
    const cloudTex = squareTexture((g, s) => {
      const r = mulberry32(11);
      g.clearRect(0, 0, s, s);
      g.fillStyle = '#ffffff';
      for (let i = 0; i < 22; i++) {
        const x = Math.floor(r() * s), y = Math.floor(r() * s), w = 2 + Math.floor(r() * 7), h = 1 + Math.floor(r() * 4);
        for (const [ox, oy] of [[0, 0], [-s, 0], [0, -s], [-s, -s]]) g.fillRect(x + ox, y + oy, w, h);
      }
    }, 64);
    cloudTex.wrapS = cloudTex.wrapT = THREE.RepeatWrapping;
    this.cloudU = { map: { value: cloudTex }, uOff: { value: new THREE.Vector2() }, uTint: { value: new THREE.Color(1, 1, 1) }, uCam: { value: new THREE.Vector3() } };
    const clouds = new THREE.Mesh(new THREE.PlaneGeometry(640, 640), new THREE.ShaderMaterial({
      uniforms: this.cloudU,
      vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vUv = w.xz / 768.0; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform vec2 uOff; uniform vec3 uTint, uCam; varying vec2 vUv; varying vec3 vW;
        void main() {
          vec4 t = texture2D(map, vUv + uOff);
          if (t.a < 0.5) discard;
          float d = length(vW.xz - uCam.xz);
          float a = 0.8 * (1.0 - smoothstep(120.0, 300.0, d));
          gl_FragColor = vec4(uTint, a);
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    clouds.rotation.x = -Math.PI / 2;
    clouds.position.y = 44;
    clouds.name = 'clouds';
    clouds.renderOrder = 3;
    this.clouds = clouds;
    scene.add(clouds);

    // 島のまわりの海（世界の四角の外側だけ）
    const ocean = new THREE.Group();
    ocean.name = 'ocean';
    const om = oceanMaterial(atlas.water);
    const Y = SEA - 1 + 14 / 16 - 0.01;
    const E = 600;
    for (const [x0, z0, x1, z1] of [[-E, -E, WX + E, 0], [-E, WZ, WX + E, WZ + E], [-E, 0, 0, WZ], [WX, 0, WX + E, WZ]]) {
      const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
      g.rotateX(-Math.PI / 2);
      g.translate((x0 + x1) / 2, Y, (z0 + z1) / 2);
      ocean.add(new THREE.Mesh(g, om));
    }
    scene.add(ocean);
    this.ocean = ocean;
    this.state = skyAt(0.2);
  }

  /** 時間帯 t（0〜1）とカメラで、空・光の uniform をそろえる。 */
  update(t, camera, dt, time) {
    const s = (this.state = skyAt(t));
    this.uniforms.uTop.value.copy(s.top);
    this.uniforms.uHor.value.copy(s.hor);
    this.group.position.copy(camera.position);
    this.group.updateMatrixWorld(true);
    // 太陽：t = 0 で東（+x）から昇り、0.25 で真上、0.5 で西に沈む
    const ang = t * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0.25).normalize();
    this.uniforms.uSun.value.copy(dir);
    this.uniforms.uGlowAmt.value = 1 - smoothstep(0.06, 0.16, Math.min(Math.abs(t - 0.5), Math.abs(t), Math.abs(t - 1)));
    this.sun.position.copy(dir).multiplyScalar(200);
    this.moon.position.copy(dir).multiplyScalar(-200);
    this.group.updateMatrixWorld(true);
    this.sun.lookAt(camera.position);
    this.moon.lookAt(camera.position);
    this.sun.visible = dir.y > -0.15;
    this.moon.visible = dir.y < 0.15;
    const night = smoothstep(0.52, 0.6, t) * (1 - smoothstep(0.93, 0.99, t));
    this.stars.material.opacity = night * 0.9;
    this.stars.rotation.y = time * 0.004;

    shared.uSky.value = s.sky;
    shared.uSkyColor.value.copy(s.tint);
    shared.uFogColor.value.copy(s.hor).lerp(s.top, 0.15);
    // 雲
    this.cloudU.uOff.value.x = time * 0.0025;
    this.cloudU.uCam.value.copy(camera.position);
    this.cloudU.uTint.value.setRGB(1, 1, 1).multiplyScalar(lerp(0.25, 1, s.sky)).lerp(s.hor, 0.15);
    this.clouds.position.x = camera.position.x;
    this.clouds.position.z = camera.position.z;
  }
}
