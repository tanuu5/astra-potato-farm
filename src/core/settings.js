// 遊ぶ人の設定（音量・画質・言語・ボタン表示）。localStorage に残し、URL で一時的に上書きできる：
//   ?quality=high   画質を固定（撮影のときは high にする。auto だと重い場面で解像度が下がる）
//   ?lang=en        言語        ?mute=1  音を出さない
import { createStore } from './save.js';
import { detectLang, isLang } from './i18n.js';

export const QUALITIES = ['auto', 'high', 'medium', 'low'];
// ゲームパッドの表示：type1 = A/B/X/Y の配置、type2 = ×/○/□/△ の配置（メーカー名は画面に出さない）
export const PAD_TYPES = ['auto', 'type1', 'type2'];
// 緑のアレガイド：on = 画面の外の矢印・「近づいている」のお知らせ・出てくる音／off = 気配と音だけ（本物っぽく）
export const MOB_GUIDES = ['on', 'off'];

const store = createStore('astra-potato-farm.settings', {
  volume: { master: 0.9, music: 0.6, sfx: 0.8 },
  quality: 'auto',
  lang: '',
  padType: 'auto',
  sens: 1,         // 視点の速さ（0.2〜2）
  mobGuide: 'on',  // 緑のアレガイド（MOB_GUIDES）
}, 1);

export const settings = store.data;
if (!isLang(settings.lang)) settings.lang = detectLang();
if (!QUALITIES.includes(settings.quality)) settings.quality = 'auto';
if (!PAD_TYPES.includes(settings.padType)) settings.padType = 'auto';
if (!(settings.sens >= 0.2 && settings.sens <= 2)) settings.sens = 1;
if (!MOB_GUIDES.includes(settings.mobGuide)) settings.mobGuide = 'on';

// URL の上書きは保存しない（その回だけ）
const q = new URLSearchParams(location.search);
export const overrides = {
  quality: QUALITIES.includes(q.get('quality')) ? q.get('quality') : null,
  lang: isLang(q.get('lang')) ? q.get('lang') : null,
  mute: q.has('mute'),
};

export const effective = {
  get quality() { return overrides.quality || settings.quality; },
  get lang() { return overrides.lang || settings.lang; },
};

export function saveSettings() { store.save(); }
