// «Оживить» — готовые анимации в один клик: появление, исчезновение, циклы, камера, кости.
// Движение всегда относительно текущих значений слоя на кадре начала. Служебные ключи пресетов
// помечаются полем hid (1 — скрытое состояние: начало появления / конец исчезновения, 2 — удержание
// до появления, 3 — промежуточный: перелёт, замах, размах цикла), чтобы повторное применение
// не принимало их за «домашнее» положение слоя.
import { app } from '../app.js';
import { registry, registerSideTab, registerMenubarButton, registerMenu, registerTimelineMenu, registerInspector, addStyle } from '../ext.js';
import { registerIcon, icon } from '../icons.js';
import { h, M, DEG, clamp } from '../util.js';
import { setKey, evalCh } from '../anim.js';
import { evaluate, layerWorldPoints } from '../scene.js';
import { setOrigin } from '../tools.js';
import { layerIcon, layerLabel } from '../panels.js';
import { boneAncestor, boneDescendants } from '../model.js';
import { numField, rangeField, selectField, checkField, confirmDialog, dialog } from '../ui.js';

registerIcon('sparkle', '<path d="M11 3l1.9 5.6L18.5 10.5l-5.6 1.9L11 18l-1.9-5.6L3.5 10.5l5.6-1.9z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/><path d="M18.5 2.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z"/>');

// ---------- настройки панели (личное удобство, хранится в браузере) ----------
const LS = 'anim2d.presets';
const opt = { dur: 24, auto: true, str: 1, reps: 'auto', preview: true, more: false };
try {
  const s = JSON.parse(localStorage.getItem(LS) || '{}');
  if (isFinite(s.dur)) opt.dur = clamp(Math.round(s.dur), 2, 600);
  if (typeof s.auto === 'boolean') opt.auto = s.auto;
  if (isFinite(s.str)) opt.str = clamp(+s.str, 0.25, 3);
  if (typeof s.reps === 'string') opt.reps = s.reps;
  if (typeof s.preview === 'boolean') opt.preview = s.preview;
  if (typeof s.more === 'boolean') opt.more = s.more;
} catch (e) { /* нет доступа */ }
const saveOpt = () => { try { localStorage.setItem(LS, JSON.stringify(opt)); } catch (e) { /* нет доступа */ } };
const REPS = { auto: 'Авто', 1: '1', 2: '2', 3: '3', 4: '4', 6: '6', 8: '8', end: 'До конца сцены' };
if (!(opt.reps in REPS)) opt.reps = 'auto';

let startOverride = null; // кадр начала, заданный вручную (null — текущий кадр)

// ---------- вспомогательная математика ----------
const add = (p, v, k = 1) => [p[0] + v[0] * k, p[1] + v[1] * k];
const mul = (s, kx, ky = kx) => [s[0] * kx, s[1] * ky];
const vlen = (v) => Math.hypot(v[0], v[1]);
const opIn = (o) => (o > 0.05 ? o : 1); // появление прозрачного слоя — до полной видимости
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Форма одного цикла [[t 0..1, x, интерполяция]] → ключи [[смещение кадра, x, интерполяция]] на n повторов
function cycle(c, shape, endX = shape[0][1]) {
  const out = [];
  for (let i = 0; i < c.n; i++) for (const [t, x, ip] of shape) out.push([Math.round((i + t) * c.P), x, ip]);
  out.push([c.T, endX, 'smooth']);
  return out;
}
const vals = (keys, fn) => keys.map(([o, x, ip, hid]) => [o, fn(x), ip, hid]);
// Синус ключами на четвертях периода: плавная интерполяция между ними даёт почти идеальную синусоиду
const SINE = [[0, 0, 'smooth'], [0.25, 1, 'smooth'], [0.5, 0, 'smooth'], [0.75, -1, 'smooth']];

// Синус со сдвигом фазы ph (доля периода). wrap — бесшовная петля; иначе амплитуда плавно нарастает и затухает.
function waveKeys(T, P, ph, wrap) {
  const ramp = Math.min(P, T / 2);
  const env = (t) => (wrap ? 1 : clamp(Math.min(t / ramp, (T - t) / ramp), 0, 1));
  const val = (t) => Math.sin(2 * Math.PI * (t / P - ph)) * env(t);
  const out = [[0, wrap ? val(0) : 0, 'smooth']];
  const q = P / 4;
  for (let k = Math.ceil(-ph * 4); ; k++) {
    const t = ph * P + k * q;
    if (t >= T) break;
    const f = Math.round(t);
    if (f <= 0 || f >= T) continue;
    out.push([f, val(t), 'smooth']);
  }
  out.push([T, wrap ? val(T) : 0, 'smooth']);
  return out;
}

// ---------- пресеты ----------
// cat: in | out | loop | cam | bone; g — род названия (для «добавлен/добавлена/добавлено»)
// ch — имена каналов (слоя, камеры или каждой кости); build(c) → [{ c: канал, keys: [[смещение, значение, интерп., hid?]], pre? }]
const CATS = [
  { id: 'in', name: 'Появление', note: 'Слой появляется и встаёт точно на своё текущее место.' },
  { id: 'out', name: 'Исчезновение', note: 'Слой уходит и остаётся скрытым до следующих ключей.' },
  { id: 'loop', name: 'Циклы', note: 'Повторяющееся движение вокруг текущего положения слоя.' },
  { id: 'cam', name: 'Камера', note: 'Движение камеры для всей сцены — слой выбирать не нужно.' },
  { id: 'bone', name: 'Кости', note: '' },
];

const slideIn = (id, name, side, anim) => ({
  id, cat: 'in', name, g: 'm', dur: 18, ch: ['pos'], pv: { k: 'box', a: anim + ' 2s infinite' },
  tip: 'Слой влетает из-за края кадра и мягко останавливается на своём месте. Сила — дальность разлёта.',
  build: (c) => {
    const L = c.L, p0 = c.base(L.pos), off = c.off(side), k = Math.min(0.05, 16 / Math.max(vlen(off), 1));
    return [{ c: L.pos, pre: add(p0, off), keys: [[0, add(p0, off), 'out', 1], [c.r(0.78), add(p0, off, -k), 'ease', 3], [c.T, p0, 'smooth']] }];
  },
});
const flyOut = (id, name, side, anim) => ({
  id, cat: 'out', name, g: 'm', dur: 18, ch: ['pos'], pv: { k: 'box', a: anim + ' 2s infinite' },
  tip: 'Лёгкий замах назад — и слой улетает за край кадра.',
  build: (c) => {
    const L = c.L, p0 = c.base(L.pos), off = c.off(side), k = Math.min(0.06, 20 / Math.max(vlen(off), 1));
    return [{ c: L.pos, keys: [[0, p0, 'ease'], [c.r(0.22), add(p0, off, -k), 'in', 3], [c.T, add(p0, off), 'step', 1]] }];
  },
});
const pan = (id, name, sign, anim) => ({
  id, cat: 'cam', name, g: 'f', dur: 48, ch: ['pos'], pv: { k: 'cam', a: anim + ' 3s ease-in-out infinite' },
  tip: 'Камера плавно проезжает в сторону на треть ширины кадра. Сила — дальность.',
  build: (c) => {
    const cam = c.cam, p0 = c.base(cam.pos), z = Math.abs(evalCh(cam.zoom, c.a)) || 1, r = evalCh(cam.roll, c.a) * DEG;
    const d = (sign * 0.3 * c.doc.w * c.str) / z;
    return [{ c: cam.pos, keys: [[0, p0, 'ease'], [c.T, add(p0, [Math.cos(r) * d, Math.sin(r) * d]), 'smooth']] }];
  },
});

