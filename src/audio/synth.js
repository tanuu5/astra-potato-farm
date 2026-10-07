// 音源と効果音。音声ファイルは使わず、Web Audio のオシレーターとノイズで鳴らす。
// どの関数も (ctx, out, t, p) の形：out はミキサーの系統（{ dry, wet }）、t は鳴らす時刻（ctx.currentTime 基準）。
// p は { f（Hz）or m（MIDI）, dur, vel（0〜1）, pan（-1〜1）, rev（リバーブへの送り 0〜1） } など。
// 値はすべて fin() で確かめてから使う（NaN が AudioParam に入ると、その音はもう鳴らない）。

const fin = (x, d) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const FLOOR = 0.0001; // 指数ランプは 0 に向かえないので、ここまで下げる

const noiseCache = new WeakMap();
function noiseBuffer(ctx) {
  let b = noiseCache.get(ctx);
  if (!b) {
    const n = ctx.sampleRate * 1.5;
    b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    let s = 22222;
    for (let i = 0; i < n; i++) d[i] = ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}

/** node → 音量 → 定位 → out.dry（と、rev があれば out.wet）につなぐ。音量の GainNode を返す。 */
function route(ctx, node, out, p) {
  const g = ctx.createGain();
  g.gain.value = 0;
  let last = node.connect(g);
  if (p.pan) {
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, fin(p.pan, 0)));
    last = last.connect(pan);
  }
  last.connect(out.dry);
  const rev = fin(p.rev, 0);
  if (rev > 0) { const s = ctx.createGain(); s.gain.value = rev; last.connect(s).connect(out.wet); }
  return g;
}

/** 立ち上がり a、減衰 d で peak から消える（打楽器・効果音の形）。 */
function perc(param, t, peak, a, d) {
  param.setValueAtTime(FLOOR, t);
  param.linearRampToValueAtTime(Math.max(FLOOR, peak), t + a);
  param.exponentialRampToValueAtTime(FLOOR, t + a + d);
}
/** 立ち上がり a、保持、離して r で消える（持続音の形）。 */
function adsr(param, t, peak, a, hold, r) {
  param.setValueAtTime(FLOOR, t);
  param.linearRampToValueAtTime(Math.max(FLOOR, peak), t + a);
  param.setValueAtTime(Math.max(FLOOR, peak), t + a + hold);
  param.exponentialRampToValueAtTime(FLOOR, t + a + hold + r);
}

function osc(ctx, type, f, t, end) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(Math.max(1, f), t);
  o.start(t);
  o.stop(end + 0.05);
  return o;
}

function noise(ctx, t, end) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx);
  s.loop = true;
  s.start(t, Math.random() * 1.2);
  s.stop(end + 0.05);
  return s;
}

function filter(ctx, type, f, q = 0.8) {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = Math.max(10, f);
  b.Q.value = q;
  return b;
}

const hz = (p, def) => fin(p.f, p.m !== undefined ? mtof(fin(p.m, 69)) : def);

