// parts.js — каталог частей организма. Каждая часть рисуется процедурно
// и имеет параметры (размер, поворот, изгиб), которые правит редактор.

import { Spine } from './spine.js';
import { clamp, lerp, lerpAngle, wrapAngle, damp, TAU, makeRng } from './rng.js';
import { drawTaperChain, catmullClosed, drawBody } from './render.js';

export const PART = {
  MOUTH_HERB: 'mouth_herb',
  MOUTH_CARN: 'mouth_carn',
  MOUTH_OMNI: 'mouth_omni',
  EYE: 'eye',
  FLAGELLUM: 'flagellum',
  FIN: 'fin',
  SPIKE: 'spike',
  POISON: 'poison',
  ELECTRO: 'electro',
  ARMOR: 'armor',
};

/** Каталог: стоимость в ДНК, слой отрисовки, вклад в статы. */
export const CATALOG = {
  [PART.MOUTH_HERB]: { cost: 0, layer: 'front', stats: { herb: 3, dmg: 1 } },
  [PART.MOUTH_CARN]: { cost: 12, layer: 'front', stats: { carn: 3, dmg: 6 } },
  [PART.MOUTH_OMNI]: { cost: 20, layer: 'front', stats: { herb: 2, carn: 2, dmg: 4 } },
  [PART.EYE]:        { cost: 4,  layer: 'front', stats: { sense: 3, turn: 0.4 } },
  [PART.FLAGELLUM]:  { cost: 8,  layer: 'back',  stats: { speed: 6, turn: 1 } },
  [PART.FIN]:        { cost: 10, layer: 'back',  stats: { speed: 3, turn: 3 } },
  [PART.SPIKE]:      { cost: 14, layer: 'front', stats: { dmg: 5, def: 1 } },
  [PART.POISON]:     { cost: 22, layer: 'front', stats: { dmg: 3, def: 2 } },
  [PART.ELECTRO]:    { cost: 26, layer: 'front', stats: { dmg: 4, def: 1 } },
  [PART.ARMOR]:      { cost: 16, layer: 'front', stats: { def: 7, speed: -2 } },
};

const TMP = [0, 0, 0];
const BUF = new Float32Array(128);

/**
 * Создание части. t — положение вдоль позвоночника (0 нос, 1 хвост),
 * side — -1 слева / +1 справа / 0 по оси.
 */
export function createPart(type, { t = 0.5, side = 1, size = 1, rot = 0, seed = 1 } = {}) {
  const p = {
    type, t, side, size, rot, seed,
    phase: (seed % 100) / 100 * TAU,
    // Рантайм-состояние
    chain: null,
    look: 0, lookY: 0,     // зрачок
    blink: 0, blinkNext: 1 + (seed % 40) / 10,
    open: 0,               // раскрытие рта
    charge: 0,             // заряд спецоргана
    spring: 0, springV: 0, // пружинка установки в редакторе
  };
  if (type === PART.FLAGELLUM) {
    p.chain = new Spine({
      count: 9,
      segLen: (i, n) => 7 * size * (1 - i / n * 0.45),
      bend: 0.6,
      follow: (i, n) => 0.42 - 0.22 * (i / n),   // кончик отстаёт сильнее — хлыст
    });
  }
  return p;
}

/** Мировая точка крепления части. Пишет в out = [x,y,angle]. */
const ANCHOR_K = {
  [PART.EYE]: 0.55,        // глаз сидит внутри силуэта, а не на кромке
  [PART.POISON]: 0.4,
  [PART.ELECTRO]: 0.4,
  [PART.ARMOR]: 0,
};

export function anchor(part, body, out) {
  body.spine.sample(part.t, out);
  const hw = body.halfWidth * body.profile.at(part.t) * (body.breathe || 1);
  const k = ANCHOR_K[part.type] ?? 0.9;
  const a = out[2];
  out[0] += -Math.sin(a) * hw * part.side * k;
  out[1] += Math.cos(a) * hw * part.side * k;
  return out;
}