const PRESETS = [
  // ----- появление -----
  {
    id: 'fadein', cat: 'in', name: 'Проявление', g: 'n', dur: 12, ch: ['op'], pv: { k: 'box', a: 'pz-fadein 1.8s infinite' },
    tip: 'Слой плавно проявляется из полной прозрачности.',
    build: (c) => [{ c: c.L.op, pre: 0, keys: [[0, 0, 'ease', 1], [c.T, opIn(c.base(c.L.op)), 'smooth']] }],
  },
  slideIn('inleft', 'Вылет слева', 'left', 'pz-inl'),
  slideIn('inright', 'Вылет справа', 'right', 'pz-inr'),
  slideIn('intop', 'Вылет сверху', 'top', 'pz-int'),
  slideIn('inbottom', 'Вылет снизу', 'bottom', 'pz-inb'),
  {
    id: 'pop', cat: 'in', name: 'Выпрыгивание', g: 'n', dur: 12, ch: ['scl', 'op'], pivot: 'center', pv: { k: 'box', a: 'pz-pop 1.8s infinite' },
    tip: 'Слой выскакивает из точки, чуть перерастает и пружинисто встаёт в свой размер.',
    build: (c) => {
      const L = c.L, s0 = c.base(L.scl), q = 0.2 * c.str, tiny = mul(s0, 0.02);
      return [
        { c: L.scl, pre: tiny, keys: [[0, tiny, 'out', 1], [c.r(0.55), mul(s0, 1 + q), 'ease', 3], [c.r(0.8), mul(s0, 1 - q * 0.3), 'ease', 3], [c.T, s0, 'smooth']] },
        { c: L.op, pre: 0, keys: [[0, opIn(c.base(L.op)), 'smooth']] },
      ];
    },
  },
  {
    id: 'spinin', cat: 'in', name: 'Раскрутка', g: 'f', dur: 24, ch: ['rot', 'scl', 'op'], pivot: 'center', pv: { k: 'box', a: 'pz-spinin 2s ease-out infinite' },
    tip: 'Слой вырастает из точки, делая полный оборот. Сила — число оборотов.',
    build: (c) => {
      const L = c.L, r0 = c.base(L.rot), s0 = c.base(L.scl), turn = 360 * c.str, tiny = mul(s0, 0.02);
      return [
        { c: L.rot, pre: r0 - turn, keys: [[0, r0 - turn, 'out', 1], [c.T, r0, 'smooth']] },
        { c: L.scl, pre: tiny, keys: [[0, tiny, 'out', 1], [c.T, s0, 'smooth']] },
        { c: L.op, pre: 0, keys: [[0, opIn(c.base(L.op)), 'smooth']] },
      ];
    },
  },
  // ----- исчезновение -----
  {
    id: 'fadeout', cat: 'out', name: 'Растворение', g: 'n', dur: 12, ch: ['op'], pv: { k: 'box', a: 'pz-fadeout 1.8s infinite' },
    tip: 'Слой плавно становится прозрачным и исчезает.',
    build: (c) => [{ c: c.L.op, keys: [[0, c.base(c.L.op), 'ease'], [c.T, 0, 'step', 1]] }],
  },
  flyOut('outright', 'Улёт вправо', 'right', 'pz-outr'),
  flyOut('outleft', 'Улёт влево', 'left', 'pz-outl'),
  flyOut('outup', 'Улёт вверх', 'top', 'pz-outu'),
  {
    id: 'collapse', cat: 'out', name: 'Схлопывание', g: 'n', dur: 12, ch: ['scl', 'op'], pivot: 'center', pv: { k: 'box', a: 'pz-collapse 1.8s infinite' },
    tip: 'Слой чуть надувается и схлопывается в точку.',
    build: (c) => {
      const L = c.L, s0 = c.base(L.scl);
      return [
        { c: L.scl, keys: [[0, s0, 'ease'], [c.r(0.3), mul(s0, 1 + 0.12 * c.str), 'in', 3], [c.T, mul(s0, 0.02), 'step', 1]] },
        { c: L.op, keys: [[0, c.base(L.op), 'step'], [c.T, 0, 'step', 1]] },
      ];
    },
  },
  // ----- циклы -----
  {
    id: 'bounce', cat: 'loop', name: 'Подпрыгивание', g: 'n', dur: 18, cycle: true, reps: 'end', ch: ['pos', 'scl'], pivot: 'bottom',
    tail: (P) => Math.max(2, Math.round(P * 0.2)), pv: { k: 'ground', a: 'pz-bounce 0.9s infinite' },
    tip: 'Прыжки на месте со сжатием при приземлении и вытягиванием в полёте. Сила — высота прыжка.',
    build: (c) => {
      const L = c.L, p0 = c.base(L.pos), s0 = c.base(L.scl);
      const up = c.geo.dir(0, -clamp(c.geo.fh * 0.45, 24, 150) * c.str);
      const q = 0.16 * Math.min(c.str, 2.5);
      const squash = mul(s0, 1 + q, 1 - q), stretch = mul(s0, 1 - q * 0.5, 1 + q * 0.6);
      const scl = [];
      for (let i = 0; i < c.n; i++) {
        const t = (u) => Math.round((i + u) * c.P);
        scl.push([t(0), i ? squash : s0, 'ease'], [t(0.15), stretch, 'ease'], [t(0.5), s0, 'ease'], [t(0.85), stretch, 'ease']);
      }
      scl.push([c.T, squash, 'ease'], [c.T + c.tail, s0, 'smooth']);
      return [
        { c: L.pos, keys: vals(cycle(c, [[0, 0, 'out'], [0.5, 1, 'in']]), (x) => add(p0, up, x)) },
        { c: L.scl, keys: scl },
      ];
    },
  },
  {
    id: 'sway', cat: 'loop', name: 'Покачивание', g: 'n', dur: 48, cycle: true, reps: 'end', ch: ['rot'], pivot: 'bottom', pv: { k: 'tall', a: 'pz-sway 2.4s ease-in-out infinite' },
    tip: 'Мягкое покачивание из стороны в сторону вокруг нижнего края — как растение на ветру. Сила — угол.',
    build: (c) => { const r0 = c.base(c.L.rot); return [{ c: c.L.rot, keys: vals(cycle(c, SINE), (x) => r0 + 8 * c.str * x) }]; },
  },
  {
    id: 'pendulum', cat: 'loop', name: 'Маятник', g: 'm', dur: 36, cycle: true, reps: 'end', ch: ['rot'], pivot: 'top', pv: { k: 'pend', a: 'pz-pendulum 1.6s ease-in-out infinite' },
    tip: 'Раскачивание с подвесом за верхний край — как вывеска или люстра. Сила — размах.',
    build: (c) => { const r0 = c.base(c.L.rot); return [{ c: c.L.rot, keys: vals(cycle(c, SINE), (x) => r0 + 25 * c.str * x) }]; },
  },
  {
    id: 'pulse', cat: 'loop', name: 'Пульсация', g: 'f', dur: 24, cycle: true, reps: 'end', ch: ['scl'], pivot: 'center', pv: { k: 'box', a: 'pz-pulse 1.2s ease-in-out infinite' },
    tip: 'Слой ритмично увеличивается и возвращается к своему размеру. Сила — насколько увеличивается.',
    build: (c) => { const s0 = c.base(c.L.scl); return [{ c: c.L.scl, keys: vals(cycle(c, [[0, 0, 'ease'], [0.5, 1, 'ease']]), (x) => mul(s0, 1 + 0.15 * c.str * x)) }]; },
  },
  {
    id: 'spin', cat: 'loop', name: 'Вращение', g: 'n', dur: 48, cycle: true, reps: 'end', ch: ['rot'], pivot: 'center', pv: { k: 'box', a: 'pz-spin 2s linear infinite' },
    tip: 'Равномерное вращение по часовой стрелке: один оборот за длительность. Сила — скорость.',
    build: (c) => {
      const r0 = c.base(c.L.rot), turns = Math.max(1, Math.round(c.str * c.n));
      return [{ c: c.L.rot, keys: [[0, r0, 'linear'], [c.T, r0 + 360 * turns, 'linear']] }];
    },
  },
  {
    id: 'float', cat: 'loop', name: 'Парение', g: 'n', dur: 48, cycle: true, reps: 'end', ch: ['pos'], pv: { k: 'box', a: 'pz-float 2.4s ease-in-out infinite' },
    tip: 'Слой медленно плавает вверх-вниз, будто невесомый. Сила — размах.',
    build: (c) => {
      const p0 = c.base(c.L.pos), up = c.geo.dir(0, -clamp(c.geo.fh * 0.06, 6, 24) * c.str);
      return [{ c: c.L.pos, keys: vals(cycle(c, SINE), (x) => add(p0, up, x)) }];
    },
  },
  {
    id: 'shake', cat: 'loop', name: 'Тряска', g: 'f', dur: 12, cycle: true, reps: 1, ch: ['pos'], pv: { k: 'box', a: 'pz-shake 1.4s infinite' },
    tip: 'Короткая затухающая тряска из стороны в сторону — удар, испуг, «нет». Сила — размах.',
    build: (c) => {
      const p0 = c.base(c.L.pos), side = c.geo.dir(clamp(c.geo.fw * 0.08, 6, 30) * c.str, 0), m = Math.max(4, Math.round(c.P / 2));
      const shape = [];
      for (let j = 0; j < m; j++) shape.push([j / m, j ? (j % 2 ? -1 : 1) * (1 - j / m) : 0, 'smooth']);
      return [{ c: c.L.pos, keys: vals(cycle(c, shape), (x) => add(p0, side, x)) }];
    },
  },
  {
    id: 'jitter', cat: 'loop', name: 'Дрожание', g: 'n', dur: 24, cycle: true, reps: 'end', ch: ['pos'], pv: { k: 'box', a: 'pz-jitter 0.32s linear infinite' },
    tip: 'Мелкая нервная дрожь — от холода, страха или злости. Сила — размах.',
    build: (c) => {
      const L = c.L, p0 = c.base(L.pos), A = clamp(Math.min(c.geo.fw, c.geo.fh) * 0.03, 1.5, 6) * c.str;
      const ex = c.geo.dir(A, 0), ey = c.geo.dir(0, A), R = rng(L.id * 7919 + c.a);
      const keys = [[0, p0, 'linear']];
      for (let f = 2; f < c.T; f += 2) keys.push([f, add(add(p0, ex, R() * 2 - 1), ey, R() * 2 - 1), 'linear']);
      keys.push([c.T, p0, 'smooth']);
      return [{ c: L.pos, keys }];
    },
  },
  {
    id: 'heart', cat: 'loop', name: 'Сердцебиение', g: 'n', dur: 24, cycle: true, reps: 'end', ch: ['scl'], pivot: 'center', pv: { k: 'box', a: 'pz-heart 1.3s infinite' },
    tip: 'Двойной удар «тук-тук» и пауза, как у сердца. Сила — величина удара.',
    build: (c) => {
      const s0 = c.base(c.L.scl);
      const shape = [[0, 0, 'out'], [0.1, 1, 'ease'], [0.2, 0.3, 'out'], [0.32, 0.75, 'ease'], [0.5, 0, 'ease']];
      return [{ c: c.L.scl, keys: vals(cycle(c, shape), (x) => mul(s0, 1 + 0.16 * c.str * x)) }];
    },
  },
  {
    id: 'jelly', cat: 'loop', name: 'Желе', g: 'n', dur: 24, cycle: true, reps: 'end', ch: ['scl'], pivot: 'bottom', pv: { k: 'ground', a: 'pz-jelly 1.6s infinite' },
    tip: 'Упругое сплющивание и вытягивание с затуханием, как у желе. Сила — упругость.',
    build: (c) => {
      const s0 = c.base(c.L.scl), q = 0.18 * Math.min(c.str, 2.5);
      const shape = [[0, 0, 'ease'], [0.14, 1, 'ease'], [0.32, -0.7, 'ease'], [0.5, 0.4, 'ease'], [0.68, -0.2, 'ease'], [0.84, 0.06, 'ease']];
      return [{ c: c.L.scl, keys: vals(cycle(c, shape), (x) => mul(s0, 1 + q * x, 1 - q * x)) }];
    },
  },
  // ----- камера -----
  {
    id: 'camin', cat: 'cam', name: 'Наезд', g: 'm', dur: 36, ch: ['zoom'], pv: { k: 'cam', a: 'pz-zin 3s ease-in-out infinite' },
    tip: 'Камера плавно приближается к центру кадра. Сила — насколько крупно.',
    build: (c) => { const z0 = c.base(c.cam.zoom); return [{ c: c.cam.zoom, keys: [[0, z0, 'ease'], [c.T, z0 * (1 + 0.5 * c.str), 'smooth']] }]; },
  },
  {
    id: 'camout', cat: 'cam', name: 'Отъезд', g: 'm', dur: 36, ch: ['zoom'], pv: { k: 'cam', a: 'pz-zout 3s ease-in-out infinite' },
    tip: 'Камера плавно отдаляется, показывая больше сцены. Сила — насколько далеко.',
    build: (c) => { const z0 = c.base(c.cam.zoom); return [{ c: c.cam.zoom, keys: [[0, z0, 'ease'], [c.T, z0 / (1 + 0.5 * c.str), 'smooth']] }]; },
  },
  {
    id: 'camshake', cat: 'cam', name: 'Тряска камеры', g: 'f', dur: 12, cycle: true, reps: 1, ch: ['pos', 'roll'], pv: { k: 'cam', a: 'pz-cshake 1.4s infinite' },
    tip: 'Резкая затухающая тряска всего кадра — взрыв, удар, землетрясение. Сила — размах.',
    build: (c) => {
      const cam = c.cam, p0 = c.base(cam.pos), r0 = c.base(cam.roll), z = Math.abs(evalCh(cam.zoom, c.a)) || 1;
      const A = (16 * c.str) / z, RA = 1.5 * c.str, R = rng(c.a * 31 + 7), m = Math.max(4, Math.round(c.P / 2));
      const pos = [], roll = [];
      for (let i = 0; i < c.n; i++) {
        for (let j = 0; j < m; j++) {
          const f = Math.round((i + j / m) * c.P), e = j ? 1 - j / m : 0, sg = j % 2 ? -1 : 1;
          pos.push([f, [p0[0] + sg * (0.5 + 0.5 * R()) * A * e, p0[1] + (R() * 2 - 1) * A * e], 'smooth']);
          roll.push([f, r0 - sg * (0.4 + 0.6 * R()) * RA * e, 'smooth']);
        }
      }
      pos.push([c.T, p0, 'smooth']);
      roll.push([c.T, r0, 'smooth']);
      return [{ c: cam.pos, keys: pos }, { c: cam.roll, keys: roll }];
    },
  },
  pan('panleft', 'Панорама влево', -1, 'pz-panl'),
  pan('panright', 'Панорама вправо', 1, 'pz-panr'),
  // ----- кости (на слое костей) -----
  {
    id: 'bwave', cat: 'bone', name: 'Махание костью', full: 'Махание выделенной костью', g: 'n', dur: 16, cycle: true, reps: 'end', ch: ['ang'], pv: { k: 'arm', a: 'pz-arm 0.9s ease-in-out infinite' },
    tip: 'Выделенная кость машет туда-обратно вокруг текущего угла — рука, хвост, флажок. Сила — размах.',
    build: (c) => c.bones.map((b) => { const a0 = c.base(b.ang); return { c: b.ang, keys: vals(cycle(c, SINE), (x) => a0 + 30 * c.str * x) }; }),
  },
  {
    id: 'bchain', cat: 'bone', name: 'Волна по цепочке', g: 'f', dur: 32, cycle: true, reps: 'end', ch: ['ang'], pv: { k: 'chain' },
    tip: 'Волна бежит от выделенной кости к концу цепочки с запаздыванием — для хвостов, волос, щупалец, верёвок. Сила — размах.',
    bones: (L, sel) => {
      const set = new Set(sel.map((b) => b.id));
      for (const b of sel) boneDescendants(L, b.id, set);
      return L.bones.filter((b) => set.has(b.id));
    },
    build: (c) => {
      const L = c.L, ids = new Set(c.bones.map((b) => b.id)), byId = new Map(L.bones.map((b) => [b.id, b]));
      const depth = (b) => { let d = 0, p = b.parent; while (p != null && ids.has(p) && d < 64) { d++; p = byId.get(p).parent; } return d; };
      const wrap = c.untilEnd && c.a <= c.doc.start; // петля на всю сцену — бесшовно
      return c.bones.map((b) => {
        const a0 = c.base(b.ang);
        return { c: b.ang, keys: vals(waveKeys(c.T, c.P, depth(b) * 0.14, wrap), (x) => a0 + 16 * c.str * x) };
      });
    },
  },
  {
    id: 'bnod', cat: 'bone', name: 'Кивок', g: 'm', dur: 16, cycle: true, reps: 1, ch: ['ang'], pv: { k: 'nod', a: 'pz-nod 1.5s ease-in-out infinite' },
    tip: 'Голова кивает и возвращается. Без выделения ищется кость «Голова». Сила — глубина кивка.',
    bones: (L, sel) => (sel.length ? sel : L.bones.filter((b) => /голов|head/i.test(b.name)).slice(0, 1)),
    need: 'Выделите кость головы (клик инструментом «Управление костями», Z) — кость с именем «Голова» не найдена',
    build: (c) => c.bones.map((b) => {
      const a0 = c.base(b.ang);
      return { c: b.ang, keys: vals(cycle(c, [[0, 0, 'ease'], [0.35, 1, 'ease'], [0.7, -0.25, 'ease']]), (x) => a0 + 16 * c.str * x) };
    }),
  },
  {
    id: 'bbreath', cat: 'bone', name: 'Дыхание', g: 'n', dur: 48, cycle: true, reps: 'end', ch: ['scl'], pv: { k: 'breath', a: 'pz-breath 2.4s ease-in-out infinite' },
    tip: 'Едва заметный вдох-выдох: кость (обычно корпус) слегка увеличивается. Без выделения — главная корневая кость. Сила — глубина.',
    bones: (L, sel) => {
      if (sel.length) return sel;
      let best = null, bn = -1;
      for (const b of L.bones) if (b.parent == null) { const n = boneDescendants(L, b.id).size; if (n > bn) { bn = n; best = b; } }
      return best ? [best] : [];
    },
    build: (c) => c.bones.map((b) => {
      const s0 = c.base(b.scl);
      return { c: b.scl, keys: vals(cycle(c, [[0, 0, 'ease'], [0.5, 1, 'ease']]), (x) => s0 * (1 + 0.035 * c.str * x)) };
    }),
  },
];
const byId = Object.fromEntries(PRESETS.map((p) => [p.id, p]));
// мягкие переносы для длинных названий на узких карточках
const SOFT = { pop: 'Выпры\u00ADгивание', bounce: 'Подпры\u00ADгивание', heart: 'Сердце\u00ADбиение', collapse: 'Схлопы\u00ADвание', sway: 'Покачи\u00ADвание', spinin: 'Рас\u00ADкрутка' };
const ADDED = { m: 'добавлен', f: 'добавлена', n: 'добавлено' };

