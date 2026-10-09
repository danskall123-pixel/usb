// Операции с ключами: повтор, зацикливание, растяжение времени, обращение, сдвиг, удержание позы,
// упрощение и быстрая смена плавности. Работают с выделенными ключами таймлайна, а если ничего
// не выделено — со всеми ключами активного слоя (вместе с вложенными слоями).
// Ключи кадра 0 (поза покоя) никогда не сдвигаются и не удаляются.
import { app } from '../app.js';
import { h } from '../util.js';
import { INTERP, evalCh, setKey, keyIndex, shiftKeys } from '../anim.js';
import { layerOwnChannels, descendants } from '../model.js';
import { registerIcon } from '../icons.js';
import { registerMenu, registerTimelineMenu, addStyle } from '../ext.js';
import { dialog, numField, checkField } from '../ui.js';

registerIcon('krepeat', '<path d="M3 15l3-3 3 3-3 3z" fill="currentColor"/><path d="M15 15l3-3 3 3-3 3z" fill="currentColor"/><path d="M6 8.5c3-4 9-4 12 0"/><path d="M18.4 4.6l-.3 4-3.8-1"/>');
registerIcon('kstretch', '<path d="M3 12h18"/><path d="M6.5 8.5L3 12l3.5 3.5M17.5 8.5L21 12l-3.5 3.5"/><path d="M12 5v2.5M12 16.5V19"/>');
registerIcon('kreverse', '<path d="M4 8h15"/><path d="M15.5 4.5L19 8l-3.5 3.5"/><path d="M20 16H5"/><path d="M8.5 12.5L5 16l3.5 3.5"/>');
registerIcon('kshift', '<path d="M3 12l3.5-3.5L10 12l-3.5 3.5z" fill="currentColor"/><path d="M12 12h9"/><path d="M17.5 8.5L21 12l-3.5 3.5"/>');
registerIcon('khold', '<path d="M2.5 12L6 8.5 9.5 12 6 15.5z" fill="currentColor"/><path d="M14.5 12L18 8.5l3.5 3.5-3.5 3.5z" fill="currentColor"/><path d="M9.5 12h5" stroke-width="2.6"/>');
registerIcon('ksimplify', '<path d="M3 17C6 5 18 5 21 17"/><path d="M3 17l2.2-2.2L7.4 17l-2.2 2.2z" fill="currentColor"/><path d="M16.6 17l2.2-2.2L21 17l-2.2 2.2z" fill="currentColor"/><path d="M9 6.5l1.5 1.5M15 6.5L13.5 8" stroke-dasharray="1 2"/>');

addStyle(`
.ko-note { color: var(--text2); font-size: 12.5px; line-height: 1.45; margin: 0; }
.ko-res { padding: 8px 10px; border-radius: 6px; background: var(--bg2); border: 1px solid var(--line); color: var(--text); font-size: 12.5px; line-height: 1.45; }
.ko-res b { color: var(--accent); font-weight: 600; }
.ko-res .warn { color: var(--warm); }
.ko-presets { display: flex; flex-wrap: wrap; gap: 5px; }
.ko-presets .btn.on { border-color: var(--accent); color: var(--accent); }
.ko-dis { opacity: .45; pointer-events: none; }
`, 'keyops-css');

// ---------- общие помощники ----------
const cp = (v) => (Array.isArray(v) ? v.slice() : v);
const num = (v) => typeof v === 'number' || Array.isArray(v);
export function plural(n, forms) {
  const a = Math.abs(n) % 100, b = a % 10;
  return n + ' ' + (a > 10 && a < 20 ? forms[2] : b === 1 ? forms[0] : b >= 2 && b <= 4 ? forms[1] : forms[2]);
}
const FRAMES = ['кадр', 'кадра', 'кадров'];
const TIMES = ['раз', 'раза', 'раз'];

function eqV(a, b, eps = 1e-4) {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= eps);
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= eps;
  return a === b;
}
const keyAt = (c, f) => { const i = keyIndex(c, f); return i >= 0 ? c.k[i] : null; };
// Упорядочить ключи и убрать дубли кадров (остаётся последний)
function tidy(c) {
  c.k.sort((x, y) => x.f - y.f);
  const out = [];
  for (const k of c.k) { if (out.length && out[out.length - 1].f === k.f) out[out.length - 1] = k; else out.push(k); }
  c.k = out;
}
// Обратная интерполяция: ускорение ↔ замедление
const flipI = (i) => (i === 'in' ? 'out' : i === 'out' ? 'in' : i);

