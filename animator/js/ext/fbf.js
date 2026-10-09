// Покадровая (рисованная) анимация — как в классических мультфильмах: каждый кадр — отдельный рисунок.
// Слой — встроенный «Переключатель» с флагом fbf: дочерние векторные слои — рисунки («Рисунок N»),
// ступенчатый ключ канала sw на кадре f = «с этого кадра виден этот рисунок» ('-' — пустой кадр).
// Кисть сама заводит новый рисунок там, где его ещё нет; N — новый рисунок через «шаг» кадров,
// Shift+N — копия текущего, B — пустой кадр, Enter — следующий шаг. Луковая кожа показывает соседние рисунки.
import { app } from '../app.js';
import { setKey, delKey, evalCh, keyIndex, shiftKeys } from '../anim.js';
import { newDoc, newLayer, cloneLayer, siblings, boneAncestor } from '../model.js';
import { Renderer } from '../render.js';
import { layerWorldPoints, boneWorld } from '../scene.js';
import { screenPathData } from '../tools.js';
import { M, h, clamp, segsPath, distToSeg } from '../util.js';
import { icon, registerIcon } from '../icons.js';
import {
  registerInspector, registerMenu, registerShortcut, registerHook, registerOverlay,
  registerTimelineMenu, registerTemplate, addStyle,
} from '../ext.js';

registerIcon('fbf', '<rect x="9" y="2.5" width="12.5" height="12.5" rx="1.5" opacity=".4"/><rect x="5.75" y="5.75" width="12.5" height="12.5" rx="1.5" opacity=".7"/><rect x="2.5" y="9" width="12.5" height="12.5" rx="1.5"/><path d="M5.5 18c1.4-2.6 2.8-.4 4.2-2.8"/>');
registerIcon('fbfempty', '<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 2.4"/>');

const DRAW_TOOLS = ['freehand', 'shape', 'addpoint'];
const ONION_BEFORE = '#ff4a5e', ONION_AFTER = '#36a3ff';

// ---------- настройки луковой кожи рисунков (вид, не документ) ----------
const O = app.opts;
O.fbfOnion = true; O.fbfBefore = 2; O.fbfAfter = 1;
try {
  const s = JSON.parse(localStorage.getItem('anim2d.fbfOnion') || 'null');
  if (s) { O.fbfOnion = !!s.on; O.fbfBefore = clamp(s.before | 0, 0, 5); O.fbfAfter = clamp(s.after | 0, 0, 5); }
} catch (e) { /* нет доступа */ }
function saveOnion() {
  try { localStorage.setItem('anim2d.fbfOnion', JSON.stringify({ on: O.fbfOnion, before: O.fbfBefore, after: O.fbfAfter })); } catch (e) { /* нет доступа */ }
}
function setOnion(on) {
  O.fbfOnion = !!on;
  if (on && O.fbfBefore + O.fbfAfter === 0) O.fbfBefore = 1;
  saveOnion();
  app.render();
}

// ---------- модель ----------
const isFbf = (L) => !!L && L.type === 'switch' && !!L.fbf && Array.isArray(L.children);
function fbfOf(L) {
  if (!L || !app.idx) return null;
  if (isFbf(L)) return L;
  const p = app.idx.parent.get(L.id);
  return isFbf(p) ? p : null;
}
const stepOf = (F) => (F.fbfStep == null ? 2 : clamp(Math.round(F.fbfStep) || 1, 1, 3));
const autoOf = (F) => F.fbfAuto !== false;
const firstFrame = (doc = app.doc) => Math.max(1, doc.start);
const byId = (F, v) => (v != null && v !== '' && v !== '-' ? F.children.find((c) => String(c.id) === String(v)) || null : null);
const shownAt = (F, f) => byId(F, evalCh(F.sw, f));
const vec = (D) => (D && D.type === 'vector' ? D : null);
function plural(n, w) {
  const a = Math.abs(n) % 100, b = a % 10;
  return n + ' ' + (a > 10 && a < 20 ? w[2] : b > 1 && b < 5 ? w[1] : b === 1 ? w[0] : w[2]);
}
const framesW = (n) => plural(n, ['кадр', 'кадра', 'кадров']);

// Экспозиция (как лист в мультипликации): ключи канала sw с кадра 1 → кто с какого по какой кадр виден
function exposures(F) {
  const ks = F.sw.k.filter((k) => k.f > 0);
  return ks.map((k, i) => ({ f: k.f, v: k.v, D: byId(F, k.v), end: i + 1 < ks.length ? ks[i + 1].f - 1 : null }));
}
function curIndex(ex, f) {
  let i = -1;
  for (let j = 0; j < ex.length; j++) if (ex[j].f <= f) i = j;
  return i;
}
const lenOf = (e) => (e.end == null ? Math.max(1, app.doc.end - e.f + 1) : e.end - e.f + 1);
function rangeText(e) {
  const end = e.end == null ? app.doc.end : e.end;
  if (e.f > end) return `кадр ${e.f} · после конца`;
  return end === e.f ? 'кадр ' + e.f : `кадры ${e.f}–${end}`;
}

// Кадр 0 (поза покоя) повторяет первый рисунок, если тот начинается с первого кадра анимации
function syncZero(F, doc = app.doc) {
  const k0 = F.sw.k[0], k1 = F.sw.k.find((k) => k.f > 0);
  k0.i = 'step';
  if (k1) k0.v = k1.f <= firstFrame(doc) ? k1.v : '-';
  else if (!byId(F, k0.v)) k0.v = '-';
}

function nextName(F) {
  let n = 0;
  for (const c of F.children) { const m = /^Рисунок (\d+)$/.exec(c.name); if (m) n = Math.max(n, +m[1]); }
  return 'Рисунок ' + (n + 1);
}

function makeFbf(doc, name, f) {
  const F = newLayer(doc, 'switch', name);
  Object.assign(F, { fbf: true, fbfStep: 2, fbfAuto: true, open: true });
  const D = newLayer(doc, 'vector', 'Рисунок 1');
  F.children.push(D);
  setKey(F.sw, f, String(D.id), 'step');
  syncZero(F, doc);
  return { F, D };
}

// Новый рисунок (пустой или копия src), видимый с кадра f
function addDrawing(F, f, src = null) {
  const D = src ? cloneLayer(app.doc, src) : newLayer(app.doc, 'vector');
  D.name = nextName(F);
  D.vis = true;
  D.lock = false;
  // дети — в порядке появления (в списке слоёв более поздние рисунки выше)
  const first = new Map();
  for (const e of exposures(F)) if (e.D && !first.has(e.D)) first.set(e.D, e.f);
  let at = F.children.length;
  for (let i = 0; i < F.children.length; i++) {
    const ff = first.get(F.children[i]);
    if (ff != null && ff > f) { at = i; break; }
  }
  F.children.splice(at, 0, D);
  setKey(F.sw, f, String(D.id), 'step');
  syncZero(F);
  app.restructure();
  return D;
}

