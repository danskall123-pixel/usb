// main.js — игровой цикл с фиксированным шагом физики и интерполяцией
// при отрисовке. Шаг 2: живая демка — существо плывёт за пальцем.

import { Input, lockViewport } from './input.js';
import { Player, defaultConfig, randomConfig, buildBody, spineStep, prepareRender, updateBodyParts } from './player.js';
import { drawCreature } from './parts.js';
import { scenePalette } from './palette.js';
import { noise } from './noise.js';
import { clamp, lerp, lerpAngle, damp, makeRng, TAU } from './rng.js';

const STEP = 1 / 60;          // шаг физики
const MAX_FRAME = 0.25;       // защита от «прыжка» после сворачивания вкладки

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
const fpsEl = document.getElementById('fps');

let W = 0, H = 0, DPR = 1;
let bgGrad = null;

const scene = scenePalette(20260830, 0);
const cam = { x: 0, y: 0, zoom: 1, shake: 0 };
const input = new Input(canvas);
lockViewport();

const player = new Player(defaultConfig(4211), 0, 0);

// Пара соседей — проверяем, что генерация из seed даёт разных существ.
const neighbours = [];
for (let i = 0; i < 3; i++) {
  const seed = 1000 + i * 7919;
  const rng = makeRng(seed);
  const body = buildBody(randomConfig(seed), rng.range(-300, 300), rng.range(-260, 260), rng.range(0, TAU));
  neighbours.push({ body, x: body.x, y: body.y, angle: body.angle, speed: 0, t: rng.range(0, 100), seed });
}

// Взвесь для ощущения глубины (полноценный фон — в background.js на шаге 3).
const DUST = 220;
const dust = new Float32Array(DUST * 3);
{
  const rng = makeRng(7);
  for (let i = 0; i < DUST; i++) {
    dust[i * 3] = rng.range(-1200, 1200);
    dust[i * 3 + 1] = rng.range(-1200, 1200);
    dust[i * 3 + 2] = rng.range(0.4, 1.6);
  }
}

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  bgGrad = ctx.createLinearGradient(0, 0, 0, H * DPR);
  bgGrad.addColorStop(0, scene.top);
  bgGrad.addColorStop(0.55, scene.surface);
  bgGrad.addColorStop(1, scene.bottom);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));
resize();

/** Экранные координаты (CSS-пиксели) -> мировые. */
function screenToWorld(sx, sy, out) {
  out.x = cam.x + (sx - W / 2) / cam.zoom;
  out.y = cam.y + (sy - H / 2) / cam.zoom;
  return out;
}

const touchWorld = { x: 0, y: 0 };
let hasTarget = false;
let time = 0;

function fixedUpdate(dt) {
  time += dt;

  // Цель движения: точка касания в мире.
  if (input.active) {
    if (input.mode === 'joystick') {
      const s = input.stick;
      touchWorld.x = player.x + s.dx * 200 * s.mag;
      touchWorld.y = player.y + s.dy * 200 * s.mag;
    } else {
      screenToWorld(input.x, input.y, touchWorld);
    }
    hasTarget = true;
  } else {
    hasTarget = false;
  }

  player.update(dt, hasTarget ? touchWorld : null, input.boost);

  // Глаза следят за пальцем, иначе — за направлением движения.
  if (hasTarget) { player.body.lookX = touchWorld.x; player.body.lookY = touchWorld.y; }
  else { player.body.lookX = undefined; player.body.lookY = undefined; }

  // Соседи: неспешное блуждание по шуму (нормальный ИИ — на шаге 3).
  for (const n of neighbours) {
    n.t += dt;
    const want = noise.fbmS2(n.seed * 0.13, n.t * 0.12, 2) * Math.PI * 2;
    n.angle = lerpAngle(n.angle, want, damp(1.4, dt));
    n.speed = lerp(n.speed, 34 + Math.sin(n.t * 0.7) * 16, damp(1.2, dt));
    n.x += Math.cos(n.angle) * n.speed * dt;
    n.y += Math.sin(n.angle) * n.speed * dt;
    n.body.speed01 = clamp(n.speed / 110, 0, 1);
    n.body.breathe = 1 + Math.sin(n.t * TAU * 0.6) * 0.04;
    n.body.lookX = player.x; n.body.lookY = player.y;
    spineStep(n.body, n.x, n.y, n.angle, dt);
    updateBodyParts(n.body, dt, n.t);
  }

  // Камера: мягкое запаздывание + лёгкий zoom-out на ускорении.
  const lead = 0.18;
  cam.x = lerp(cam.x, player.x + Math.cos(player.angle) * player.speed * lead, damp(3.2, dt));
  cam.y = lerp(cam.y, player.y + Math.sin(player.angle) * player.speed * lead, damp(3.2, dt));
  const targetZoom = 1 - player.body.speed01 * 0.10 - (player.boosting ? 0.05 : 0);
  cam.zoom = lerp(cam.zoom, targetZoom, damp(2.4, dt));
  if (cam.shake > 0) cam.shake = Math.max(0, cam.shake - dt * 2.4);
}