// Что обрабатываем: выделенные ключи или все ключи активного слоя
// → { mode: 'sel'|'layer', W: Map(канал → Set(кадров)), rowIds?, L?, what }
export function workSet() {
  const ops = app.timelineOps;
  const sel = ops ? ops.selection() : null;
  if (sel && sel.size) {
    const rowIds = new Set(), zero = [];
    for (const s of ops.selectedIds()) { const rid = s.slice(0, s.lastIndexOf('|')); rowIds.add(rid); if (s.endsWith('|0')) zero.push(s); }
    const n = ops.selectedIds().size;
    return { mode: 'sel', W: sel, rowIds, zero, what: 'выделенные ключи (' + n + ')' };
  }
  const L = app.active;
  if (!L) return null;
  const W = new Map();
  for (const X of [L, ...descendants(L)]) {
    for (const c of layerOwnChannels(X)) if (c.k.length > 1) W.set(c, new Set(c.k.map((k) => k.f)));
  }
  const kids = L.children && L.children.length ? ' и вложенных' : '';
  return { mode: 'layer', W, L, what: `все ключи слоя «${L.name}»${kids}` };
}

// Для повтора и растяжения: ключ кадра 0 (поза покоя) входит во фрагмент, только если движение
// в диапазоне воспроизведения начинается от него (у канала нет ключа на первом кадре сцены)
function spanSet(ws) {
  if (!ws || app.doc.start <= 0) return ws;
  let has0 = false, needs0 = false;
  for (const [c, fs] of ws.W) {
    if (!fs.has(0)) continue;
    has0 = true;
    const first = c.k.find((k) => k.f > 0);
    if (first && first.f > app.doc.start) { needs0 = true; break; }
  }
  if (!has0 || needs0) return ws;
  const W = new Map();
  for (const [c, fs] of ws.W) { const n = new Set([...fs].filter((f) => f > 0)); if (n.size) W.set(c, n); }
  return { ...ws, W };
}

// Размах значений канала по компонентам (для числовых каналов), иначе null
function chRange(c) {
  const v0 = c.k[0].v;
  if (Array.isArray(v0)) return v0.map((_, j) => { let mn = Infinity, mx = -Infinity; for (const k of c.k) { mn = Math.min(mn, k.v[j]); mx = Math.max(mx, k.v[j]); } return mx - mn; });
  if (typeof v0 === 'number') { let mn = Infinity, mx = -Infinity; for (const k of c.k) { mn = Math.min(mn, k.v); mx = Math.max(mx, k.v); } return mx - mn; }
  return null;
}
// Допуск «то же значение» для замкнутого цикла: 1% размаха, но не больше 2 единиц (пикселей, градусов)
function chEps(c) {
  const r = chRange(c);
  if (r === null) return 0;
  const m = Array.isArray(r) ? Math.max(...r) : r;
  return Math.max(1e-4, Math.min(2, m * 0.01));
}

function framesOf(W, skip0 = false) {
  const s = new Set();
  for (const fs of W.values()) for (const f of fs) if (!skip0 || f > 0) s.add(f);
  return [...s].sort((a, b) => a - b);
}

const docMaxKey = () => { const fr = app.allKeyFrames(); return fr.length ? fr[fr.length - 1] : 0; };

// Подогнать конец сцены: продлить, если новые ключи ушли за конец; при shrink — укоротить,
// если анимация раньше заканчивалась ровно на последнем кадре сцены
function fitEnd(before, opMax, shrink) {
  const d = app.doc;
  if (opMax > d.end) { d.end = opMax; return ' Сцена продлена до кадра ' + opMax + '.'; }
  const after = docMaxKey();
  if (shrink && before === d.end && after < d.end && after > d.start) { d.end = after; return ' Сцена укорочена до кадра ' + after + '.'; }
  return '';
}