function lastDrawingUpTo(F, f) {
  let D = null;
  for (const e of exposures(F)) if (e.f <= f && vec(e.D)) D = e.D;
  return D;
}

// Продлить анимацию, если рисунок вышел за её конец
function extendEnd(t, F) {
  const need = t + stepOf(F) - 1;
  if (need <= app.doc.end) return '';
  app.doc.end = need;
  return ` Анимация продлена до кадра ${need}.`;
}

// Скрытый слой среди L и его родителей (самый верхний) или null, если всё видно
function hiddenIn(L) {
  let r = null;
  for (let X = L; X; X = app.idx.parent.get(X.id)) if (!X.vis) r = X;
  return r;
}

// ---------- покадровый слой внутри слоя костей ----------
// Без привязки к кости точки рисунка «гнутся» по костям, и на кадре ≠ 0 штрих ложится не там, где нарисован.
// Рисунок — это картинка целиком, поэтому прикрепляем весь покадровый слой к одной кости (жёстко).
function effBind(L) {
  for (let X = L; X && X.type !== 'bone'; X = app.idx.parent.get(X.id)) if (X.bind != null) return X.bind;
  return null;
}
function autoBind(F, near) {
  const B = boneAncestor(app.idx, F);
  if (!B || !B.bones.length || effBind(F) != null) return null;
  const has = (id) => id != null && B.bones.some((b) => b.id === id);
  let id = near ? effBind(near) : null;
  if (!has(id) && near && near.paths) {
    // чаще всего встречающаяся кость среди точек слоя
    const cnt = new Map();
    for (const p of near.paths) for (const pt of p.pts) if (pt.bone != null) cnt.set(pt.bone, (cnt.get(pt.bone) || 0) + 1);
    let best = 0;
    for (const [b, n] of cnt) if (n > best && has(b)) { best = n; id = b; }
  }
  if (!has(id) && near) {
    // ближайшая кость к середине содержимого
    const S = app.scene(), rec = S.layers.get(B.id), pts = layerWorldPoints(S, near);
    if (rec && rec.bc && pts.length) {
      let cx = 0, cy = 0;
      for (const [x, y] of pts) { cx += x; cy += y; }
      cx /= pts.length; cy /= pts.length;
      let bd = Infinity;
      for (const b of B.bones) {
        const m = boneWorld(rec, b.id);
        if (!m) continue;
        const a = M.apply(m, 0, 0), t = M.apply(m, b.len, 0);
        const d = distToSeg(cx, cy, a[0], a[1], t[0], t[1]).d;
        if (d < bd) { bd = d; id = b.id; }
      }
    }
  }
  if (!has(id)) id = (B.bones.find((b) => b.parent == null) || B.bones[0]).id;
  F.bind = id;
  return B.bones.find((b) => b.id === id);
}

// ---------- активный слой следует за видимым рисунком ----------
let lastSet = null;    // id слоя, который сделали активным мы (а не пользователь)
let detour = null;   // { tool, now }: инструмент, сброшенный при заходе на пустой кадр, и чем его заменило ядро
let autoSet = false;  // идёт наша собственная смена активного слоя
function setActiveAuto(T) {
  lastSet = T.id;
  if (app.activeId === T.id) return;
  autoSet = true;
  try { app.setActive(T.id); } finally { autoSet = false; }
}
function follow() {
  const A = app.active, F = fbfOf(A);
  if (!F) return;
  if (A === F && app.activeId !== lastSet) return; // пользователь сам выбрал покадровый слой
  const T = shownAt(F, app.frame) || F;
  if (T === A) return;
  const tool = app.tool;
  setActiveAuto(T);
  if (T === F) {
    if (app.tool !== tool) detour = { tool, now: app.tool };
  } else if (detour) {
    // вернуть инструмент, только если пользователь не выбрал другой сам
    const d = detour;
    detour = null;
    if (app.tool === d.now && app.tool !== d.tool) app.cmd.setTool(d.tool);
  }
}
app.on('frame', () => { if (!app.playing) follow(); });
app.on('toggleplay', () => { if (!app.playing) follow(); });
app.on('stop', () => follow());

// Выбрали в списке слоёв рисунок, которого на этом кадре не видно, — переходим к кадру, где он показан
app.on('active', (id) => {
  if (autoSet || id == null || app.playing || !app.idx) return;
  const D = app.idx.layers.get(id), F = fbfOf(D);
  if (!F || D === F || shownAt(F, app.frame) === D) return;
  let best = null;
  for (const e of exposures(F)) if (e.D === D && (!best || Math.abs(e.f - app.frame) < Math.abs(best.f - app.frame))) best = e;
  if (!best) return;
  lastSet = D.id;
  app.setFrame(best.f);
});

// Рисунок, который где-то показан, но не на текущем кадре
function strayDrawing(F, A) {
  if (!A || A === F || shownAt(F, app.frame) === A) return false;
  return F.sw.k.some((k) => k.f > 0 && String(k.v) === String(A.id));
}

// Отмена штриха, создавшего рисунок, удаляет и рисунок — ядро тогда делает активным первый слой документа.
// Остаёмся в покадровом слое: на видимом рисунке или на самом слое.
let track = null; // { id, F } — активный слой внутри покадрового
let histI = -1;
app.on('render', () => {
  if (!app.idx) return;
  if (track && app.activeId !== track.id && !app.idx.layers.has(track.id)) {
    const F = app.idx.layers.get(track.F);
    if (isFbf(F)) {
      const T = shownAt(F, app.frame) || F;
      track = { id: T.id, F: F.id };
      setActiveAuto(T);
      return;
    }
  }
  const F = fbfOf(app.active);
  track = F ? { id: app.activeId, F: F.id } : null;
  // после отмены/повтора/удаления — снова на видимый рисунок (если активный выбирали мы
  // или активным оказался рисунок, которого на этом кадре не видно)
  if (app.history.i !== histI) {
    histI = app.history.i;
    if (F && !app.playing && (app.activeId === lastSet || strayDrawing(F, app.active))) follow();
  }
});

// ---------- рисование: куда идёт штрих ----------
let pending = null;  // рисунок, созданный по нажатию кисти, пока штрих не завершён
let hintShown = false;

