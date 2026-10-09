// Слой «Частицы»: готовые атмосферные эффекты (снег, дождь, звёзды, конфетти…) без рисования.
// Всё детерминировано: у каждой частицы — псевдослучайные константы из хеша (seed),
// положение в момент t = кадр / fps считается аналитически с переносом внутри области.
// Поэтому перемотка, экспорт и циклы всегда дают одинаковую картинку.
import { app } from '../app.js';
import { h, M, clamp, hex2rgb } from '../util.js';
import { ch, evalCh, setKey } from '../anim.js';
import { newLayer } from '../model.js';
import { Renderer } from '../render.js';
import { registerIcon, icon } from '../icons.js';
import { registerLayerType, registerInspector, registerMenu, registerOverlay, registerHook, addStyle } from '../ext.js';

const TAU = Math.PI * 2;
const MAX_COUNT = 1500;
const TYPE_COLOR = '#7fe0ff';

// ---------- иконки ----------
registerIcon('particles', '<circle cx="6" cy="7" r="1.6" fill="currentColor"/><circle cx="17" cy="5" r="1.2" fill="currentColor"/><circle cx="11" cy="12.5" r="1.8" fill="currentColor"/><circle cx="19" cy="13" r="1.3" fill="currentColor"/><circle cx="5.5" cy="18.5" r="1.2" fill="currentColor"/><path d="M14.5 15.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/>');
registerIcon('ptc-snow', '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.6 4.6L12 6.2l2.4-1.6M9.6 19.4L12 17.8l2.4 1.6"/>');
registerIcon('ptc-rain', '<path d="M8 3.5L6 8.5M14 3L12 8M20 3.5L18 8.5M10 11.5L8 16.5M16 11.5L14 16.5M7 18.5L5.8 21.5M13 18.5L11.8 21.5"/>');
registerIcon('ptc-stars', '<path d="M10 3c.5 4 2 5.5 6 6-4 .5-5.5 2-6 6-.5-4-2-5.5-6-6 4-.5 5.5-2 6-6z"/><path d="M18 14c.3 2 1 2.7 3 3-2 .3-2.7 1-3 3-.3-2-1-2.7-3-3 2-.3 2.7-1 3-3z"/>');
registerIcon('ptc-confetti', '<rect x="4" y="4" width="4" height="6" rx=".6" transform="rotate(-20 6 7)"/><rect x="14.5" y="3" width="4" height="6" rx=".6" transform="rotate(25 16.5 6)"/><rect x="9" y="12.5" width="4" height="6" rx=".6" transform="rotate(12 11 15.5)"/><path d="M17.5 14.5l3 3M4.5 16l1.8 4"/>');
registerIcon('ptc-bubbles', '<circle cx="9" cy="14" r="5.5"/><circle cx="17.5" cy="7" r="3"/><circle cx="16.5" cy="18" r="1.8"/><path d="M6.4 12.4a3 3 0 0 1 2.4-2"/>');
registerIcon('ptc-leaves', '<path d="M4 20C4 10 10 4 20 4c0 10-6 16-16 16z"/><path d="M4 20L14 10"/>');
registerIcon('ptc-sparks', '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>');
registerIcon('ptc-hearts', '<path d="M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.3 4.2 4.2 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>');
registerIcon('ptc-fireflies', '<circle cx="12" cy="12" r="2.4" fill="currentColor"/><circle cx="12" cy="12" r="5.8" opacity=".5"/><circle cx="12" cy="12" r="9.4" opacity=".22"/>');
registerIcon('ptc-dust', '<path d="M8 3l1.2 3.8L13 8l-3.8 1.2L8 13l-1.2-3.8L3 8l3.8-1.2z"/><path d="M17 12l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/><circle cx="7" cy="18" r="1" fill="currentColor"/><circle cx="18.5" cy="5" r="1" fill="currentColor"/>');

// ---------- пресеты ----------
// model: fall — падают, rise — всплывают, float — висят и дрейфуют, wander — порхают, embers — взлетают и гаснут
// shape: soft — мягкий кружок, glow — светящаяся точка, streak — штрих, star — звёздочка, glitter — блёстка,
//        rect — прямоугольник, ring — пузырь, leaf — листик, heart — сердечко
// depth — диапазон «глубины» (дальние частицы мельче и медленнее), depthFade — дальние ещё и прозрачнее
// bg — фон, на котором эффект смотрится лучше (предлагается, если фон проекта светлый)
const PRESETS = {
  snow: {
    name: 'Снег', model: 'fall', shape: 'soft', depth: [0.35, 1], depthFade: true, sizeVar: [0.55, 1.25], sway: 45, swayW: [0.6, 1.6],
    def: { count: 260, size: 7, speed: 75, wind: 15, turb: 0.5, opVar: 0.3, colors: ['#ffffff', '#eaf3ff'] },
    bg: '#33465f', tip: 'Мягкие снежинки с покачиванием и глубиной',
  },
  rain: {
    name: 'Дождь', model: 'fall', shape: 'streak', depth: [0.45, 1], depthFade: true, sizeVar: [0.7, 1.2], sway: 6, swayW: [1, 2],
    def: { count: 420, size: 2, speed: 950, wind: 140, turb: 0.1, opVar: 0.35, colors: ['#9fbbe0', '#cfdff2'] },
    bg: '#3b4554', tip: 'Косые струи, наклон задаёт ветер',
  },
  stars: {
    name: 'Звёзды', model: 'float', shape: 'star', depth: [0.5, 1], depthFade: true, sizeVar: [0.4, 1.3], sway: 6, swayW: [0.2, 0.5], twW: [1.2, 4.5],
    def: { count: 130, size: 9, speed: 3, wind: 0, turb: 0.2, opVar: 0.45, colors: ['#ffffff', '#fff1bf', '#cfe2ff'] },
    bg: '#0f1633', tip: 'Мерцающее звёздное небо',
  },
  confetti: {
    name: 'Конфетти', model: 'fall', shape: 'rect', depth: [0.7, 1], sizeVar: [0.7, 1.2], sway: 40, swayW: [1, 2.5], rotW: [1, 4], flipW: [3, 8],
    def: { count: 220, size: 22, speed: 150, wind: 0, turb: 0.6, opVar: 0, colors: ['#ff4d6d', '#ffc93c', '#3fd0c9', '#8f6bff'] },
    tip: 'Разноцветные кувыркающиеся бумажки',
  },
  bubbles: {
    name: 'Пузыри', model: 'rise', shape: 'ring', depth: [0.6, 1], sizeVar: [0.35, 1.4], sway: 28, swayW: [1, 2.2], wobW: [2.5, 4],
    def: { count: 55, size: 18, speed: 75, wind: 0, turb: 0.5, opVar: 0.3, colors: ['#bfeaff', '#ffffff'] },
    bg: '#1d4f6e', tip: 'Всплывающие пузыри, покачиваются',
  },
  leaves: {
    name: 'Листопад', model: 'fall', shape: 'leaf', depth: [0.7, 1], sizeVar: [0.75, 1.25], sway: 90, swayW: [0.7, 1.4], rotW: [0.2, 0.8], flipW: [1.5, 3.5],
    def: { count: 55, size: 26, speed: 85, wind: 35, turb: 0.8, opVar: 0, colors: ['#e8892b', '#c9462a', '#f2c14e', '#8c5a2b'] },
    tip: 'Кружащиеся осенние листья',
  },
  sparks: {
    name: 'Искры', model: 'embers', shape: 'glow', additive: true, depth: [0.6, 1], sizeVar: [0.5, 1.3], sway: 30, swayW: [2, 5], twW: [8, 16],
    def: { count: 150, size: 7, speed: 170, wind: 20, turb: 0.5, opVar: 0.2, colors: ['#ffb13b', '#ff6a2b', '#ffe08a'] },
    bg: '#1d1414', tip: 'Взлетают снизу и гаснут, как от костра',
  },
  hearts: {
    name: 'Сердечки', model: 'rise', shape: 'heart', depth: [0.7, 1], sizeVar: [0.6, 1.3], sway: 30, swayW: [0.8, 1.8], wobW: [3, 4.5],
    def: { count: 40, size: 20, speed: 65, wind: 0, turb: 0.5, opVar: 0.25, colors: ['#ff4d6d', '#ff8fab', '#ff5fc8'] },
    tip: 'Всплывающие сердечки',
  },
  fireflies: {
    name: 'Светлячки', model: 'wander', shape: 'glow', additive: true, depth: [0.6, 1], sizeVar: [0.7, 1.3], sway: 0, twW: [0.8, 2.2],
    def: { count: 40, size: 8, speed: 30, wind: 0, turb: 0.6, opVar: 0.2, colors: ['#d8ff6b', '#ffe76b'] },
    bg: '#10211c', tip: 'Порхающие огоньки, мигают',
  },
  dust: {
    name: 'Пыль/блёстки', model: 'float', shape: 'glitter', depth: [0.5, 1], depthFade: true, sizeVar: [0.5, 1.3], sway: 18, swayW: [0.3, 0.9], twW: [2, 6],
    def: { count: 160, size: 3, speed: 12, wind: 6, turb: 0.4, opVar: 0.4, colors: ['#f5b83d', '#ffd76b', '#fff1b8'] },
    bg: '#2a2238', tip: 'Парящие пылинки, иногда вспыхивают',
  },
};
const PRESET_IDS = Object.keys(PRESETS);
const presetOf = (L) => PRESETS[L.preset] || PRESETS.snow;

