// 起動：部品を組み立て、ループを回す。作品ごとに変えるのは主に game/Game.js。
import './ui.css';    // 構造（どの作品でもほぼそのまま）
import './theme.css'; // 見た目（作品ごとに書き換える）
import './hud.css';   // ゲーム中の表示（このゲームの HUD）
import { Renderer } from './core/Renderer.js';
import { Input } from './core/Input.js';
import { settings, effective, overrides, saveSettings } from './core/settings.js';
import { setLang, applyDom, t, missingKeys } from './core/i18n.js';
import { GameAudio } from './audio/Audio.js';
import { Screens } from './ui/Screens.js';
import { MenuNav } from './ui/MenuNav.js';
import { TouchControls } from './ui/TouchControls.js';
import { refreshGlyphs } from './ui/glyphs.js';
import { preventZoom } from './ui/noZoom.js';
import { Game } from './game/Game.js';
import { installDevHarness } from '../dev/devHarness.js';

// 一人称・肩越しのカメラなら true：遊んでいるあいだマウスを画面に閉じ込める（クリックで閉じ込め、外れたら一時停止）
const POINTER_LOCK = true;

const app = document.getElementById('app');
const ui = document.getElementById('ui');
const loading = document.getElementById('loading');

setLang(effective.lang);
preventZoom();

let game;
let dev = null;
try {
  const renderer = new Renderer(app, { quality: effective.quality });
  const input = new Input(renderer.domElement);
  const audio = new GameAudio(settings.volume, { muted: overrides.mute });
  const touch = new TouchControls(ui, renderer.domElement, input, { onPause: () => game.state === 'play' && game.setState('paused') });
  const lock = () => { if (POINTER_LOCK) input.lockPointer(); };
  const screens = new Screens(ui, {
    onClick: (act) => audio.sfx(act === 'back' ? 'ui_back' : 'ui_ok'),
    onStart: () => { game.start(); },
    onContinue: () => { game.continueGame?.(); lock(); },   // セーブのある作品：screens.setContinue(true) で「つづきから」を出す
    onResume: () => { game.setState('play'); lock(); },
    onRetry: () => { game.retry(); lock(); },
    onToTitle: () => { game.reset(); game.setState('title'); },
    onSettings: (what) => {
      if (what === 'volume') audio.setVolume(settings.volume);
      if (what === 'quality' && !overrides.quality) renderer.setQuality(settings.quality);
      if (what === 'lang') setLang(settings.lang);
      if (what === 'padType' || what === 'lang') refreshGlyphs(input, settings);
      if (what === 'sens') input.sens = settings.sens;
      if (what === 'lang') game.setSplash?.();
      saveSettings();
    },
  });
  const nav = new MenuNav(() => screens.current(), () => audio.sfx('ui_move'));
  input.sens = settings.sens;
  input.mouseNeedsLock = POINTER_LOCK;
  game = new Game({ renderer, input, audio, screens, touch, ui });
  game.lockPointer = lock;
  input.onDevice = () => refreshGlyphs(input, settings);
  if (POINTER_LOCK) {
    renderer.domElement.addEventListener('click', () => { if (game.state === 'play') input.lockPointer(); });
    input.onPointerLock = (locked) => { if (!locked && game.state === 'play' && input.device === 'kb') game.setState('paused'); };
  }
  applyDom();
  refreshGlyphs(input, settings);

  // 最初の操作で音を出せるようにする（ブラウザの決まり）
  const unlock = () => audio.unlock();
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, unlock, { passive: true });

  const step = (dt) => {
    game.step(dt);
    // メニュー（タイトル・一時停止・設定）はゲームパッドとキーボードでも操作できる
    if (game.state !== 'play') nav.update(input.menu);
  };

  dev = installDevHarness({
    renderer: renderer.renderer,
    scene: () => game.scene,
    camera: () => game.camera,
    step,
    render: () => game.render(1 / 60),
    resize: (w, h) => renderer.resize(w, h),
    state: () => game.snapshot(),
    input: input.devInput(),
    goto: (name) => {
      if (name === 'title') { game.reset(); game.setState('title'); }
      else if (name === 'play') { game.start(); game.onAction('introGo'); }
      else if (name === 'paused') { if (game.state !== 'play') { game.start(); game.onAction('introGo'); } game.setState('paused'); }
      else if (/^day[1-5]$/.test(name)) { game.start(); game.tut = null; game.startDay(+name[3] - 1); game.setState('play'); }
      return game.state;
    },
    extra: { game, audio, i18nMissing: missingKeys },
  });

  let last = performance.now();
  let started = false;
  const frame = (now) => {
    // 長い間があいたとき（裏に回っていた等）に、一度に大きく進めない
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (started) {
      if (!dev?.paused) step(dt);
      game.render(dt);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  // 読み込み（game.init）が終わってから回し始め、最初の数コマを描いてから読み込み画面を消す
  game.init().then(() => {
    started = true;
    last = performance.now();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      loading.classList.add('done');
      // 読み込み画面が消えきってから「準備完了」にする（撮影ツールは ready を合図に撮り始めるので）
      setTimeout(() => { loading.remove(); dev?.markReady(); }, 600);
    }));
  }).catch((e) => {
    loading.querySelector('.ld-text').textContent = t('boot.loadFailed');
    console.error(e);
  });
} catch (e) {
  loading.querySelector('.ld-text').textContent = t('boot.noWebgl');
  throw e;
}