function fresh(F, f) {
  const i = keyIndex(F.sw, f);
  pending = { F: F.id, f, prev: i > 0 ? F.sw.k[i].v : undefined, z0: F.sw.k[0].v, end: app.doc.end, active: app.activeId };
  const D = addDrawing(F, f);
  pending.D = D.id;
  const ext = extendEnd(f, F);
  if (f !== app.frame) app.toast(`Кадр 0 — поза покоя: рисунок появится с кадра ${f}.` + ext, 4000);
  else if (!hintShown && shownAt(F, f - 1)) {
    hintShown = true;
    app.toast('Новый кадр — новый рисунок (предыдущий остался луковой кожей). Отключается в «Свойствах»: «Новый рисунок на каждом кадре».' + ext, 6000);
  } else if (ext) app.toast(ext.trim());
  return D;
}

function targetDrawing(F) {
  const f = app.frame;
  if (f === 0) return vec(shownAt(F, 0)) || fresh(F, firstFrame());
  const i = keyIndex(F.sw, f);
  if (i > 0) return vec(byId(F, F.sw.k[i].v)) || fresh(F, f);
  if (autoOf(F)) return fresh(F, f);
  return vec(shownAt(F, f)) || fresh(F, f);
}

// Клик кистью без штриха не должен оставлять пустой рисунок
function cleanupPending() {
  const p = pending;
  pending = null;
  if (!p || !app.idx) return;
  const F = app.idx.layers.get(p.F), D = app.idx.layers.get(p.D);
  if (!F || !D || !isFbf(F) || (D.paths && D.paths.length) || (D.children && D.children.length)) return;
  F.children.splice(F.children.indexOf(D), 1);
  if (p.prev === undefined) delKey(F.sw, p.f); else setKey(F.sw, p.f, p.prev, 'step');
  F.sw.k[0].v = p.z0;
  app.doc.end = p.end;
  app.restructure();
  if (app.idx.layers.has(p.active) && app.activeId !== p.active) setActiveAuto(app.idx.layers.get(p.active));
  app.refresh();
  app.render();
}
app.on('commit', () => { pending = null; });
const later = () => { if (pending) setTimeout(cleanupPending, 0); };
window.addEventListener('pointerup', later);
window.addEventListener('pointercancel', later);

registerHook('vectorTarget', (A) => {
  const F = fbfOf(A);
  if (!F) return null;
  if (F.lock) return F; // ядро покажет «Слой заблокирован»
  if (pending) cleanupPending();
  const D = targetDrawing(F);
  detour = null;
  setActiveAuto(D);
  const hid = !D.lock && hiddenIn(D);
  if (hid) app.toast(`Слой «${hid.name}» скрыт — рисунок не будет виден. Включите «глаз» в панели «Слои».`, 4000);
  return D;
});

// ---------- команды ----------
// Куда ставить новый кадр: сюда, если здесь ещё ничего не начинается, иначе — через шаг
function slotFrame(F) {
  const base = app.frame > 0 ? app.frame : firstFrame();
  return keyIndex(F.sw, base) > 0 ? base + stepOf(F) : base;
}

function goTo(F, t, D) {
  app.setFrame(t);
  setActiveAuto(D || shownAt(F, t) || F);
}

function editableF(F) {
  if (!F) return false;
  if (F.lock) { app.toast('Покадровый слой заблокирован'); return false; }
  if (app.playing) app.emit('stop');
  return true;
}

// kind: 'blank' — новый пустой рисунок, 'copy' — копия видимого, 'empty' — пустой кадр
function addFrame(F, kind, t = slotFrame(F)) {
  if (!editableF(F)) return;
  const i = keyIndex(F.sw, t);
  const there = i > 0 ? F.sw.k[i].v : null;
  if (there != null && (byId(F, there) || (kind === 'empty' && there === '-'))) {
    goTo(F, t);
    app.toast(there === '-' ? `Кадр ${t} уже пустой` : `На кадре ${t} уже есть рисунок — перешли к нему`);
    return;
  }
  let src = null;
  if (kind === 'copy') {
    src = vec(shownAt(F, app.frame)) || lastDrawingUpTo(F, app.frame);
    if (!src) kind = 'blank';
  }
  let D = null;
  if (kind === 'empty') { setKey(F.sw, t, '-', 'step'); syncZero(F); } else D = addDrawing(F, t, src);
  const ext = extendEnd(t, F);
  goTo(F, t, D);
  app.commit({ blank: 'Новый рисунок', copy: 'Копия рисунка', empty: 'Пустой кадр' }[kind]);
  const ghost = O.fbfOnion && O.fbfBefore > 0 ? ' Предыдущий виден красным.' : '';
  if (kind === 'blank') app.toast(`${D.name} на кадре ${t} — рисуйте!${ghost}${ext}`, 3200);
  else if (kind === 'copy') app.toast(`Копия «${src.name}» на кадре ${t} — измените её.${ext}`, 3200);
  else app.toast(`Пустой кадр ${t}: с него ничего не видно.${ext}`, 3200);
}

function deleteCurrent(F) {
  if (!editableF(F)) return;
  const f = app.frame || firstFrame(), ex = exposures(F), i = curIndex(ex, f); // кадр 0 показывает первый кадр анимации
  if (i < 0) { app.toast('Здесь нет рисунка. Перейдите на кадр с рисунком.'); return; }
  const e = ex[i];
  if (!e.D) {
    delKey(F.sw, e.f);
    syncZero(F);
    setActiveAuto(shownAt(F, f) || F);
    app.commit('Удаление пустого кадра');
    app.toast('Пустой кадр убран — снова виден предыдущий рисунок');
    return;
  }
  const D = e.D, uses = ex.filter((x) => x.D === D).length;
  F.children.splice(F.children.indexOf(D), 1);
  F.sw.k = F.sw.k.filter((k) => k.f === 0 || String(k.v) !== String(D.id));
  syncZero(F);
  app.restructure();
  setActiveAuto(shownAt(F, f) || F);
  app.commit('Удаление рисунка');
  app.toast(`«${D.name}» удалён${uses > 1 ? ` (он был показан ${uses} раза)` : ''}. Отменить — Ctrl+Z`);
}