// ---------- применение ----------
// длительности эффектов заданы для 24 к/с; при другой частоте кадров темп в секундах сохраняется
const effDur = (p) => Math.max(2, Math.round(opt.auto ? (p.dur * ((app.doc && app.doc.fps) || 24)) / 24 : opt.dur));
const effReps = (p) => (opt.reps === 'auto' ? p.reps : opt.reps === 'end' ? 'end' : Math.max(1, +opt.reps || 1));
const okLayer = (L) => !!L && L.type !== 'audio';
// Рисунок покадрового слоя оживляем вместе со всем покадровым слоем, иначе двигался бы один рисунок
function targetLayer(L = app.active) {
  const P = L && app.idx ? app.idx.parent.get(L.id) : null;
  return P && P.type === 'switch' && P.fbf ? P : L;
}
const kindLabel = (L) => (L.type === 'switch' && L.fbf ? 'покадровый' : String(layerLabel(L) || '').toLowerCase());
// Слой или один из его родителей скрыт «глазом»
function hiddenChain(L) {
  for (let X = L; X; X = app.idx.parent.get(X.id)) if (X.vis === false) return true;
  return false;
}

function startFrame() {
  if (startOverride != null) return startOverride;
  const f = pv ? pv.orig : app.frame;
  return f > 0 ? f : Math.max(1, app.doc ? app.doc.start : 1);
}