// Обновить выделение на таймлайне: newFrames — Map(канал → Set(кадров))
function reselect(ws, newFrames) {
  const ops = app.timelineOps;
  if (!ops) return;
  if (ws.mode !== 'sel') { ops.redraw(); return; }
  const ids = [...(ws.zero || [])]; // ключи позы покоя остаются выделенными
  for (const r of ops.rows()) {
    if (!ws.rowIds.has(r.id)) continue;
    const fs = new Set();
    for (const c of r.chans) { const s = newFrames.get(c); if (s) for (const f of s) if (keyIndex(c, f) >= 0) fs.add(f); }
    for (const f of fs) if (f > 0) ids.push(r.id + '|' + f);
  }
  ops.setSelected(ids);
}

function noKeys(ws) {
  if (!ws) { app.toast('Сначала выберите слой в панели «Слои» или выделите ключи на таймлайне', 3500); return true; }
  if (!ws.W.size) {
    app.toast(ws.mode === 'layer' ? `На слое «${ws.L.name}» пока нет анимации — создайте ключи: перейдите на другой кадр и измените позу` : 'Выделенные ключи не найдены', 4000);
    return true;
  }
  return false;
}

// ---------- повтор ----------
// План повтора: фрагмент [a, b]; если последний ключ совпадает с первым (цикл замкнут) — период = длине,
// иначе между повторами добавляется плавный возврат длиной в средний интервал между ключами
export function repeatPlan(W) {
  const frames = framesOf(W);
  if (frames.length < 2) return null;
  const a = frames[0], b = frames[frames.length - 1], len = b - a;
  let closed = true;
  for (const [c, fs] of W) {
    if (!fs.has(a) || !fs.has(b)) continue;
    const ka = keyAt(c, a), kb = keyAt(c, b);
    if (ka && kb && !eqV(ka.v, kb.v, chEps(c))) { closed = false; break; }
  }
  const gap = closed ? 0 : Math.max(1, Math.round(len / (frames.length - 1)));
  return { a, b, len, closed, gap, period: len + gap, nFrames: frames.length };
}

function repeatCount(p, { times, pingpong, toEnd }) {
  const P = pingpong ? p.len : p.period;
  if (toEnd) return Math.max(0, Math.ceil((app.doc.end - p.b) / P));
  return Math.max(1, times | 0);
}

// Ключи фрагмента в обратном порядке (зеркально внутри [a, b]) с перевёрнутой плавностью
function mirrored(src, a, b) {
  const m = src.length - 1;
  return src.map((_, j) => {
    const s = src[m - j];
    const i = j < m ? flipI(src[m - j - 1].i) : src[0].i;
    return { f: a + b - s.f, v: s.v, i };
  });
}

export function applyRepeat(ws, opts) {
  ws = spanSet(ws);
  const p = repeatPlan(ws.W);
  if (!p) return { error: 'Нужны ключи хотя бы на двух разных кадрах — выделите фрагмент на таймлайне' };
  const P = opts.pingpong ? p.len : p.period;
  const n = repeatCount(p, opts);
  if (n < 1) return { error: `Фрагмент уже доходит до конца сцены (кадр ${app.doc.end})` };
  const end = app.doc.end;
  const regionEnd = p.b + n * P;
  const out = new Map();
  let replaced = 0;
  for (const [c, fs] of ws.W) {
    const src = c.k.filter((k) => fs.has(k.f)).map((k) => ({ f: k.f, v: cp(k.v), i: k.i }));
    if (!src.length) continue;
    // ключи, которые уже стояли в области повторов, заменяются
    const before = c.k.length;
    c.k = c.k.filter((k) => !(k.f > p.b && k.f <= regionEnd));
    replaced += before - c.k.length;
    const rev = opts.pingpong ? mirrored(src, p.a, p.b) : null;
    const gen = new Set(fs);
    for (let r = 1; r <= n; r++) {
      const seq = rev && r % 2 ? rev : src;
      for (const k of seq) { setKey(c, k.f + r * P, k.v, k.i); gen.add(k.f + r * P); }
    }
    if (opts.toEnd) {
      // за концом сцены оставляем только один ключ (чтобы движение до последнего кадра было верным)
      const beyond = [...gen].filter((f) => f > end && f > p.b).sort((x, y) => x - y);
      const drop = new Set(beyond.slice(1));
      if (drop.size) { c.k = c.k.filter((k) => !drop.has(k.f) || fs.has(k.f)); for (const f of drop) gen.delete(f); }
    }
    out.set(c, gen);
  }
  return { p, n, P, out, replaced, last: opts.toEnd ? Math.min(regionEnd, end) : regionEnd };
}