// ---------- псевдослучайные константы ----------
// Индексы констант частицы
const K = 16;
const RX = 0, RY = 1, RSP = 2, RDEPTH = 3, RPH = 4, RFR = 5, RCOL = 6, ROP = 7, RVIS = 8, RROT = 9, RPH2 = 10, RSZ = 11, RFR2 = 12, RDIR = 13, RLIFE = 14, RPH3 = 15;

function hash(a, b, seed) {
  let x = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(seed + 0x27d4eb2f, 0x165667b1);
  x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d);
  x ^= x >>> 12; x = Math.imul(x, 0x297a2d39);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

// Таблица констант (seed, count) → { R, order (по глубине: дальние первыми) }
const tables = new Map();
function table(seed, count) {
  const key = seed + ':' + count;
  let t = tables.get(key);
  if (t) return t;
  const R = new Float32Array(count * K);
  for (let i = 0; i < count; i++) for (let k = 0; k < K; k++) R[i * K + k] = hash(i, k, seed);
  const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => R[a * K + RDEPTH] - R[b * K + RDEPTH]);
  t = { R, order: Uint32Array.from(order) };
  tables.set(key, t);
  if (tables.size > 24) tables.delete(tables.keys().next().value);
  return t;
}

const mod = (a, n) => ((a % n) + n) % n;
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const HEX = /^#[0-9a-f]{6}$/i;
function isLight(hex) {
  if (!HEX.test(hex || '')) return true;
  const [r, g, b] = hex2rgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62;
}
function colorsOf(L) {
  const c = Array.isArray(L.colors) ? L.colors.filter((x) => HEX.test(x)).slice(0, 4) : [];
  return c.length ? c : presetOf(L).def.colors;
}

// ---------- расчёт кадра ----------
// Результат — в общих буферах (координаты слоя), в порядке отрисовки
let cap = 0, BX, BY, BS, BR, BSX, BSY, BA, BE, BC;
function ensure(n) {
  if (n <= cap) return;
  cap = Math.max(n, 256);
  BX = new Float32Array(cap); BY = new Float32Array(cap); BS = new Float32Array(cap); BR = new Float32Array(cap);
  BSX = new Float32Array(cap); BSY = new Float32Array(cap); BA = new Float32Array(cap); BE = new Float32Array(cap);
  BC = new Uint8Array(cap);
}

function areaOf(L) {
  const d = app.doc || { w: 1280, h: 720 };
  const a = Array.isArray(L.area) ? L.area : [];
  return [Math.max(1, num(a[0], d.w)), Math.max(1, num(a[1], d.h))];
}