// Дольше/короче держать текущий рисунок: сдвигаются все следующие кадры
function changeHold(F, d) {
  if (!editableF(F)) return;
  const f = app.frame || firstFrame(), ex = exposures(F), i = curIndex(ex, f);
  if (i < 0) { app.toast('Перейдите на кадр с рисунком'); return; }
  const e = ex[i], doc = app.doc;
  const len = lenOf(e);
  if (d < 0 && len <= 1) { app.toast('Короче одного кадра нельзя. Чтобы убрать рисунок — «Удалить»'); return; }
  const after = new Set(F.sw.k.filter((k) => k.f > e.f).map((k) => k.f));
  if (after.size) {
    // длина подогнана под рисунки — конец едет вместе с ними, последний рисунок держится столько же
    const fitted = F.sw.k[F.sw.k.length - 1].f + stepOf(F) - 1 === doc.end;
    shiftKeys(F.sw, after, d);
    const last = F.sw.k[F.sw.k.length - 1].f;
    if (fitted || last > doc.end) doc.end = Math.max(doc.start, last + stepOf(F) - 1);
  } else {
    // последний рисунок держится до конца анимации — меняем конец
    doc.end = Math.max(e.f, (e.f + len - 1) + d);
  }
  syncZero(F);
  app.commit('Длительность рисунка');
  const ne = exposures(F)[i];
  const name = e.D ? `«${e.D.name}»` : 'Пустой кадр';
  app.toast(`${name}: ${framesW(lenOf(ne))}` + (after.size ? '' : ` (конец анимации — кадр ${doc.end})`));
}

// Показать уже нарисованный рисунок ещё раз с текущего кадра (циклы, моргание…)
function reuse(F, D) {
  if (!editableF(F)) return;
  const f = app.frame;
  if (f === 0) { app.toast('Перейдите на кадр анимации (кадр 0 — поза покоя)'); return; }
  setKey(F.sw, f, String(D.id), 'step');
  syncZero(F);
  const ext = extendEnd(f, F);
  setActiveAuto(D);
  app.commit('Повтор рисунка');
  app.toast(`«${D.name}» показан с кадра ${f}.` + ext);
}

function jumpTo(F, e) {
  if (app.playing) app.emit('stop');
  app.setFrame(e.f);
  setActiveAuto(e.D || F);
}

function stepFrame(F, dir) {
  if (app.playing) app.emit('stop');
  const s = stepOf(F), f = app.frame;
  if (dir > 0) app.setFrame(f === 0 ? firstFrame() : f + s);
  else if (f > 1) app.setFrame(Math.max(1, f - s));
}