// Удалить ключи в диапазоне [a, b] (кадр 0 не трогаем) и «удержания», которые вели к удалённому появлению.
// Возвращает число удалённых ключей, поставленных не «Оживить» (их стоит упомянуть в сообщении).
function clearRange(c, a, b) {
  const k = c.k;
  let own = 0;
  c.k = k.filter((x, i) => {
    if (x.f === 0) return true;
    if (x.f >= a && x.f <= b) { if (!x.hid && !x.pz) own++; return false; }
    if (x.hid === 2) { const nx = k[i + 1]; if (nx && nx.f >= a && nx.f <= b) return false; }
    return true;
  });
  return own;
}
const homeValue = (c, f) => evalCh({ k: c.k.filter((k) => k.f === 0 || !k.hid) }, f);
// Кадр начала a — посреди прежнего служебного перехода (например, «Появления»), который кончается в [a, b]?
// Тогда «место» слоя — ключ, которым переход заканчивается (его мог сдвинуть пользователь), а не середина пути.
// Ключ ровно на кадре a (например, слой расставили на первом кадре) — это и есть место слоя.
// Возвращает { v, own } (own — ключ поставил пользователь, его значение сохраняется, а не «заменяется»).
function landing(c, a, b) {
  let prev = null;
  for (const k of c.k) if (k.f <= a && (k.f === 0 || !k.hid)) prev = k;
  if (!prev) return undefined;
  if (prev.f === a) return prev.f > 0 ? { v: prev.v, own: !prev.pz } : undefined;
  const next = c.k.find((k) => k.f > a && !k.hid);
  if (!next || next.f > b || !c.k.some((k) => k.hid && k.f > prev.f && k.f < next.f)) return undefined;
  return { v: next.v, own: false };
}

// Геометрия слоя на кадре f без «скрытых» ключей: рамка содержимого (локальная и в кадре камеры)
// и перевод смещения из координат кадра в пространство родителя слоя.
function layerGeo(L, f) {
  const saved = [L.pos, L.rot, L.scl, L.op].map((c) => [c, c.k]);
  for (const [c] of saved) c.k = c.k.filter((k) => k.f === 0 || !k.hid);
  try {
    const S = evaluate(app.doc, f);
    const rec = S.layers.get(L.id);
    const box = (pts) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      return { x0, y0, x1, y1 };
    };
    const pts = layerWorldPoints(S, L);
    const Wi = M.inv(rec.world);
    let lb = pts.length ? box(pts.map(([x, y]) => M.apply(Wi, x, y))) : null;
    if (lb && lb.x1 - lb.x0 < 1e-6 && lb.y1 - lb.y0 < 1e-6) lb = null;
    const fb = box(pts.length ? pts.map(([x, y]) => M.apply(S.cam, x, y)) : [M.apply(S.cam, ...M.apply(rec.world, L.origin[0], L.origin[1]))]);
    const Ci = M.inv(M.mul(S.cam, M.mul(rec.world, M.inv(rec.local))));
    return { lb, fb, fw: fb.x1 - fb.x0, fh: fb.y1 - fb.y0, dir: (dx, dy) => M.applyV(Ci, dx, dy) };
  } finally {
    for (const [c, k] of saved) c.k = k;
  }
}

// Точка вращения по умолчанию [0,0] (или поставленная раньше самим «Оживить») → в центр (или к краю)
// содержимого, слой не сдвигается. Точку, заданную пользователем, не трогаем.
// keep(f) — кадры, где ключи положения пишет сам эффект (компенсирующие ключи там не нужны);
// mineKey(c, f) — ключ канала, который эффект сейчас перезапишет (не считается чужой анимацией).
function autoPivot(L, where, geo, keep, mineKey) {
  const o = L.origin;
  if (!geo.lb) return false;
  const near = (u, v) => Math.abs(u[0] - v[0]) < 1e-6 && Math.abs(u[1] - v[1]) < 1e-6;
  const fresh = near(o, [0, 0]);
  const mine = !fresh && Array.isArray(L.pzPiv) && near(o, L.pzPiv);
  if (!fresh && !mine) return false;
  const { x0, y0, x1, y1 } = geo.lb, cx = (x0 + x1) / 2;
  const pt = where === 'top' ? [cx, y0] : where === 'bottom' ? [cx, y1] : [cx, (y0 + y1) / 2];
  if (Math.hypot(pt[0] - o[0], pt[1] - o[1]) < 0.5) return false;
  // Остальная анимация поворота и масштаба зависит от точки вращения: эффекты «Оживить» не переделываем,
  // а ручные ключи сохраняем на месте ключами положения на тех же кадрах (setOrigin их компенсирует)
  const other = new Set();
  for (const c of [L.rot, L.scl]) for (const k of c.k) if (k.f > 0 && !mineKey(c, k.f)) other.add(k.f);
  if (other.size && mine) return false;
  for (const f of other) {
    if (keep(f) || L.pos.k.some((k) => k.f === f)) continue;
    let prev = L.pos.k[0];
    for (const k of L.pos.k) { if (k.f < f) prev = k; else break; }
    setKey(L.pos, f, evalCh(L.pos, f), prev.i);
  }
  setOrigin(L, pt);
  L.pzPiv = [pt[0], pt[1]];
  return true;
}

const same = (u, v) => (Array.isArray(u) ? u.every((x, i) => Math.abs(x - v[i]) < 1e-9) : Math.abs(u - v) < 1e-9);

// cyc — у циклов все ключи, отличные от исходного значения, помечаются промежуточными
function writeTrack(tr, a, cyc, base) {
  const c = tr.c;
  let last = a;
  if (tr.pre !== undefined) {
    // до начала появления слой держится в «скрытом» состоянии
    let prev = null;
    for (const k of c.k) { if (k.f < a) prev = k; else break; }
    const hf = prev ? prev.f + 1 : 1;
    if (hf < a) setKey(c, hf, tr.pre, 'step').hid = 2;
  }
  for (let [o, v, ip, hid] of tr.keys) {
    const k = setKey(c, a + o, v, ip);
    if (!hid && cyc && !same(v, base(c))) hid = 3;
    if (hid) { k.hid = hid; delete k.pz; } else { delete k.hid; k.pz = 1; }
    last = Math.max(last, a + o);
  }
  return last;
}

function selectBoneTool() { try { if (app.cmd && app.cmd.setTool) app.cmd.setTool('bmanip'); } catch (e) { /* нет инструмента */ } }

function applyPreset(p, { preview: doPreview = opt.preview } = {}) {
  const doc = app.doc;
  if (!doc) return false;
  const kind = p.cat === 'cam' ? 'cam' : p.cat === 'bone' ? 'bone' : 'layer';
  const L = targetLayer();
  let bones = null;
  if (kind !== 'cam') {
    if (!okLayer(L)) { app.toast(L ? 'У звукового слоя нет движения — выберите другой слой' : 'Сначала выберите слой в панели «Слои»', 3000); return false; }
    if (L.lock) { app.toast(`Слой «${L.name}» заблокирован — снимите замок в панели «Слои»`, 3000); return false; }
  }
  if (kind === 'bone') {
    if (L.type !== 'bone') { app.toast('Эффекты костей работают на слое костей — выберите его в панели «Слои»', 3500); return false; }
    const sel = L.bones.filter((b) => app.sel.bones.has(b.id));
    bones = p.bones ? p.bones(L, sel) : sel;
    if (!bones.length) {
      app.toast(L.bones.length ? (p.need || 'Сначала выделите кость: кликните по ней инструментом «Управление костями» (Z)') : 'В этом слое ещё нет костей', 4000);
      if (L.bones.length) selectBoneTool();
      return false;
    }
  }
  const a = startFrame(); // до остановки предпросмотра: он помнит исходный кадр
  const orig = stopPreview();
  const P0 = effDur(p);
  const tail = p.tail ? p.tail(P0) : 0;
  let n = 1, P = P0, T = P0, untilEnd = false;
  if (p.cycle) {
    const r = effReps(p);
    if (r === 'end') {
      const avail = doc.end + 1 - a - tail;
      // до конца сцены: целое число повторов, слегка растянутых или сжатых; если места почти нет — один полный
      if (avail >= Math.max(8, P0 * 0.35)) { n = Math.max(1, Math.round(avail / P0)); P = avail / n; T = avail; untilEnd = true; }
    } else n = r;
    if (!untilEnd) T = n * P0;
  }
  const b = a + T + tail;
  const target = kind === 'cam' ? doc.cam : L;
  const chans = kind === 'bone' ? bones.flatMap((bn) => p.ch.map((k) => bn[k])) : p.ch.map((k) => target[k]);
  const land = new Map();
  for (const c of chans) { const v = landing(c, a, b); if (v !== undefined) land.set(c, v); }
  let replaced = 0;
  for (const c of chans) replaced += clearRange(c, a, b);
  // место слоя на кадре a — временным ключом (эффект перезапишет его своим первым ключом)
  for (const [c, v] of land) { setKey(c, a, v.v, 'smooth'); if (v.own) replaced--; }
  replaced = Math.max(0, replaced);
  let geo = null;
  if (kind === 'layer') {
    geo = layerGeo(L, a);
    const writesPos = p.ch.includes('pos');
    if (p.pivot) autoPivot(L, p.pivot, geo, (f) => writesPos && f >= a && f <= b, (c, f) => chans.includes(c) && f >= a && f <= b);
  }
  const cache = new Map();
  const ctx = {
    a, P, n, T, tail, untilEnd, str: opt.str, doc, L, cam: doc.cam, bones, geo,
    r: (t) => Math.round(T * t),
    base: (c) => { if (!cache.has(c)) cache.set(c, homeValue(c, a)); return cache.get(c); },
    // смещение «за край кадра» (в пространстве родителя), умноженное на силу
    off: (side) => {
      const fb = geo.fb, w = doc.w, hh = doc.h, m = 24;
      let dx = 0, dy = 0;
      if (side === 'left') dx = Math.min(-(fb.x1 + w / 2) - m, -40);
      if (side === 'right') dx = Math.max(w / 2 - fb.x0 + m, 40);
      if (side === 'top') dy = Math.min(-(fb.y1 + hh / 2) - m, -40);
      if (side === 'bottom') dy = Math.max(hh / 2 - fb.y0 + m, 40);
      return geo.dir(dx * opt.str, dy * opt.str);
    },
  };
  let last = a;
  try {
    for (const tr of p.build(ctx)) last = Math.max(last, writeTrack(tr, a, !!p.cycle, ctx.base));
  } catch (e) {
    console.error('Оживить:', p.id, e);
    app.restoreSnap(app.history.stack[app.history.i].snap); // откатить частично записанное
    app.toast('Не удалось добавить анимацию', 2500);
    return false;
  }
  const lastPlayed = untilEnd ? Math.min(last, doc.end) : last;
  let msg = `«${p.name}» ${ADDED[p.g] || 'добавлено'}: кадры ${a}–${lastPlayed}`;
  if (kind === 'bone' && bones.length > 1) msg += ` (костей: ${bones.length})`;
  if (replaced) msg += `. Заменены прежние ключи (${replaced}) — Ctrl+Z вернёт их`;
  if (lastPlayed > doc.end) { doc.end = lastPlayed; msg += `. Сцена удлинена до кадра ${lastPlayed}`; }
  if (kind !== 'cam' && hiddenChain(L)) msg += '. Слой скрыт — включите «глаз» в панели «Слои», чтобы его увидеть';
  app.commit('Оживить: ' + p.name);
  app.toast(msg, msg.length > 50 ? 3500 : 2600);
  lastApplied = { p, next: lastPlayed + 1 };
  updNext();
  if (doPreview) preview(a, Math.min(lastPlayed, a + Math.max(P0, Math.min(2 * Math.round(P), 3 * doc.fps))), orig);
  else if (orig != null && orig !== app.frame) app.setFrame(orig);
  return true;
}

