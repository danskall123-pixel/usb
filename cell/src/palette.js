// palette.js — процедурные палитры. Никаких хардкод-цветов в игре:
// всё выводится из seed через гармонии HSL.

import { makeRng, clamp } from './rng.js';

/** Строка цвета HSL. h в градусах, s/l в процентах. */
export const hsl = (h, s, l, a = 1) =>
  a >= 1 ? `hsl(${((h % 360) + 360) % 360} ${clamp(s, 0, 100)}% ${clamp(l, 0, 100)}%)`
         : `hsl(${((h % 360) + 360) % 360} ${clamp(s, 0, 100)}% ${clamp(l, 0, 100)}% / ${a})`;

/** Схемы гармонии: смещения оттенка для акцентов. */
const HARMONIES = {
  analogous: [0, 28, -28],
  triad: [0, 120, -120],
  complement: [0, 180, 30],
  split: [0, 150, -150],
};

/**
 * Палитра существа из seed.
 * base — основной тон тела, deep — тень, light — блик,
 * accent — части/мембраны, glow — свечение, ink — контур.
 */
export function creaturePalette(seed) {
  const rng = makeRng(seed ^ 0x9e3779b9);
  const scheme = rng.pick(Object.keys(HARMONIES));
  const off = HARMONIES[scheme];

  const h = rng.range(0, 360);
  const s = rng.range(45, 88);
  const l = rng.range(46, 66);
  const accentH = h + off[1] * rng.range(0.6, 1);
  const glowH = h + off[2] * rng.range(0.4, 1);

  return {
    scheme,
    h, s, l,
    base: hsl(h, s, l),
    mid: hsl(h + 6, s * 0.9, l * 0.82),
    deep: hsl(h - 10, s * 0.8, l * 0.42),
    light: hsl(h + 14, s * 0.6, Math.min(92, l * 1.55)),
    accent: hsl(accentH, s * 1.0, l * 1.05),
    accentDeep: hsl(accentH - 8, s * 0.85, l * 0.6),
    glow: hsl(glowH, 92, 72),
    ink: hsl(h - 6, s * 0.5, 14),
    // Полупрозрачные варианты — заранее, чтобы не собирать строки в кадре.
    membrane: hsl(h + 10, s, Math.min(95, l * 1.5), 0.28),
    rim: hsl(h + 20, 80, 88, 0.55),
    shadow: hsl(h - 20, 60, 8, 0.35),
  };
}

/** Палитра сцены (вода) — от поверхности к глубине. */
export function scenePalette(seed, depth = 0) {
  const rng = makeRng((seed ^ 0x51ed270b) + depth * 977);
  const h = 175 + rng.range(-28, 34) - depth * 6;   // от бирюзы к синеве
  const s = clamp(52 - depth * 5 + rng.range(-6, 6), 18, 70);
  return {
    h, s,
    surface: hsl(h + 12, s + 12, 42 - depth * 4),
    top: hsl(h + 6, s, 26 - depth * 3),
    bottom: hsl(h - 12, s * 0.9, 9 - depth),
    haze: hsl(h + 10, s * 0.8, 34, 0.16),
    ray: hsl(h + 26, 70, 82, 0.09),
    dust: hsl(h + 30, 40, 86, 0.5),
    far: hsl(h - 6, s * 0.7, 15),
  };
}
