// main.js — игровой цикл и состояния игры: меню, игра, уровень роста,
// редактор, пауза, смерть. Физика — фиксированный шаг, отрисовка — с интерполяцией.

import { Input, lockViewport } from './input.js';
import { Player, defaultConfig, prepareRender, buildBody } from './player.js';
import { drawCreature, PART } from './parts.js';
import { Background } from './background.js';
import { Particles, P } from './particles.js';
import { World } from './spawner.js';
import { Editor, unlockedParts } from './editor.js';
import { configCost, computeStats } from './stats.js';
import { buildPalette } from './palette.js';
import { I18n } from './i18n.js';
import { UI } from './ui.js';
import { Audio } from './audio.js';
import * as Save from './save.js';
import { installIcons } from './icons.js';
import { clamp, lerp, damp, TAU } from './rng.js';

const STEP = 1 / 60;
const MAX_FRAME = 0.25;
const SEED = 20260830;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });

let W = 0, H = 0, DPR = 1;
const cam = { x: 0, y: 0, zoom: 1, shake: 0 };
const view = { x0: 0, y0: 0, x1: 0, y1: 0 };

const i18n = new I18n('ru');
const ui = new UI(i18n);
const input = new Input(canvas);
lockViewport();

const bg = new Background(SEED);
const particles = new Particles(700);
const player = new Player(defaultConfig(4211), 0, 0);
const world = new World(SEED, bg, particles);
const editor = new Editor(canvas, i18n.t);
const audio = new Audio();
input.onFirstTouch = () => audio.unlock();

world.player = player;
world.populate(0, 0);

// Размытый снимок мира — фон редактора (дёшево: даунскейл + апскейл).
const blurCv = document.createElement('canvas');
const blurCtx = blurCv.getContext('2d');

let state = 'menu';
let hitStop = 0;
let time = 0;
let playTime = 0;
let skillCd = 0;
let deathShown = false;
let autosave = 5;

/** Сколько ДНК нужно до следующего уровня роста. */
function need(level) { return 45 + level * 45; }

// ---------- События мира ----------
world.onEat = (value, x, y, meat) => {
  if (state !== 'play') return;
  const gain = Math.round(value * (meat ? 1.4 : 1));
  player.dna += gain;
  particles.text('+' + gain, x, y - 12, meat ? 12 : 140);
  audio.eat();
  particles.burst(x, y, 5, meat ? 12 : 140, 90, 2);
  if (player.dna >= need(player.level) && player.level < 5) levelUp();
};

world.onHit = (kind, x, y, power) => {
  hitStop = kind === 'hurt' ? 0.06 : 0.045;
  if (kind === 'bite') audio.bite();
  if (kind === 'hurt') {
    audio.hurt();
    cam.shake = Math.min(1, 0.5 + power * 0.1);
    vibrate(35);
  }
};

function vibrate(pattern) {
  if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) { /* iOS может игнорировать */ } }
}

// ---------- Состояния ----------
// Имя состояния -> id секции экрана.
const SCREEN_OF = { editor: 'editorUI', dead: 'death', menu: 'menu', pause: 'pause', levelup: 'levelup' };

function setState(s) {
  state = s;
  ui.show(SCREEN_OF[s] || null);
  // «Продолжить» доступно, только если есть валидное сохранение.
  if (s === 'menu') {
    const btn = document.getElementById('btnContinue');
    if (btn) btn.disabled = !Save.hasSave();
  }
}

/** Старт партии из конфигурации (новая игра или загруженное сохранение). */
function startGame(cfg, level = 1, dna = 0, x = 0, y = 0, elapsed = 0) {
  player.cfg = cfg;
  player.stats = computeStats(cfg);
  player.morph = null;
  player.x = x; player.y = y; player.px = x; player.py = y;
  player.angle = 0; player.speed = 0;
  player.body = buildBody(cfg, x, y, 0);
  player.body.spine.place(x, y, 0);
  Object.assign(player, {
    dna, level, dead: false, dyingT: -1, invuln: 1.2,
    stamina: 1, attackCd: 0, hp: player.stats.maxHp,
  });
  player._fadeStep = undefined;
  world.reset();
  world.maxCreatures = 16 + (level - 1) * 2;
  world.populate(x, y);
  particles.clear();
  playTime = elapsed;
  deathShown = false;
  cam.x = x; cam.y = y;
  setState('play');
  saveNow();
}