// ---------- предпросмотр ----------
let pv = null, previewing = false;
const setFrameQuiet = (f) => { previewing = true; try { app.setFrame(f); } finally { previewing = false; } };
function stopPreview(restore = false) {
  if (!pv) return null;
  const o = pv.orig;
  cancelAnimationFrame(pv.raf);
  pv = null;
  if (restore && app.frame !== o) setFrameQuiet(o);
  return o;
}
function preview(a, b, orig = null) {
  if (app.playing) app.emit('stop');
  const fps = app.doc.fps, t0 = performance.now();
  pv = { raf: 0, last: null, orig: orig != null ? orig : app.frame };
  const tick = (now) => {
    if (!pv) return;
    // пользователь сам запустил воспроизведение или сменил кадр — не мешаем
    if (app.playing) { pv = null; return; }
    if (pv.last != null && app.frame !== pv.last) { pv = null; startOverride = null; refreshStart(); return; }
    const f = a + Math.floor(((now - t0) / 1000) * fps);
    if (f > b) { stopPreview(true); refreshStart(); return; }
    if (f !== app.frame) setFrameQuiet(f);
    pv.last = app.frame;
    pv.raf = requestAnimationFrame(tick);
  };
  pv.raf = requestAnimationFrame(tick);
}
// Клик или клавиша во время показа — сначала вернуться на исходный кадр, чтобы правка не попала на кадр показа
function interruptPreview(e) {
  if (!pv) return;
  if (e.type === 'keydown' && (e.repeat || ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key))) return;
  if (e.type === 'pointerdown' && e.target && e.target.closest && e.target.closest('.pz-card')) return; // новая карточка сама перезапустит показ
  stopPreview(true);
  refreshStart();
}
document.addEventListener('pointerdown', interruptPreview, true);
document.addEventListener('keydown', interruptPreview, true);

// ---------- убрать анимацию ----------
function clearLayerAnim() {
  const L = targetLayer();
  if (!okLayer(L)) { app.toast('Сначала выберите слой в панели «Слои»'); return; }
  if (L.lock) { app.toast(`Слой «${L.name}» заблокирован`); return; }
  const chans = [L.pos, L.rot, L.scl, L.op];
  const boneCh = L.type === 'bone' ? L.bones.flatMap((b) => [b.pos, b.ang, b.scl]) : [];
  const count = (list) => list.reduce((s, c) => s + c.k.filter((k) => k.f > 0).length, 0);
  const n = count(chans), nb = count(boneCh);
  if (!n && !nb) { app.toast(`У слоя «${L.name}» нет анимации движения`); return; }
  let withBones = !n && nb > 0;
  const run = () => {
    stopPreview(true);
    for (const c of chans.concat(withBones ? boneCh : [])) c.k = c.k.filter((k) => k.f === 0);
    app.commit('Убрать анимацию слоя');
    app.toast(`Анимация слоя «${L.name}» убрана. Ctrl+Z — вернуть`, 2600);
  };
  dialog({
    title: 'Убрать анимацию слоя',
    width: 400,
    body: h('div', null,
      h('p', null, `Удалить ключи положения, поворота, масштаба и прозрачности слоя «${L.name}»?`),
      h('p', { class: 'muted' }, `Ключей: ${n}. Поза покоя (кадр 0) останется. Отменить можно через Ctrl+Z.`),
      nb ? checkField(`Также убрать анимацию костей (ключей: ${nb})`, withBones, (v) => { withBones = v; }) : null,
    ),
    buttons: [{ label: 'Отмена' }, { label: 'Убрать', primary: true, action: run }],
  });
}

async function clearCamAnim() {
  const cam = app.doc.cam, chans = [cam.pos, cam.zoom, cam.roll];
  const n = chans.reduce((s, c) => s + c.k.filter((k) => k.f > 0).length, 0);
  if (!n) { app.toast('У камеры нет анимации'); return; }
  if (!(await confirmDialog('Убрать анимацию камеры', `Удалить все ключи камеры (${n}), кроме кадра 0? Отменить можно через Ctrl+Z.`, 'Убрать'))) return;
  stopPreview(true);
  for (const c of chans) c.k = c.k.filter((k) => k.f === 0);
  app.commit('Убрать анимацию камеры');
  app.toast('Анимация камеры убрана');
}

// ---------- панель ----------
let ui = null, lastApplied = null;

function openTab() {
  if (!app.showSideTab) return;
  app.showSideTab('presets');
  const side = document.getElementById('side');
  if (side && !side.offsetWidth) app.toast('Панель «Оживить» справа скрыта — расширьте окно браузера', 3000);
}

function stage(p) {
  const k = p.pv.k, a = p.pv.a;
  const st = (style) => (a ? { animation: a, ...style } : style);
  let kids;
  switch (k) {
    case 'ground': kids = [h('i', { class: 'pz-gnd' }), h('i', { class: 'pz-a pz-low', style: st() })]; break;
    case 'tall': kids = [h('i', { class: 'pz-gnd' }), h('i', { class: 'pz-a pz-low pz-tall', style: st() })]; break;
    case 'pend': kids = [h('i', { class: 'pz-hook' }), h('i', { class: 'pz-pend', style: st() })]; break;
    case 'cam': kids = [h('i', { class: 'pz-world', style: st() }, h('i', { class: 'pz-sun' }), h('i', { class: 'pz-hill' }), h('i', { class: 'pz-hero' })), h('i', { class: 'pz-frame' })]; break;
    case 'arm': kids = [h('i', { class: 'pz-gnd' }), h('i', { class: 'pz-bone pz-arm', style: st() })]; break;
    case 'chain': {
      let inner = null;
      for (let i = 3; i >= 0; i--) inner = h('i', { class: 'pz-bone' + (i ? '' : ' pz-chain'), style: { animationDelay: `${-i * 0.18}s` } }, inner);
      kids = [inner];
      break;
    }
    case 'nod': kids = [h('i', { class: 'pz-gnd' }), h('i', { class: 'pz-bone pz-body' }), h('i', { class: 'pz-headb', style: st() }, h('i', { class: 'pz-face' }))]; break;
    case 'breath': kids = [h('i', { class: 'pz-gnd' }), h('i', { class: 'pz-torso', style: st() })]; break;
    default: kids = [h('i', { class: 'pz-a', style: st() })];
  }
  return h('span', { class: 'pz-stage', 'aria-hidden': 'true' }, kids);
}

function flash(el) { el.classList.remove('done'); void el.offsetWidth; el.classList.add('done'); }