function drawBackground() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W * DPR, H * DPR);

  // Лучи света сверху — простые полосы с мягкой анимацией.
  ctx.save();
  ctx.scale(DPR, DPR);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5; i++) {
    const p = i / 5;
    const sway = Math.sin(time * 0.25 + i * 1.7) * 40;
    const x = ((p * 1.4 - cam.x * 0.04 * 0.01) % 1 + 1) % 1 * (W + 260) - 130 + sway;
    const g = ctx.createLinearGradient(x, 0, x + 90, H);
    g.addColorStop(0, scene.ray);
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - 40, -10);
    ctx.lineTo(x + 60, -10);
    ctx.lineTo(x + 190, H + 10);
    ctx.lineTo(x + 30, H + 10);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawDust() {
  ctx.fillStyle = scene.dust;
  for (let i = 0; i < DUST; i++) {
    const d = dust[i * 3 + 2];
    // Параллакс: дальняя взвесь движется медленнее.
    const wx = dust[i * 3] + Math.sin(time * 0.4 + i) * 6;
    const wy = dust[i * 3 + 1] + Math.cos(time * 0.33 + i * 1.3) * 6;
    const sx = (wx - cam.x * d) * cam.zoom + W / 2;
    const sy = (wy - cam.y * d) * cam.zoom + H / 2;
    if (sx < -20 || sy < -20 || sx > W + 20 || sy > H + 20) continue;
    ctx.globalAlpha = 0.10 + d * 0.12;
    ctx.fillRect(sx, sy, d * 1.6, d * 1.6);
  }
  ctx.globalAlpha = 1;
}

function render(alpha) {
  drawBackground();

  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawDust();

  // Мировая система координат.
  const sh = cam.shake > 0 ? cam.shake * 10 : 0;
  ctx.translate(W / 2 + Math.sin(time * 57) * sh, H / 2 + Math.cos(time * 43) * sh);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);

  for (const n of neighbours) {
    prepareRender(n.body, alpha);
    drawCreature(ctx, n.body, 2);
  }

  prepareRender(player.body, alpha);
  drawCreature(ctx, player.body, 2);

  ctx.restore();
}

// --- Цикл ---
let last = performance.now() / 1000;
let acc = 0;
let fpsAcc = 0, fpsFrames = 0;

function frame(nowMs) {
  requestAnimationFrame(frame);
  const now = nowMs / 1000;
  let dt = now - last;
  last = now;
  if (dt > MAX_FRAME) dt = MAX_FRAME;

  acc += dt;
  let guard = 5;
  while (acc >= STEP && guard-- > 0) { fixedUpdate(STEP); acc -= STEP; }

  render(acc / STEP);

  fpsAcc += dt; fpsFrames++;
  if (fpsAcc >= 0.5) {
    if (fpsEl) fpsEl.textContent = Math.round(fpsFrames / fpsAcc) + ' FPS';
    fpsAcc = 0; fpsFrames = 0;
  }
}
requestAnimationFrame(frame);

// Кнопка «другое существо» — проверка процедурной генерации.
document.getElementById('reroll')?.addEventListener('click', () => {
  const seed = (Math.random() * 1e9) | 0;
  const nb = new Player(randomConfig(seed), player.x, player.y);
  nb.angle = player.angle;
  player.body = nb.body;
  player.body.spine.place(player.x, player.y, player.angle);
});