function newGame() {
  Save.clear();
  startGame(defaultConfig((Math.random() * 1e9) | 0));
}

function continueGame() {
  const d = Save.load();
  if (!d) { newGame(); return; }
  i18n.set(d.lang);
  input.mode = d.mode;
  startGame(d.cfg, d.level, d.dna, d.x, d.y, d.time);
}

/** Сохранение состояния одним JSON-ключом. */
function saveNow() {
  Save.save({
    cfg: player.cfg, level: player.level, dna: player.dna,
    x: player.x, y: player.y, lang: i18n.lang, mode: input.mode,
    sound: audio.enabled, time: playTime,
  });
}

function levelUp() {
  player.level++;
  player.dna = Math.max(0, player.dna - need(player.level - 1));
  vibrate([25, 40, 45]);
  // Снимок берём до вспышки — иначе застывший эффект попадёт в размытый фон.
  document.getElementById('luLevel').textContent = player.level;
  audio.evolve();
  saveNow();
  snapshotBlur();
  setState('levelup');
}

/** Открыть редактор с телом, увеличенным под новый уровень. */
function openEditor() {
  const cfg = JSON.parse(JSON.stringify(player.cfg));
  cfg.halfWidth *= 1.14;
  cfg.segLen *= 1.06;
  cfg.segCount = Math.min(14, cfg.segCount + 1);
  editor.start(cfg, player.dna + configCost(player.cfg), player.level, null);
  ui.setEditorDna(editor.dna - configCost(editor.cfg));
  snapshotBlur();
  setState('editor');
}

function closeEditor() {
  const spent = configCost(editor.cfg) - configCost(player.cfg);
  player.dna = Math.max(0, player.dna - Math.max(0, spent));
  player.applyConfig(editor.cfg);
  world.maxCreatures = 16 + player.level * 2;
  // Вспышка света в момент самого превращения.
  particles.ring(player.x, player.y, player.body.pal.h, player.body.halfWidth * 1.5, 0.8);
  particles.ring(player.x, player.y, 60, player.body.halfWidth * 0.9, 0.55);
  particles.burst(player.x, player.y, 26, player.body.pal.h, 210, 3.2);
  bg.disturb(player.x, player.y, 1.4);
  editor.open = false;
  audio.evolve();
  setState('play');
  saveNow();
}

/** Снимок экрана в маленький буфер — при апскейле даёт мягкое размытие. */
function snapshotBlur() {
  const w = Math.max(1, Math.round(W / 8)), h = Math.max(1, Math.round(H / 8));
  if (blurCv.width !== w) { blurCv.width = w; blurCv.height = h; }
  blurCtx.drawImage(canvas, 0, 0, w, h);
}

// ---------- Ресайз ----------
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  bg.resize(W, H, DPR);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));
resize();

const touchWorld = { x: 0, y: 0 };
function screenToWorld(sx, sy, out) {
  out.x = cam.x + (sx - W / 2) / cam.zoom;
  out.y = cam.y + (sy - H / 2) / cam.zoom;
  return out;
}