// Прокрутить «Свойства» к секции покадровой анимации
function revealSection() {
  setTimeout(() => {
    const el = document.querySelector('.fbf-sec');
    if (el && !el.closest('[hidden]')) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, 120);
}

// Новый покадровый слой над активным (не внутри другого переключателя)
function createFbf() {
  const doc = app.doc;
  if (app.playing) app.emit('stop');
  const f = app.frame > 0 ? app.frame : firstFrame();
  const n = app.idx.list.filter(isFbf).length + 1;
  const { F, D } = makeFbf(doc, 'Покадровая ' + n, f);
  const A0 = app.active;
  let A = A0;
  while (A) { const p = app.idx.parent.get(A.id); if (!p || p.type !== 'switch') break; A = p; }
  // в проекте без анимации длина растёт вместе с рисунками — воспроизведение крутит ровно нарисованное
  const fresh0 = app.allKeyFrames().every((x) => x === 0) && !app.idx.list.some((x) => x.type === 'audio');
  if (A) { const sib = siblings(doc, app.idx, A); sib.splice(sib.indexOf(A) + 1, 0, F); } else doc.layers.push(F);
  if (fresh0) doc.end = Math.max(doc.start, f + stepOf(F) - 1);
  let ext = fresh0 ? ' Длина анимации растёт вместе с рисунками.' : extendEnd(f, F);
  app.restructure();
  // внутри персонажа (слоя костей) — прикрепить к кости выбранной части, чтобы рисунок ложился, где нарисован
  const bone = autoBind(F, A0 && A0.type !== 'bone' ? A0 : null);
  if (bone) ext += ` Слой прикреплён к кости «${bone.name}» — рисунки двигаются вместе с ней.`;
  setActiveAuto(D);
  if (app.frame !== f) app.setFrame(f);
  if (!DRAW_TOOLS.includes(app.tool)) app.cmd.setTool('freehand');
  setOnion(true);
  app.commit('Новый покадровый слой');
  app.showSideTab && app.showSideTab('props');
  revealSection();
  app.toast('Покадровый слой готов! Рисуйте кистью (F). N — новый рисунок через ' + framesW(stepOf(F)) + ', Enter — следующий кадр. Предыдущий рисунок виден красным.' + ext, 7000);
  return F;
}

// Векторный слой → покадровый (его содержимое становится первым рисунком)
function convertToFbf(L) {
  if (!L || L.type !== 'vector' || fbfOf(L)) return;
  const doc = app.doc;
  if (app.playing) app.emit('stop');
  const f = app.frame > 0 ? app.frame : firstFrame();
  const fresh0 = app.allKeyFrames().every((x) => x === 0) && !app.idx.list.some((x) => x.type === 'audio');
  const F = newLayer(doc, 'switch', L.name);
  Object.assign(F, { fbf: true, fbfStep: 2, fbfAuto: true, open: true, bind: L.bind });
  L.bind = null;
  // движение слоя (положение, поворот, масштаб, прозрачность) переходит к покадровому слою — объект
  // продолжает двигаться как раньше, а сам рисунок становится неподвижной картинкой
  for (const k of ['pos', 'rot', 'scl', 'op', 'origin']) { const t = F[k]; F[k] = L[k]; L[k] = t; }
  const P = app.idx.parent.get(L.id);
  // L внутри обычного переключателя (например, фазы рта): его ключи теперь показывают покадровый слой
  if (P && P.type === 'switch') for (const k of P.sw.k) if (String(k.v) === String(L.id)) k.v = String(F.id);
  const sib = siblings(doc, app.idx, L);
  sib.splice(sib.indexOf(L), 1, F);
  F.children.push(L);
  L.name = 'Рисунок 1';
  const flat = bake(L, app.frame);
  setKey(F.sw, f, String(L.id), 'step');
  syncZero(F);
  if (fresh0) doc.end = Math.max(doc.start, f + stepOf(F) - 1); else extendEnd(f, F);
  app.restructure();
  const bone = autoBind(F, L);
  setActiveAuto(L);
  if (app.frame !== f) app.setFrame(f);
  setOnion(true);
  app.commit('Покадровый слой из векторного');
  bakeNoted = bakeNoted || flat > 0;
  revealSection();
  app.toast(`«${F.name}» теперь покадровый: это рисунок 1` + (flat ? ' (в его текущей позе)' : '') + '. Перейдите дальше (Enter) и рисуйте следующий кадр.'
    + (bone ? ` Слой прикреплён к кости «${bone.name}».` : ''), 6000);
}

// ---------- чистота документа перед каждым снимком истории ----------
// Рисунок — это «один кадр мультфильма»: правки на кадре > 0 не превращаются в ключи внутри рисунка
// (ни у точек, ни у положения/поворота/масштаба самого рисунка), а сразу меняют сам рисунок.
// Ссылки на удалённые рисунки убираются. Двигается весь покадровый слой (его ключи не трогаем).
function bake(D, f) {
  let n = 0;
  const flat = (c) => {
    if (!c || c.k.length < 2) return;
    const v = evalCh(c, f);
    c.k = [{ f: 0, v: Array.isArray(v) ? v.slice() : v, i: c.k[0].i }];
    n++;
  };
  if (D.pos) { flat(D.pos); flat(D.rot); flat(D.scl); flat(D.op); }
  if (D.paths) for (const p of D.paths) { for (const pt of p.pts) { flat(pt.pos); flat(pt.curv); } flat(p.fill); flat(p.stroke); flat(p.width); }
  if (D.children) for (const C of D.children) n += bake(C, f);
  return n;
}
let baked = 0;
function tidy() {
  const walk = (arr) => {
    for (const L of arr) {
      if (isFbf(L)) {
        L.sw.k = L.sw.k.filter((k) => k.f === 0 || k.v === '-' || byId(L, k.v));
        syncZero(L);
        for (const D of L.children) baked += bake(D, app.frame);
      }
      if (L.children) walk(L.children);
    }
  };
  walk(app.doc.layers);
}

// Новый слой («+» в панели слоёв, импорт картинки), созданный, пока выбран рисунок, ядро кладёт внутрь
// покадрового слоя — там он невидим и не нужен. Выносим его рядом: обычный слой — выше, картинку — ниже
// (подложка, чтобы обводить).
function adoptStray(label) {
  if (!/^(Новый слой|Импорт изображения)/.test(label)) return;
  const A = app.active, P = A && app.idx.parent.get(A.id);
  if (!isFbf(P) || P.sw.k.some((k) => String(k.v) === String(A.id))) return;
  P.children.splice(P.children.indexOf(A), 1);
  const sib = siblings(app.doc, app.idx, P), below = label.startsWith('Импорт');
  sib.splice(sib.indexOf(P) + (below ? 0 : 1), 0, A);
  app.restructure();
  app.toast(`«${A.name}» — отдельный слой ${below ? 'под' : 'над'} покадровым «${P.name}». Новый рисунок в покадровом слое — клавиша N.`, 4500);
}

// Покадровый слой перетащили в слой костей — прикрепить к кости (если пользователь сам не выбрал «гибкую»)
function bindMoved() {
  for (const F of app.idx.list) {
    if (!isFbf(F) || F.fbfFlex) continue;
    const b = autoBind(F, F);
    if (b) app.toast(`«${F.name}» прикреплён к кости «${b.name}»: рисунки двигаются вместе с ней. Другую кость можно выбрать в «Свойствах» → «Кость».`, 5000);
  }
}

let bakeNoted = false;
registerHook('beforeCommit', (label) => {
  if (!app.doc || !app.idx) return;
  label = String(label || '');
  adoptStray(label);
  if (label === 'Перемещение слоя') bindMoved();
  // пользователь сам снял привязку покадрового слоя к кости — больше не прикрепляем автоматически
  if (label === 'Привязка слоя' && isFbf(app.active)) app.active.fbfFlex = app.active.bind == null || undefined;
  baked = 0;
  tidy();
  if (baked && !bakeNoted) {
    bakeNoted = true;
    app.toast('Рисунок покадрового слоя — это один кадр мультфильма: правка применена к самому рисунку (без ключей внутри него). Чтобы двигать всё — выберите сам покадровый слой.', 6000);
  }
});

// ---------- луковая кожа рисунков (поверх холста, контурами — как в Moho) ----------
function ghosts(F, f) {
  const ex = exposures(F), i = curIndex(ex, f), cur = shownAt(F, f);
  const out = [], seen = new Set(cur ? [cur] : []);
  let n = 0;
  for (let j = i - 1; j >= 0 && n < O.fbfBefore; j--) {
    const D = ex[j].D;
    if (!D || seen.has(D)) continue;
    seen.add(D);
    out.push({ D, before: true, k: ++n });
  }
  n = 0;
  for (let j = i + 1; j < ex.length && n < O.fbfAfter; j++) {
    const D = ex[j].D;
    if (!D || seen.has(D)) continue;
    seen.add(D);
    out.push({ D, before: false, k: ++n });
  }
  return out.reverse(); // дальние — первыми, ближние — сверху
}

function drawGhost(ctx, D, S, m, color, alpha) {
  if (!D.vis) return;
  const rec = S.layers.get(D.id);
  if (!rec) return;
  if (D.children) { for (const C of D.children) drawGhost(ctx, C, S, m, color, alpha); return; }
  if (!rec.paths) return;
  const z = M.scaleFactor(m);
  ctx.strokeStyle = ctx.fillStyle = color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const pr of rec.paths) {
    const n = pr.xs.length;
    if (n < 2) continue;
    const { segs } = screenPathData(pr, m);
    const P = segsPath(segs, pr.path.closed);
    if (pr.path.closed && pr.path.hf && pr.fill[3] > 0) { ctx.globalAlpha = alpha * 0.22; ctx.fill(P); }
    let w = 1.5;
    if (pr.path.hs && pr.width > 0 && pr.stroke[3] > 0) {
      let s = 0;
      for (let k = 0; k < n; k++) s += pr.ws[k];
      w = Math.max(1.5, pr.width * rec.lw * z * (s / n));
    }
    ctx.globalAlpha = alpha;
    ctx.lineWidth = w;
    ctx.stroke(P);
  }
}

// Подсказка под индикатором кадра: что сейчас на кадре и что сделает штрих
function pill(ctx, text, x, y) {
  ctx.font = '600 12px Inter, system-ui, sans-serif';
  const w = Math.round(ctx.measureText(text).width + 30), hh = 24;
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(15,16,18,.8)';
  ctx.strokeStyle = 'rgba(211,139,255,.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x + 0.5, y + 0.5, w, hh, 6); else ctx.rect(x + 0.5, y + 0.5, w, hh);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#d38bff';
  ctx.fillRect(x + 9, y + 8, 7, 9);
  ctx.fillStyle = '#ece2ff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 21, y + hh / 2 + 1);
}

function statusText(F, f) {
  const ex = exposures(F), i = curIndex(ex, f);
  if (f === 0) { const D = shownAt(F, 0); return D ? `Кадр 0 (поза покоя): «${D.name}»` : 'Кадр 0 — поза покоя'; }
  if (i < 0) return 'До первого рисунка — штрих начнёт новый';
  const e = ex[i];
  if (!e.D) return autoOf(F) ? `Пустой кадр · штрих начнёт новый рисунок` : 'Пустой кадр';
  if (e.f === f) return `${e.D.name} · ${rangeText(e)}`;
  return autoOf(F) ? `Держится «${e.D.name}» · штрих начнёт новый рисунок` : `${e.D.name} · ${rangeText(e)}`;
}

