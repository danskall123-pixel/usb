// save.js — сохранение в localStorage одним JSON-ключом.
// Обрабатывает повреждённые данные и недоступное хранилище (приватный режим).

const KEY = 'celldrift.save.v1';
const VERSION = 1;

/** Проверка, что хранилище вообще доступно (в iOS-приватном режиме бывает нет). */
function storage() {
  try {
    const s = window.localStorage;
    const probe = '__probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch (e) {
    return null;
  }
}

/** Минимальная валидация конфигурации тела — защита от кривого JSON. */
function validCfg(c) {
  return c && typeof c === 'object'
    && Number.isFinite(c.seed)
    && Number.isFinite(c.segCount) && c.segCount >= 4 && c.segCount <= 24
    && Number.isFinite(c.segLen) && c.segLen > 0 && c.segLen < 100
    && Number.isFinite(c.halfWidth) && c.halfWidth > 0 && c.halfWidth < 200
    && Array.isArray(c.profile) && c.profile.length >= 3 && c.profile.length <= 16
    && c.profile.every((v) => Number.isFinite(v) && v > 0 && v < 4)
    && Array.isArray(c.parts) && c.parts.length <= 40
    && c.parts.every((p) => p && typeof p.type === 'string'
      && Number.isFinite(p.t) && Number.isFinite(p.side) && Number.isFinite(p.size));
}

export function save(state) {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(KEY, JSON.stringify({
      v: VERSION,
      cfg: state.cfg,
      level: state.level,
      dna: state.dna,
      x: state.x, y: state.y,
      lang: state.lang,
      mode: state.mode,
      sound: state.sound,
      time: state.time,
    }));
    return true;
  } catch (e) {
    return false;   // например, переполнена квота
  }
}

/** Возвращает валидное состояние либо null. */
export function load() {
  const s = storage();
  if (!s) return null;
  let raw;
  try { raw = s.getItem(KEY); } catch (e) { return null; }
  if (!raw) return null;

  let d;
  try { d = JSON.parse(raw); } catch (e) { clear(); return null; }
  if (!d || d.v !== VERSION || !validCfg(d.cfg)) { clear(); return null; }

  return {
    cfg: d.cfg,
    level: Number.isFinite(d.level) ? Math.min(5, Math.max(1, d.level | 0)) : 1,
    dna: Number.isFinite(d.dna) ? Math.max(0, d.dna) : 0,
    x: Number.isFinite(d.x) ? d.x : 0,
    y: Number.isFinite(d.y) ? d.y : 0,
    lang: d.lang === 'en' ? 'en' : 'ru',
    mode: d.mode === 'joystick' ? 'joystick' : 'follow',
    sound: d.sound !== false,
    time: Number.isFinite(d.time) ? d.time : 0,
  };
}

export function hasSave() { return load() !== null; }

export function clear() {
  const s = storage();
  if (!s) return;
  try { s.removeItem(KEY); } catch (e) { /* хранилище недоступно */ }
}

/** Настройки (язык/звук/управление) сохраняем даже без игры. */
export function saveSettings(partial) {
  const cur = load();
  if (cur) { save({ ...cur, ...partial }); return; }
  const s = storage();
  if (!s) return;
  try { s.setItem(KEY + '.settings', JSON.stringify(partial)); } catch (e) { /* no-op */ }
}

export function loadSettings() {
  const s = storage();
  if (!s) return {};
  try {
    const cur = load();
    if (cur) return { lang: cur.lang, mode: cur.mode, sound: cur.sound };
    const raw = s.getItem(KEY + '.settings');
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}
