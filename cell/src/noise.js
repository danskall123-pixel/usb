// noise.js — собственная реализация шума: value 2D/3D и simplex 2D.
// Без библиотек. Таблица перестановок строится из seed, поэтому мир воспроизводим.

import { makeRng, smoothstep } from './rng.js';

/**
 * Создаёт набор шумовых функций для конкретного seed.
 * Возвращает { value2, value3, simplex2, fbm2, fbmS2, ridged2, curl2 }.
 */
export function makeNoise(seed = 1337) {
  const rng = makeRng(seed);

  // Таблица перестановок 0..255, перемешанная Фишером–Йетсом, продублированная.
  const perm = new Uint8Array(512);
  const src = new Uint8Array(256);
  for (let i = 0; i < 256; i++) src[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = rng.int(0, i);
    const t = src[i]; src[i] = src[j]; src[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = src[i & 255];

  // Псевдослучайные значения в [-1,1] для value-шума.
  const grad1 = new Float32Array(256);
  for (let i = 0; i < 256; i++) grad1[i] = rng.range(-1, 1);

  // Градиенты для simplex (12 направлений по кругу — достаточно для 2D).
  const gx = new Float32Array(256);
  const gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const a = rng.range(0, Math.PI * 2);
    gx[i] = Math.cos(a);
    gy[i] = Math.sin(a);
  }

  const hash2 = (xi, yi) => perm[(perm[xi & 255] + (yi & 255)) & 255];
  const hash3 = (xi, yi, zi) => perm[(perm[(perm[xi & 255] + (yi & 255)) & 255] + (zi & 255)) & 255];

  /** Value-шум 2D, результат примерно в [-1,1]. */
  function value2(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = smoothstep(xf), v = smoothstep(yf);
    const a = grad1[hash2(xi, yi)];
    const b = grad1[hash2(xi + 1, yi)];
    const c = grad1[hash2(xi, yi + 1)];
    const d = grad1[hash2(xi + 1, yi + 1)];
    const top = a + (b - a) * u;
    const bot = c + (d - c) * u;
    return top + (bot - top) * v;
  }

  /** Value-шум 3D — удобен для анимации (третья ось = время). */
  function value3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = smoothstep(xf), v = smoothstep(yf), w = smoothstep(zf);
    const l = (a, b, t) => a + (b - a) * t;
    const c000 = grad1[hash3(xi, yi, zi)];
    const c100 = grad1[hash3(xi + 1, yi, zi)];
    const c010 = grad1[hash3(xi, yi + 1, zi)];
    const c110 = grad1[hash3(xi + 1, yi + 1, zi)];
    const c001 = grad1[hash3(xi, yi, zi + 1)];
    const c101 = grad1[hash3(xi + 1, yi, zi + 1)];
    const c011 = grad1[hash3(xi, yi + 1, zi + 1)];
    const c111 = grad1[hash3(xi + 1, yi + 1, zi + 1)];
    const x00 = l(c000, c100, u), x10 = l(c010, c110, u);
    const x01 = l(c001, c101, u), x11 = l(c011, c111, u);
    return l(l(x00, x10, v), l(x01, x11, v), w);
  }

  // --- Simplex 2D ---
  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;

  /** Simplex-шум 2D, результат примерно в [-1,1]. Без «квадратной» сетки value-шума. */
  function simplex2(xin, yin) {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    let i1, j1;
    if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;

    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const h = hash2(i, j); t0 *= t0;
      n += t0 * t0 * (gx[h] * x0 + gy[h] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const h = hash2(i + i1, j + j1); t1 *= t1;
      n += t1 * t1 * (gx[h] * x1 + gy[h] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const h = hash2(i + 1, j + 1); t2 *= t2;
      n += t2 * t2 * (gx[h] * x2 + gy[h] * y2);
    }
    return 70 * n;
  }

  /** Фрактальный value-шум: сумма октав с затуханием. */
  function fbm2(x, y, oct = 4, lac = 2, gain = 0.5) {
    let a = 0.5, f = 1, sum = 0, norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += a * value2(x * f, y * f);
      norm += a; a *= gain; f *= lac;
    }
    return sum / norm;
  }

  /** Фрактальный simplex — для фона и течений. */
  function fbmS2(x, y, oct = 4, lac = 2, gain = 0.5) {
    let a = 0.5, f = 1, sum = 0, norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += a * simplex2(x * f, y * f);
      norm += a; a *= gain; f *= lac;
    }
    return sum / norm;
  }

  /** Ridged-шум — «прожилки», хорош для каустики. */
  function ridged2(x, y, oct = 3) {
    let a = 0.5, f = 1, sum = 0, norm = 0;
    for (let o = 0; o < oct; o++) {
      const v = 1 - Math.abs(simplex2(x * f, y * f));
      sum += a * v * v;
      norm += a; a *= 0.5; f *= 2;
    }
    return sum / norm;
  }

  /**
   * Curl-поле из шума: безвихревое течение (не «сдувает» всё в одну точку).
   * out — массив [vx, vy], чтобы не аллоцировать в игровом цикле.
   */
  function curl2(x, y, out) {
    const e = 0.35;
    const n1 = fbmS2(x, y + e, 2), n2 = fbmS2(x, y - e, 2);
    const n3 = fbmS2(x + e, y, 2), n4 = fbmS2(x - e, y, 2);
    out[0] = (n1 - n2) / (2 * e);
    out[1] = -(n3 - n4) / (2 * e);
    return out;
  }

  return { value2, value3, simplex2, fbm2, fbmS2, ridged2, curl2 };
}

/** Общий шум по умолчанию — чтобы не плодить таблицы. */
export const noise = makeNoise(20260830);