function mount(el) {
  const tgtIc = h('span', { class: 'pz-tgt-ic' });
  const tgtTxt = h('span', { class: 'pz-tgt-t' });
  const clearBtn = h('button', { class: 'icon-btn pz-clear', title: 'Убрать анимацию слоя: удалить ключи положения, поворота, масштаба и прозрачности (поза покоя на кадре 0 останется)', 'aria-label': 'Убрать анимацию слоя', onclick: clearLayerAnim }, icon('trash', 16));
  const clearBtn2 = h('button', { class: 'btn sm pz-clear2', title: 'Удалить ключи положения, поворота, масштаба и прозрачности активного слоя (поза покоя на кадре 0 останется)', onclick: clearLayerAnim }, icon('trash', 14), 'Убрать анимацию слоя');
  const startF = numField('Начало', startFrame(), {
    min: 1, max: 99999, step: 1, prec: 0, unit: 'к', title: 'Кадр, с которого начнётся анимация',
    onCommit: (v) => { startOverride = Math.max(1, Math.round(v)); refreshStart(); },
  });
  const startNote = h('div', { class: 'pz-hint' });
  const durF = numField('Длительность', opt.dur, {
    min: 2, max: 600, step: 1, prec: 0, unit: 'к', title: 'Длительность в кадрах (у циклов — длина одного повтора)',
    onCommit: (v) => { opt.dur = Math.round(v); opt.auto = false; autoC.querySelector('input').checked = false; saveOpt(); updCards(); },
  });
  const autoC = checkField('авто', opt.auto, (v) => { opt.auto = v; saveOpt(); updCards(); }, 'У каждого эффекта своя подходящая длительность (видна на карточке)');
  const strF = rangeField('Сила', opt.str, { min: 0.25, max: 3, step: 0.05, prec: 2, onLive: (v) => { opt.str = v; }, onCommit: (v) => { opt.str = v; saveOpt(); updMore(); } });
  strF.title = 'Размах движения: 1 — обычный, меньше — спокойнее, больше — сильнее. Двойной клик по слову «Сила» — вернуть 1';
  strF.querySelector('.rng-l').addEventListener('dblclick', () => { opt.str = 1; strF.set(1); saveOpt(); updMore(); });
  const repsF = selectField('Повторы', opt.reps, REPS, (v) => { opt.reps = v; saveOpt(); updCards(); });
  repsF.title = 'Сколько раз повторить цикл. «Авто» — до конца сцены для плавных циклов, один раз для тряски и кивка';
  const pvC = checkField('Сразу показать результат', opt.preview, (v) => { opt.preview = v; saveOpt(); updMore(); }, 'После добавления один раз проиграть анимацию');
  // второстепенные настройки свёрнуты, чтобы карточки эффектов были видны сразу
  const setMore = (on) => { opt.more = on; saveOpt(); updMore(); };
  const moreDot = h('i', { class: 'pz-dot', hidden: true });
  const moreBtn = h('button', { class: 'btn sm pz-more-btn', onclick: () => setMore(!opt.more) }, icon('settings', 14), h('span', null, 'Настройки'), moreDot, h('span', { class: 'pz-caret' }, '▾'));
  const moreSum = h('button', { class: 'pz-link pz-sum', hidden: true, onclick: () => setMore(true) });
  const more = h('div', { class: 'pz-more', hidden: true },
    h('div', { class: 'pz-row' }, repsF),
    h('div', { class: 'pz-row' }, durF, autoC),
    strF,
    pvC,
  );
  const nextBtn = h('button', { class: 'pz-next', hidden: true, onclick: () => { if (lastApplied) { startOverride = lastApplied.next; refreshStart(); } } });

  const cards = [];
  const card = (p) => {
    const badge = h('span', { class: 'pz-meta' });
    const btn = h('button', { class: 'pz-card', 'data-preset': p.id, onclick: () => { if (applyPreset(p)) flash(btn); } }, stage(p), h('span', { class: 'pz-name' }, SOFT[p.id] || p.name), badge);
    cards.push({ p, btn, badge });
    return btn;
  };
  const cats = {};
  for (const cat of CATS) {
    const head = h('div', { class: 'pz-cat-h' }, h('span', { class: 'pz-cat-t' }, cat.name));
    if (cat.id === 'cam') head.append(h('button', { class: 'pz-link', title: 'Удалить все ключи камеры, кроме кадра 0', onclick: clearCamAnim }, 'убрать анимацию камеры'));
    const note = h('div', { class: 'insp-note pz-cat-n' }, cat.note);
    const sec = h('section', { class: 'pz-cat' }, head, note, h('div', { class: 'pz-grid' }, PRESETS.filter((p) => p.cat === cat.id).map(card)));
    cats[cat.id] = { sec, note };
  }
  const boneHint = h('div', { class: 'pz-bonehint', hidden: true });
  // эффекты конкретного типа слоя (registerLayerType(..., { effects: [{ id, name, hint, apply(L, { start }) }] }))
  const typeSec = h('section', { class: 'pz-cat pz-typefx', hidden: true });

  el.classList.add('pz');
  el.append(
    h('div', { class: 'pz-tgt' }, tgtIc, tgtTxt, clearBtn),
    h('div', { class: 'pz-ctl' },
      h('div', { class: 'pz-row' }, h('div', { class: 'pz-col' }, startF, startNote), moreBtn),
      moreSum,
      more,
    ),
    nextBtn,
    typeSec,
    cats.in.sec, cats.out.sec, cats.loop.sec, cats.cam.sec, cats.bone.sec, boneHint,
    h('div', { class: 'insp-note pz-tip' }, 'Клик по карточке сразу добавляет ключи на таймлайн. Эффекты можно сочетать: например, «Вылет слева» и «Проявление» с одного кадра. Ctrl+Z — отменить.'),
    h('div', { class: 'pz-foot' }, clearBtn2),
  );
  ui = { startF, startNote, durF, autoC, strF, repsF, pvC, nextBtn, tgtIc, tgtTxt, clearBtn, clearBtn2, cards, cats, boneHint, more, moreBtn, moreDot, moreSum, typeSec };
  updMore();
  refresh();
}

// Кнопка «Настройки»: точка и строка-сводка, если что-то отличается от обычного
function updMore() {
  if (!ui) return;
  const ch = [];
  if (Math.abs(opt.str - 1) > 1e-9) ch.push('сила ' + String(+opt.str.toFixed(2)).replace('.', ','));
  if (!opt.auto) ch.push(`длительность ${opt.dur} к`);
  if (opt.reps !== 'auto') ch.push('повторы: ' + REPS[opt.reps].toLowerCase());
  if (!opt.preview) ch.push('без показа результата');
  ui.more.hidden = !opt.more;
  ui.moreBtn.classList.toggle('on', opt.more);
  ui.moreBtn.setAttribute('aria-expanded', String(opt.more));
  ui.moreBtn.title = (opt.more ? 'Скрыть' : 'Показать') + ' настройки: повторы, длительность, сила, показ результата' + (ch.length ? '\nИзменено: ' + ch.join(', ') : '');
  ui.moreDot.hidden = !ch.length;
  ui.moreSum.hidden = opt.more || !ch.length;
  ui.moreSum.textContent = ch.length ? 'Изменено: ' + ch.join(' · ') : '';
}

function refreshStart() {
  if (!ui) return;
  ui.shownStart = startFrame();
  ui.startF.set(ui.shownStart);
  const n = ui.startNote;
  n.textContent = '';
  if (startOverride != null) n.append('задано вручную · ', h('button', { class: 'pz-link', onclick: () => { startOverride = null; refreshStart(); } }, 'текущий кадр'));
  else n.textContent = (pv ? pv.orig : app.frame) > 0 ? '= текущий кадр' : 'с начала сцены';
  updNext();
}

function updNext() {
  if (!ui) return;
  const la = lastApplied, show = !!la && app.doc && la.next <= app.doc.end && startFrame() !== la.next;
  ui.nextBtn.hidden = !show;
  if (show) {
    ui.nextBtn.textContent = '';
    ui.nextBtn.append(icon('next', 14), `Следующий эффект — после «${la.p.name}» (с кадра ${la.next})`);
  }
}

function updCards() {
  if (!ui) return;
  updMore();
  const fps = (app.doc && app.doc.fps) || 24, L = targetLayer();
  ui.durF.set(opt.dur);
  ui.durF.classList.toggle('pz-dim', opt.auto);
  for (const { p, btn, badge } of ui.cards) {
    const d = effDur(p), r = p.cycle ? effReps(p) : null;
    badge.textContent = d + ' к' + (p.cycle ? (r === 'end' ? ' · ↻' : ' · ×' + r) : '');
    const sec = (d / fps).toFixed(d % fps ? 1 : 0).replace('.', ',');
    const na = p.cat !== 'cam' && !okLayer(L);
    btn.classList.toggle('na', na);
    btn.title = (p.full || p.name) + '\n' + p.tip + `\n\nДлительность: ${d} к. (${sec} с)` +
      (p.cycle ? `\nПовторы: ${r === 'end' ? 'до конца сцены' : r}` : '') +
      (na ? '\n\nСначала выберите слой в панели «Слои».' : '');
  }
}

function refresh() {
  if (!ui || !app.doc) return;
  const L = targetLayer();
  ui.tgtIc.textContent = '';
  if (okLayer(L)) {
    ui.tgtIc.append(icon(layerIcon(L) || 'vector', 15));
    ui.tgtTxt.textContent = '';
    const st = (L.lock ? ' · заблокирован' : '') + (hiddenChain(L) ? ' · скрыт' : '');
    ui.tgtTxt.append('Слой: ', h('b', null, L.name), h('span', { class: 'muted' }, ` · ${kindLabel(L)}${st}`));
    ui.tgtTxt.title = `Эффекты слоя применяются к «${L.name}»` + (L !== app.active ? ' — целиком, со всеми рисунками' : '');
  } else {
    ui.tgtIc.append(icon('help', 15));
    ui.tgtTxt.textContent = L ? 'Звуковой слой нельзя оживить — выберите другой' : 'Слой не выбран — выберите его в панели «Слои»';
    ui.tgtTxt.title = '';
  }
  ui.clearBtn.disabled = ui.clearBtn2.disabled = !okLayer(L);
  // кости
  const isBone = !!L && L.type === 'bone';
  const B = L && !isBone && app.idx ? boneAncestor(app.idx, L) : null;
  ui.cats.bone.sec.hidden = !isBone;
  // на слое костей эффекты костей — самые нужные: показываем их первыми
  const bsec = ui.cats.bone.sec, anchor = isBone ? ui.cats.in.sec : ui.cats.cam.sec.nextSibling;
  if (bsec.nextSibling !== anchor && bsec !== anchor) anchor.parentNode.insertBefore(bsec, anchor);
  if (isBone) {
    const n = L.bones.filter((b) => app.sel.bones.has(b.id)).length;
    ui.cats.bone.note.textContent = !L.bones.length ? 'В этом слое пока нет костей.'
      : n ? `Выделено костей: ${n} — эффект применится к ним.`
        : 'Выделите кость кликом инструментом «Управление костями» (Z). «Кивок» и «Дыхание» найдут кость сами.';
  }
  ui.boneHint.hidden = !B;
  if (B) {
    ui.boneHint.textContent = '';
    ui.boneHint.append(h('span', null, 'Хотите оживить кости? Эффекты костей — на слое «', h('b', null, B.name), '».'),
      h('button', { class: 'btn sm', onclick: () => app.setActive(B.id) }, icon('bone', 14), 'Выбрать слой костей'));
  }
  updTypeFx(L);
  refreshStart();
  updCards();
}