function simulate(L, f) {
  const doc = app.doc || { fps: 24, start: 1, end: 72 };
  const P = presetOf(L), D = P.def;
  const count = clamp(Math.round(num(L.count, D.count)), 0, MAX_COUNT);
  if (!count) return 0;
  const amt = L.amt ? clamp(num(+evalCh(L.amt, f), 1), 0, 1) : 1;
  if (amt <= 0.0005) return 0;
  const size = Math.max(0.1, num(L.size, D.size)), speed = num(L.speed, D.speed), wind = num(L.wind, D.wind);
  const turb = Math.max(0, num(L.turb, D.turb)), opVar = clamp(num(L.opVar, D.opVar), 0, 1);
  const nCol = colorsOf(L).length;
  const [W, H] = areaOf(L);
  const fps = doc.fps || 24, t = f / fps;
  // бесшовный цикл: период = длина анимации
  const T = L.loop ? Math.max(1, doc.end - doc.start + 1) / fps : 0;
  const seed = L.seed | 0;
  const tb = table(seed, count), R = tb.R;
  const model = P.model, shape = P.shape;
  const swayA = turb * (P.sway || 0);
  const wanderA = model === 'wander' ? 30 + turb * 140 : 0;
  const streak = shape === 'streak';
  const smax = size * P.sizeVar[1];
  // запас вокруг области: частицы появляются/исчезают за её краем
  const m = smax * 3 + swayA + wanderA + (streak ? Math.min(160, Math.abs(speed) * 0.06) + 10 : 0) + 12;
  const Wm = W + 2 * m, Hm = H + 2 * m;
  const qW = (w) => (T ? Math.max(1, Math.round((w * T) / TAU)) * TAU / T : w);
  const rng = (r, ab) => ab[0] + (ab[1] - ab[0]) * r;
  const [d0, d1] = P.depth, [s0, s1] = P.sizeVar;
  ensure(count);
  let n = 0;
  for (let q = 0; q < count; q++) {
    const i = tb.order[q], o = i * K;
    let a = amt >= 1 ? 1 : clamp((amt * 1.08 - R[o + RVIS]) / 0.08, 0, 1);
    if (a <= 0) continue;
    const d = d0 + (d1 - d0) * R[o + RDEPTH];
    let s = size * (s0 + (s1 - s0) * R[o + RSZ]) * d;
    a *= 1 - opVar * R[o + ROP];
    if (P.depthFade) a *= 0.45 + 0.55 * d;
    let x, y, rot = 0, sx = 1, sy = 1, ex = 0;
    const ph = R[o + RPH] * TAU, ph2 = R[o + RPH2] * TAU, ph3 = R[o + RPH3] * TAU;
    if (model === 'embers') {
      const sp = speed * (0.6 + 0.8 * R[o + RSP]) * d;
      let life = Math.min(8, ((0.35 + 0.65 * R[o + RLIFE]) * H * 0.85) / Math.max(sp, 5));
      let per = 0;
      if (T) { per = Math.max(1, Math.round(T / life)); life = T / per; }
      const tt = t + R[o + RPH] * life;
      let cyc = Math.floor(tt / life);
      const age = tt - cyc * life, k = age / life;
      if (per) cyc = mod(cyc, per);
      const ux = hash(i, 2000 + cyc, seed);
      x = (ux - 0.5) * W + wind * d * age;
      if (swayA) x += swayA * d * k * Math.sin(qW(rng(R[o + RFR], P.swayW)) * t + ph);
      y = H / 2 - sp * age;
      s *= 1 - 0.65 * k;
      a *= Math.min(1, k * 12) * Math.pow(1 - k, 0.75);
      a *= 0.78 + 0.22 * Math.sin(qW(rng(R[o + RFR2], P.twW)) * t + ph2);
    } else {
      let vx, vy;
      if (model === 'fall' || model === 'rise') {
        vy = (model === 'rise' ? -1 : 1) * speed * (0.75 + 0.5 * R[o + RSP]) * d;
        vx = wind * d;
      } else {
        const ang = R[o + RDIR] * TAU, sp = speed * (0.5 + R[o + RSP]) * d * (model === 'wander' ? 0.3 : 1);
        vx = Math.cos(ang) * sp + wind * d;
        vy = Math.sin(ang) * sp;
      }
      let age = t, fade = 1, per = -1;
      if (T) {
        const kx = (vx * T) / Wm, ky = (vy * T) / Hm;
        const ok = (k) => Math.abs(k) >= 0.8 || Math.abs(k) < 0.05;
        if (ok(kx) && ok(ky)) {
          // скорость слегка подгоняется, чтобы за цикл пройти целое число «экранов»
          vx = (Math.round(kx) * Wm) / T;
          vy = (Math.round(ky) * Hm) / T;
          per = Math.abs(Math.round(ky));
        } else {
          // слишком медленно для цикла: частица живёт один цикл и незаметно появляется снова
          age = mod(t + R[o + RLIFE] * T, T);
          const fw = Math.min(0.4, T * 0.15);
          fade = Math.min(1, age / fw, (T - age) / fw);
        }
      }
      const yy = R[o + RY] * Hm + vy * age;
      let cyc = Math.floor(yy / Hm);
      const ye = yy - cyc * Hm;
      if (per >= 0) cyc = per ? mod(cyc, per) : 0;
      // после каждого переноса — новая случайная колонка, чтобы узор не повторялся
      const ux = cyc === 0 ? R[o + RX] : hash(i, 1000 + cyc, seed);
      const xe = mod(ux * Wm + vx * age, Wm);
      x = xe - Wm / 2;
      y = ye - Hm / 2;
      const ef = Math.min(xe, Wm - xe, ye, Hm - ye) / m;
      if (ef < 1) a *= ef <= 0 ? 0 : ef * ef * (3 - 2 * ef);
      a *= fade;
      const sw = swayA ? qW(rng(R[o + RFR], P.swayW)) : 0;
      if (swayA) {
        x += swayA * d * Math.sin(sw * t + ph);
        if (model === 'float') y += swayA * d * 0.6 * Math.cos(qW(rng(R[o + RFR], P.swayW) * 0.8) * t + ph3);
      }
      if (model === 'wander') {
        const A = wanderA * d, w = (Math.max(speed, 1) / 40) * (0.6 + 0.8 * R[o + RFR]);
        x += A * (0.7 * Math.sin(qW(w) * t + ph) + 0.3 * Math.sin(qW(w * 2.3) * t + ph3));
        y += A * 0.8 * (0.7 * Math.cos(qW(w * 0.77) * t + ph2) + 0.3 * Math.sin(qW(w * 1.9) * t + ph));
      }
      switch (shape) {
        case 'streak': {
          const v = Math.hypot(vx, vy);
          const len = clamp(v * 0.05, 6, 150) * (0.6 + 0.4 * d);
          if (v > 1e-6) { sx = (vx / v) * len; sy = (vy / v) * len; } else { sx = 0; sy = len; }
          break;
        }
        case 'rect': {
          const dir = R[o + RROT] < 0.5 ? -1 : 1;
          rot = ph2 + dir * qW(rng(R[o + RROT] * 2 % 1, P.rotW)) * t;
          sx = 0.62;
          const c = Math.cos(qW(rng(R[o + RFR2], P.flipW)) * t + ph3);
          sy = c < 0 ? c - 0.08 : c + 0.08;
          break;
        }
        case 'leaf': {
          const dir = R[o + RROT] < 0.5 ? -1 : 1;
          rot = ph2 + dir * qW(rng(R[o + RROT] * 2 % 1, P.rotW)) * t + (swayA ? 0.9 * Math.cos(sw * t + ph) : 0);
          const c = Math.cos(qW(rng(R[o + RFR2], P.flipW)) * t + ph3);
          sy = c < 0 ? c * 0.7 - 0.3 : c * 0.7 + 0.3;
          break;
        }
        case 'heart':
          rot = 0.22 * Math.sin((sw || 1.2) * t + ph + 0.6);
          s *= 1 + 0.07 * Math.sin(qW(rng(R[o + RFR2], P.wobW)) * t + ph2);
          break;
        case 'ring': {
          const wob = 0.06 * Math.sin(qW(rng(R[o + RFR2], P.wobW)) * t + ph3);
          sx = 1 + wob; sy = 1 - wob;
          break;
        }
        case 'star': case 'glitter': {
          ex = 0.5 + 0.5 * Math.sin(qW(rng(R[o + RFR2], P.twW)) * t + ph2);
          a *= 0.3 + 0.7 * ex;
          if (shape === 'star') s *= 0.75 + 0.25 * ex;
          break;
        }
        case 'glow': {
          // светлячки мигают
          const b = 0.5 + 0.5 * Math.sin(qW(rng(R[o + RFR2], P.twW)) * t + ph2);
          a *= 0.22 + 0.78 * b * b;
          break;
        }
      }
    }
    if (a <= 0.003 || s <= 0.01) continue;
    BX[n] = x; BY[n] = y; BS[n] = s; BR[n] = rot; BSX[n] = sx; BSY[n] = sy; BA[n] = Math.min(1, a); BE[n] = ex;
    BC[n] = Math.min(nCol - 1, Math.floor(R[o + RCOL] * nCol));
    n++;
  }
  return n;
}

// ---------- формы (единичные, одна строка SVG-пути и для холста, и для экспорта) ----------
const D_HEART = 'M0 .9C-.4 .55-1 .2-1-.3C-1-.75-.45-1 0-.55C.45-1 1-.75 1-.3C1 .2 .4 .55 0 .9Z';
const D_LEAF = 'M-1 0C-.55-.62.4-.68 1 0C.42.6-.55.55-1 0Z';
const D_VEIN = 'M-1.28 0L.84 0';
const D_RECT = 'M-.5-.5H.5V.5H-.5Z';
const D_SPARK = 'M0-1Q.12-.12 1 0Q.12.12 0 1Q-.12.12-1 0Q-.12-.12 0-1Z';
let PATHS = null;
function paths() {
  if (PATHS) return PATHS;
  const circle = new Path2D();
  circle.arc(0, 0, 1, 0, TAU);
  const hl = new Path2D();
  hl.ellipse(-0.38, -0.42, 0.2, 0.12, -0.7, 0, TAU);
  PATHS = { heart: new Path2D(D_HEART), leaf: new Path2D(D_LEAF), vein: new Path2D(D_VEIN), spark: new Path2D(D_SPARK), circle, hl };
  return PATHS;
}

function mixWhite(hex, k) {
  const [r, g, b] = hex2rgb(hex);
  return [Math.round(r + (255 - r) * k), Math.round(g + (255 - g) * k), Math.round(b + (255 - b) * k)];
}
const GLOW_K = 2.6; // радиус ореола светящейся точки относительно размера
const SOFT_STOPS = [[0, 1, 0], [0.5, 0.8, 0], [0.8, 0.25, 0], [1, 0, 0]];
const GLOW_STOPS = [[0, 1, 0.85], [0.16, 1, 0.5], [0.32, 0.62, 0], [0.6, 0.16, 0], [1, 0, 0]];
const STAR_GLOW = 2.4; // ореол звезды относительно её размера