function repeatDialog(preset = {}) {
  const ws0 = workSet();
  if (noKeys(ws0)) return;
  const ws = spanSet(ws0);
  const p = repeatPlan(ws.W);
  if (!p) { app.toast('Для повтора нужны ключи хотя бы на двух разных кадрах — выделите фрагмент на таймлайне (рамкой)', 4000); return; }
  const o = { times: 2, pingpong: false, toEnd: false, ...preset };
  const res = h('div', { class: 'ko-res' });
  const timesF = numField('Сколько раз', o.times, { min: 1, max: 100, step: 1, prec: 0, onLive: (v) => { o.times = v; upd(); }, onCommit: (v) => { o.times = v; upd(); } });
  const upd = () => {
    timesF.classList.toggle('ko-dis', o.toEnd);
    const P = o.pingpong ? p.len : p.period;
    const n = repeatCount(p, o);
    const last = o.toEnd ? app.doc.end : p.b + n * P;
    res.replaceChildren();
    if (n < 1) { res.append(h('span', { class: 'warn' }, `Фрагмент уже доходит до конца сцены (кадр ${app.doc.end}).`)); return; }
    res.append('Повторов: ', h('b', null, String(n)), ' — анимация продлится до кадра ', h('b', null, String(last)), '.');
    if (!o.toEnd && last > app.doc.end) res.append(' Сцена будет продлена.');
    if (!o.pingpong && !p.closed) res.append(h('br'), h('span', { class: 'warn' }, `Последний ключ отличается от первого — между повторами будет плавный возврат к началу (${plural(p.gap, FRAMES)}).`));
    if (o.pingpong) res.append(h('br'), 'Движение пойдёт вперёд и назад, как маятник.');
  };
  dialog({
    title: 'Повторить ключи',
    width: 420,
    body: h('div', { class: 'form' },
      h('p', { class: 'ko-note' }, `Фрагмент: кадры ${p.a}–${p.b} (${plural(p.nFrames, ['кадр', 'кадра', 'кадров'])} с ключами) — ${ws.what}. Повторы встанут сразу после него.`),
      timesF,
      checkField('Туда-обратно (пинг-понг)', o.pingpong, (v) => { o.pingpong = v; upd(); }, 'Каждый второй повтор идёт в обратную сторону'),
      checkField(`До конца сцены (кадр ${app.doc.end})`, o.toEnd, (v) => { o.toEnd = v; upd(); }, 'Повторять, пока не закончится сцена'),
      res,
    ),
    buttons: [{ label: 'Отмена' }, { label: 'Повторить', primary: true, action: () => { runRepeat(o); } }],
  });
  upd();
}

function runRepeat(o) {
  const ws = workSet();
  if (noKeys(ws)) return;
  const before = docMaxKey();
  const r = applyRepeat(ws, o);
  if (r.error) { app.toast(r.error, 3500); return; }
  const extra = o.toEnd ? '' : fitEnd(before, r.last, false);
  reselect(ws, r.out);
  app.commit(o.toEnd ? 'Зацикливание до конца сцены' : 'Повтор ключей');
  let msg = o.toEnd
    ? `Зациклено до конца сцены: ${plural(r.n, ['повтор', 'повтора', 'повторов'])}${o.pingpong ? ' туда-обратно' : ''}.`
    : `Повторено ${plural(r.n, TIMES)}${o.pingpong ? ' туда-обратно' : ''}: ключи до кадра ${r.last}.`;
  if (!o.pingpong && !r.p.closed) msg += ' Добавлен плавный возврат к началу.';
  if (r.replaced) msg += ` Заменено старых ключей: ${r.replaced}.`;
  app.toast(msg + extra, 4000);
}

function loopToEnd() { runRepeat({ times: 1, pingpong: false, toEnd: true }); }