registerOverlay((ctx, S) => {
  if (app.playing) return;
  const F = fbfOf(app.active);
  if (!F || !F.vis) return;
  if (O.fbfOnion) {
    const m = app.docToScreenM();
    for (const g of ghosts(F, app.frame)) {
      const a = (g.before ? 0.6 : 0.5) * Math.pow(0.6, g.k - 1);
      drawGhost(ctx, g.D, S, m, g.before ? ONION_BEFORE : ONION_AFTER, a);
    }
    ctx.globalAlpha = 1;
  }
  pill(ctx, statusText(F, app.frame), 10, 38);
});

// ---------- секция «Свойства» ----------
const thumbR = new Renderer();
const TW = 88, TH = 50;
// Общая рамка миниатюр: по содержимому всех рисунков (в координатах кадра камеры), чтобы движение читалось
function thumbView(F, S) {
  const doc = app.doc, pts = [];
  for (const D of F.children) layerWorldPoints(S, D, pts);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    const [fx, fy] = M.apply(S.cam, x, y);
    if (fx < x0) x0 = fx; if (fx > x1) x1 = fx;
    if (fy < y0) y0 = fy; if (fy > y1) y1 = fy;
  }
  if (!pts.length) { x0 = -doc.w / 2; x1 = doc.w / 2; y0 = -doc.h / 2; y1 = doc.h / 2; }
  const pad = Math.max(x1 - x0, y1 - y0) * 0.12 + 8;
  x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
  const s = Math.min(TW / (x1 - x0), TH / (y1 - y0), TW / 140);
  return M.mul([s, 0, 0, s, TW / 2 - s * (x0 + x1) / 2, TH / 2 - s * (y0 + y1) / 2], S.cam);
}
function thumb(D, S, V) {
  const c = h('canvas', { class: 'fbf-th', width: TW, height: TH });
  const ctx = c.getContext('2d');
  ctx.fillStyle = app.doc.bg;
  ctx.fillRect(0, 0, TW, TH);
  ctx.setTransform(...V);
  try { thumbR.drawLayer(ctx, D, S, { images: app.images, px: M.scaleFactor(V) }, 0); } catch (e) { /* пустая миниатюра */ }
  return c;
}

