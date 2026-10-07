// アストラのせりふと、お知らせ（チャット欄に出す）。せりふは i18n のキー（'astra.idle.3' のように番号つきで並べる）。
//   say('astra.idle', { random: true })   番号つきのどれか（続けて同じものは出さない）
//   say('astra.dusk')                     そのキー 1 つ
//   opts.cool：同じキーをくり返さない秒数　opts.delay：遅らせる秒数　opts.vars：{n} などの置き換え
import { t } from '../core/i18n.js';
import { ja } from '../i18n/ja.js';

const variants = new Map();
function countVariants(prefix) {
  if (variants.has(prefix)) return variants.get(prefix);
  let n = 0;
  while ((`${prefix}.${n}`) in ja) n++;
  variants.set(prefix, n);
  return n;
}

export class Talk {
  constructor({ onLine, onSys }) {
    this.onLine = onLine;   // (text, key) => void
    this.onSys = onSys;     // (text, kind) => void
    this.queue = [];
    this.gap = 0;
    this.cool = new Map();
    this.last = new Map();
    this.time = 0;
  }

  reset() { this.queue = []; this.gap = 0; this.cool.clear(); }

  say(key, opts = {}) {
    const { random = false, cool = 3, delay = 0, vars, low = false } = opts;
    if ((this.cool.get(key) ?? -1e9) > this.time) return false;
    if (low && (this.queue.length || this.gap > 0)) return false;
    let k = key;
    if (random) {
      const n = countVariants(key);
      if (!n) return false;
      let i = Math.floor(Math.random() * n);
      if (n > 1 && i === this.last.get(key)) i = (i + 1) % n;
      this.last.set(key, i);
      k = `${key}.${i}`;
    }
    this.cool.set(key, this.time + cool);
    this.queue.push({ k, vars, at: this.time + delay });
    return true;
  }

  sys(key, vars, kind = 'sys') { this.onSys(t(key, vars), kind); }

  update(dt) {
    this.time += dt;
    this.gap -= dt;
    if (this.gap > 0 || !this.queue.length) return;
    const i = this.queue.findIndex((q) => q.at <= this.time);
    if (i < 0) return;
    const q = this.queue.splice(i, 1)[0];
    const text = t(q.k, q.vars);
    this.onLine(text, q.k);
    this.gap = Math.min(3.2, 1.2 + text.length * 0.045);
  }
}