// ---------- растяжение / сжатие времени ----------
export function applyStretch(ws, factor, ripple = true) {
  ws = spanSet(ws);
  const frames = framesOf(ws.W);
  if (frames.length < 2) return { error: 'Для растяжения нужны ключи хотя бы на двух разных кадрах' };
  const a = frames[0], b = frames[frames.length - 1];
  const map = (f) => Math.max(f === 0 ? 0 : 1, Math.round(a + (f - a) * factor));
  const nb = map(b), delta = nb - b, end = app.doc.end;
  const out = new Map();
  let opMax = 0; // куда ушли ключи, которые были в пределах сцены
  for (const [c, fs] of ws.W) {
    const moving = c.k.filter((k) => fs.has(k.f) && k.f > 0);
    if (!moving.length) { out.set(c, new Set(fs)); continue; }
    const rest = c.k.filter((k) => !(fs.has(k.f) && k.f > 0));
    if (ripple && delta) for (const k of rest) if (k.f > b) { if (k.f <= end) opMax = Math.max(opMax, k.f + delta); k.f += delta; }
    for (const k of moving) if (k.f <= end) opMax = Math.max(opMax, map(k.f));
    // несколько ключей на одном кадре → остаётся ближайший к точному времени
    const placed = new Map();
    for (const k of moving) {
      const exact = a + (k.f - a) * factor, t = map(k.f), err = Math.abs(exact - t);
      const cur = placed.get(t);
      if (!cur || err <= cur.err) placed.set(t, { k, err });
    }
    const keep = rest.filter((k) => !placed.has(k.f));
    c.k = keep.concat([...placed].map(([t, { k }]) => ({ f: t, v: k.v, i: k.i })));
    tidy(c);
    const gen = new Set([...placed.keys()]);
    if (fs.has(0)) gen.add(0);
    out.set(c, gen);
  }
  return { a, b, nb, out, opMax };
}

function stretchDialog() {
  const ws0 = workSet();
  if (noKeys(ws0)) return;
  const ws = spanSet(ws0);
  const frames = framesOf(ws.W);
  if (frames.length < 2) { app.toast('Для растяжения нужны ключи хотя бы на двух разных кадрах — выделите их на таймлайне', 4000); return; }
  const a = frames[0], b = frames[frames.length - 1], len = b - a;
  const o = { factor: 2, ripple: true };
  const res = h('div', { class: 'ko-res' });
  const presets = h('div', { class: 'ko-presets' });
  const PRE = [[0.5, 'В 2 раза быстрее'], [0.75, 'Чуть быстрее'], [1.5, 'Чуть медленнее'], [2, 'В 2 раза медленнее']];
  const factorF = numField('Множитель', o.factor, { min: 0.05, max: 20, step: 0.05, prec: 2, onLive: (v) => setF(v, 'f'), onCommit: (v) => setF(v, 'f') });
  const lenF = numField('Длительность', Math.round(len * o.factor), { min: 1, max: 100000, step: 1, prec: 0, unit: 'кадр.', onLive: (v) => setF(v / len, 'l'), onCommit: (v) => setF(v / len, 'l') });
  function setF(v, from) {
    o.factor = Math.max(0.05, Math.min(20, v));
    if (from !== 'f') factorF.set(o.factor);
    if (from !== 'l') lenF.set(Math.round(len * o.factor));
    upd();
  }
  const upd = () => {
    const nb = Math.max(1, Math.round(a + len * o.factor));
    presets.querySelectorAll('.btn').forEach((btn) => btn.classList.toggle('on', Math.abs(+btn.dataset.f - o.factor) < 1e-9));
    res.replaceChildren(
      o.factor > 1 ? 'Медленнее: ' : o.factor < 1 ? 'Быстрее: ' : 'Без изменений: ',
      'кадры ', h('b', null, `${a}–${b}`), ' → ', h('b', null, `${a}–${nb}`), ` (${plural(nb - a, FRAMES)}).`,
    );
    if (nb - a < frames.length - 1) res.append(h('br'), h('span', { class: 'warn' }, 'Часть ключей сольётся — слишком сильное сжатие.'));
  };
  for (const [f, label] of PRE) presets.append(h('button', { class: 'btn sm', 'data-f': f, onclick: () => setF(f) }, label));
  dialog({
    title: 'Растянуть / сжать время',
    width: 440,
    body: h('div', { class: 'form' },
      h('p', { class: 'ko-note' }, `Фрагмент: кадры ${a}–${b} — ${ws.what}. Опорный кадр — ${a}: он остаётся на месте. Множитель 2 — в два раза медленнее, 0.5 — в два раза быстрее.`),
      presets,
      h('div', { class: 'insp-row' }, factorF, lenF),
      checkField('Сдвинуть следующие ключи', o.ripple, (v) => { o.ripple = v; }, 'Ключи после фрагмента сдвинутся, чтобы остальная анимация не наложилась'),
      res,
    ),
    buttons: [{ label: 'Отмена' }, { label: 'Применить', primary: true, action: () => runStretch(o) }],
  });
  upd();
}