function updTypeFx(L) {
  const sec = ui.typeSec, xt = L && registry.layerTypes[L.type];
  const fx = xt && Array.isArray(xt.effects) ? xt.effects : [];
  sec.hidden = !fx.length || !!(L && L.lock);
  const key = fx.length ? L.type : '';
  if (sec.dataset.k === key) return;
  sec.dataset.k = key;
  sec.textContent = '';
  if (!fx.length) return;
  sec.append(
    h('div', { class: 'pz-cat-h' }, h('span', { class: 'pz-cat-t' }, 'Особые эффекты: ' + (xt.label || L.type))),
    h('div', { class: 'pz-grid' }, fx.map((e) => {
      const btn = h('button', { class: 'pz-card', 'data-typefx': e.id, title: e.hint || e.name, onclick: () => {
        const T = targetLayer();
        if (!T || T.type !== key) return;
        try { if (e.apply(T, { start: startFrame() }) !== false) flash(btn); } catch (er) { console.error(er); app.toast('Не удалось применить эффект'); }
      } }, h('span', { class: 'pz-stage', 'aria-hidden': 'true' }, h('i', { class: 'pz-a', style: { animation: 'pz-fadein 1.8s infinite' } })), h('span', { class: 'pz-name' }, e.name), h('span', { class: 'pz-meta' }, e.meta || ''));
      return btn;
    })),
  );
}

registerSideTab({ id: 'presets', title: 'Оживить', icon: 'sparkle', order: -10, mount, refresh });

app.on('frame', () => {
  if (previewing || pv || app.playing) return;
  startOverride = null;
  refreshStart();
});
// после остановки воспроизведения кадр меняется без события — подтянуть поле «Начало»
app.on('render', () => { if (ui && !pv && !app.playing && startOverride == null && ui.shownStart !== startFrame()) refreshStart(); });
app.on('docloaded', () => { stopPreview(); startOverride = null; lastApplied = null; refresh(); });
app.on('toggleplay', () => { if (pv) { pv = null; } });

// ---------- кнопка, меню, таймлайн, свойства ----------
registerMenubarButton(() => h('button', { class: 'pz-mb', title: 'Оживить: готовые анимации в один клик', onclick: openTab }, icon('sparkle', 16), h('span', null, 'Оживить')));

const QUICK = [['Появление', ['fadein', 'inleft', 'inbottom', 'pop']], ['Исчезновение', ['fadeout', 'outright', 'collapse']], ['Циклы', ['bounce', 'sway', 'pulse', 'spin', 'float', 'shake']]];
registerMenu('Анимация', () => [
  { label: 'Оживить: готовые анимации…', icon: 'sparkle', action: openTab },
  {
    label: 'Оживить слой', icon: 'sparkle', disabled: () => !okLayer(targetLayer()),
    sub: QUICK.flatMap(([t, ids]) => [{ title: t }, ...ids.map((id) => ({ label: byId[id].name, action: () => applyPreset(byId[id]) }))]),
  },
  { label: 'Убрать анимацию слоя…', disabled: () => !okLayer(targetLayer()), action: clearLayerAnim },
]);

registerTimelineMenu(({ row, frame }) => {
  const f = Math.max(1, frame);
  if (row && row.kind === 'cam') return [{ label: `Оживить камеру с кадра ${f}…`, icon: 'sparkle', action: () => { openTab(); startOverride = f; refreshStart(); } }];
  const L = row && row.layer, T = targetLayer(L);
  if (!okLayer(T)) return [];
  return [{
    label: `Оживить «${T.name}» с кадра ${f}…`, icon: 'sparkle',
    action: () => { if (app.activeId !== L.id) app.setActive(L.id); openTab(); startOverride = f; refreshStart(); },
  }];
});

registerInspector({
  id: 'presets-link', order: -50, when: (L) => okLayer(L),
  build: () => h('section', { class: 'insp-sec pz-insp' },
    h('button', { class: 'pz-insp-btn', title: 'Готовые анимации: появление, исчезновение, циклы, камера', onclick: openTab }, icon('sparkle', 16), 'Оживить слой — готовые движения')),
});