/** Обновление «живых» частей: жгутики, зрачки, моргание, рты. */
export function updatePart(part, body, dt, time) {
  // Пружина установки (редактор): затухающие колебания масштаба.
  if (part.spring !== 0 || part.springV !== 0) {
    part.springV += -part.spring * 220 * dt;
    part.springV *= Math.exp(-9 * dt);
    part.spring += part.springV * dt;
    if (Math.abs(part.spring) < 0.002 && Math.abs(part.springV) < 0.02) { part.spring = 0; part.springV = 0; }
  }

  switch (part.type) {
    case PART.FLAGELLUM: {
      anchor(part, body, TMP);
      const ch = part.chain;
      if (!ch.ready) { ch.place(TMP[0], TMP[1], TMP[2]); ch.ready = true; }
      ch.savePrev();
      // Гребок: направление основания качается синусоидой, сила растёт со скоростью.
      const beat = Math.sin(time * (4 + body.speed01 * 9) + part.phase);
      const base = TMP[2] + part.rot * part.side + beat * (0.28 + body.speed01 * 0.4) * part.side;
      ch.solve(TMP[0], TMP[1], base);
      ch.advanceWave(dt, body.speed01 * 0.8 + 0.25);
      break;
    }
    case PART.EYE: {
      // Зрачок с инерцией тянется к цели взгляда, иначе — по направлению движения.
      anchor(part, body, TMP);
      let dx, dy;
      if (body.lookX !== undefined) { dx = body.lookX - TMP[0]; dy = body.lookY - TMP[1]; }
      else { dx = Math.cos(TMP[2]); dy = Math.sin(TMP[2]); }
      const len = Math.hypot(dx, dy) || 1;
      const local = wrapAngle(Math.atan2(dy, dx) - TMP[2]);
      const k = damp(9, dt);
      part.look = lerp(part.look, clamp(Math.cos(local) * 1.0, -1, 1) * clamp(len / 60, 0.25, 1), k);
      part.lookY = lerp(part.lookY, clamp(Math.sin(local), -1, 1) * clamp(len / 60, 0.25, 1), k);
      // Моргание.
      part.blinkNext -= dt;
      if (part.blinkNext <= 0) { part.blink = 0.18; part.blinkNext = 2.4 + Math.random() * 4.5; }
      if (part.blink > 0) part.blink -= dt;
      break;
    }
    case PART.MOUTH_HERB: case PART.MOUTH_CARN: case PART.MOUTH_OMNI: {
      part.open = Math.max(0, part.open - dt * 3.2);
      break;
    }
    case PART.ELECTRO: case PART.POISON: {
      part.charge = Math.max(0, part.charge - dt * 2.2);
      break;
    }
  }
}

/** Отрисовка части заданного слоя ('back' — под телом, 'front' — поверх). */
export function drawPart(ctx, part, body, layer) {
  if (CATALOG[part.type].layer !== layer) return;
  const pal = body.pal;
  // Размер части зависит и от общей величины тела, и от толщины в точке крепления —
  // иначе рот на узком носу выглядит непропорционально огромным.
  const local = 0.45 + 0.55 * body.profile.at(part.t);
  const s = body.halfWidth * local * part.size * (1 + part.spring);

  switch (part.type) {
    case PART.FLAGELLUM:
      drawTaperChain(ctx, part.chain, s * 0.34, s * 0.07, pal.accent, pal.accentDeep, 0.95);
      break;

    case PART.FIN: drawFin(ctx, part, body, s); break;
    case PART.EYE: drawEye(ctx, part, body, s); break;
    case PART.SPIKE: drawSpike(ctx, part, body, s); break;
    case PART.ARMOR: drawArmor(ctx, part, body, s); break;
    case PART.POISON: drawGland(ctx, part, body, s, pal.glow); break;
    case PART.ELECTRO: drawElectro(ctx, part, body, s); break;
    default: drawMouth(ctx, part, body, s); break;
  }
}

// --- Отдельные рисовалки ---

/** Плавник: мембрана с рёбрами, волна идёт с запаздыванием относительно тела. */
function drawFin(ctx, part, body, s) {
  anchor(part, body, TMP);
  const [ax, ay, aa] = TMP;
  const dir = aa + (Math.PI / 2) * part.side + part.rot * part.side;
  const len = s * 2.0, span = s * 1.35;
  const ribs = 6;
  let c = 0;

  // Внешняя кромка: точки веером, каждая колеблется со сдвигом фазы (запаздывание).
  for (let i = 0; i < ribs; i++) {
    const t = i / (ribs - 1);
    const spread = (t - 0.5) * span;
    const wave = Math.sin(body.spine.phase * 0.85 - t * 2.1 + part.phase) *
                 s * (0.16 + body.speed01 * 0.4) * t;
    const l = len * (0.45 + 0.55 * Math.sin(t * Math.PI));
    const px = ax + Math.cos(dir) * l - Math.sin(dir) * (spread + wave);
    const py = ay + Math.sin(dir) * l + Math.cos(dir) * (spread + wave);
    BUF[c++] = px; BUF[c++] = py;
  }
  // Замыкаем на основание.
  BUF[c++] = ax - Math.sin(dir) * span * 0.35;
  BUF[c++] = ay + Math.cos(dir) * span * 0.35;
  BUF[c++] = ax + Math.sin(dir) * span * 0.35;
  BUF[c++] = ay - Math.cos(dir) * span * 0.35;

  ctx.save();
  catmullClosed(ctx, BUF, c >> 1, 0.85);
  const g = ctx.createLinearGradient(ax, ay, ax + Math.cos(dir) * len, ay + Math.sin(dir) * len);
  g.addColorStop(0, body.pal.membrane);
  g.addColorStop(0.45, body.pal.accent);
  g.addColorStop(1, body.pal.membrane);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = body.pal.rim;
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = Math.max(0.8, s * 0.06);
  ctx.stroke();
  ctx.restore();
}