function runStretch(o) {
  const ws = workSet();
  if (noKeys(ws)) return;
  const before = docMaxKey();
  const r = applyStretch(ws, o.factor, o.ripple);
  if (r.error) { app.toast(r.error, 3500); return; }
  const extra = fitEnd(before, r.opMax, true);
  reselect(ws, r.out);
  app.commit(o.factor >= 1 ? 'Растяжение времени' : 'Сжатие времени');
  app.toast(`Время ${o.factor >= 1 ? 'растянуто' : 'сжато'} ×${+o.factor.toFixed(2)}: кадры ${r.a}–${r.b} → ${r.a}–${r.nb}.${extra}`, 3500);
}

// ---------- обращение ----------
export function applyReverse(ws) {
  const frames = framesOf(ws.W, true);
  if (frames.length < 2) return { error: 'Для обращения нужны ключи хотя бы на двух кадрах (кроме кадра 0)' };
  const a = frames[0], b = frames[frames.length - 1];
  const out = new Map();
  for (const [c, fs] of ws.W) {
    const src = c.k.filter((k) => fs.has(k.f) && k.f > 0);
    const gen = new Set(fs.has(0) ? [0] : []);
    if (src.length) {
      const nk = mirrored(src.map((k) => ({ f: k.f, v: k.v, i: k.i })), a, b);
      // последний ключ ведёт к ключам после фрагмента так же, как раньше
      nk[nk.length - 1].i = src[src.length - 1].i;
      const nf = new Set(nk.map((k) => k.f));
      c.k = c.k.filter((k) => !(fs.has(k.f) && k.f > 0) && !nf.has(k.f)).concat(nk).sort((x, y) => x.f - y.f);
      for (const f of nf) gen.add(f);
    }
    out.set(c, gen);
  }
  return { a, b, out };
}

function runReverse() {
  const ws = workSet();
  if (noKeys(ws)) return;
  const r = applyReverse(ws);
  if (r.error) { app.toast(r.error, 3500); return; }
  reselect(ws, r.out);
  app.commit('Обращение ключей');
  app.toast(`Анимация на кадрах ${r.a}–${r.b} теперь идёт задом наперёд.`, 3000);
}

// ---------- сдвиг ----------
export function applyShift(ws, d) {
  const frames = framesOf(ws.W, true);
  if (!frames.length) return { error: 'Ключи кадра 0 (поза покоя) не сдвигаются — выделите другие ключи' };
  let clamped = false;
  if (frames[0] + d < 1) { d = 1 - frames[0]; clamped = true; }
  const out = new Map();
  for (const [c, fs] of ws.W) {
    shiftKeys(c, fs, d, false);
    out.set(c, new Set([...fs].map((f) => (f > 0 ? f + d : f))));
  }
  return { d, clamped, out };
}

function shiftDialog() {
  const ws = workSet();
  if (noKeys(ws)) return;
  const o = { d: 6 };
  const frames = framesOf(ws.W, true);
  dialog({
    title: 'Сдвинуть ключи',
    width: 380,
    body: h('div', { class: 'form' },
      h('p', { class: 'ko-note' }, `${ws.what[0].toUpperCase() + ws.what.slice(1)}${frames.length ? `, кадры ${frames[0]}–${frames[frames.length - 1]}` : ''}. Больше нуля — позже, меньше нуля — раньше. Ключи кадра 0 остаются на месте.`),
      numField('Сдвиг', o.d, { min: -10000, max: 10000, step: 1, prec: 0, unit: 'кадр.', onLive: (v) => { o.d = v; }, onCommit: (v) => { o.d = v; } }),
    ),
    buttons: [{ label: 'Отмена' }, { label: 'Сдвинуть', primary: true, action: () => runShift(Math.round(o.d)) }],
  });
}

