// rng.js — детерминированный генератор случайных чисел.
// Один seed всегда даёт одно и то же существо.

/** Хеш строки -> 32-битное целое (для seed из текста). */
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 — быстрый и качественный PRNG на 32 битах состояния. */
export function makeRng(seed) {
  let a = (typeof seed === 'string' ? hashSeed(seed) : seed >>> 0) || 1;

  /** Следующее число в [0,1). */
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    /** Вещественное в [min,max). */
    range: (min, max) => min + next() * (max - min),
    /** Целое в [min,max] включительно. */
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    /** Случайный элемент массива. */
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    /** Событие с вероятностью p. */
    chance: (p) => next() < p,
    /** Нормальное распределение (Бокс–Мюллер), mu/sigma. */
    gauss: (mu = 0, sigma = 1) => {
      const u = Math.max(1e-9, next());
      const v = next();
      return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    /** Знак ±1. */
    sign: () => (next() < 0.5 ? -1 : 1),
  };
}

// --- Мелкая математика, нужная всем модулям ---

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);

/** Приводит угол к диапазону [-PI, PI]. */
export function wrapAngle(a) {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a < -Math.PI) a += TAU;
  return a;
}

/** Интерполяция углов по кратчайшей дуге. */
export function lerpAngle(a, b, t) {
  return a + wrapAngle(b - a) * t;
}

/** Кадронезависимое сглаживание: доля пути к цели за время dt. */
export function damp(rate, dt) {
  return 1 - Math.exp(-rate * dt);
}
