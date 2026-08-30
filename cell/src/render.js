// render.js — отрисовка тела: обводка сплайном по левым и правым точкам
// сегментов, объём градиентами, эффекты (урон, свечение, растворение).
// Никаких спрайтов: всё — путь и заливка.

import { clamp, lerp, TAU } from './rng.js';

// --- Служебные буферы: переиспользуются, чтобы не мусорить в игровом цикле ---
const SCRATCH = new Float32Array(512);
const SCRATCH2 = new Float32Array(512);
const TMP = [0, 0, 0];

/**
 * Проводит замкнутый catmull-rom сплайн через точки pts (плоский массив x,y)
 * и превращает его в кубические кривые Безье. Тело выходит гладким.
 */
export function catmullClosed(ctx, pts, count, tension = 1) {
  if (count < 3) return;
  const k = tension / 6;
  const gx = (i) => pts[(((i % count) + count) % count) * 2];
  const gy = (i) => pts[(((i % count) + count) % count) * 2 + 1];

  ctx.beginPath();
  ctx.moveTo(gx(0), gy(0));
  for (let i = 0; i < count; i++) {
    const x0 = gx(i - 1), y0 = gy(i - 1);
    const x1 = gx(i), y1 = gy(i);
    const x2 = gx(i + 1), y2 = gy(i + 1);
    const x3 = gx(i + 2), y3 = gy(i + 2);
    ctx.bezierCurveTo(
      x1 + (x2 - x0) * k, y1 + (y2 - y0) * k,
      x2 - (x3 - x1) * k, y2 - (y3 - y1) * k,
      x2, y2
    );
  }
  ctx.closePath();
}

/** Незамкнутый catmull-rom — для плавников и мембран. */
export function catmullOpen(ctx, pts, count, tension = 1, moveTo = true) {
  if (count < 2) return;
  const k = tension / 6;
  const gx = (i) => pts[clamp(i, 0, count - 1) * 2];
  const gy = (i) => pts[clamp(i, 0, count - 1) * 2 + 1];
  if (moveTo) { ctx.beginPath(); ctx.moveTo(gx(0), gy(0)); }
  for (let i = 0; i < count - 1; i++) {
    const x0 = gx(i - 1), y0 = gy(i - 1);
    const x1 = gx(i), y1 = gy(i);
    const x2 = gx(i + 1), y2 = gy(i + 1);
    const x3 = gx(i + 2), y3 = gy(i + 2);
    ctx.bezierCurveTo(
      x1 + (x2 - x0) * k, y1 + (y2 - y0) * k,
      x2 - (x3 - x1) * k, y2 - (y3 - y1) * k,
      x2, y2
    );
  }
}

/**
 * Строит контур тела вокруг позвоночника: нос, правый борт, хвост, левый борт.
 * @returns число точек, записанных в out (плоский массив x,y)
 */
export function buildOutline(spine, profile, halfWidth, out, squash = 1, bulge = 1) {
  const n = spine.n;
  const rx = spine.rx, ry = spine.ry, ra = spine.ra;
  let c = 0;

  const w = (i) => halfWidth * profile.at(i / (n - 1)) * bulge;

  // Нос: выносим точку вперёд по направлению головы.
  const w0 = w(0);
  out[c++] = rx[0] + Math.cos(ra[0]) * w0 * 0.95;
  out[c++] = ry[0] + Math.sin(ra[0]) * w0 * 0.95;

  // Правый борт (нормаль +).
  for (let i = 0; i < n; i++) {
    const ww = w(i) * squash;
    out[c++] = rx[i] - Math.sin(ra[i]) * ww;
    out[c++] = ry[i] + Math.cos(ra[i]) * ww;
  }

  // Хвостовой кончик.
  const wl = w(n - 1);
  out[c++] = rx[n - 1] - Math.cos(ra[n - 1]) * wl * 0.9;
  out[c++] = ry[n - 1] - Math.sin(ra[n - 1]) * wl * 0.9;

  // Левый борт (обратный ход).
  for (let i = n - 1; i >= 0; i--) {
    const ww = w(i) * squash;
    out[c++] = rx[i] + Math.sin(ra[i]) * ww;
    out[c++] = ry[i] - Math.cos(ra[i]) * ww;
  }

  return c >> 1;
}

/**
 * Полигон вдоль произвольной цепочки с сужением — жгутики, хвосты, усы.
 */
export function buildTaper(spine, w0, w1, out, power = 1.6) {
  const n = spine.n;
  const rx = spine.rx, ry = spine.ry, ra = spine.ra;
  let c = 0;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const w = lerp(w0, w1, Math.pow(t, power));
    out[c++] = rx[i] - Math.sin(ra[i]) * w;
    out[c++] = ry[i] + Math.cos(ra[i]) * w;
  }
  const wt = w1 * 0.6;
  out[c++] = rx[n - 1] - Math.cos(ra[n - 1]) * wt;
  out[c++] = ry[n - 1] - Math.sin(ra[n - 1]) * wt;
  for (let i = n - 1; i >= 0; i--) {
    const t = i / (n - 1);
    const w = lerp(w0, w1, Math.pow(t, power));
    out[c++] = rx[i] + Math.sin(ra[i]) * w;
    out[c++] = ry[i] - Math.cos(ra[i]) * w;
  }
  return c >> 1;
}