// ---------- Шаг симуляции ----------
function fixedUpdate(dt) {
  time += dt;

  if (state === 'editor') {
    editor.update(dt, input, W, H);
    ui.setEditorDna(Math.max(0, editor.dna - configCost(editor.cfg)));
    return;
  }
  if (state === 'pause' || state === 'levelup') return;

  const playing = state === 'play';
  if (playing) playTime += dt;

  if (player.dead) {
    if (player.dyingT < 0.02) audio.death();
    player.updateDying(dt);
    if (player.dyingT > 1.6 && !deathShown && playing) {
      deathShown = true;
      ui.setDeathStats(player.level, player.dna, playTime);
      saveNow();
      snapshotBlur();
      setState('dead');
    }
  } else {
    let target = null;
    if (playing && input.active) {
      if (input.mode === 'joystick') {
        const s = input.stick;
        touchWorld.x = player.x + s.dx * 220 * s.mag;
        touchWorld.y = player.y + s.dy * 220 * s.mag;
      } else {
        screenToWorld(input.x, input.y, touchWorld);
      }
      target = touchWorld;
      player.body.lookX = touchWorld.x;
      player.body.lookY = touchWorld.y;
    } else {
      player.body.lookX = undefined;
      player.body.lookY = undefined;
    }

    player.update(dt, target, playing && input.boost);
    audio.boost(player.boosting);

    if (player.boosting && player.speed > 40 && Math.random() < dt * 40) {
      const sp = player.body.spine, i = sp.n - 1;
      particles.trail(sp.rx[i], sp.ry[i],
        -Math.cos(player.angle) * 30 + (Math.random() - 0.5) * 30,
        -Math.sin(player.angle) * 30 + (Math.random() - 0.5) * 30);
    }
  }

  if (skillCd > 0) skillCd = Math.max(0, skillCd - dt);
  if (playing && !player.dead) {
    autosave -= dt;
    if (autosave <= 0) { autosave = 5; saveNow(); }
  }
  bg.update(dt, player.dead ? null : player);
  world.update(dt, cam);
  particles.update(dt, bg);

  const lead = 0.2;
  cam.x = lerp(cam.x, player.x + Math.cos(player.angle) * player.speed * lead, damp(3.4, dt));
  cam.y = lerp(cam.y, player.y + Math.sin(player.angle) * player.speed * lead, damp(3.4, dt));
  const zoomFit = clamp(15 / player.body.halfWidth, 0.5, 1.15);
  const targetZoom = zoomFit * (1 - player.body.speed01 * 0.10 - (player.boosting ? 0.05 : 0));
  cam.zoom = lerp(cam.zoom, targetZoom, damp(2.2, dt));
  if (cam.shake > 0) cam.shake = Math.max(0, cam.shake - dt * 2.6);
}

function respawn() {
  const cfg = player.cfg;
  player.dead = false;
  player.dyingT = -1;
  player.hp = player.stats.maxHp;
  player.invuln = 1.4;
  player.speed = 0;
  player.body.alpha = 1;
  player.body.pal = buildPalette(player.body.pal.params, 0);
  player._fadeStep = undefined;
  player.body.spine.soft = 0;
  player.body.spine.relax = 0.94;
  player.x = 0; player.y = 0;
  player.body.spine.place(0, 0, player.angle);
  player.dna = Math.max(0, player.dna - 20);
  deathShown = false;
  world.reset();
  world.populate(0, 0);
  particles.clear();
  particles.ring(0, 0, player.body.pal.h, 40, 0.6);
  setState('play');
}

/** Спецорган: ядовитое облако или электроразряд по площади. */
function useSkill() {
  if (skillCd > 0 || player.dead || state !== 'play') return;
  const has = player.body.parts.find((p) => p.type === PART.POISON || p.type === PART.ELECTRO);
  if (!has) return;
  skillCd = 6;
  has.charge = 1;
  const electro = has.type === PART.ELECTRO;
  audio.skill(electro);
  const R = electro ? 150 : 110;
  for (const c of world.creatures) {
    if (!c.alive || c.dying >= 0) continue;
    if (Math.hypot(c.x - player.x, c.y - player.y) < R) {
      c.hurt(player.stats.dmg * (electro ? 1.4 : 1.1), player.x, player.y, world);
    }
  }
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * TAU, d = Math.random() * R;
    particles.spawn(electro ? P.SPARK : P.GOO,
      player.x + Math.cos(a) * d, player.y + Math.sin(a) * d,
      Math.cos(a) * 40, Math.sin(a) * 40, 0.7, electro ? 3 : 6,
      electro ? 196 : 96, 1.6);
  }
  particles.ring(player.x, player.y, electro ? 196 : 96, R * 0.5, 0.45);
  bg.disturb(player.x, player.y, 1.2);
  vibrate(20);
}