// ---------- стили ----------
addStyle(`
.pz-mb { display: inline-flex; align-items: center; gap: 6px; padding: 4px 11px; border-radius: var(--radius); border: 0; font-size: 12px; font-weight: 600; color: #22140f; background: linear-gradient(135deg, #ffc46b, #ff7a59); white-space: nowrap; box-shadow: 0 1px 6px rgba(255,122,89,.25); }
.pz-mb:hover { filter: brightness(1.08); }
.pz { padding: 8px 10px 24px; overflow-x: hidden; }
.pz-tgt { display: flex; align-items: center; gap: 6px; padding: 2px 0 8px; border-bottom: 1px solid var(--line); min-width: 0; }
.pz-tgt-ic { color: var(--warm); display: inline-flex; }
.pz-tgt-t { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 12.5px; }
.pz-tgt-t b { color: #fff; font-weight: 600; }
.pz-clear { flex: none; width: 26px; height: 24px; }
.pz-clear:hover { color: var(--danger); }
.pz-clear:disabled, .pz-clear2:disabled { opacity: .4; cursor: default; }
.pz-foot { margin-top: 10px; }
.pz-clear2:hover:not(:disabled) { color: #ffb3bb; background: #5a2a31; }
.pz-ctl { padding: 6px 0 4px; }
.pz-row { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 6px 8px; margin: 6px 0; }
.pz-row > .num { flex: 1 1 140px; min-width: 0; }
.pz-row > .sel { flex: 1 1 118px; min-width: 0; }
.pz-row > .sel span { white-space: nowrap; }
.pz-row > .chk { flex: none; height: 26px; }
.pz-col { flex: 1 1 118px; min-width: 0; display: flex; flex-direction: column; }
.pz-col > .num { width: 100%; }
.pz-hint { color: var(--text3); font-size: 11px; margin-top: 2px; min-height: 14px; }
.pz-dim { opacity: .5; }
.pz-more-btn { flex: none; height: 26px; gap: 5px; padding: 0 8px; color: var(--text2); }
.pz-more-btn:hover, .pz-more-btn.on { color: var(--text); }
.pz-more-btn .pz-caret { font-size: 10px; color: var(--text3); transition: transform .15s; }
.pz-more-btn.on .pz-caret { transform: rotate(180deg); }
.pz-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--warm); }
.pz-dot[hidden], .pz-more[hidden], .pz-link.pz-sum[hidden] { display: none; }
.pz-more { margin: 2px 0 4px; padding: 2px 8px 6px; border-radius: 6px; background: var(--bg2); }
.pz-link.pz-sum { display: block; margin: -2px 0 4px; color: var(--warm); text-align: left; }
.pz-link { border: 0; background: none; padding: 0; color: var(--accent); font-size: 11px; cursor: pointer; }
.pz-link:hover { text-decoration: underline; }
.pz-next { display: flex; align-items: center; gap: 6px; width: 100%; margin: 4px 0 2px; padding: 6px 8px; border-radius: 6px; border: 1px dashed rgba(76,157,255,.45); background: var(--accent-bg); color: var(--text); font-size: 12px; text-align: left; }
.pz-next:hover { border-style: solid; }
.pz-next[hidden] { display: none; }
.pz-next .ic { color: var(--accent); }
.pz-cat { padding-top: 10px; }
.pz-cat[hidden] { display: none; }
.pz-cat-h { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; }
.pz-cat-t { font-size: 11px; text-transform: uppercase; letter-spacing: .6px; color: var(--text2); font-weight: 600; }
.pz-cat-n { margin: 2px 0 6px; }
.pz-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(78px, 1fr)); gap: 6px; }
.pz-card { position: relative; display: flex; flex-direction: column; align-items: stretch; gap: 4px; padding: 4px 4px 5px; border-radius: 7px; border: 1px solid var(--line2); background: var(--bg2); color: var(--text); text-align: center; min-width: 0; }
.pz-card:hover { border-color: var(--accent); background: #26354a; }
.pz-card:active { transform: translateY(1px); }
.pz-card.na { opacity: .55; }
.pz-card.done { animation: pz-done .7s ease-out; }
@keyframes pz-done { 0% { box-shadow: 0 0 0 0 rgba(255,173,92,.9); border-color: var(--warm); } 100% { box-shadow: 0 0 0 8px rgba(255,173,92,0); } }
.pz-name { flex: 1; font-size: 11.5px; line-height: 1.2; display: flex; align-items: center; justify-content: center; hyphens: manual; }
.pz-meta { color: var(--text3); font-size: 9.5px; line-height: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pz-card:hover .pz-meta { color: var(--text2); }
.pz-stage { position: relative; display: block; height: 44px; border-radius: 5px; background: var(--bg0); overflow: hidden; }
.pz-stage i { position: absolute; display: block; }
.pz-a { left: 50%; top: 50%; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 4px; background: linear-gradient(135deg, #ffc46b, #ff7a59); box-shadow: 0 1px 3px rgba(0,0,0,.4); }
.pz-gnd { left: 10px; right: 10px; bottom: 7px; height: 1px; background: var(--line2); }
.pz-a.pz-low { top: auto; bottom: 8px; margin: 0 0 0 -7px; transform-origin: 50% 100%; }
.pz-a.pz-tall { width: 9px; height: 24px; margin-left: -4.5px; border-radius: 5px 5px 2px 2px; }
.pz-hook { left: 50%; top: 3px; width: 6px; height: 3px; margin-left: -3px; border-radius: 2px; background: var(--text3); }
.pz-pend { left: 50%; top: 5px; width: 2px; height: 22px; margin-left: -1px; background: var(--text2); transform-origin: 50% 0; }
.pz-pend::after { content: ''; position: absolute; left: 50%; bottom: -10px; width: 12px; height: 12px; margin-left: -6px; border-radius: 4px; background: linear-gradient(135deg, #ffc46b, #ff7a59); }
.pz-world { inset: 0; transform-origin: 50% 50%; }
.pz-sun { left: 22%; top: 9px; width: 9px; height: 9px; border-radius: 50%; background: #ffd44d; }
.pz-hill { left: -30%; right: -30%; bottom: -14px; height: 26px; border-radius: 50%; background: #3f7a2e; }
.pz-hero { left: 58%; bottom: 9px; width: 9px; height: 13px; border-radius: 5px 5px 2px 2px; background: linear-gradient(135deg, #ffc46b, #ff7a59); }
.pz-frame { inset: 6px 14px; border: 1.5px dashed rgba(255,255,255,.55); border-radius: 3px; }
.pz-bone { left: 15px; top: 0; width: 17px; height: 5px; border-radius: 3px; background: #4c9dff; transform-origin: 2.5px 50%; animation: pz-bw 1.6s ease-in-out infinite alternate; }
.pz-bone::before { content: ''; position: absolute; left: -1px; top: -1px; width: 7px; height: 7px; border-radius: 50%; background: #9cc8ff; }
.pz-stage > .pz-chain { left: 10px; top: 50%; margin-top: -2.5px; }
.pz-bone.pz-arm { left: 50%; top: auto; bottom: 8px; width: 24px; margin-left: -2.5px; transform: rotate(-60deg); }
.pz-bone.pz-body { left: 50%; top: auto; bottom: 8px; width: 20px; margin-left: -2.5px; transform: rotate(-90deg); animation: none; }
.pz-headb { left: 50%; bottom: 25px; width: 14px; height: 14px; margin-left: -7px; border-radius: 50%; background: linear-gradient(135deg, #ffc46b, #ff7a59); transform-origin: 50% 120%; }
.pz-face { right: 2px; top: 5px; width: 3px; height: 3px; border-radius: 50%; background: #3a2418; }
.pz-torso { left: 50%; bottom: 8px; width: 16px; height: 24px; margin-left: -8px; border-radius: 8px 8px 4px 4px; background: #4c9dff; transform-origin: 50% 100%; }
.pz-torso::before { content: ''; position: absolute; left: 50%; top: -11px; width: 10px; height: 10px; margin-left: -5px; border-radius: 50%; background: linear-gradient(135deg, #ffc46b, #ff7a59); }
.pz-insp { padding: 6px 10px; }
.pz-insp-btn { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid rgba(255,173,92,.45); background: rgba(255,173,92,.1); color: var(--text); font-size: 12px; }
.pz-insp-btn:hover { background: rgba(255,173,92,.2); border-color: var(--warm); }
.pz-insp-btn .ic { color: var(--warm); }
.pz-bonehint { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; margin-top: 12px; padding: 8px; border-radius: 6px; background: var(--bg2); color: var(--text2); font-size: 12px; }
.pz-bonehint[hidden] { display: none; }
.pz-bonehint b { color: var(--text); }
.pz-tip { margin-top: 14px; line-height: 1.4; }
@keyframes pz-fadein { 0%, 12% { opacity: 0 } 55%, 100% { opacity: 1 } }
@keyframes pz-inl { 0%, 10% { transform: translateX(-48px); animation-timing-function: cubic-bezier(.2,.8,.3,1) } 46% { transform: translateX(3px) } 58%, 100% { transform: none } }
@keyframes pz-inr { 0%, 10% { transform: translateX(48px); animation-timing-function: cubic-bezier(.2,.8,.3,1) } 46% { transform: translateX(-3px) } 58%, 100% { transform: none } }
@keyframes pz-int { 0%, 10% { transform: translateY(-34px); animation-timing-function: cubic-bezier(.2,.8,.3,1) } 46% { transform: translateY(2px) } 58%, 100% { transform: none } }
@keyframes pz-inb { 0%, 10% { transform: translateY(34px); animation-timing-function: cubic-bezier(.2,.8,.3,1) } 46% { transform: translateY(-2px) } 58%, 100% { transform: none } }
@keyframes pz-pop { 0%, 10% { transform: scale(0) } 36% { transform: scale(1.35) } 48% { transform: scale(.9) } 58%, 100% { transform: scale(1) } }
@keyframes pz-spinin { 0%, 8% { transform: rotate(-360deg) scale(0) } 60%, 100% { transform: rotate(0) scale(1) } }
@keyframes pz-fadeout { 0%, 35% { opacity: 1 } 80%, 100% { opacity: 0 } }
@keyframes pz-outr { 0%, 30% { transform: none } 40% { transform: translateX(-4px); animation-timing-function: cubic-bezier(.6,0,.9,.5) } 78%, 100% { transform: translateX(48px) } }
@keyframes pz-outl { 0%, 30% { transform: none } 40% { transform: translateX(4px); animation-timing-function: cubic-bezier(.6,0,.9,.5) } 78%, 100% { transform: translateX(-48px) } }
@keyframes pz-outu { 0%, 30% { transform: none } 40% { transform: translateY(3px); animation-timing-function: cubic-bezier(.6,0,.9,.5) } 78%, 100% { transform: translateY(-34px) } }
@keyframes pz-collapse { 0%, 30% { transform: scale(1) } 42% { transform: scale(1.2) } 74%, 100% { transform: scale(0) } }
@keyframes pz-bounce { 0%, 100% { transform: translateY(0) scale(1.25, .75); animation-timing-function: ease-out } 12% { transform: translateY(-3px) scale(.88, 1.12); animation-timing-function: ease-out } 50% { transform: translateY(-20px) scale(1); animation-timing-function: ease-in } 88% { transform: translateY(-3px) scale(.88, 1.12); animation-timing-function: ease-in } }
@keyframes pz-sway { 0%, 100% { transform: rotate(-14deg) } 50% { transform: rotate(14deg) } }
@keyframes pz-pendulum { 0%, 100% { transform: rotate(32deg) } 50% { transform: rotate(-32deg) } }
@keyframes pz-pulse { 0%, 100% { transform: scale(1) } 50% { transform: scale(1.4) } }
@keyframes pz-spin { to { transform: rotate(360deg) } }
@keyframes pz-float { 0%, 100% { transform: translateY(5px) } 50% { transform: translateY(-6px) } }
@keyframes pz-shake { 0%, 60%, 100% { transform: none } 8% { transform: translateX(-8px) } 16% { transform: translateX(7px) } 24% { transform: translateX(-5px) } 32% { transform: translateX(4px) } 40% { transform: translateX(-2px) } 48% { transform: translateX(1px) } }
@keyframes pz-jitter { 0%, 100% { transform: translate(0, 0) } 25% { transform: translate(-1.5px, 1px) } 50% { transform: translate(1.5px, -1px) } 75% { transform: translate(-1px, -1.5px) } }
@keyframes pz-heart { 0%, 50%, 100% { transform: scale(1) } 10% { transform: scale(1.4) } 20% { transform: scale(1.05) } 30% { transform: scale(1.3) } }
@keyframes pz-jelly { 0%, 72%, 100% { transform: scale(1) } 12% { transform: scale(1.4, .65) } 26% { transform: scale(.78, 1.25) } 40% { transform: scale(1.14, .88) } 54% { transform: scale(.95, 1.05) } }
@keyframes pz-zin { 0%, 15% { transform: scale(1) } 70%, 100% { transform: scale(1.75) } }
@keyframes pz-zout { 0%, 15% { transform: scale(1.75) } 70%, 100% { transform: scale(1) } }
@keyframes pz-cshake { 0%, 50%, 100% { transform: none } 6% { transform: translate(-4px, 2px) rotate(-2deg) } 12% { transform: translate(4px, -2px) rotate(2deg) } 18% { transform: translate(-3px, -1px) rotate(-1.5deg) } 24% { transform: translate(3px, 2px) rotate(1deg) } 32% { transform: translate(-2px, 0) } 40% { transform: translate(1px, -1px) } }
@keyframes pz-panl { 0%, 12% { transform: translateX(-12px) } 72%, 100% { transform: translateX(12px) } }
@keyframes pz-panr { 0%, 12% { transform: translateX(12px) } 72%, 100% { transform: translateX(-12px) } }
@keyframes pz-arm { 0%, 100% { transform: rotate(-95deg) } 50% { transform: rotate(-35deg) } }
@keyframes pz-bw { 0% { transform: rotate(-22deg) } 100% { transform: rotate(22deg) } }
@keyframes pz-nod { 0%, 62%, 100% { transform: rotate(0) } 24% { transform: rotate(26deg) } 42% { transform: rotate(-6deg) } }
@keyframes pz-breath { 0%, 100% { transform: scale(1) } 50% { transform: scale(1.1, 1.12) } }
`, 'presets-css');
