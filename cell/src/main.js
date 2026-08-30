// main.js — игровой цикл: фиксированный шаг физики + интерполяция,
// hit-stop, тряска камеры, автоснижение качества при просадке FPS.

import { Input, lockViewport } from './input.js';
import { Player, defaultConfig, prepareRender } from './player.js';
import { drawCreature } from './parts.js';
import { Background } from './background.js';
import { Particles } from './particles.js';
import { World } from './spawner.js';
import { buildPalette } from './palette.js';
import { clamp, lerp, damp, TAU } from './rng.js';

const STEP = 1 / 60;
const MAX_FRAME = 0.25;
const SEED = 20260830;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
const hud = {
  fps: document.getElementById('fps'),
  hp: document.getElementById('hpFill'),
  dna: document.getElementById('dnaVal'),
  growth: document.getElementById('growthFill'),
  level: document.getElementById('levelVal'),
  stam: document.getElementById('stamFill'),
};

let W = 0, H = 0, DPR = 1;
const cam = { x: 0, y: 0, zoom: 1, shake: 0 };
const view = { x0: 0, y0: 0, x1: 0, y1: 0 };

const input = new Input(canvas);
lockViewport();

const bg = new Background(SEED);
const particles = new Particles(700);
const player = new Player(defaultConfig(4211), 0, 0);
const world = new World(SEED, bg, particles);
world.player = player;
world.populate(0, 0);

let hitStop = 0;
let time = 0;
let respawnT = -1;

world.onEat = (value, x, y, meat) => {
  const gain = Math.round(value * (meat ? 1.4 : 1));
  player.dna += gain;
  player.growth = clamp(player.dna / need(player.level), 0, 1);
  particles.text('+' + gain, x, y - 12, meat ? 12 : 140);
  particles.burst(x, y, 5, meat ? 12 : 140, 90, 2);
  if (player.growth >= 1) evolve();
};

world.onHit = (kind, x, y, power) => {
  hitStop = kind === 'hurt' ? 0.06 : 0.045;
  if (kind === 'hurt') {
    cam.shake = Math.min(1, 0.5 + power * 0.1);
    if (navigator.vibrate) { try { navigator.vibrate(35); } catch (e) { /* iOS может игнорировать */ } }
  }
};

/** Сколько ДНК нужно до следующего уровня роста. */
function need(level) { return 60 + level * 55; }

/** Эволюция: вспышка, рост тела, плавная интерполяция параметров. */
function evolve() {
  if (player.level >= 5) { player.dna = Math.min(player.dna, need(5)); return; }
  player.level++;
  player.dna = 0;
  player.growth = 0;

  const cfg = JSON.parse(JSON.stringify(player.cfg));
  cfg.halfWidth *= 1.16;
  cfg.segLen *= 1.08;
  cfg.segCount = Math.min(14, cfg.segCount + 1);
  player.applyConfig(cfg);

  particles.ring(player.x, player.y, player.body.pal.h, player.body.halfWidth * 1.4, 0.7);
  particles.ring(player.x, player.y, 60, player.body.halfWidth * 0.8, 0.5);
  particles.burst(player.x, player.y, 26, player.body.pal.h, 220, 3.4);
  bg.disturb(player.x, player.y, 1.4);
  world.maxCreatures = 16 + player.level * 2;
  if (navigator.vibrate) { try { navigator.vibrate([25, 40, 45]); } catch (e) { /* no-op */ } }
}

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