// ---------- спрайты ----------
// Неповёрнутые формы (точки, звёзды, блёстки, пузыри) заранее рисуются в маленький canvas — по виду,
// цвету и размеру 8…256 px, — и на кадре частица — это один drawImage вместо нескольких путей.
// Размер спрайта подбирается под экранный размер частицы: чётко и при приближении, и в экспорте 200%.
// EXT — половина стороны формы в единицах частицы (для спрайта и для отсечения невидимых).
const EXT = { soft: 1, glow: 1, star: STAR_GLOW, spark: 1, ring: 1.06, leaf: 1.3, heart: 1.02, rect: 0.5 };
function gradient(g, hex, stops, R) {
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, R);
  for (const [off, al, wh] of stops) {
    const [r, gg, b] = mixWhite(hex, wh);
    gr.addColorStop(off, `rgba(${r},${gg},${b},${al})`);
  }
  return gr;
}
function paintShape(g, kind, hex) {
  const PT = paths();
  switch (kind) {
    case 'soft': case 'glow':
      g.fillStyle = gradient(g, hex, kind === 'glow' ? GLOW_STOPS : SOFT_STOPS, 1);
      g.fillRect(-1, -1, 2, 2);
      break;
    case 'star':
      g.globalAlpha = 0.45;
      g.fillStyle = gradient(g, hex, GLOW_STOPS, STAR_GLOW);
      g.fillRect(-STAR_GLOW, -STAR_GLOW, 2 * STAR_GLOW, 2 * STAR_GLOW);
      g.globalAlpha = 1;
      g.fillStyle = hex;
      g.fill(PT.spark);
      break;
    case 'ring':
      g.fillStyle = g.strokeStyle = hex;
      g.globalAlpha = 0.13; g.fill(PT.circle);
      g.globalAlpha = 1; g.lineWidth = 0.09; g.stroke(PT.circle);
      g.globalAlpha = 0.85; g.fillStyle = '#ffffff'; g.fill(PT.hl);
      break;
    default: g.fillStyle = hex; g.fill(PT.spark);
  }
}
const sprites = new Map();
// lv — уровень размера: сторона спрайта 2^lv пикселей (3…8)
function sprite(kind, hex, lv) {
  const key = kind + hex + lv;
  let s = sprites.get(key);
  if (s) return s;
  const N = 1 << lv, ext = EXT[kind];
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  const k = (N - 2) / (2 * ext); // по 1 px запаса с краёв, чтобы сглаживание не обрезалось
  g.setTransform(k, 0, 0, k, N / 2, N / 2);
  paintShape(g, kind, hex);
  s = { c, e: N / 2 / k };
  sprites.set(key, s);
  if (sprites.size > 128) sprites.delete(sprites.keys().next().value);
  return s;
}
// экранный диаметр (px) → уровень спрайта с небольшим запасом
const level = (d) => Math.max(3, Math.min(8, 32 - Math.clz32(Math.ceil(d * 1.15) - 1)));

// Свечение складывается со светом под ним — но на светлом фоне так частицы пропали бы совсем
const additive = (P) => P.additive && !isLight(app.doc && app.doc.bg);

const ONION_MAX = 120; // в «луковой коже» хватает намёка: не больше стольких частиц на слой

// ---------- отрисовка на холсте ----------
function draw(ctx, L, rec, S, o) {
  const n = simulate(L, S.f);
  if (!n) return;
  const P = presetOf(L), cols = colorsOf(L);
  ctx.save();
  ctx.transform(...rec.world);
  const b = ctx.getTransform();
  const det = b.a * b.d - b.b * b.c;
  if (!(Math.abs(det) > 1e-12)) { ctx.restore(); return; }
  // видимая часть холста в координатах слоя: частицы за её пределами не рисуем
  const iv = b.inverse(), cw = ctx.canvas.width, chh = ctx.canvas.height;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [px, py] of [[0, 0], [cw, 0], [0, chh], [cw, chh]]) {
    const x = iv.a * px + iv.c * py + iv.e, y = iv.b * px + iv.d * py + iv.f;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const out = (x, y, rad) => x + rad < x0 || x - rad > x1 || y + rad < y0 || y - rad > y1;
  const scl = Math.sqrt(Math.abs(det)); // пикселей холста на единицу слоя
  const step = o && o.onion ? Math.max(1, Math.ceil(n / ONION_MAX)) : 1;
  const ga = ctx.globalAlpha;
  ctx.imageSmoothingEnabled = true;
  if (additive(P)) ctx.globalCompositeOperation = 'lighter';
  // спрайты этого кадра: [вид][цвет * 16 + уровень]
  const caches = {};
  const spr = (kind, ci, d) => {
    const lv = level(d), C = caches[kind] || (caches[kind] = []), i = ci * 16 + lv;
    return C[i] || (C[i] = sprite(kind, cols[ci], lv));
  };
  // частица без поворота: спрайт прямо в координатах слоя (без setTransform на каждую)
  const blit = (kind, j, rx, ry, alpha) => {
    const ext = EXT[kind], rm = Math.max(rx, ry);
    if (out(BX[j], BY[j], rm * ext)) return;
    const s = spr(kind, BC[j], 2 * ext * rm * scl);
    ctx.globalAlpha = ga * alpha;
    const ex = s.e * rx, ey = s.e * ry;
    ctx.drawImage(s.c, BX[j] - ex, BY[j] - ey, 2 * ex, 2 * ey);
  };
  switch (P.shape) {
    case 'soft': case 'glow': case 'star': {
      const kind = P.shape, k = kind === 'glow' ? GLOW_K : 1;
      for (let j = 0; j < n; j += step) { const r = BS[j] * k; blit(kind, j, r, r, BA[j]); }
      break;
    }
    case 'glitter': {
      for (let j = 0; j < n; j += step) {
        const r = BS[j];
        blit('soft', j, r, r, BA[j]);
        const fl = (BE[j] - 0.72) / 0.28;
        if (fl > 0) { const rr = r * (1.2 + 2.6 * fl); blit('spark', j, rr, rr, BA[j] * fl); }
      }
      break;
    }
    case 'ring': {
      for (let j = 0; j < n; j += step) blit('ring', j, BS[j] * Math.abs(BSX[j]), BS[j] * Math.abs(BSY[j]), BA[j]);
      break;
    }
    case 'streak': {
      // штрихи группируются по цвету/прозрачности/толщине: десятки обводок вместо сотен
      const groups = new Map();
      for (let j = 0; j < n; j += step) {
        const hx = BSX[j] / 2, hy = BSY[j] / 2;
        if (out(BX[j] - hx, BY[j] - hy, Math.abs(hx) + Math.abs(hy) + BS[j])) continue;
        const al = Math.ceil(BA[j] * 6), wq = Math.max(0.25, Math.round(BS[j] * 2) / 2);
        const key = BC[j] * 4096 + al * 512 + wq * 2;
        let g = groups.get(key);
        if (!g) groups.set(key, (g = { c: cols[BC[j]], a: al / 6, w: wq, p: new Path2D() }));
        g.p.moveTo(BX[j], BY[j]);
        g.p.lineTo(BX[j] - BSX[j], BY[j] - BSY[j]);
      }
      ctx.lineCap = 'round';
      for (const g of groups.values()) {
        ctx.strokeStyle = g.c;
        ctx.globalAlpha = ga * g.a;
        ctx.lineWidth = g.w;
        ctx.stroke(g.p);
      }
      break;
    }
    default: { // leaf, rect, heart — с поворотом и «переворотом»
      // Повёрнутый спрайт рисуется заметно медленнее простой заливки, поэтому здесь — пути (без save/restore)
      const PT = paths(), kind = P.shape, ext = EXT[kind] * 1.42;
      let lastC = -1;
      if (kind === 'leaf') { ctx.lineWidth = 0.07; ctx.strokeStyle = 'rgba(70,35,10,.38)'; }
      for (let j = 0; j < n; j += step) {
        const r = BS[j], sx = r * BSX[j], sy = r * BSY[j];
        if (out(BX[j], BY[j], Math.max(Math.abs(sx), Math.abs(sy)) * ext)) continue;
        // матрица частицы = матрица слоя · T(x, y) · R(rot) · S(sx, sy)
        const rot = BR[j], c = rot ? Math.cos(rot) : 1, sn = rot ? Math.sin(rot) : 0;
        const A = c * sx, B = sn * sx, C = -sn * sy, D = c * sy, x = BX[j], y = BY[j];
        ctx.setTransform(b.a * A + b.c * B, b.b * A + b.d * B, b.a * C + b.c * D, b.b * C + b.d * D, b.a * x + b.c * y + b.e, b.b * x + b.d * y + b.f);
        ctx.globalAlpha = ga * BA[j];
        if (BC[j] !== lastC) { lastC = BC[j]; ctx.fillStyle = cols[lastC]; }
        if (kind === 'rect') ctx.fillRect(-0.5, -0.5, 1, 1);
        else if (kind === 'heart') ctx.fill(PT.heart);
        else { ctx.fill(PT.leaf); ctx.stroke(PT.vein); }
      }
    }
  }
  ctx.restore();
}