function runShift(d) {
  const ws = workSet();
  if (noKeys(ws)) return;
  if (!d) { app.toast('Сдвиг 0 кадров — ничего не изменилось'); return; }
  const before = docMaxKey();
  const r = applyShift(ws, d);
  if (r.error) { app.toast(r.error, 3500); return; }
  if (!r.d) { app.toast('Ключи уже начинаются с кадра 1 — раньше сдвинуть нельзя'); return; }
  const moved = framesOf(ws.W, true).filter((f) => f <= app.doc.end).map((f) => Math.max(1, f + r.d));
  const extra = fitEnd(before, moved.length ? Math.max(...moved) : 0, false);
  reselect(ws, r.out);
  app.commit('Сдвиг ключей');
  const sgn = r.d > 0 ? '+' : '−';
  app.toast(`Ключи сдвинуты на ${sgn}${plural(Math.abs(r.d), FRAMES)} (${r.d > 0 ? 'позже' : 'раньше'}).${r.clamped ? ' Дальше кадра 1 сдвигать нельзя.' : ''}${extra}`, 3500);
}

// ---------- удержание позы ----------
export function applyHold(ws, f) {
  const out = new Map();
  let n = 0;
  for (const [c, fs] of ws.W) {
    if (keyIndex(c, f) >= 0) continue;
    let prev = null, next = null;
    for (const k of c.k) { if (k.f < f) prev = k; else if (k.f > f) { next = k; break; } }
    if (!prev || !next) continue;
    if (eqV(evalCh(c, f), prev.v, 1e-6)) continue; // уже стоит на месте
    setKey(c, f, prev.v, prev.i);
    out.set(c, new Set([...fs, f]));
    n++;
  }
  return { n, out };
}

function runHold() {
  const f = app.frame;
  if (f <= 0) { app.toast('Перейдите на кадр, до которого поза должна оставаться неподвижной, и повторите', 3500); return; }
  const ws = workSet();
  if (noKeys(ws)) return;
  const r = applyHold(ws, f);
  if (!r.n) { app.toast(`На кадре ${f} нечего удерживать: здесь уже есть ключ или объект и так стоит на месте`, 3500); return; }
  if (ws.mode === 'sel') {
    for (const [c, fs] of ws.W) if (!r.out.has(c)) r.out.set(c, fs);
    reselect(ws, r.out);
  }
  app.commit('Удержание позы');
  app.toast(`Поза удержана до кадра ${f}: движение к следующему ключу начнётся отсюда (${plural(r.n, ['канал', 'канала', 'каналов'])}).`, 3500);
}

// ---------- упрощение ----------
// Удаляет ключи, без которых анимация почти не меняется (сравнение с исходной кривой по всем кадрам)
export function applySimplify(ws, rel = 0.004) {
  let removed = 0;
  const out = new Map();
  for (const [c, fs] of ws.W) {
    const orig = { k: c.k.slice() };
    // допуск: доля размаха значений, но не больше полпикселя / полградуса
    const r = chRange(c), tf = (x) => Math.max(1e-4, Math.min(0.5, x * rel));
    const tol = r === null ? null : Array.isArray(r) ? r.map(tf) : tf(r);
    const close = (x, y) => {
      if (tol === null) return x === y;
      if (Array.isArray(tol)) return x.every((xv, j) => Math.abs(xv - y[j]) <= tol[j]);
      return Math.abs(x - y) <= tol;
    };
    for (const cand of orig.k) {
      if (cand.f === 0 || !fs.has(cand.f)) continue;
      const i = c.k.indexOf(cand);
      if (i <= 0) continue;
      const trial = { k: c.k.slice(0, i).concat(c.k.slice(i + 1)) };
      const lo = c.k[Math.max(0, i - 2)].f, hi = c.k[Math.min(c.k.length - 1, i + 2)].f;
      let ok = true;
      for (let f = lo; f <= hi && ok; f++) ok = close(evalCh(trial, f), evalCh(orig, f));
      if (ok) { c.k = trial.k; removed++; }
    }
    out.set(c, new Set([...fs].filter((f) => keyIndex(c, f) >= 0)));
  }
  return { removed, out };
}

function runSimplify() {
  const ws = workSet();
  if (noKeys(ws)) return;
  const r = applySimplify(ws);
  if (!r.removed) { app.toast('Лишних ключей не нашлось — каждый ключ меняет движение', 3000); return; }
  reselect(ws, r.out);
  app.commit('Упрощение ключей');
  app.toast(`Удалено лишних ключей: ${r.removed}. Движение осталось прежним.`, 3000);
}