// ---------------------------------------------------------------- 楽器（シーケンサーから使う）
export const INSTRUMENTS = {
  /** 矩形波のリード（チップチューン寄り）。 */
  lead(ctx, out, t, p) {
    const f = hz(p, 440), dur = fin(p.dur, 0.25), vel = fin(p.vel, 0.8);
    const o = osc(ctx, 'square', f, t, t + dur + 0.2);
    const lp = filter(ctx, 'lowpass', Math.min(9000, f * 6), 0.7);
    const g = route(ctx, o.connect(lp), out, { rev: 0.18, ...p });
    adsr(g.gain, t, 0.14 * vel, 0.006, Math.max(0, dur - 0.03), 0.12);
  },
  /** のこぎり波のベース（フィルターで弾く）。 */
  bass(ctx, out, t, p) {
    const f = hz(p, 55), dur = fin(p.dur, 0.25), vel = fin(p.vel, 0.8);
    const o = osc(ctx, 'sawtooth', f, t, t + dur + 0.15);
    const lp = filter(ctx, 'lowpass', 900, 3);
    lp.frequency.setValueAtTime(220 + 2200 * vel, t);
    lp.frequency.exponentialRampToValueAtTime(260, t + 0.18);
    const g = route(ctx, o.connect(lp), out, p);
    adsr(g.gain, t, 0.3 * vel, 0.004, Math.max(0, dur - 0.04), 0.08);
  },
  /** 少しずらした 3 本ののこぎり波のパッド（和音向け）。 */
  pad(ctx, out, t, p) {
    const f = hz(p, 220), dur = fin(p.dur, 1), vel = fin(p.vel, 0.6);
    const lp = filter(ctx, 'lowpass', 1800, 0.5);
    const mix = ctx.createGain();
    for (const det of [-9, 0, 8]) { const o = osc(ctx, 'sawtooth', f, t, t + dur + 0.8); o.detune.value = det; o.connect(mix); }
    mix.gain.value = 0.33;
    const g = route(ctx, mix.connect(lp), out, { rev: 0.35, ...p });
    adsr(g.gain, t, 0.08 * vel, 0.12, Math.max(0, dur - 0.12), 0.6);
  },
  /** 弾いた音（三角波＋短い倍音）。アルペジオ・メロディに。 */
  pluck(ctx, out, t, p) {
    const f = hz(p, 440), vel = fin(p.vel, 0.8);
    const o = osc(ctx, 'triangle', f, t, t + 0.6);
    const o2 = osc(ctx, 'sine', f * 2, t, t + 0.25);
    const m = ctx.createGain();
    o.connect(m); o2.connect(m);
    const g = route(ctx, m, out, { rev: 0.2, ...p });
    perc(g.gain, t, 0.25 * vel, 0.003, 0.45);
  },
  /** 鐘（FM）。完成・ご褒美の合図に。 */
  bell(ctx, out, t, p) {
    const f = hz(p, 880), vel = fin(p.vel, 0.7), dur = fin(p.dur, 1.4);
    const car = osc(ctx, 'sine', f, t, t + dur);
    const mod = osc(ctx, 'sine', f * 3.5, t, t + dur);
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * 2.2, t);
    mg.gain.exponentialRampToValueAtTime(Math.max(1, f * 0.05), t + dur);
    mod.connect(mg).connect(car.frequency);
    const g = route(ctx, car, out, { rev: 0.35, ...p });
    perc(g.gain, t, 0.18 * vel, 0.002, dur);
  },
  kick(ctx, out, t, p) {
    const vel = fin(p.vel, 0.9);
    const o = osc(ctx, 'sine', 150, t, t + 0.45);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = route(ctx, o, out, p);
    perc(g.gain, t, 0.9 * vel, 0.002, 0.38);
  },
  snare(ctx, out, t, p) {
    const vel = fin(p.vel, 0.8);
    const n = noise(ctx, t, t + 0.25);
    const g = route(ctx, n.connect(filter(ctx, 'bandpass', 1800, 0.7)), out, { rev: 0.15, ...p });
    perc(g.gain, t, 0.5 * vel, 0.001, 0.18);
    const o = osc(ctx, 'triangle', 190, t, t + 0.15);
    const g2 = route(ctx, o, out, p);
    perc(g2.gain, t, 0.3 * vel, 0.001, 0.09);
  },
  hat(ctx, out, t, p) {
    const vel = fin(p.vel, 0.6), open = !!p.open;
    const n = noise(ctx, t, t + (open ? 0.35 : 0.08));
    const g = route(ctx, n.connect(filter(ctx, 'highpass', 7500, 0.7)), out, p);
    perc(g.gain, t, 0.22 * vel, 0.001, open ? 0.3 : 0.05);
  },
};