// ---------- экспорт SVG (текущий кадр) ----------
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
function svgMat(x, y, r, sx, sy) {
  const c = r ? Math.cos(r) : 1, s = r ? Math.sin(r) : 0;
  return `matrix(${r3(c * sx)} ${r3(s * sx)} ${r3(-s * sy)} ${r3(c * sy)} ${r2(x)} ${r2(y)})`;
}
function svgGrad(id, hex, stops) {
  return `<radialGradient id="${id}">` + stops.map(([off, al, wh]) => {
    const [r, g, b] = mixWhite(hex, wh);
    return `<stop offset="${off}" stop-color="rgb(${r},${g},${b})" stop-opacity="${al}"/>`;
  }).join('') + '</radialGradient>';
}

function svg(L, rec, S) {
  const n = simulate(L, S.f);
  if (!n) return '';
  const P = presetOf(L), cols = colorsOf(L);
  const id = 'ptc' + L.id;
  let defs = '', body = '';
  const op = (a) => (a < 0.999 ? ` opacity="${r3(a)}"` : '');
  const grads = (kind) => cols.map((c, i) => svgGrad(`${id}${kind}${i}`, c, kind === 'g' ? GLOW_STOPS : SOFT_STOPS)).join('');
  switch (P.shape) {
    case 'soft': case 'glow': {
      const g = P.shape === 'glow' ? 'g' : 's', k = P.shape === 'glow' ? GLOW_K : 1;
      defs += grads(g);
      for (let j = 0; j < n; j++) body += `<circle cx="${r2(BX[j])}" cy="${r2(BY[j])}" r="${r2(BS[j] * k)}" fill="url(#${id}${g}${BC[j]})"${op(BA[j])}/>`;
      break;
    }
    case 'streak': {
      const groups = new Map();
      for (let j = 0; j < n; j++) {
        const al = Math.ceil(BA[j] * 6), wq = Math.max(0.25, Math.round(BS[j] * 2) / 2);
        const key = BC[j] + '|' + al + '|' + wq;
        let g = groups.get(key);
        if (!g) groups.set(key, (g = { c: cols[BC[j]], a: al / 6, w: wq, d: '' }));
        g.d += `M${r2(BX[j])} ${r2(BY[j])}L${r2(BX[j] - BSX[j])} ${r2(BY[j] - BSY[j])}`;
      }
      for (const g of groups.values()) body += `<path d="${g.d}" fill="none" stroke="${g.c}" stroke-opacity="${r3(g.a)}" stroke-width="${g.w}" stroke-linecap="round"/>`;
      break;
    }
    case 'star': case 'glitter': {
      defs += `<path id="${id}k" d="${D_SPARK}"/>`;
      if (P.shape === 'star') {
        defs += grads('g');
        for (let j = 0; j < n; j++) {
          body += `<circle cx="${r2(BX[j])}" cy="${r2(BY[j])}" r="${r2(BS[j] * 2.4)}" fill="url(#${id}g${BC[j]})"${op(BA[j] * 0.45)}/>`;
          body += `<use href="#${id}k" transform="${svgMat(BX[j], BY[j], 0, BS[j], BS[j])}" fill="${cols[BC[j]]}"${op(BA[j])}/>`;
        }
      } else {
        defs += grads('s');
        for (let j = 0; j < n; j++) {
          body += `<circle cx="${r2(BX[j])}" cy="${r2(BY[j])}" r="${r2(BS[j])}" fill="url(#${id}s${BC[j]})"${op(BA[j])}/>`;
          const fl = (BE[j] - 0.72) / 0.28;
          if (fl > 0) { const rr = BS[j] * (1.2 + 2.6 * fl); body += `<use href="#${id}k" transform="${svgMat(BX[j], BY[j], 0, rr, rr)}" fill="${cols[BC[j]]}"${op(BA[j] * fl)}/>`; }
        }
      }
      break;
    }
    case 'ring':
      defs += `<g id="${id}r"><circle r="1" fill="currentColor" fill-opacity=".13"/><circle r="1" fill="none" stroke="currentColor" stroke-width=".09"/>` +
        '<ellipse cx="-.38" cy="-.42" rx=".2" ry=".12" transform="rotate(-40.1 -.38 -.42)" fill="#fff" fill-opacity=".85"/></g>';
      for (let j = 0; j < n; j++) body += `<use href="#${id}r" transform="${svgMat(BX[j], BY[j], 0, BS[j] * BSX[j], BS[j] * BSY[j])}" color="${cols[BC[j]]}"${op(BA[j])}/>`;
      break;
    case 'leaf':
      defs += `<g id="${id}l"><path d="${D_LEAF}"/><path d="${D_VEIN}" fill="none" stroke="rgb(70,35,10)" stroke-opacity=".38" stroke-width=".07"/></g>`;
      for (let j = 0; j < n; j++) body += `<use href="#${id}l" transform="${svgMat(BX[j], BY[j], BR[j], BS[j] * BSX[j], BS[j] * BSY[j])}" fill="${cols[BC[j]]}"${op(BA[j])}/>`;
      break;
    default: {
      const heart = P.shape === 'heart';
      defs += `<path id="${id}p" d="${heart ? D_HEART : D_RECT}"/>`;
      for (let j = 0; j < n; j++) body += `<use href="#${id}p" transform="${svgMat(BX[j], BY[j], BR[j], BS[j] * BSX[j], BS[j] * BSY[j])}" fill="${cols[BC[j]]}"${op(BA[j])}/>`;
    }
  }
  const w = rec.world.map((v) => +v.toFixed(5)).join(' ');
  const blend = additive(P) ? ' style="mix-blend-mode:plus-lighter"' : '';
  return `<g transform="matrix(${w})"${blend}><defs>${defs}</defs>${body}</g>`;
}

// ---------- параметры слоя ----------
function applyPreset(L, id) {
  const P = PRESETS[id] || PRESETS.snow;
  const D = P.def;
  L.preset = PRESETS[id] ? id : 'snow';
  L.count = D.count;
  L.size = D.size;
  L.speed = D.speed;
  L.wind = D.wind;
  L.turb = D.turb;
  L.opVar = D.opVar;
  L.colors = D.colors.slice();
}

// Имя по пресету: «Снег», «Снег 2»…
function uniqueName(base, except) {
  const used = new Set(app.idx ? app.idx.list.filter((x) => x !== except).map((x) => x.name) : []);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(base + ' ' + i)) return base + ' ' + i;
}
// Имя слоя придумано автоматически (не переименован вручную)?
function autoNamed(L) {
  const bases = ['Частицы', ...PRESET_IDS.map((k) => PRESETS[k].name)];
  return bases.some((b) => L.name === b || new RegExp('^' + b.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + ' \\d+$').test(L.name));
}