// ---------- Отрисовка ----------
function updateView() {
  const hw = W / 2 / cam.zoom + 60, hh = H / 2 / cam.zoom + 60;
  view.x0 = cam.x - hw; view.x1 = cam.x + hw;
  view.y0 = cam.y - hh; view.y1 = cam.y + hh;
}

function renderWorld(alpha) {
  updateView();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  bg.drawFar(ctx, cam);

  const sh = cam.shake > 0 ? cam.shake * cam.shake * 14 : 0;
  ctx.save();
  ctx.translate(W / 2 + Math.sin(time * 71) * sh, H / 2 + Math.cos(time * 59) * sh);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);

  bg.drawNear(ctx, cam, view);
  world.drawFood(ctx, view, time);

  for (const c of world.creatures) {
    if (c.x < view.x0 || c.x > view.x1 || c.y < view.y0 || c.y > view.y1) continue;
    prepareRender(c.body, alpha);
    drawCreature(ctx, c.body, c.radius * cam.zoom < 9 ? 1 : 2);
  }

  // Размытие движения на ускорении: тело рисуется ещё раз с запаздыванием.
  if (player.boosting && player.body.speed01 > 0.5) {
    prepareRender(player.body, Math.max(0, alpha - 0.9));
    const a0 = player.body.alpha;
    player.body.alpha = 0.22;
    drawCreature(ctx, player.body, 0);
    player.body.alpha = a0;
  }

  prepareRender(player.body, alpha);
  const blink = player.invuln > 0 && !player.dead && Math.sin(time * 40) > 0;
  if (!player.dead) player.body.alpha = blink ? 0.55 : 1;
  drawCreature(ctx, player.body, 2);

  particles.draw(ctx, view);
  ctx.restore();

  drawJoystick();
}

/** Виртуальный джойстик рисуется в экранных координатах, когда включён режим. */
function drawJoystick() {
  if (input.mode !== 'joystick' || !input.stick.active || state !== 'play') return;
  const s = input.stick;
  const R = 46;
  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = 'hsl(186 80% 82%)';
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(s.ox, s.oy, R, 0, TAU); ctx.stroke();
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = 'hsl(160 80% 60% / .55)';
  ctx.beginPath();
  ctx.arc(s.ox + s.dx * R * s.mag, s.oy + s.dy * R * s.mag, 17, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function render(alpha) {
  if (state === 'editor') {
    // Замороженный размытый мир за спиной.
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(blurCv, 0, 0, W, H);
    editor.draw(ctx, W, H, alpha);
    return;
  }
  renderWorld(alpha);
}

// ---------- Кнопки ----------
const $ = (id) => document.getElementById(id);

$('btnNew').addEventListener('click', newGame);
$('btnContinue').addEventListener('click', continueGame);
$('btnSound').addEventListener('click', (e) => {
  audio.unlock();
  const on = audio.toggle();
  e.currentTarget.textContent = on ? '♪' : '♪̸';
  e.currentTarget.classList.toggle('on', on);
  Save.saveSettings({ sound: on });
});
$('btnPause').addEventListener('click', () => { snapshotBlur(); setState('pause'); });
$('btnResume').addEventListener('click', () => setState('play'));
$('btnToMenu').addEventListener('click', () => setState('menu'));
$('btnRespawn').addEventListener('click', respawn);
$('btnDeathMenu').addEventListener('click', () => setState('menu'));
$('btnEditor').addEventListener('click', openEditor);
$('btnSkill').addEventListener('click', useSkill);
$('btnLang').addEventListener('click', (e) => {
  e.currentTarget.textContent = i18n.toggle().toUpperCase();
  $('ctrlVal').textContent = i18n.t(input.mode === 'follow' ? 'ctrlFollow' : 'ctrlStick');
  Save.saveSettings({ lang: i18n.lang });
});
$('btnCtrl').addEventListener('click', () => {
  input.mode = input.mode === 'follow' ? 'joystick' : 'follow';
  $('ctrlVal').textContent = i18n.t(input.mode === 'follow' ? 'ctrlFollow' : 'ctrlStick');
  Save.saveSettings({ mode: input.mode });
});
$('edUndo').addEventListener('click', () => editor.undo());
$('edRandom').addEventListener('click', () => editor.randomize());
$('edSym').addEventListener('click', (e) => {
  editor.symmetry = !editor.symmetry;
  e.currentTarget.classList.toggle('on', editor.symmetry);
});
$('edPreview').addEventListener('click', () => { editor.preview = editor.preview > 0 ? 0 : 6; });
$('edDone').addEventListener('click', closeEditor);

// Клик по любой кнопке — короткий синтезированный отклик.
document.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => audio.ui()));

