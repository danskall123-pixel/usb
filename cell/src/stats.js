// stats.js — статы выводятся из конфигурации тела и частей.
// Редактор пересчитывает их вживую при перетаскивании.

import { CATALOG, PART } from './parts.js';
import { clamp } from './rng.js';

/** Базовые характеристики от размера тела. */
function baseFrom(cfg) {
  const len = cfg.segCount * cfg.segLen;
  const mass = (cfg.halfWidth * len) / 150;   // условная «масса»
  return {
    mass,
    speed: clamp(74 - mass * 1.1, 30, 96),    // крупным плыть тяжелее
    turn: clamp(5.6 - mass * 0.10, 1.8, 6.4),
    dmg: 1 + mass * 0.15,
    def: mass * 0.4,
    sense: 180,
    herb: 0, carn: 0,
    maxHp: 3 + mass * 0.5,
  };
}

/**
 * Полный пересчёт статов. Возвращает новый объект — редактор сравнивает
 * его со старым и показывает дельты (+3 / −1).
 */
export function computeStats(cfg) {
  const s = baseFrom(cfg);
  for (const p of cfg.parts) {
    const entry = CATALOG[p.type];
    if (!entry) continue;
    const k = p.size || 1;
    for (const key in entry.stats) {
      s[key] = (s[key] || 0) + entry.stats[key] * k;
    }
  }
  // Жгутики и плавники дают скорость с убывающей отдачей.
  const movers = cfg.parts.filter((p) => p.type === PART.FLAGELLUM || p.type === PART.FIN).length;
  if (movers > 2) s.speed -= (movers - 2) * 1.6;

  s.speed = clamp(s.speed, 26, 190);
  s.turn = clamp(s.turn, 1.4, 8);
  s.dmg = Math.max(0.4, s.dmg);
  s.def = Math.max(0, s.def);
  s.maxHp = Math.max(2, s.maxHp + s.def * 0.25);
  s.diet = s.carn > s.herb ? 'carn' : s.herb > s.carn ? 'herb' : 'omni';
  return s;
}

/** Стоимость конфигурации в ДНК (сумма частей). */
export function configCost(cfg) {
  let c = 0;
  for (const p of cfg.parts) c += CATALOG[p.type]?.cost || 0;
  return c;
}

/** Ключи, которые показываются в панели редактора. */
export const SHOWN = ['speed', 'turn', 'dmg', 'def', 'maxHp'];