// Насколько светло то, что под частицами: крошечный рендер кадра без слоёв частиц.
// → { light: светлая ли картинка, bgVisible: видно ли фон проекта (иначе его смена ничего не даст) }
let bdR = null;
function backdrop() {
  const doc = app.doc;
  const w = 48, hh = Math.max(8, Math.round((48 * doc.h) / doc.w));
  const c = document.createElement('canvas');
  c.width = w; c.height = hh;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const lum = (filter) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, hh);
    if (filter) {
      const S = app.scene(), cm = S.cam, k = w / doc.w;
      ctx.setTransform(cm[0] * k, cm[1] * k, cm[2] * k, cm[3] * k, cm[4] * k + w / 2, cm[5] * k + hh / 2);
      (bdR ||= new Renderer()).drawLayers(ctx, doc.layers, S, { images: app.images, px: k, filter });
    }
    const d = ctx.getImageData(0, 0, w, hh).data;
    let sum = 0, cover = 0;
    for (let i = 0; i < d.length; i += 4) { sum += (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * d[i + 3] / 255; cover += d[i + 3]; }
    return { sum, cover: cover / 255 / (w * hh) };
  };
  try {
    const L0 = lum((X) => X.type !== 'particles');
    const n = w * hh;
    const [r, g, b] = HEX.test(doc.bg || '') ? hex2rgb(doc.bg) : [255, 255, 255];
    const bgY = 0.299 * r + 0.587 * g + 0.114 * b;
    // слои поверх фона проекта: их собственный вклад + фон в непокрытых местах
    const avg = (L0.sum + bgY * (1 - L0.cover) * n) / n / 255;
    return { light: avg > 0.62, bgVisible: L0.cover < 0.85, bgLight: isLight(doc.bg) };
  } catch (e) {
    return { light: isLight(doc.bg), bgVisible: true, bgLight: isLight(doc.bg) };
  }
}

// Создать слой частиц сверху всех слоёв
function createParticles(id = 'snow', name) {
  const P = PRESETS[id] || PRESETS.snow;
  const L = newLayer(app.doc, 'particles', P.name);
  applyPreset(L, id);
  L.name = name || uniqueName(P.name);
  app.doc.layers.push(L);
  app.restructure();
  app.activeId = L.id;
  app.clearSel();
  app.fixTool();
  if (app.showSideTab) app.showSideTab('props');
  app.commit('Новый слой: ' + L.name);
  const bd = P.bg ? backdrop() : null;
  const tipBg = bd && bd.light ? (bd.bgVisible && bd.bgLight ? ' На светлом фоне эффект почти не виден — в «Свойствах» есть кнопка «Тёмный фон».' : ' Совет: на светлом фоне эффект почти не виден.') : '';
  app.toast(`Добавлен эффект «${P.name}» поверх всех слоёв. Пробел — посмотреть, настройки — в «Свойствах».` + tipBg, tipBg ? 6500 : 4200);
  return L;
}

// Плавное появление/исчезновение (ключи канала «Показано»), f — кадр начала (по умолчанию текущий)
function fadeKeys(L, dir, f = app.frame) {
  const doc = app.doc;
  const dur = Math.max(2, Math.round(doc.fps || 24));
  const c = L.amt || (L.amt = ch(1));
  const near0 = (v) => v <= 0.01;
  let s, e;
  if (dir > 0) {
    s = f > 0 ? f : Math.max(1, doc.start);
    e = s + dur;
    // у самого конца анимации появление не успело бы закончиться — частиц не было бы видно вовсе
    if (e > doc.end) { s = Math.max(1, doc.start, doc.end - dur); e = s + dur; }
    c.k = c.k.filter((k) => k.f === 0 || k.f < s || k.f > e);
    // до появления частиц нет (до ближайшего ключа, где они и так скрыты)
    for (let i = c.k.length - 1; i >= 1; i--) {
      const k = c.k[i];
      if (k.f >= s) continue;
      if (near0(k.v)) break;
      k.v = 0;
    }
    const f0 = Math.max(1, doc.start);
    if (f0 < s && !c.k.some((k) => k.f > 0 && k.f < s)) setKey(c, f0, 0, 'linear');
    setKey(c, s, 0, 'ease');
    setKey(c, e, 1, 'ease');
  } else {
    s = f > doc.start ? f : doc.end - dur;
    e = Math.min(s + dur, doc.end);
    if (e - s < Math.max(2, dur / 4)) { e = doc.end; s = Math.max(0, e - dur); }
    const v0 = clamp(+evalCh(c, s) || 0, 0, 1);
    const top = v0 > 0.97 || v0 <= 0.05 ? 1 : v0;
    c.k = c.k.filter((k) => k.f === 0 || k.f < s || k.f > e);
    // после исчезновения частиц нет (до ближайшего ключа, где они и так скрыты)
    for (const k of c.k) {
      if (k.f <= e) continue;
      if (near0(k.v)) break;
      k.v = 0;
    }
    setKey(c, s, top, 'ease');
    setKey(c, e, 0, 'ease');
  }
  app.commit(dir > 0 ? 'Частицы: плавное появление' : 'Частицы: плавное исчезновение');
  app.toast(dir > 0 ? `Частицы плавно появляются: кадры ${s}–${e}` : `Частицы плавно исчезают: кадры ${s}–${e}`, 3000);
}

// ---------- «тяжёлая» сцена ----------
const HEAVY = 3000;
// Сколько частиц во всех видимых слоях частиц сцены
function totalCount() {
  if (!app.idx) return 0;
  let n = 0;
  const hidden = (X) => { for (let p = X; p; p = app.idx.parent.get(p.id)) if (!p.vis) return true; return false; };
  for (const X of app.idx.list) if (X.type === 'particles' && !hidden(X)) n += clamp(Math.round(num(X.count, presetOf(X).def.count)), 0, MAX_COUNT);
  return n;
}
const heavyText = (n) => `В сцене ${n} частиц — просмотр может подтормаживать. Если так, уменьшите «Количество» или скройте лишние слои частиц (на экспорт это не влияет).`;
let lastTotal = 0;
app.on('docloaded', () => { lastTotal = totalCount(); });
app.on('commit', () => {
  const n = totalCount();
  if (n > HEAVY && lastTotal <= HEAVY) app.toast(heavyText(n), 6000);
  lastTotal = n;
});

// ---------- тип слоя ----------
registerLayerType('particles', {
  label: 'Частицы',
  icon: 'particles',
  // в «Новый слой» — не просто «Частицы», а сразу выбор эффекта (см. registerMenu('Новый слой') ниже)
  creatable: false,
  color: TYPE_COLOR,
  defaults(L, doc) {
    applyPreset(L, 'snow');
    const d = doc && doc.w ? doc : app.doc || { w: 1280, h: 720 };
    L.area = [d.w || 1280, d.h || 720];
    L.seed = ((L.id * 7919) % 9973) + 1;
    L.loop = false;
    L.amt = ch(1);
    if (autoNamed(L)) L.name = 'Снег';
  },
  channels(L) { return [L.amt || (L.amt = ch(1))]; },
  channelLabels: { amt: 'Показано' },
  // эффект во весь кадр не должен перехватывать клики по персонажам — выбирается в панели слоёв
  pick: false,
  // карточки во вкладке «✨ Оживить» → «Особые эффекты: Частицы»
  effects: [
    { id: 'ptc-fadein', name: 'Плавно появиться', meta: 'за 1 секунду', hint: 'Сначала частиц нет, затем за 1 секунду они появляются — с кадра «Начало»', apply: (L, o) => fadeKeys(L, 1, o && o.start) },
    { id: 'ptc-fadeout', name: 'Плавно исчезнуть', anim: 'pz-fadeout 1.8s infinite', meta: 'за 1 секунду', hint: 'За 1 секунду частицы исчезают — с кадра «Начало» (если это первый кадр — в конце анимации)', apply: (L, o) => fadeKeys(L, -1, o && o.start) },
  ],
  draw(ctx, L, rec, S, o) { draw(ctx, L, rec, S, o); },
  bounds(L, rec) {
    const [W, H] = areaOf(L), w = W / 2, hh = H / 2;
    return [[-w, -hh], [w, -hh], [w, hh], [-w, hh]].map(([x, y]) => M.apply(rec.world, x, y));
  },
  svg(L, rec, S) { return svg(L, rec, S); },
});