// --- Настройки и сохранение ---
const settings = Save.loadSettings();
if (settings.lang) i18n.set(settings.lang);
if (settings.mode) input.mode = settings.mode;
if (settings.sound === false) audio.enabled = false;
i18n.apply();
$('btnLang').textContent = i18n.lang.toUpperCase();
$('ctrlVal').textContent = i18n.t(input.mode === 'follow' ? 'ctrlFollow' : 'ctrlStick');
$('btnSound').textContent = audio.enabled ? '♪' : '♪̸';
$('btnContinue').disabled = !Save.hasSave();

// Сворачивание приложения: пауза и сохранение.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    audio.boost(false);
    if (state === 'play') { saveNow(); snapshotBlur(); setState('pause'); }
  }
});
window.addEventListener('pagehide', () => { if (state === 'play') saveNow(); });

// --- PWA: иконки генерируются кодом, service worker кэширует оболочку ---
installIcons('./manifest.json');
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* офлайн необязателен */ });
  });
}

// ---------- Цикл ----------
let last = performance.now() / 1000;
let acc = 0, fpsAcc = 0, fpsFrames = 0, lowFps = 0;

function frame(nowMs) {
  requestAnimationFrame(frame);
  const now = nowMs / 1000;
  let dt = now - last;
  last = now;
  if (dt > MAX_FRAME) dt = MAX_FRAME;

  if (hitStop > 0) {
    hitStop -= dt;
  } else {
    acc += dt;
    let guard = 5;
    while (acc >= STEP && guard-- > 0) { fixedUpdate(STEP); acc -= STEP; }
  }

  render(acc / STEP);

  if (state === 'menu') ui.drawLogo(time, player.body.pal);

  fpsAcc += dt; fpsFrames++;
  if (fpsAcc >= 0.5) {
    const fps = fpsFrames / fpsAcc;
    ui.setFps(fps);
    if (fps < 50) {
      if (++lowFps >= 2) {
        particles.setLimit(particles.limit * 0.75);
        bg.quality = Math.max(0.2, bg.quality - 0.25);
        lowFps = 0;
      }
    } else if (fps > 57) {
      // Восстанавливаем качество, когда запас производительности вернулся.
      lowFps = 0;
      particles.setLimit(Math.min(particles.max, particles.limit * 1.06));
      bg.quality = Math.min(1, bg.quality + 0.05);
    }
    fpsAcc = 0; fpsFrames = 0;
    ui.setHud(player, need(player.level));
    // Кнопка спецоргана видна, только если орган есть.
    const skillBtn = $('btnSkill');
    if (skillBtn) {
      const has = player.body.parts.some((p) => p.type === PART.POISON || p.type === PART.ELECTRO);
      skillBtn.style.display = has ? '' : 'none';
    }
    ui.drawMinimap(player, world);
    const ring = $('skillRing');
    if (ring) ring.style.setProperty('--cd', (1 - skillCd / 6).toFixed(2));
  }
}
requestAnimationFrame(frame);

// Отладочный доступ из консоли.
window.__game = { player, world, bg, particles, cam, editor, ui, setState, levelUp, openEditor };