/** Глаз: склера, радужка, зрачок с инерцией, блик, моргание. */
function drawEye(ctx, part, body, s) {
  anchor(part, body, TMP);
  const [ax, ay, aa] = TMP;
  const r = s * 0.52;
  const open = part.blink > 0 ? clamp(part.blink / 0.09 - 1, 0.06, 1) : 1;

  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(aa);
  ctx.scale(1, open);

  const g = ctx.createRadialGradient(-r * 0.25, -r * 0.25, r * 0.1, 0, 0, r);
  g.addColorStop(0, 'hsl(0 0% 100%)');
  g.addColorStop(1, 'hsl(210 20% 80%)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();

  ctx.strokeStyle = body.pal.ink;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = Math.max(0.7, r * 0.16);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Зрачок смещается внутри склеры.
  const px = part.look * r * 0.42, py = part.lookY * r * 0.42;
  ctx.fillStyle = body.pal.accentDeep;
  ctx.beginPath(); ctx.arc(px, py, r * 0.52, 0, TAU); ctx.fill();
  ctx.fillStyle = body.pal.ink;
  ctx.beginPath(); ctx.arc(px, py, r * 0.3, 0, TAU); ctx.fill();
  ctx.fillStyle = 'hsl(0 0% 100% / 0.85)';
  ctx.beginPath(); ctx.arc(px - r * 0.16, py - r * 0.18, r * 0.14, 0, TAU); ctx.fill();
  ctx.restore();
}

/** Рот: травоядный — мягкий с ресничками, хищный — с зубами. */
function drawMouth(ctx, part, body, s) {
  anchor(part, body, TMP);
  const [ax, ay, aa] = TMP;
  const carn = part.type === PART.MOUTH_CARN;
  const omni = part.type === PART.MOUTH_OMNI;
  const open = part.open;
  // Раскрытие: рот вытягивается поперёк и подаётся вперёд.
  const rw = s * (carn ? 0.92 : 0.78) * (1 + open * 0.35);
  const rh = s * (carn ? 0.62 : 0.58) * (0.6 + open * 0.7);

  ctx.save();
  ctx.translate(ax + Math.cos(aa) * s * 0.12, ay + Math.sin(aa) * s * 0.12);
  ctx.rotate(aa);

  // Губа — из цвета тела, чтобы рот «врастал» в организм, а не лежал кляксой.
  ctx.fillStyle = body.pal.mid;
  ctx.beginPath();
  ctx.ellipse(0, 0, rw * 1.2, rh * 1.24, 0, 0, TAU);
  ctx.fill();

  // Глотка: тёмная, но не чёрная — градиент внутрь.
  const g = ctx.createRadialGradient(rw * 0.2, 0, rh * 0.08, 0, 0, rw);
  g.addColorStop(0, 'hsl(350 55% 34%)');
  g.addColorStop(0.55, 'hsl(348 50% 20%)');
  g.addColorStop(1, 'hsl(348 45% 12%)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, rw, rh, 0, 0, TAU);
  ctx.fill();

  if (carn || omni) {
    // Зубы — треугольники по кромке, вершинами внутрь.
    const teeth = carn ? 8 : 5;
    ctx.fillStyle = 'hsl(45 25% 93%)';
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * TAU + 0.2;
      const cx = Math.cos(a) * rw, cy = Math.sin(a) * rh;
      const tl = s * (carn ? 0.2 : 0.13) * (0.6 + open * 0.8);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a + 0.45) * tl * 0.55, cy + Math.sin(a + 0.45) * tl * 0.55);
      ctx.lineTo(cx - Math.cos(a) * tl, cy - Math.sin(a) * tl);
      ctx.lineTo(cx + Math.cos(a - 0.45) * tl * 0.55, cy + Math.sin(a - 0.45) * tl * 0.55);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    // Реснички: тонкие, светлые, колышутся волной.
    ctx.strokeStyle = body.pal.light;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = Math.max(0.9, s * 0.075);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU;
      const w = Math.sin(body.spine.phase * 1.4 + i * 0.9) * 0.35;
      const cx = Math.cos(a) * rw * 1.05, cy = Math.sin(a) * rh * 1.05;
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a + w) * s * 0.19, cy + Math.sin(a + w) * s * 0.19);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Шип: конус наружу по нормали. */
function drawSpike(ctx, part, body, s) {
  anchor(part, body, TMP);
  const [ax, ay, aa] = TMP;
  const dir = aa + (Math.PI / 2) * part.side + part.rot * part.side;
  const len = s * 1.5, w = s * 0.3;
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(dir);
  const g = ctx.createLinearGradient(0, 0, len, 0);
  g.addColorStop(0, body.pal.accentDeep);
  g.addColorStop(1, 'hsl(40 25% 92%)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, -w);
  ctx.quadraticCurveTo(len * 0.6, -w * 0.35, len, 0);
  ctx.quadraticCurveTo(len * 0.6, w * 0.35, 0, w);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Броня: пластины дугами поперёк тела. */
function drawArmor(ctx, part, body, s) {
  const sp = body.spine;
  ctx.save();
  ctx.globalAlpha = 0.75;
  for (let k = 0; k < 3; k++) {
    const t = clamp(part.t + (k - 1) * 0.12, 0.05, 0.9);
    sp.sample(t, TMP);
    const hw = body.halfWidth * body.profile.at(t) * 1.02;
    ctx.save();
    ctx.translate(TMP[0], TMP[1]);
    ctx.rotate(TMP[2]);
    const g = ctx.createLinearGradient(0, -hw, 0, hw);
    g.addColorStop(0, body.pal.light);
    g.addColorStop(0.5, body.pal.accentDeep);
    g.addColorStop(1, body.pal.deep);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, hw * 0.34, hw, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

/** Ядовитая железа: пульсирующий пузырь со свечением. */
function drawGland(ctx, part, body, s, color) {
  anchor(part, body, TMP);
  const pulse = 1 + Math.sin(body.spine.phase * 0.6 + part.phase) * 0.08 + part.charge * 0.3;
  const r = s * 0.55 * pulse;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(TMP[0], TMP[1], r * 0.15, TMP[0], TMP[1], r * 2.2);
  g.addColorStop(0, color);
  g.addColorStop(1, 'transparent');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(TMP[0], TMP[1], r * 2.2, 0, TAU); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(TMP[0], TMP[1], r, 0, TAU); ctx.fill();
  ctx.restore();
}

/** Электро-орган: узел + процедурные разряды при заряде. */
function drawElectro(ctx, part, body, s) {
  anchor(part, body, TMP);
  const [ax, ay] = TMP;
  const r = s * 0.5;
  ctx.save();
  ctx.fillStyle = 'hsl(196 100% 72%)';
  ctx.beginPath(); ctx.arc(ax, ay, r, 0, TAU); ctx.fill();

  if (part.charge > 0.01) {
    const rng = makeRng((part.seed + Math.floor(body.spine.phase * 6)) | 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'hsl(190 100% 82%)';
    ctx.lineWidth = Math.max(1, s * 0.1);
    ctx.beginPath();
    for (let b = 0; b < 3; b++) {
      let a = rng.range(0, TAU), x = ax, y = ay;
      ctx.moveTo(x, y);
      for (let i = 0; i < 4; i++) {
        a += rng.range(-0.8, 0.8);
        x += Math.cos(a) * r * 1.3; y += Math.sin(a) * r * 1.3;
        ctx.lineTo(x, y);
      }
    }
    ctx.globalAlpha = part.charge;
    ctx.stroke();
  }
  ctx.restore();
}

/** Полная отрисовка существа: части сзади -> тело -> части спереди. */
export function drawCreature(ctx, body, detail = 2) {
  const parts = body.parts;
  for (let i = 0; i < parts.length; i++) drawPart(ctx, parts[i], body, 'back');
  drawBody(ctx, body, detail);
  for (let i = 0; i < parts.length; i++) drawPart(ctx, parts[i], body, 'front');
}