function fbfSection(L, { sec, row, upd, numField, checkField }) {
  const F = fbfOf(L);
  if (!F) return null;
  const S = app.scene();
  const V = thumbView(F, S);
  const ex = exposures(F);
  // один рисунок может быть показан много раз (циклы) — рисуем миниатюру один раз и копируем
  const thumbs = new Map();
  const th = (D) => {
    const c0 = thumbs.get(D);
    if (!c0) { const c = thumb(D, S, V); thumbs.set(D, c); return c; }
    const c = h('canvas', { class: 'fbf-th', width: TW, height: TH });
    c.getContext('2d').drawImage(c0, 0, 0);
    return c;
  };
  const btn = (ic, label, key, title, fn, cls = '') => h('button', { class: 'btn sm ' + cls, title: title + (key ? ` (${key})` : ''), onclick: fn },
    icon(ic, 15), h('span', null, label), key ? h('kbd', null, key) : null);

  const status = h('div', { class: 'fbf-status' });
  const holdV = h('span', { class: 'fbf-hold-v' });
  const actions = h('div', { class: 'fbf-btns' },
    btn('plus', 'Новый рисунок', 'N', 'Чистый лист на следующем кадре (через «шаг»); предыдущий рисунок будет виден луковой кожей', () => addFrame(F, 'blank'), 'primary wide'),
    btn('copy', 'Копия', '', 'Копия текущего рисунка на следующем кадре — чтобы чуть-чуть изменить (Shift+N)', () => addFrame(F, 'copy')),
    btn('fbfempty', 'Пустой', '', 'Пустой кадр: с него ничего не видно — пауза или исчезновение (B)', () => addFrame(F, 'empty')),
    btn('trash', 'Удалить', '', 'Удалить текущий рисунок со всех кадров (следующие кадры не сдвигаются)', () => deleteCurrent(F), 'danger'),
  );
  const hold = h('div', { class: 'insp-row fbf-hold' },
    h('span', { class: 'fbf-lab', title: 'Сколько кадров виден текущий рисунок' }, 'Держать'),
    h('button', { class: 'btn sm', title: 'Короче на 1 кадр (следующие рисунки сдвинутся раньше)', onclick: () => changeHold(F, -1) }, '−1'),
    holdV,
    h('button', { class: 'btn sm', title: 'Дольше на 1 кадр (следующие рисунки сдвинутся позже)', onclick: () => changeHold(F, 1) }, '+1'),
  );

  const step = stepOf(F);
  const STEP_T = { 1: 'каждый кадр — новый рисунок (плавно, но больше работы)', 2: '«по двойкам»: рисунок держится 2 кадра — классика мультфильмов', 3: '«по тройкам»: рисунок держится 3 кадра — меньше рисования' };
  const seg = h('div', { class: 'fbf-seg', role: 'group', 'aria-label': 'Шаг' }, [1, 2, 3].map((n) => h('button', {
    class: n === step ? 'on' : '', title: STEP_T[n], 'aria-pressed': n === step,
    onclick: () => { if (stepOf(F) === n) return; F.fbfStep = n; app.commit('Шаг рисования'); app.toast(`Шаг ${n}: ${STEP_T[n]}`, 3000); },
  }, String(n))));
  const stepRow = h('div', { class: 'insp-row' }, h('span', { class: 'fbf-lab', title: 'На сколько кадров вперёд переходят N и Enter' }, 'Шаг'), seg,
    h('span', { class: 'fbf-note' }, step === 1 ? 'каждый кадр' : step === 2 ? 'по двойкам' : 'по тройкам'));
  const auto = checkField('Новый рисунок на каждом кадре', autoOf(F), (v) => { F.fbfAuto = v; app.commit(v ? 'Новый рисунок на каждом кадре: вкл' : 'Новый рисунок на каждом кадре: выкл'); },
    'Начали рисовать на кадре, где нет своего рисунка, — он создаётся сам. Выключите, чтобы дорисовывать уже видимый рисунок');

  const onionChk = checkField('Луковая кожа', O.fbfOnion, (v) => { setOnion(v); }, 'Соседние рисунки контурами: красным — предыдущие, синим — следующие');
  const onion = h('div', { class: 'insp-row fbf-onion' }, onionChk,
    numField('до', O.fbfBefore, { min: 0, max: 5, step: 1, prec: 0, width: 26, title: 'Сколько предыдущих рисунков показывать', onCommit: (v) => { O.fbfBefore = Math.round(v); saveOnion(); app.render(); } }),
    numField('после', O.fbfAfter, { min: 0, max: 5, step: 1, prec: 0, width: 26, title: 'Сколько следующих рисунков показывать', onCommit: (v) => { O.fbfAfter = Math.round(v); saveOnion(); app.render(); } }),
  );

  // экспозиция: кто на каких кадрах
  const list = h('div', { class: 'fbf-list', role: 'listbox', 'aria-label': 'Рисунки по кадрам' });
  const rows = [];
  ex.forEach((e, idx) => {
    const r = h('div', { class: 'fbf-item' + (e.D ? '' : ' empty'), role: 'option', title: e.D ? `Перейти к «${e.D.name}»` : 'Перейти к пустому кадру', onclick: () => jumpTo(F, e) },
      e.D ? th(e.D) : h('span', { class: 'fbf-th fbf-th-empty' }, icon('fbfempty', 14)),
      h('span', { class: 'fbf-nm' }, e.D ? e.D.name : 'пусто'),
      h('span', { class: 'fbf-fr' }, rangeText(e)),
      e.D ? h('button', { class: 'icon-btn fbf-re', title: `Показать «${e.D.name}» ещё раз — с текущего кадра`, 'aria-label': 'Повторить с текущего кадра', onclick: (ev) => { ev.stopPropagation(); reuse(F, e.D); } }, icon('loop', 14)) : null,
    );
    rows.push([r, idx]);
    list.append(r);
  });
  const used = new Set(ex.map((e) => e.D).filter(Boolean));
  const unused = F.children.filter((c) => !used.has(c));
  for (const D of unused) {
    list.append(h('div', { class: 'fbf-item unused', title: 'Этот рисунок сейчас нигде не показан', onclick: () => { app.setActive(D.id); app.toast(`«${D.name}» нигде не показан. Кнопка ⟳ — показать его с текущего кадра.`, 3500); } },
      th(D),
      h('span', { class: 'fbf-nm' }, D.name),
      h('span', { class: 'fbf-fr' }, 'не показан'),
      h('button', { class: 'icon-btn fbf-re', title: `Показать «${D.name}» с текущего кадра`, 'aria-label': 'Показать с текущего кадра', onclick: (ev) => { ev.stopPropagation(); reuse(F, D); } }, icon('loop', 14)),
    ));
  }
  if (!ex.length && !unused.length) list.append(h('div', { class: 'fbf-none' }, 'Пока нет рисунков — просто начните рисовать кистью (F)'));

  // обновление без пересборки (при смене кадра)
  upd({
    set() {
      const f = app.frame || firstFrame(), ex2 = exposures(F), i = curIndex(ex2, f); // кадр 0 показывает первый кадр
      status.textContent = statusText(F, app.frame);
      holdV.textContent = i >= 0 ? framesW(lenOf(ex2[i])) : '—';
      holdV.title = i >= 0 && ex2[i].end == null ? `Последний рисунок держится до конца анимации (кадр ${app.doc.end})` : '';
      for (const [r, idx] of rows) r.classList.toggle('on', idx === i);
      const on = list.querySelector('.fbf-item.on');
      if (on && list.scrollHeight > list.clientHeight) {
        const top = on.offsetTop - list.offsetTop;
        if (top < list.scrollTop || top + on.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top - list.clientHeight / 2;
      }
    },
  }, () => null).set();

  const el = sec('Покадровая анимация',
    status,
    actions,
    hold,
    stepRow,
    row(auto),
    onion,
    list,
    h('div', { class: 'insp-note fbf-keys' }, 'Рисуйте кистью ', h('kbd', null, 'F'), ' или фигурами ', h('kbd', null, 'R'), '. ',
      h('kbd', null, 'N'), ' новый рисунок · ', h('kbd', null, 'Shift+N'), ' копия · ', h('kbd', null, 'B'), ' пустой кадр · ',
      h('kbd', null, 'Enter'), ' следующий шаг (', h('kbd', null, 'Shift+Enter'), ' назад) · ', h('kbd', null, 'Shift+←/→'), ' соседний рисунок'),
  );
  el.classList.add('fbf-sec');
  return el;
}

registerInspector({ id: 'fbf', order: 5, when: (L) => !!fbfOf(L), build: fbfSection });

// ---------- меню, таймлайн, шаблон ----------
registerMenu('Слой', () => {
  const A = app.active;
  const items = [{ label: 'Новый покадровый слой', icon: 'fbf', action: createFbf }];
  if (A && A.type === 'vector' && !fbfOf(A)) items.push({ label: 'Сделать покадровым (рисунок 1)', icon: 'fbf', action: () => convertToFbf(A) });
  return items;
});
registerMenu('Анимация', () => {
  const F = fbfOf(app.active);
  if (!F) return [{ label: 'Новый покадровый слой (рисованная анимация)', icon: 'fbf', action: createFbf }];
  return [
    { title: 'Покадровая анимация' },
    { label: 'Новый рисунок', icon: 'plus', key: 'N', action: () => addFrame(F, 'blank') },
    { label: 'Копия рисунка', icon: 'copy', key: 'Shift+N', action: () => addFrame(F, 'copy') },
    { label: 'Пустой кадр', icon: 'fbfempty', key: 'B', action: () => addFrame(F, 'empty') },
    { label: 'Следующий шаг', icon: 'next', key: 'Enter', action: () => stepFrame(F, 1) },
    { label: 'Луковая кожа рисунков', icon: 'onion', checked: O.fbfOnion, action: () => { setOnion(!O.fbfOnion); app.rebuildInspector && app.rebuildInspector(); } },
  ];
});

registerTimelineMenu(({ row, frame }) => {
  const F = row && row.layer ? fbfOf(row.layer) : null;
  if (!F || frame < 1) return [];
  return [
    { label: `Новый рисунок на кадре ${frame}`, icon: 'fbf', action: () => addFrame(F, 'blank', frame) },
    { label: `Копия рисунка на кадр ${frame}`, icon: 'copy', action: () => addFrame(F, 'copy', frame) },
    { label: `Пустой кадр на кадре ${frame}`, icon: 'fbfempty', action: () => addFrame(F, 'empty', frame) },
  ];
});

registerTemplate({
  id: 'fbf',
  name: 'Рисованная анимация',
  description: 'Покадрово, как в мультфильмах: рисуете кадр за кадром, предыдущий рисунок просвечивает',
  order: 20,
  build() {
    const d = newDoc();
    d.name = 'Рисованная анимация';
    const { F } = makeFbf(d, 'Покадровая 1', firstFrame(d));
    d.end = firstFrame(d) + stepOf(F) - 1; // длина растёт вместе с рисунками
    d.layers.push(F);
    d._fbfStart = true;
    return d;
  },
});

registerHook('docLoaded', (doc) => {
  pending = null;
  lastSet = null;
  detour = null;
  track = null;
  if (!doc._fbfStart) {
    // открыли проект: активным должен быть рисунок, видимый на текущем кадре (кадр выставляется после загрузки)
    setTimeout(() => {
      const A = app.active, F = fbfOf(A);
      if (F && A !== F && shownAt(F, app.frame) !== A && !app.playing) setActiveAuto(shownAt(F, app.frame) || F);
    }, 0);
    return;
  }
  delete doc._fbfStart;
  setTimeout(() => {
    const F = app.idx.list.find(isFbf);
    const D = F && F.children[0];
    if (D) setActiveAuto(D);
    if (!DRAW_TOOLS.includes(app.tool)) app.cmd.setTool('freehand');
    setOnion(true);
    revealSection();
    app.toast('Рисуйте кистью (F). Готово — нажмите N: новый лист через ' + framesW(F ? stepOf(F) : 2) + ', предыдущий рисунок будет просвечивать.', 7000);
  }, 0);
});

// ---------- горячие клавиши (только когда выбран покадровый слой или его рисунок) ----------
const inFbf = () => !!fbfOf(app.active);
const withF = (fn) => () => { const F = fbfOf(app.active); if (F) fn(F); };
registerShortcut({ key: 'n', when: inFbf, run: withF((F) => addFrame(F, 'blank')), label: 'Покадровая анимация: новый рисунок через «шаг»' });
registerShortcut({ key: 'n', shift: true, when: inFbf, run: withF((F) => addFrame(F, 'copy')), label: 'Покадровая анимация: копия текущего рисунка' });
registerShortcut({ key: 'b', when: inFbf, run: withF((F) => addFrame(F, 'empty')), label: 'Покадровая анимация: пустой кадр' });
registerShortcut({ key: 'enter', when: inFbf, run: withF((F) => stepFrame(F, 1)), keyLabel: 'Enter', label: 'Покадровая анимация: следующий шаг' });
registerShortcut({ key: 'enter', shift: true, when: inFbf, run: withF((F) => stepFrame(F, -1)), keyLabel: 'Enter', label: 'Покадровая анимация: предыдущий шаг' });

// Shift+←/→ на рисунке: ядро ищет ключи только в самом рисунке (их там нет) — ищем в покадровом слое
const onDrawing = () => { const A = app.active, F = fbfOf(A); return !!F && A !== F; };
function jumpDrawing(dir) {
  const F = fbfOf(app.active);
  if (!F) return;
  const frames = app.allKeyFrames(F), f = app.frame;
  const t = dir > 0 ? frames.find((x) => x > f) : [...frames].reverse().find((x) => x < f);
  if (t != null) app.setFrame(t);
}
registerShortcut({ key: 'arrowright', shift: true, when: onDrawing, run: () => jumpDrawing(1) });
registerShortcut({ key: 'arrowleft', shift: true, when: onDrawing, run: () => jumpDrawing(-1) });

// ---------- значок и подпись слоя ----------
registerHook('layerIcon', (L) => (isFbf(L) ? 'fbf' : null));
registerHook('layerLabel', (L) => (isFbf(L) ? 'Покадровый' : null));

addStyle(`
.fbf-status { font-size: 12px; color: #e3d4ff; background: rgba(211,139,255,.1); border: 1px solid rgba(211,139,255,.28); border-radius: 6px; padding: 5px 8px; margin-bottom: 6px; }
.fbf-btns { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; }
.fbf-btns .btn { justify-content: center; gap: 4px; padding: 5px 4px; min-width: 0; }
.fbf-btns .btn.wide { grid-column: 1 / -1; padding: 6px 8px; font-size: 13px; }
.fbf-btns .btn > span:not(.ic) { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.fbf-btns kbd { font-size: 10px; padding: 0 5px; min-width: 0; background: rgba(0,0,0,.22); border-color: rgba(255,255,255,.25); color: inherit; margin-left: 4px; }
.fbf-keys { line-height: 1.9; }
.fbf-keys kbd { font-size: 10px; padding: 0 4px; min-width: 0; }
.fbf-lab { color: var(--text2); font-size: 12px; min-width: 58px; }
.fbf-hold .btn { padding: 3px 9px; }
.fbf-hold-v { min-width: 62px; text-align: center; font-variant-numeric: tabular-nums; font-size: 12px; }
.fbf-seg { display: inline-flex; border: 1px solid var(--line2); border-radius: 6px; overflow: hidden; }
.fbf-seg button { padding: 3px 11px; background: var(--bg3); border: 0; border-right: 1px solid var(--line2); color: var(--text); font-size: 12px; }
.fbf-seg button:last-child { border-right: 0; }
.fbf-seg button:hover { background: var(--bg4); }
.fbf-seg button.on { background: var(--accent2); color: #fff; }
.fbf-note { color: var(--text3); font-size: 11.5px; }
.fbf-onion .num { flex: 0 0 auto; }
.fbf-onion .chk { flex: 1; }
.fbf-list { max-height: 248px; overflow-y: auto; border: 1px solid var(--line); border-radius: 6px; margin-top: 8px; background: var(--bg0); position: relative; }
.fbf-item { display: flex; align-items: center; gap: 8px; padding: 3px 4px 3px 5px; cursor: pointer; border-bottom: 1px solid var(--line); font-size: 12px; }
.fbf-item:last-child { border-bottom: 0; }
.fbf-item:hover { background: var(--bg2); }
.fbf-item.on { background: var(--accent-bg); box-shadow: inset 3px 0 0 var(--accent); }
.fbf-item.unused { opacity: .7; }
.fbf-item .fbf-th { width: 44px; height: auto; border-radius: 3px; border: 1px solid var(--line2); flex: none; display: block; }
.fbf-item .fbf-th-empty { height: 25px; display: grid; place-items: center; color: var(--text3); border-style: dashed; background: none; }
.fbf-item.empty .fbf-nm { color: var(--text3); font-style: italic; }
.fbf-nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fbf-fr { color: var(--text3); font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.fbf-re { width: 22px; height: 22px; padding: 0; opacity: 0; }
.fbf-item:hover .fbf-re, .fbf-item.unused .fbf-re, .fbf-re:focus-visible { opacity: 1; }
.fbf-none { padding: 12px; color: var(--text3); text-align: center; font-size: 12px; }
`, 'fbf-css');