// «+» в панели слоёв вызывает app.addLayer('particles'): кладём слой наверх и называем по эффекту
const baseAddLayer = app.addLayer;
app.addLayer = function (type, name) {
  if (type === 'particles') return createParticles('snow', name);
  return baseAddLayer.call(app, type, name);
};

// Копия слоя частиц с тем же «вариантом» легла бы точно поверх оригинала — даём ей свою раскладку
// (до снимка истории — тем же шагом отмены, что и само дублирование)
registerHook('beforeCommit', (lab) => {
  if (lab !== 'Дублирование слоя' && lab !== 'Вставка слоя') return;
  const A = app.active;
  if (!A) return;
  const mine = [];
  const walk = (X) => { if (X.type === 'particles') mine.push(X); if (X.children) X.children.forEach(walk); };
  walk(A);
  if (!mine.length) return;
  const others = new Set(app.idx.list.filter((X) => X.type === 'particles' && !mine.includes(X)).map((X) => X.seed | 0));
  const clash = mine.filter((X) => others.has(X.seed | 0));
  if (!clash.length) return;
  for (const X of clash) { let s; do { s = 1 + Math.floor(Math.random() * 99999); } while (others.has(s)); X.seed = s; others.add(s); }
  app.toast('Копия частиц получила свою раскладку, чтобы не совпадать с оригиналом', 2600);
});

// Сменили размер кадра в «Настройках проекта» — частицы «во весь кадр» растягиваются вместе с ним
registerHook('beforeCommit', (lab, doc) => {
  if (lab !== 'Настройки проекта' || !app.idx) return;
  const H = app.history, top = H.stack[H.i];
  let prev = null;
  try { prev = top && JSON.parse(top.snap); } catch (e) { return; }
  if (!prev || (prev.w === doc.w && prev.h === doc.h)) return;
  for (const X of app.idx.list) {
    if (X.type !== 'particles') continue;
    const [aw, ah] = areaOf(X);
    if (Math.abs(aw - prev.w) < 1 && Math.abs(ah - prev.h) < 1) X.area = [doc.w, doc.h];
  }
});

// ---------- меню «Слой» и «+» в панели слоёв ----------
const presetItems = () => [{ title: 'Готовые эффекты' }, ...PRESET_IDS.map((id) => ({ label: PRESETS[id].name, icon: 'ptc-' + id, action: () => createParticles(id) }))];
registerMenu('Слой', () => [{ label: 'Добавить частицы', icon: 'particles', sub: presetItems() }]);
registerMenu('Новый слой', () => [{ label: 'Частицы: снег, дождь…', icon: 'particles', sub: presetItems() }]);

// ---------- рамка области на холсте ----------
registerOverlay((ctx, S) => {
  const L = app.active;
  if (!L || L.type !== 'particles' || !L.vis) return;
  const rec = S.layers.get(L.id);
  if (!rec) return;
  const m = M.mul(app.docToScreenM(), rec.world);
  const [W, H] = areaOf(L), w = W / 2, hh = H / 2;
  const pts = [[-w, -hh], [w, -hh], [w, hh], [-w, hh]].map(([x, y]) => M.apply(m, x, y));
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.closePath();
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = 'rgba(127,224,255,.75)';
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = '11px Inter, system-ui, sans-serif';
  const label = 'Область частиц · ' + presetOf(L).name;
  const tx = Math.min(pts[0][0], pts[3][0]) + 6, ty = Math.min(pts[0][1], pts[1][1]) + 16;
  ctx.fillStyle = 'rgba(20,24,30,.65)';
  ctx.fillRect(tx - 4, ty - 12, ctx.measureText(label).width + 8, 16);
  ctx.fillStyle = 'rgba(127,224,255,.95)';
  ctx.fillText(label, tx, ty);
});

