// Анимационные каналы: ключи + интерполяция.
// Канал: { k: [{ f: кадр, v: значение, i: интерполяция }] } — ключ на кадре 0 есть всегда (поза покоя).
// Интерполяция ключа задаёт движение от этого ключа к следующему.

export const INTERP = {
  smooth: 'Плавная',
  linear: 'Линейная',
  ease: 'Вход/выход',
  in: 'Ускорение',
  out: 'Замедление',
  step: 'Ступенчатая',
  bounce: 'Отскок',
  elastic: 'Упругая',
};

export const INTERP_COLOR = {
  smooth: '#5fb3ff',
  linear: '#ffad5c',
  ease: '#7fd36b',
  in: '#b6e06b',
  out: '#57c9a6',
  step: '#ff6464',
  bounce: '#d38bff',
  elastic: '#ffd84d',
};

export const animSettings = { interp: 'smooth' };

const cp = (v) => (Array.isArray(v) ? v.slice() : v);

export function ch(v, interp = 'smooth') {
  return { k: [{ f: 0, v: cp(v), i: interp }] };
}

function bounceOut(x) {
  const n1 = 7.5625, d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
}

export function ease(i, t) {
  switch (i) {
    case 'linear': return t;
    case 'ease': return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case 'in': return t * t * t;
    case 'out': return 1 - Math.pow(1 - t, 3);
    case 'bounce': return bounceOut(t);
    case 'elastic':
      return t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
    case 'step': return 0;
    default: return t;
  }
}

export function evalCh(c, f) {
  const k = c.k, n = k.length;
  if (n === 1 || f <= k[0].f) return k[0].v;
  if (f >= k[n - 1].f) return k[n - 1].v;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (k[m].f <= f) lo = m; else hi = m;
  }
  const a = k[lo], b = k[hi];
  const va = a.v, vb = b.v;
  if (a.f === f || a.i === 'step') return va;
  const isArr = Array.isArray(va);
  if (!isArr && typeof va !== 'number') return va;
  const t = (f - a.f) / (b.f - a.f);
  if (a.i === 'smooth') {
    // Эрмит с касательными Катмулла — Рома; на крайних ключах касательная = 0 (мягкий старт/стоп)
    const dt = b.f - a.f;
    const kp = lo > 0 ? k[lo - 1] : null, kn = hi < n - 1 ? k[hi + 1] : null;
    const t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    const comp = (x0, x1, xp, xn) => {
      if (x0 === x1) return x0; // удержание: без «перелёта»
      const m0 = kp ? (x1 - xp) / (b.f - kp.f) : 0;
      const m1 = kn ? (xn - x0) / (kn.f - a.f) : 0;
      return h00 * x0 + h10 * dt * m0 + h01 * x1 + h11 * dt * m1;
    };
    if (!isArr) return comp(va, vb, kp && kp.v, kn && kn.v);
    const out = new Array(va.length);
    for (let j = 0; j < va.length; j++) out[j] = comp(va[j], vb[j], kp && kp.v[j], kn && kn.v[j]);
    return out;
  }
  const e = ease(a.i, t);
  if (!isArr) return va + (vb - va) * e;
  const out = new Array(va.length);
  for (let j = 0; j < va.length; j++) out[j] = va[j] + (vb[j] - va[j]) * e;
  return out;
}

export function keyIndex(c, f) {
  const k = c.k;
  for (let i = 0; i < k.length; i++) {
    if (k[i].f === f) return i;
    if (k[i].f > f) break;
  }
  return -1;
}

export function setKey(c, f, v, interp) {
  const k = c.k;
  v = cp(v);
  let i = 0;
  while (i < k.length && k[i].f < f) i++;
  if (i < k.length && k[i].f === f) {
    k[i].v = v;
    if (interp) k[i].i = interp;
    return k[i];
  }
  const key = { f, v, i: interp || (typeof v === 'number' || Array.isArray(v) ? animSettings.interp : 'step') };
  k.splice(i, 0, key);
  return key;
}

export function delKey(c, f) {
  if (f === 0) return false;
  const i = keyIndex(c, f);
  if (i > 0) { c.k.splice(i, 1); return true; }
  return false;
}

export const isAnimated = (c) => c.k.length > 1;

// Переместить (или скопировать) ключи из набора кадров на d кадров
export function shiftKeys(c, frames, d, copy) {
  const moving = c.k.filter((k) => k.f > 0 && frames.has(k.f));
  if (!moving.length || d === 0) return;
  if (!copy) c.k = c.k.filter((k) => !(k.f > 0 && frames.has(k.f)));
  for (const k of moving) {
    const nf = Math.max(1, k.f + d);
    const at = c.k.findIndex((x) => x.f === nf);
    const nk = { ...k, f: nf, v: cp(k.v) };
    if (at >= 0) c.k[at] = nk; else c.k.push(nk);
  }
  c.k.sort((a, b) => a.f - b.f);
}

export function keyFrames(c, out = new Map()) {
  for (const k of c.k) if (!out.has(k.f)) out.set(k.f, k.i);
  return out;
}