function fixedUpdate(dt) {
  time += dt;

  if (player.dead) {
    player.updateDying(dt);
    if (respawnT < 0) respawnT = 2.2;
    respawnT -= dt;
    if (respawnT <= 0) respawn();
  } else {
    let target = null;
    if (input.active) {
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

    player.update(dt, target, input.boost);

    // След пузырей при ускорении.
    if (player.boosting && player.speed > 40 && Math.random() < dt * 40) {
      const sp = player.body.spine, i = sp.n - 1;
      particles.trail(sp.rx[i], sp.ry[i],
        -Math.cos(player.angle) * 30 + (Math.random() - 0.5) * 30,
        -Math.sin(player.angle) * 30 + (Math.random() - 0.5) * 30);
    }
  }

  bg.update(dt, player.dead ? null : player);
  world.update(dt, cam);
  particles.update(dt, bg);

  // Камера: запаздывание + zoom-out на скорости.
  const lead = 0.2;
  cam.x = lerp(cam.x, player.x + Math.cos(player.angle) * player.speed * lead, damp(3.4, dt));
  cam.y = lerp(cam.y, player.y + Math.sin(player.angle) * player.speed * lead, damp(3.4, dt));
  const zoomFit = clamp(15 / player.body.halfWidth, 0.55, 1.15);
  const targetZoom = zoomFit * (1 - player.body.speed01 * 0.10 - (player.boosting ? 0.05 : 0));
  cam.zoom = lerp(cam.zoom, targetZoom, damp(2.2, dt));
  if (cam.shake > 0) cam.shake = Math.max(0, cam.shake - dt * 2.6);
}

function respawn() {
  respawnT = -1;
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
  world.reset();
  world.populate(0, 0);
  particles.ring(0, 0, player.body.pal.h, 40, 0.6);
}

function updateView() {
  const hw = W / 2 / cam.zoom + 60, hh = H / 2 / cam.zoom + 60;
  view.x0 = cam.x - hw; view.x1 = cam.x + hw;
  view.y0 = cam.y - hh; view.y1 = cam.y + hh;
}

function render(alpha) {
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
    // Дальние и мелкие существа рисуются упрощённо.
    drawCreature(ctx, c.body, c.radius * cam.zoom < 9 ? 1 : 2);
  }

  prepareRender(player.body, alpha);
  // Мигание неуязвимости.
  const blink = player.invuln > 0 && !player.dead && (Math.sin(time * 40) > 0);
  player.body.alpha = player.dead ? player.body.alpha : (blink ? 0.55 : 1);
  drawCreature(ctx, player.body, 2);

  particles.draw(ctx, view);
  ctx.restore();
}

function updateHud() {
  if (hud.hp) hud.hp.style.width = (clamp(player.hp / player.maxHp, 0, 1) * 100).toFixed(1) + '%';
  if (hud.stam) hud.stam.style.width = (player.stamina * 100).toFixed(1) + '%';
  if (hud.dna) hud.dna.textContent = player.dna | 0;
  if (hud.growth) hud.growth.style.width = (clamp(player.dna / need(player.level), 0, 1) * 100).toFixed(1) + '%';
  if (hud.level) hud.level.textContent = player.level;
}

// --- Цикл ---
let last = performance.now() / 1000;
let acc = 0, fpsAcc = 0, fpsFrames = 0, lowFps = 0;

function frame(nowMs) {
  requestAnimationFrame(frame);
  const now = nowMs / 1000;
  let dt = now - last;
  last = now;
  if (dt > MAX_FRAME) dt = MAX_FRAME;

  if (hitStop > 0) {
    hitStop -= dt;              // кадр «замирает» на 40–60 мс при ударе
  } else {
    acc += dt;
    let guard = 5;
    while (acc >= STEP && guard-- > 0) { fixedUpdate(STEP); acc -= STEP; }
  }

  render(acc / STEP);

  fpsAcc += dt; fpsFrames++;
  if (fpsAcc >= 0.5) {
    const fps = fpsFrames / fpsAcc;
    if (hud.fps) hud.fps.textContent = Math.round(fps) + ' FPS';
    // Автоснижение нагрузки: меньше частиц, проще каустика.
    if (fps < 50) {
      lowFps++;
      if (lowFps >= 2) {
        particles.setLimit(particles.limit * 0.75);
        bg.quality = Math.max(0.2, bg.quality - 0.25);
        lowFps = 0;
      }
    } else if (fps > 58) {
      lowFps = 0;
      particles.setLimit(Math.min(particles.max, particles.limit * 1.05));
    }
    fpsAcc = 0; fpsFrames = 0;
    updateHud();
  }
}
requestAnimationFrame(frame);

// Отладочная кнопка: мгновенная эволюция.
document.getElementById('reroll')?.addEventListener('click', evolve);

// Отладочный доступ из консоли (не влияет на игру).
window.__game = { player, world, bg, particles, cam, evolve };