// ---------- панель «Свойства» ----------
registerInspector({
  id: 'particles',
  order: -20,
  when: (L) => L && L.type === 'particles',
  build(L, { sec, row, upd, live, f, rangeField, numField, checkField }) {
    const P = presetOf(L), D = P.def;
    const kids = [];
    const commit = (label) => app.commit('Частицы: ' + label);

    // выбор эффекта
    kids.push(h('div', { class: 'insp-note' }, 'Готовый эффект — ничего рисовать не нужно. Выберите тип:'));
    kids.push(h('div', { class: 'ptc-grid', role: 'radiogroup', 'aria-label': 'Тип эффекта' }, PRESET_IDS.map((id) => {
      const Q = PRESETS[id];
      return h('button', {
        class: 'ptc-chip' + (L.preset === id ? ' on' : ''), role: 'radio', 'aria-checked': L.preset === id,
        title: Q.tip + (L.preset === id ? '' : '. Параметры сбросятся к стандартным для этого эффекта.'),
        onclick: () => {
          if (L.preset === id) return;
          applyPreset(L, id);
          if (autoNamed(L)) L.name = uniqueName(Q.name, L);
          commit(Q.name);
          app.toast(`Эффект «${Q.name}» — параметры по умолчанию`, 2000);
        },
      }, h('span', { class: 'ptc-ic' }, icon('ptc-' + id, 16)), h('span', null, Q.name));
    })));

    // фон
    const bd = P.bg ? backdrop() : null;
    if (bd && bd.light) {
      const canFix = bd.bgVisible && bd.bgLight;
      kids.push(h('div', { class: 'ptc-bg' },
        h('span', null, canFix ? 'На светлом фоне этот эффект почти не виден.' : 'Под частицами светлая картинка — эффект почти не виден. Попробуйте другие цвета.'),
        canFix ? h('button', {
          class: 'btn sm', title: 'Поставить подходящий тёмный фон проекта (Ctrl+Z — вернуть)',
          onclick: () => { app.doc.bg = P.bg; app.commit('Фон под эффект «' + P.name + '»'); app.toast('Фон проекта изменён. Вернуть — Ctrl+Z', 2500); },
        }, 'Тёмный фон') : null,
      ));
    }

    // ползунки
    const slider = (label, key, min, max, step, prec, tip) => {
      const r = rangeField(label, num(L[key], D[key]), {
        min, max, step, prec,
        onLive: (v) => { L[key] = v; live(); },
        onCommit: (v) => { L[key] = v; commit(label.toLowerCase()); },
      });
      if (tip) r.title = tip;
      return r;
    };
    const spMax = Math.max(200, Math.ceil((D.speed * 3) / 50) * 50, num(L.speed, 0));
    const wMax = Math.max(200, Math.ceil((Math.abs(D.wind) * 3) / 50) * 50, Math.abs(num(L.wind, 0)));
    const szMax = Math.max(40, D.size * 4, num(L.size, 0));
    const spTip = { fall: 'Скорость падения', rise: 'Скорость подъёма', float: 'Скорость дрейфа', wander: 'Скорость полёта', embers: 'Скорость подъёма' }[P.model];
    kids.push(
      slider('Количество', 'count', 0, MAX_COUNT, 1, 0, 'Сколько частиц (до 1500)'),
      slider('Размер', 'size', 0.5, szMax, 0.5, 1, P.shape === 'streak' ? 'Толщина капель' : 'Размер частиц'),
      slider('Скорость', 'speed', 0, spMax, 1, 0, spTip + ', пикселей в секунду'),
      slider('Ветер', 'wind', -wMax, wMax, 1, 0, 'Снос вбок: минус — влево, плюс — вправо'),
      slider('Завихрения', 'turb', 0, 1.5, 0.01, 2, P.model === 'wander' ? 'Размах порхания' : 'Покачивание и кружение частиц'),
      slider('Разброс прозр.', 'opVar', 0, 1, 0.01, 2, 'Насколько по-разному прозрачны частицы: 0 — все одинаковые'),
    );

    const total = totalCount();
    if (total > HEAVY) kids.push(h('div', { class: 'insp-note ptc-heavy' }, heavyText(total)));

    // цвета
    const cols = colorsOf(L).slice();
    const colRow = h('div', { class: 'ptc-cols' }, h('span', { class: 'ptc-lbl' }, 'Цвета'));
    cols.forEach((c, i) => {
      colRow.append(h('input', {
        type: 'color', class: 'ptc-col', value: c, title: 'Цвет ' + (i + 1), 'aria-label': 'Цвет частиц ' + (i + 1),
        oninput: (e) => { L.colors = cols.slice(); L.colors[i] = e.target.value; cols[i] = e.target.value; live(); },
        onchange: (e) => { L.colors = cols.slice(); L.colors[i] = e.target.value; commit('цвет'); },
      }));
    });
    if (cols.length < 4) colRow.append(h('button', { class: 'icon-btn ptc-mini', title: 'Добавить цвет (до 4)', 'aria-label': 'Добавить цвет', onclick: () => { L.colors = cols.concat(cols[cols.length - 1]); commit('цвет'); } }, '+'));
    if (cols.length > 1) colRow.append(h('button', { class: 'icon-btn ptc-mini', title: 'Убрать последний цвет', 'aria-label': 'Убрать цвет', onclick: () => { L.colors = cols.slice(0, -1); commit('цвет'); } }, '−'));
    colRow.append(h('button', { class: 'icon-btn ptc-mini', title: 'Вернуть цвета эффекта по умолчанию', 'aria-label': 'Цвета по умолчанию', onclick: () => { L.colors = D.colors.slice(); commit('цвета по умолчанию'); } }, icon('undo', 14)));
    kids.push(colRow);

    // вариант раскладки
    kids.push(row(
      numField('Вариант', L.seed | 0, { min: 0, max: 99999, step: 1, prec: 0, title: 'Номер случайной раскладки частиц', onLive: (v) => { L.seed = Math.round(v); live(); }, onCommit: (v) => { L.seed = Math.round(v); commit('вариант'); } }),
      h('button', { class: 'btn sm', title: 'Случайно разбросать частицы заново', onclick: () => { let s; do { s = 1 + Math.floor(Math.random() * 99999); } while (s === L.seed); L.seed = s; commit('перемешать'); } }, 'Перемешать'),
    ));

    // область
    const [aw, ah] = areaOf(L);
    const setArea = (i, v) => { const a = areaOf(L); a[i] = Math.max(1, Math.round(v)); L.area = a; };
    kids.push(h('div', { class: 'ptc-sub' }, 'Область (центр — в центре слоя)'));
    kids.push(row(
      numField('Ширина', aw, { min: 1, max: 20000, step: 2, prec: 0, onLive: (v) => { setArea(0, v); live(); }, onCommit: (v) => { setArea(0, v); commit('область'); } }),
      numField('Высота', ah, { min: 1, max: 20000, step: 2, prec: 0, onLive: (v) => { setArea(1, v); live(); }, onCommit: (v) => { setArea(1, v); commit('область'); } }),
    ));
    kids.push(h('div', { class: 'btn-row' }, h('button', {
      class: 'btn sm', title: 'Растянуть область на весь кадр',
      onclick: () => {
        L.area = [app.doc.w, app.doc.h];
        // слой без анимации в корне — заодно ставим в центр кадра
        const p = evalCh(L.pos, 0);
        if (!app.idx.parent.get(L.id) && L.pos.k.length === 1 && (p[0] || p[1])) L.pos.k[0].v = [0, 0];
        commit('по размеру кадра');
        app.toast('Частицы заполняют весь кадр', 1800);
      },
    }, 'По размеру кадра')));

    // появление / исчезновение
    const animated = L.amt && L.amt.k.length > 1;
    kids.push(h('div', { class: 'ptc-sub' }, 'Появление'));
    const shown = rangeField('Показано', L.amt ? evalCh(L.amt, f()) : 1, {
      min: 0, max: 1, step: 0.01, prec: 2,
      onLive: (v) => { setKey(L.amt || (L.amt = ch(1)), f(), v); live(); },
      onCommit: () => commit('показано'),
    });
    shown.title = 'Какая доля частиц видна на этом кадре: 0 — ни одной, 1 — все. На кадре больше 0 изменение становится ключом.';
    kids.push(upd(shown, () => (L.amt ? evalCh(L.amt, f()) : 1)));
    kids.push(h('div', { class: 'btn-row' },
      h('button', { class: 'btn sm', title: 'Частиц нет, затем за 1 секунду они появляются (с текущего кадра или с начала)', onclick: () => fadeKeys(L, 1) }, 'Плавно появиться'),
      h('button', { class: 'btn sm', title: 'За 1 секунду частицы исчезают (с текущего кадра или в конце анимации)', onclick: () => fadeKeys(L, -1) }, 'Плавно исчезнуть'),
    ));
    if (animated) {
      kids.push(h('div', { class: 'ptc-keys' },
        h('span', null, 'Ключей появления: ' + (L.amt.k.length - 1)),
        h('button', {
          class: 'btn sm ghost', title: 'Удалить ключи появления/исчезновения — частицы видны всегда',
          onclick: () => { L.amt = ch(1); commit('без появления'); app.toast('Частицы снова видны всё время', 1800); },
        }, 'Убрать'),
      ));
    }
    kids.push(row(checkField('Бесшовный цикл (для GIF)', !!L.loop, (v) => { L.loop = v; commit(v ? 'бесшовный цикл' : 'без цикла'); },
      'Движение точно повторяется каждые ' + (app.doc.end - app.doc.start + 1) + ' кадров анимации — удобно для зацикленных GIF. Скорости чуть подстраиваются.')));

    const el = sec('Частицы · ' + P.name, ...kids);
    el.classList.add('ptc-sec');
    return el;
  },
});

addStyle(`
.ltype.t-particles { color: ${TYPE_COLOR}; }
.ptc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin: 4px 0 8px; }
.ptc-chip { display: flex; align-items: center; gap: 6px; padding: 5px 7px; border-radius: 5px; border: 1px solid var(--line2); background: var(--bg2); color: var(--text); font-size: 12px; text-align: left; min-width: 0; }
.ptc-chip:hover { background: var(--bg3); }
.ptc-chip.on { border-color: rgba(76,157,255,.65); background: var(--accent-bg); color: #fff; }
.ptc-chip .ptc-ic { color: ${TYPE_COLOR}; display: inline-flex; flex: none; }
.ptc-chip > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ptc-sec .rng-l { width: 96px; flex: none; }
.ptc-sec .rng { margin: 3px 0; }
.ptc-cols { display: flex; align-items: center; gap: 5px; margin: 6px 0; flex-wrap: wrap; }
.ptc-lbl { width: 96px; flex: none; color: var(--text2); font-size: 12px; }
.ptc-col { width: 30px; height: 24px; padding: 0; border: 1px solid var(--line2); border-radius: 5px; background: var(--bg0); cursor: pointer; }
.ptc-col::-webkit-color-swatch-wrapper { padding: 2px; }
.ptc-col::-webkit-color-swatch { border: 0; border-radius: 3px; }
.ptc-col::-moz-color-swatch { border: 0; border-radius: 3px; }
.ptc-mini { width: 24px; height: 24px; font-size: 15px; line-height: 1; padding: 0; }
.ptc-keys { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin: 4px 0 2px; color: var(--text3); font-size: 12px; }
.ptc-sub { margin: 10px 0 2px; color: var(--text2); font-size: 11.5px; font-weight: 600; }
.ptc-bg { display: flex; align-items: center; gap: 8px; margin: 2px 0 8px; padding: 6px 8px; border-radius: 6px; background: rgba(255,173,92,.1); border: 1px solid rgba(255,173,92,.3); color: var(--text); font-size: 12px; }
.ptc-bg span { flex: 1; }
.ptc-heavy { margin: 4px 0 6px; padding: 5px 8px; border-radius: 6px; background: rgba(255,200,90,.08); border: 1px solid rgba(255,200,90,.22); }
`, 'particles-css');