// ---------- плавность ----------
const EASES = [['smooth', 'Плавная'], ['linear', 'Линейная'], ['ease', 'Вход-выход'], ['bounce', 'Отскок'], ['elastic', 'Упругая'], ['step', 'Ступенчатая']];

function currentInterp(ws) {
  let cur = null;
  for (const [c, fs] of ws.W) for (const k of c.k) {
    if (!fs.has(k.f) || !num(k.v)) continue;
    if (cur === null) cur = k.i; else if (cur !== k.i) return '';
  }
  return cur;
}

export function applyInterp(ws, id) {
  const frames = new Set();
  for (const [c, fs] of ws.W) for (const k of c.k) if (fs.has(k.f) && num(k.v)) { k.i = id; frames.add(k.f); }
  return { n: frames.size };
}

function runInterp(id) {
  const ws = workSet();
  if (noKeys(ws)) return;
  const r = applyInterp(ws, id);
  if (!r.n) { app.toast('У выбранных ключей нет плавности (например, переключатель меняется только скачком)', 3500); return; }
  app.commit('Плавность: ' + (INTERP[id] || id));
  app.timelineOps && app.timelineOps.redraw();
  const name = (EASES.find((e) => e[0] === id) || [id, INTERP[id]])[1];
  app.toast(`Плавность «${name}» задана для ${plural(r.n, ['кадра', 'кадров', 'кадров'])} с ключами.`, 2600);
}

// ---------- пункты меню ----------
function items() {
  const ws = workSet();
  const sel = ws && ws.mode === 'sel';
  const cur = ws && ws.W.size ? currentInterp(ws) : null;
  const f = app.frame;
  return [
    { label: 'Повторить…', icon: 'krepeat', action: () => repeatDialog() },
    { label: 'Зациклить до конца сцены', icon: 'loop', action: loopToEnd },
    { label: 'Растянуть / сжать время…', icon: 'kstretch', action: stretchDialog },
    { label: 'Обратить (задом наперёд)', icon: 'kreverse', action: runReverse },
    { label: 'Сдвинуть на N кадров…', icon: 'kshift', action: shiftDialog },
    { label: `Удержать позу на текущем кадре${f > 0 ? ' (' + f + ')' : ''}`, icon: 'khold', action: runHold },
    { label: 'Упростить ключи', icon: 'ksimplify', action: runSimplify },
    { label: sel ? 'Плавность для выделенных' : 'Плавность для ключей слоя', icon: 'graph', sub: EASES.map(([id, name]) => ({ label: name, checked: cur === id, action: () => runInterp(id) })) },
  ];
}

function title() {
  const ws = workSet();
  if (!ws) return 'Ключи: выберите слой';
  return 'Для: ' + ws.what;
}

registerTimelineMenu(() => [{ title: title() }, ...items()]);
registerMenu('Анимация', () => [{ label: 'Операции с ключами', icon: 'krepeat', sub: [{ title: title() }, ...items()] }]);

// Подменю у нижнего края экрана (таймлайн) уходит за экран: ядро сдвигает его только по горизонтали.
// Поднимаем такое подменю, чтобы оно целиком помещалось в окне.
function fitSubmenu(sub) {
  const r = sub.getBoundingClientRect(), lim = window.innerHeight - 4;
  if (r.bottom <= lim || !sub.parentElement) return;
  const pr = sub.parentElement.getBoundingClientRect();
  const top = parseFloat(sub.style.top) || 0;
  sub.style.top = Math.max(top - (r.bottom - lim), 4 - pr.top) + 'px';
}
if (typeof MutationObserver !== 'undefined') {
  const inner = new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList.contains('sub')) fitSubmenu(n);
  });
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList.contains('menu')) inner.observe(n, { childList: true, subtree: true });
  }).observe(document.body, { childList: true });
}

// для тестов и других модулей
app.keyOps = { workSet, repeatPlan, applyRepeat, applyStretch, applyReverse, applyShift, applyHold, applySimplify, applyInterp, repeatDialog, stretchDialog, shiftDialog, loopToEnd, runReverse, runHold, runSimplify, runInterp };