/** Тонированный градиент поперёк тела — даёт объём без всяких текстур. */
function bodyGradient(ctx, spine, halfWidth, pal, litSide) {
  const i = Math.floor(spine.n * 0.35);
  const a = spine.ra[i];
  const nx = -Math.sin(a) * litSide, ny = Math.cos(a) * litSide;
  const g = ctx.createLinearGradient(
    spine.rx[i] + nx * halfWidth * 1.4, spine.ry[i] + ny * halfWidth * 1.4,
    spine.rx[i] - nx * halfWidth * 1.6, spine.ry[i] - ny * halfWidth * 1.6
  );
  g.addColorStop(0, pal.light);
  g.addColorStop(0.42, pal.base);
  g.addColorStop(1, pal.deep);
  return g;
}

/**
 * Полная отрисовка тела существа.
 * body: { spine, profile, halfWidth, pal, breathe, squash, flash, alpha, seed }
 */
export function drawBody(ctx, body, detail = 2) {
  const { spine, profile, pal } = body;
  const hw = body.halfWidth * (body.breathe || 1);
  const count = buildOutline(spine, profile, hw, SCRATCH, body.squash || 1, body.bulge || 1);

  ctx.save();
  if (body.alpha !== undefined && body.alpha < 1) ctx.globalAlpha = body.alpha;

  // 1. Мягкое свечение под телом (дёшево: один радиальный градиент).
  if (detail >= 2) {
    const cx = spine.rx[1], cy = spine.ry[1];
    const r = hw * 3.2;
    const g = ctx.createRadialGradient(cx, cy, hw * 0.3, cx, cy, r);
    g.addColorStop(0, pal.membrane);
    g.addColorStop(1, 'transparent');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  // 2. Основное тело.
  catmullClosed(ctx, SCRATCH, count);
  ctx.fillStyle = detail >= 1 ? bodyGradient(ctx, spine, hw, pal, body.litSide || 1) : pal.base;
  ctx.fill();

  // 3. Внутренняя мембрана — «просвечивающая» цитоплазма.
  if (detail >= 1) {
    const c2 = buildOutline(spine, profile, hw * 0.62, SCRATCH2, body.squash || 1, body.bulge || 1);
    catmullClosed(ctx, SCRATCH2, c2);
    ctx.fillStyle = pal.membrane;
    ctx.fill();
  }

  // 4. Ядро.
  if (detail >= 2) {
    spine.sample(0.45, TMP);
    const nr = hw * 0.42;
    const g = ctx.createRadialGradient(TMP[0] - nr * 0.3, TMP[1] - nr * 0.3, nr * 0.1, TMP[0], TMP[1], nr);
    g.addColorStop(0, pal.light);
    g.addColorStop(0.55, pal.accent);
    g.addColorStop(1, pal.accentDeep);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(TMP[0], TMP[1], nr, nr * 0.82, TMP[2], 0, TAU);
    ctx.fill();
  }

  // 5. Контур и блик по верхней кромке.
  catmullClosed(ctx, SCRATCH, count);
  ctx.strokeStyle = pal.ink;
  ctx.globalAlpha = (body.alpha ?? 1) * 0.35;
  ctx.lineWidth = Math.max(1, hw * 0.09);
  ctx.stroke();
  ctx.globalAlpha = body.alpha ?? 1;

  if (detail >= 2) {
    // Блик — короткая дуга вдоль спины со смещением к освещённой стороне.
    const n = spine.n, lit = body.litSide || 1;
    let c = 0;
    for (let i = 0; i < n - 2; i++) {
      const w = hw * profile.at(i / (n - 1)) * 0.66;
      SCRATCH2[c++] = spine.rx[i] - Math.sin(spine.ra[i]) * w * lit;
      SCRATCH2[c++] = spine.ry[i] + Math.cos(spine.ra[i]) * w * lit;
    }
    ctx.strokeStyle = pal.rim;
    ctx.lineWidth = Math.max(1, hw * 0.16);
    ctx.lineCap = 'round';
    catmullOpen(ctx, SCRATCH2, c >> 1);
    ctx.stroke();
  }

  // 6. Вспышка урона поверх силуэта.
  if (body.flash > 0.001) {
    catmullClosed(ctx, SCRATCH, count);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = clamp(body.flash, 0, 1) * 0.85;
    ctx.fillStyle = 'hsl(0 90% 62%)';
    ctx.fill();
  }

  ctx.restore();
}

/** Отрисовка хвоста/жгутика по цепочке с сужением. */
export function drawTaperChain(ctx, spine, w0, w1, fill, stroke, alpha = 1) {
  const c = buildTaper(spine, w0, w1, SCRATCH);
  ctx.save();
  ctx.globalAlpha = alpha;
  catmullClosed(ctx, SCRATCH, c, 0.9);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.globalAlpha = alpha * 0.4;
    ctx.lineWidth = Math.max(0.8, w0 * 0.35);
    ctx.stroke();
  }
  ctx.restore();
}

/** Круговой индикатор (кулдаун, прогресс) — рисуется, а не картинка. */
export function drawRing(ctx, x, y, r, t, color, width = 3) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(t, 0, 1));
  ctx.stroke();
  ctx.restore();
}