// ---------------------------------------------------------------- 効果音（audio.sfx(name) で鳴らす）
// 作品に合わせて足す・作り替える。名前はゲームの出来事に合わせる（coin, hit, gameover …）。
export const SFX = {
  ui_move(ctx, out, t) { INSTRUMENTS.pluck(ctx, out, t, { f: 1320, vel: 0.35, rev: 0 }); },
  ui_ok(ctx, out, t) { INSTRUMENTS.pluck(ctx, out, t, { f: 988, vel: 0.5 }); INSTRUMENTS.pluck(ctx, out, t + 0.06, { f: 1480, vel: 0.5 }); },
  ui_back(ctx, out, t) { INSTRUMENTS.pluck(ctx, out, t, { f: 880, vel: 0.45 }); INSTRUMENTS.pluck(ctx, out, t + 0.06, { f: 587, vel: 0.45 }); },
  pause(ctx, out, t) { INSTRUMENTS.bell(ctx, out, t, { f: 784, vel: 0.9, dur: 0.6 }); },
  jump(ctx, out, t, p = {}) {
    const n = noise(ctx, t, t + 0.08);
    const g = route(ctx, n.connect(filter(ctx, 'bandpass', 900, 0.9)), out, p);
    perc(g.gain, t, 0.08, 0.003, 0.06);
  },
  land(ctx, out, t, p = {}) {
    const n = noise(ctx, t, t + 0.12);
    const g = route(ctx, n.connect(filter(ctx, 'lowpass', 600, 0.9)), out, p);
    perc(g.gain, t, 0.35 * fin(p.vel, 1), 0.002, 0.1);
  },
  /** 足音（草・砂）。 */
  step(ctx, out, t, p = {}) {
    const sand = p.kind === 'sand';
    const n = noise(ctx, t, t + 0.1);
    const g = route(ctx, n.connect(filter(ctx, 'bandpass', (sand ? 2600 : 1500) * (0.85 + Math.random() * 0.3), 1.1)), out, p);
    perc(g.gain, t, sand ? 0.07 : 0.09, 0.004, 0.07);
  },
  /** 土を耕す（ざくっ、ざくっ）。 */
  till(ctx, out, t, p = {}) {
    for (const [dt, f, v] of [[0, 800, 0.4], [0.07, 1100, 0.3]]) {
      const n = noise(ctx, t + dt, t + dt + 0.15);
      const g = route(ctx, n.connect(filter(ctx, 'bandpass', f, 1.4)), out, p);
      perc(g.gain, t + dt, v, 0.003, 0.11);
    }
    const o = osc(ctx, 'sine', 140, t, t + 0.15);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.12);
    const g = route(ctx, o, out, p);
    perc(g.gain, t, 0.25, 0.002, 0.12);
  },
  plant(ctx, out, t, p = {}) {
    const o = osc(ctx, 'sine', 560, t, t + 0.15);
    o.frequency.exponentialRampToValueAtTime(260, t + 0.09);
    const g = route(ctx, o, out, p);
    perc(g.gain, t, 0.22, 0.002, 0.1);
    const n = noise(ctx, t, t + 0.1);
    const g2 = route(ctx, n.connect(filter(ctx, 'highpass', 2500, 0.7)), out, p);
    perc(g2.gain, t, 0.05, 0.002, 0.08);
  },
  /** 収穫（ぽこっ）。 */
  harvest(ctx, out, t, p = {}) {
    const o = osc(ctx, 'sine', 820, t, t + 0.2);
    o.frequency.exponentialRampToValueAtTime(330, t + 0.11);
    const g = route(ctx, o, out, { rev: 0.1, ...p });
    perc(g.gain, t, 0.38, 0.002, 0.13);
    const n = noise(ctx, t, t + 0.12);
    const g2 = route(ctx, n.connect(filter(ctx, 'bandpass', 3000, 0.8)), out, p);
    perc(g2.gain, t, 0.07, 0.002, 0.09);
    INSTRUMENTS.pluck(ctx, out, t + 0.05, { f: 1046, vel: 0.35, rev: 0.15 });
  },
  pluck(ctx, out, t, p = {}) {
    const n = noise(ctx, t, t + 0.15);
    const g = route(ctx, n.connect(filter(ctx, 'highpass', 2200, 0.7)), out, p);
    perc(g.gain, t, 0.12, 0.002, 0.12);
    const o = osc(ctx, 'triangle', 600, t, t + 0.1);
    o.frequency.exponentialRampToValueAtTime(300, t + 0.06);
    const g2 = route(ctx, o, out, p);
    perc(g2.gain, t, 0.12, 0.002, 0.06);
  },
  /** アイテムを拾う（ぽっ）。 */
  pickup(ctx, out, t, p = {}) {
    const k = fin(p.pitch, 1);
    const o = osc(ctx, 'sine', 900 * k, t, t + 0.12);
    o.frequency.exponentialRampToValueAtTime(1500 * k, t + 0.05);
    const g = route(ctx, o, out, p);
    perc(g.gain, t, 0.16, 0.002, 0.08);
  },
  swing(ctx, out, t, p = {}) {
    const n = noise(ctx, t, t + 0.2);
    const bp = filter(ctx, 'bandpass', 600, 1.4);
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + 0.14);
    const g = route(ctx, n.connect(bp), out, p);
    perc(g.gain, t, 0.3, 0.03, 0.12);
  },
  hit(ctx, out, t, p = {}) {
    const o = osc(ctx, 'sine', 200, t, t + 0.2);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.12);
    const g = route(ctx, o, out, p);
    perc(g.gain, t, 0.5, 0.002, 0.14);
    const n = noise(ctx, t, t + 0.1);
    const g2 = route(ctx, n.connect(filter(ctx, 'lowpass', 1400, 0.8)), out, p);
    perc(g2.gain, t, 0.35, 0.002, 0.07);
    if (p.crit) INSTRUMENTS.pluck(ctx, out, t, { f: 1760, vel: 0.5, rev: 0.1 });
  },
  /** 緑のアレのシューッ（爆発の合図）。 */
  hiss(ctx, out, t, p = {}) {
    const dur = p.big ? 2.4 : 1.5;
    const n = noise(ctx, t, t + dur + 0.1);
    const hp = filter(ctx, 'highpass', p.big ? 1200 : 2400, 0.7);
    const bp = filter(ctx, 'bandpass', 3500, 0.6);
    bp.frequency.setValueAtTime(p.big ? 1800 : 3000, t);
    bp.frequency.linearRampToValueAtTime(p.big ? 3500 : 6000, t + dur);
    const g = route(ctx, n.connect(hp).connect(bp), out, p);
    g.gain.setValueAtTime(FLOOR, t);
    g.gain.linearRampToValueAtTime(0.45, t + 0.15);
    g.gain.linearRampToValueAtTime(0.6, t + dur);
    g.gain.exponentialRampToValueAtTime(FLOOR, t + dur + 0.08);
  },
  explode(ctx, out, t, p = {}) {
    const dur = fin(p.dur, 1.2);
    const n = noise(ctx, t, t + dur);
    const lp = filter(ctx, 'lowpass', 3000, 0.6);
    lp.frequency.setValueAtTime(p.big ? 2200 : 3200, t);
    lp.frequency.exponentialRampToValueAtTime(90, t + dur);
    const g = route(ctx, n.connect(lp), out, { rev: 0.35, ...p });
    perc(g.gain, t, p.big ? 0.95 : 0.8, 0.004, dur);
    const o = osc(ctx, 'sine', p.big ? 70 : 95, t, t + dur);
    o.frequency.exponentialRampToValueAtTime(28, t + dur * 0.8);
    const g2 = route(ctx, o, out, p);
    perc(g2.gain, t, p.big ? 0.9 : 0.7, 0.004, dur * 0.8);
  },
  /** たおしたときの、ぽふっ（煙）。 */
  poof(ctx, out, t, p = {}) {
    const n = noise(ctx, t, t + 0.4);
    const lp = filter(ctx, 'lowpass', 1600, 0.7);
    lp.frequency.setValueAtTime(1600, t);
    lp.frequency.exponentialRampToValueAtTime(300, t + 0.3);
    const g = route(ctx, n.connect(lp), out, { rev: 0.2, ...p });
    perc(g.gain, t, 0.45, 0.01, 0.3);
    INSTRUMENTS.pluck(ctx, out, t + 0.05, { f: 523, vel: 0.4 });
    INSTRUMENTS.pluck(ctx, out, t + 0.11, { f: 784, vel: 0.4 });
  },
  /** アストラのしゃべり声（ピポパ）。 */
  robot_talk(ctx, out, t, p = {}) {
    const n = Math.max(1, Math.min(7, fin(p.n, 3)));
    for (let i = 0; i < n; i++) {
      const f = 620 + Math.random() * 520;
      const o = osc(ctx, i % 2 ? 'square' : 'triangle', f, t + i * 0.075, t + i * 0.075 + 0.07);
      const g = route(ctx, o.connect(filter(ctx, 'lowpass', 2600, 0.7)), out, p);
      perc(g.gain, t + i * 0.075, 0.07, 0.004, 0.05);
    }
  },
  robot_scream(ctx, out, t, p = {}) {
    for (let i = 0; i < 9; i++) {
      const f = 1500 - i * 80 + (i % 2) * 200;
      const o = osc(ctx, 'square', f, t + i * 0.055, t + i * 0.055 + 0.05);
      const g = route(ctx, o.connect(filter(ctx, 'lowpass', 3500, 0.7)), out, p);
      perc(g.gain, t + i * 0.055, 0.06, 0.003, 0.04);
    }
  },
  hurt(ctx, out, t, p = {}) {
    const o = osc(ctx, 'square', p.big ? 180 : 240, t, t + 0.3);
    o.frequency.exponentialRampToValueAtTime(p.big ? 70 : 110, t + 0.2);
    const g = route(ctx, o.connect(filter(ctx, 'lowpass', 1200, 0.9)), out, p);
    perc(g.gain, t, 0.22, 0.003, 0.22);
  },
  eat(ctx, out, t, p = {}) {
    for (let i = 0; i < 3; i++) {
      const tt = t + i * 0.13;
      const n = noise(ctx, tt, tt + 0.08);
      const g = route(ctx, n.connect(filter(ctx, 'bandpass', 1300 + Math.random() * 600, 1.3)), out, p);
      perc(g.gain, tt, 0.3, 0.003, 0.06);
    }
  },
  fertilize(ctx, out, t, p = {}) {
    [1319, 1568, 2093, 2637].forEach((f, i) => INSTRUMENTS.bell(ctx, out, t + i * 0.05, { f, vel: 0.35, dur: 0.6 }));
    const n = noise(ctx, t, t + 0.2);
    const g = route(ctx, n.connect(filter(ctx, 'highpass', 4000, 0.7)), out, p);
    perc(g.gain, t, 0.06, 0.01, 0.18);
  },
  place(ctx, out, t, p = {}) {
    const n = noise(ctx, t, t + 0.12);
    const g = route(ctx, n.connect(filter(ctx, 'lowpass', 800, 0.9)), out, p);
    perc(g.gain, t, 0.4, 0.002, 0.09);
    const o = osc(ctx, 'sine', 150, t, t + 0.12);
    const g2 = route(ctx, o, out, p);
    perc(g2.gain, t, 0.25, 0.002, 0.09);
  },
  bonk(ctx, out, t, p = {}) {
    const o = osc(ctx, 'triangle', 420, t, t + 0.2);
    const o2 = osc(ctx, 'sine', 1260, t, t + 0.1);
    const m = ctx.createGain(); o.connect(m); o2.connect(m);
    const g = route(ctx, m, out, p);
    perc(g.gain, t, 0.3, 0.002, 0.15);
  },
  pig(ctx, out, t, p = {}) {
    const o = osc(ctx, 'sawtooth', 230, t, t + 0.3);
    o.frequency.setValueAtTime(230, t);
    o.frequency.linearRampToValueAtTime(300, t + 0.08);
    o.frequency.linearRampToValueAtTime(190, t + 0.24);
    const bp = filter(ctx, 'bandpass', 700, 2.5);
    const g = route(ctx, o.connect(bp), out, p);
    perc(g.gain, t, 0.35 * fin(p.vel, 1), 0.02, 0.22);
  },
  splash(ctx, out, t, p = {}) {
    const n = noise(ctx, t, t + 0.5);
    const bp = filter(ctx, 'bandpass', 1200, 0.6);
    bp.frequency.setValueAtTime(1800, t);
    bp.frequency.exponentialRampToValueAtTime(500, t + 0.4);
    const g = route(ctx, n.connect(bp), out, { rev: 0.2, ...p });
    perc(g.gain, t, 0.3, 0.01, 0.4);
  },
  /** 朝（ちいさな上りの和音）。 */
  morning(ctx, out, t) {
    [523, 659, 784, 1047].forEach((f, i) => INSTRUMENTS.pluck(ctx, out, t + i * 0.09, { f, vel: 0.45, rev: 0.3 }));
    INSTRUMENTS.bell(ctx, out, t + 0.4, { f: 1568, vel: 0.35, dur: 1.2 });
  },
  night(ctx, out, t) {
    INSTRUMENTS.bell(ctx, out, t, { f: 440, vel: 0.5, dur: 1.6 });
    INSTRUMENTS.bell(ctx, out, t + 0.35, { f: 330, vel: 0.45, dur: 2 });
  },
  goal(ctx, out, t) {
    [523, 659, 784, 1047, 1319].forEach((f, i) => INSTRUMENTS.pluck(ctx, out, t + i * 0.06, { f, vel: 0.55, rev: 0.25 }));
    INSTRUMENTS.bell(ctx, out, t + 0.32, { f: 2093, vel: 0.45, dur: 1.4 });
    INSTRUMENTS.bell(ctx, out, t + 0.32, { f: 1568, vel: 0.35, dur: 1.4 });
  },
  ding(ctx, out, t) { INSTRUMENTS.bell(ctx, out, t, { f: 1319, vel: 0.5, dur: 0.9 }); INSTRUMENTS.bell(ctx, out, t + 0.1, { f: 1760, vel: 0.4, dur: 0.9 }); },
  /** 緑のアレが地面から出てくる。 */
  mob_spawn(ctx, out, t, p = {}) {
    for (let i = 0; i < 3; i++) {
      const n = noise(ctx, t + i * 0.12, t + i * 0.12 + 0.1);
      const g = route(ctx, n.connect(filter(ctx, 'bandpass', 700, 1.2)), out, p);
      perc(g.gain, t + i * 0.12, 0.25, 0.003, 0.08);
    }
    const o = osc(ctx, 'sine', 90, t, t + 0.4);
    const g = route(ctx, o, out, p);
    perc(g.gain, t, 0.3, 0.01, 0.35);
  },
  boss_spawn(ctx, out, t, p = {}) {
    for (let i = 0; i < 2; i++) {
      const o = osc(ctx, 'sawtooth', 55 + i * 27.5, t, t + 1.6);
      const g = route(ctx, o.connect(filter(ctx, 'lowpass', 400, 1)), out, { rev: 0.3, ...p });
      adsr(g.gain, t, 0.3, 0.1, 0.8, 0.6);
    }
    SFX.mob_spawn(ctx, out, t, p);
  },
  /** 鳥（環境音）。 */
  bird(ctx, out, t, p = {}) {
    const n = 1 + Math.floor(Math.random() * 3);
    const base = 2400 + Math.random() * 1400;
    for (let i = 0; i < n; i++) {
      const tt = t + i * (0.09 + Math.random() * 0.05);
      const o = osc(ctx, 'sine', base, tt, tt + 0.1);
      o.frequency.setValueAtTime(base, tt);
      o.frequency.exponentialRampToValueAtTime(base * (1.25 + Math.random() * 0.3), tt + 0.05);
      o.frequency.exponentialRampToValueAtTime(base * 0.9, tt + 0.08);
      const g = route(ctx, o, out, { pan: (Math.random() - 0.5) * 1.4, rev: 0.4, ...p });
      perc(g.gain, tt, 0.035, 0.005, 0.07);
    }
  },
  coin(ctx, out, t, p = {}) {
    const k = fin(p.pitch, 1);
    for (const [dt, f] of [[0, 1319], [0.07, 1976]]) {
      const o = osc(ctx, 'square', f * k, t + dt, t + dt + 0.3);
      const g = route(ctx, o.connect(filter(ctx, 'lowpass', 6000)), out, { rev: 0.15, ...p });
      perc(g.gain, t + dt, 0.1, 0.002, dt ? 0.26 : 0.08);
    }
  },
};
