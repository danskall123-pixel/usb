// Траектория движения (как в Moho/AE): пунктир пути активного слоя, выделенных костей или точек
// по кадрам сцены. Ромбики — ключи положения (их можно тянуть), точки — кадры (клик — перейти к кадру).
import { app } from '../app.js';
import { M, RAD, DEG, h, normAngle, pointInPoly, distToSeg } from '../util.js';
import { evalCh, setKey, keyIndex } from '../anim.js';
import { evaluate } from '../scene.js';
import { tools, snapXY, layerBox, hitBone, hitPoint, hitShape } from '../tools.js';
import { icon, registerIcon } from '../icons.js';
import { registerOverlay, registerViewportHandler, registerOptbarButton, registerMenu } from '../ext.js';

registerIcon('motionpath', '<path d="M3 18.5c3.5 0 4.5-11 9-11s5.5 8 9 8" stroke-dasharray="2.2 2.6"/><path d="M12 4.6l2.9 2.9L12 10.4 9.1 7.5z" fill="currentColor"/><circle cx="3.5" cy="18.5" r="1.7" fill="currentColor"/><circle cx="20.5" cy="15.5" r="1.7" fill="currentColor"/>');

const MAX_FRAMES = 600;
const MAX_BONES = 6;
const COL = '#ff5fd2';
const HIT_KEY = 7, HIT_DOT = 5;
const CUR_ZONE = 10; // вокруг положения на текущем кадре клик достаётся инструменту (там сам объект)

// ---------- настройка: показ траектории ----------
const LS = 'anim2d.motionPath';
if (app.opts.motionPath === undefined) {
  let on = true;
  try { on = localStorage.getItem(LS) !== '0'; } catch (e) { /* нет доступа */ }
  app.opts.motionPath = on;
}
const enabled = () => app.opts.motionPath !== false;

function toggle() {
  app.opts.motionPath = !enabled();
  try { localStorage.setItem(LS, app.opts.motionPath ? '1' : '0'); } catch (e) { /* нет доступа */ }
  hover = null;
  app.refresh(['optbar']);
  app.render();
  app.toast(app.opts.motionPath ? 'Траектория движения показана: пунктир с ключами-ромбиками' : 'Траектория движения скрыта', 1800);
}

// ---------- цели: что показываем ----------
const parentOf = (X) => app.idx.parent.get(X.id) || null;

function targets() {
  const L = app.active;
  if (!L || !app.doc || !app.idx || L.vis === false) return [];
  if (L.type === 'bone' && L.bones && app.sel.bones.size) {
    const bones = L.bones.filter((b) => app.sel.bones.has(b.id)).slice(0, MAX_BONES);
    if (bones.length) return bones.map((b) => ({ kind: 'bone', L, b, key: 'b' + b.id }));
  }
  if (L.type === 'vector' && L.paths && app.sel.pts.size) {
    const t = tools[app.tool];
    if (t && (t.group === 'draw' || t.group === 'bind')) {
      const pts = [];
      for (const p of L.paths) for (const pt of p.pts) if (app.sel.pts.has(pt.id)) pts.push(pt);
      if (pts.length) return [{ kind: 'pts', L, pts, key: 'p' + L.id + ':' + pts.map((p) => p.id).join(',') }];
    }
  }
  return [{ kind: 'layer', L, key: 'L' + L.id, anchor: layerAnchor(L) }];
}

// Точка слоя, путь которой показываем: точка вращения, а если она далеко от рисунка — центр содержимого
function layerAnchor(L) {
  const o = L.origin || [0, 0];
  let bb = null;
  try { bb = layerBox(L); } catch (e) { bb = null; }
  if (!bb) return [o[0], o[1]];
  const mx = (bb.x1 - bb.x0) * 0.2 + 6, my = (bb.y1 - bb.y0) * 0.2 + 6;
  if (o[0] >= bb.x0 - mx && o[0] <= bb.x1 + mx && o[1] >= bb.y0 - my && o[1] <= bb.y1 + my) return [o[0], o[1]];
  return [Math.round((bb.x0 + bb.x1) / 2), Math.round((bb.y0 + bb.y1) / 2)];
}

// Минимальный документ: только цепочка предков цели (для быстрого вычисления сотен кадров)
function miniDoc(tg) {
  const chain = [];
  for (let X = tg.L; X; X = parentOf(X)) chain.unshift(X);
  let child = null;
  for (let i = chain.length - 1; i >= 0; i--) {
    const X = chain[i], c = { ...X };
    if (X.children) c.children = child ? [child] : [];
    if (i === chain.length - 1 && X.paths) {
      const ids = tg.kind === 'pts' ? new Set(tg.pts.map((p) => p.id)) : null;
      c.paths = ids ? X.paths.filter((p) => p.pts.some((pt) => ids.has(pt.id))) : [];
    }
    child = c;
  }
  return { cam: app.doc.cam, layers: [child] };
}

// Мировая (документ) позиция цели на вычисленной сцене
function worldPos(tg, S) {
  const rec = S.layers.get(tg.L.id);
  if (!rec) return null;
  if (tg.kind === 'bone') {
    const m = rec.bc && rec.bc.Mt.get(tg.b.id);
    if (!m) return null;
    return M.apply(M.mul(rec.bc.world, m), tg.b.len, 0);
  }
  if (tg.kind === 'pts') {
    let x = 0, y = 0, n = 0;
    for (const pt of tg.pts) { const P = S.points.get(pt.id); if (P) { x += P.x; y += P.y; n++; } }
    return n ? [x / n, y / n] : null;
  }
  const o = tg.anchor || tg.L.origin || [0, 0];
  return M.apply(rec.world, o[0], o[1]);
}

// Каналы, ключи которых рисуются ромбиками
function keyChannels(tg) {
  if (tg.kind === 'bone') return [tg.b.pos, tg.b.ang];
  if (tg.kind === 'pts') return tg.pts.map((p) => p.pos);
  return [tg.L.pos];
}

function frameRange() {
  const d = app.doc;
  let f0 = Math.max(0, d.start | 0), f1 = Math.max(f0 + 1, d.end | 0);
  if (f1 - f0 > MAX_FRAMES) {
    // окно вокруг текущего кадра, сдвигается шагами по 100 кадров (без пересчёта на каждом кадре)
    const want = Math.floor((app.frame - (MAX_FRAMES >> 1) - f0) / 100) * 100 + f0;
    f0 = Math.max(f0, Math.min(f1 - MAX_FRAMES, want));
    f1 = f0 + MAX_FRAMES;
  }
  return [f0, f1];
}

// Подпись данных, от которых зависит траектория (кэш пересчитывается только при её изменении)
function signature(tg, f0, f1) {
  const parts = [tg.key, f0, f1, tg.anchor || 0];
  for (let X = tg.L; X; X = parentOf(X)) parts.push(X.id, X.pos, X.rot, X.scl, X.origin, X.bind, X.outside, X.bones || 0);
  if (tg.kind === 'pts') for (const pt of tg.pts) parts.push(pt.pos, pt.bone);
  return JSON.stringify(parts);
}

let cache = new Map();
// Траектории целей: { frames, pts, keys } для каждой. Несколько костей одного слоя считаются
// за один проход по кадрам (сцена вычисляется один раз на кадр, а не на каждую кость).
function trajectories(tgs) {
  const [f0, f1] = frameRange();
  const res = new Map();
  const groups = new Map();
  for (const tg of tgs) {
    const sig = signature(tg, f0, f1);
    const c = cache.get(tg.key);
    if (c && c.sig === sig) { res.set(tg, c.data); continue; }
    const g = tg.kind === 'bone' ? 'B' + tg.L.id : tg.key;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push({ tg, sig, frames: [], pts: [] });
  }
  for (const list of groups.values()) {
    const doc = miniDoc(list[0].tg);
    for (let f = f0; f <= f1; f++) {
      const S = evaluate(doc, f);
      for (const it of list) { const p = worldPos(it.tg, S); if (p) { it.frames.push(f); it.pts.push(p); } }
    }
    for (const it of list) {
      const keys = new Set();
      for (const ch of keyChannels(it.tg)) for (const k of ch.k) if (k.f >= f0 && k.f <= f1) keys.add(k.f);
      const data = { frames: it.frames, pts: it.pts, keys };
      if (cache.size > 24) cache = new Map();
      cache.set(it.tg.key, { sig: it.sig, data });
      res.set(it.tg, data);
    }
  }
  return res;
}

// ---------- отрисовка ----------
let drawn = [];   // [{ tg, frames, sp: [[sx, sy]], keys }] — то, что нарисовано (для попаданий)
let hover = null; // { tg, f, key }
let hinted = false;
try { hinted = localStorage.getItem('anim2d.mpHint') === '1'; } catch (e) { /* нет доступа */ }

function diamond(ctx, x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y);
  ctx.closePath();
}

function pill(ctx, x, y, text) {
  ctx.font = '11px Inter, system-ui, sans-serif';
  const w = ctx.measureText(text).width + 12, hh = 19;
  let px = x + 12, py = y - hh - 8;
  const W = ctx.canvas.clientWidth || ctx.canvas.width;
  if (px + w > W - 4) px = x - w - 12;
  if (py < 4) py = y + 10;
  ctx.fillStyle = 'rgba(20,22,26,.92)';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(px, py, w, hh, 5); else ctx.rect(px, py, w, hh);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, px + 6, py + hh / 2 + 0.5);
}

function hoverText(hv) {
  const base = 'Кадр ' + hv.f;
  if (!hv.key) return base + ' — клик: перейти';
  if (hv.tg.L.lock) return base + ' · ключ (слой заблокирован)';
  if (hv.tg.kind === 'bone' && hv.f === 0) return base + ' (поза покоя) — клик: перейти';
  if (hv.tg.kind === 'bone') return base + ' · ключ — тяните, чтобы ' + (boneMode(hv.tg, hv.f, false) === 'move' ? 'сдвинуть' : 'повернуть') + ' кость';
  return base + ' · ключ — тяните, чтобы поправить путь';
}

function drawPath(ctx, m, tg, T) {
  const n = T.pts.length;
  if (n < 2) return null;
  const sp = T.pts.map((p) => M.apply(m, p[0], p[1]));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of sp) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 - x0 < 2 && y1 - y0 < 2) return null; // цель не движется
  const cur = app.frame;
  const line = (from, to) => {
    ctx.beginPath();
    ctx.moveTo(sp[from][0], sp[from][1]);
    for (let i = from + 1; i <= to; i++) ctx.lineTo(sp[i][0], sp[i][1]);
  };
  // подложка для контраста на светлом фоне
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash([]);
  ctx.lineWidth = 3.2;
  ctx.strokeStyle = 'rgba(15,16,20,.22)';
  line(0, n - 1); ctx.stroke();
  // пунктир: прошлое тусклее, будущее ярче
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3.5, 3.5]);
  ctx.strokeStyle = COL;
  const ci = T.frames.indexOf(cur);
  if (ci > 0) { ctx.globalAlpha = 0.5; line(0, ci); ctx.stroke(); }
  ctx.globalAlpha = 1;
  line(Math.max(0, ci), n - 1); ctx.stroke();
  ctx.setLineDash([]);
  // точки кадров (прореживаются, если стоят слишком плотно)
  let lx = -1e9, ly = -1e9;
  for (let i = 0; i < n; i++) {
    const f = T.frames[i];
    if (T.keys.has(f) || f === cur) continue;
    const [x, y] = sp[i];
    if (Math.hypot(x - lx, y - ly) < 4) continue;
    lx = x; ly = y;
    ctx.globalAlpha = f < cur ? 0.55 : 1;
    ctx.beginPath(); ctx.arc(x, y, 2.1, 0, Math.PI * 2);
    ctx.fillStyle = COL; ctx.fill();
    ctx.lineWidth = 0.8; ctx.strokeStyle = 'rgba(15,16,20,.6)'; ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // ключи — ромбики
  for (let i = 0; i < n; i++) {
    const f = T.frames[i];
    if (!T.keys.has(f)) continue;
    const [x, y] = sp[i];
    const hv = hover && hover.tg.key === tg.key && hover.f === f;
    diamond(ctx, x, y, hv ? 7 : 5.2);
    ctx.fillStyle = hv ? '#ffffff' : COL;
    ctx.fill();
    ctx.lineWidth = 1.4; ctx.strokeStyle = hv ? COL : '#ffffff'; ctx.stroke();
  }
  // текущий кадр
  if (ci >= 0) {
    const [x, y] = sp[ci];
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(15,16,20,.35)'; ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = '#ff4d5a'; ctx.stroke();
  }
  // подсвеченная точка кадра
  if (hover && hover.tg.key === tg.key && !hover.key) {
    const i = T.frames.indexOf(hover.f);
    if (i >= 0) {
      ctx.beginPath(); ctx.arc(sp[i][0], sp[i][1], 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = COL; ctx.stroke();
    }
  }
  return { tg, frames: T.frames, sp, keys: T.keys };
}

registerOverlay((ctx) => {
  drawn = [];
  if (!enabled() || app.playing || !app.doc) return;
  const tgs = targets();
  if (!tgs.length) return;
  const m = app.docToScreenM();
  const T = trajectories(tgs);
  for (const tg of tgs) {
    const d = drawPath(ctx, m, tg, T.get(tg));
    if (d) drawn.push(d);
  }
  if (hover) {
    const d = drawn.find((x) => x.tg.key === hover.tg.key);
    const i = d ? d.frames.indexOf(hover.f) : -1;
    if (i >= 0) pill(ctx, d.sp[i][0], d.sp[i][1], hoverText(hover));
    else hover = null;
  }
  if (drawn.length && !hinted) {
    hinted = true;
    try { localStorage.setItem('anim2d.mpHint', '1'); } catch (e) { /* нет доступа */ }
    setTimeout(() => app.toast('Розовый пунктир — траектория движения. Тяните ромбики (ключи), чтобы поправить путь; клик по точке — переход к кадру.', 6000), 50);
  }
});

// ---------- попадания и правка ----------
// Можно ли сейчас перехватывать клики по траектории (инструменты рисования и вид — не трогаем)
function interactive() {
  if (!enabled() || app.playing || app.spaceHeld || !drawn.length) return false;
  const t = tools[app.tool];
  if (!t) return false;
  if (t.cursor === 'crosshair' || t.group === 'camera' || t.group === 'view' || t.id === 'addpoint') return false;
  return true;
}

// Содержимое активного слоя под курсором: клик по нему — работа инструмента, а не переход к кадру
function overObject(sx, sy) {
  const L = app.active, t = tools[app.tool];
  if (!L || !t) return false;
  try {
    if (t.group === 'bone') { const B = app.boneLayerFor(); return !!(B && hitBone(B, sx, sy, 11)); }
    if (L.type === 'vector' && (t.group === 'draw' || t.group === 'bind' || t.group === 'fill')) return !!(hitPoint(L, sx, sy) || hitShape(L, sx, sy));
    const bb = layerBox(L);
    if (!bb) return false;
    const q = [[bb.x0, bb.y0], [bb.x1, bb.y0], [bb.x1, bb.y1], [bb.x0, bb.y1]].map(([x, y]) => bb.toS(x, y));
    if (pointInPoly(sx, sy, q)) return true;
    // кромка рамки и зона поворота у углов (как у «Трансформировать слой»)
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4];
      if (distToSeg(sx, sy, a[0], a[1], b[0], b[1]).d <= 8 || Math.hypot(sx - a[0], sy - a[1]) <= 28) return true;
    }
  } catch (e) { /* нет данных для проверки */ }
  return false;
}

function hitTest(sx, sy) {
  let best = null, bd = Infinity;
  const cur = app.frame;
  // положение цели на текущем кадре: если курсор ближе к нему, клик достаётся инструменту
  let dc = Infinity;
  for (const d of drawn) { const i = d.frames.indexOf(cur); if (i >= 0) dc = Math.min(dc, Math.hypot(d.sp[i][0] - sx, d.sp[i][1] - sy)); }
  // сначала ключи, потом точки кадров
  for (const pass of [true, false]) {
    const r = pass ? HIT_KEY : HIT_DOT;
    for (const d of drawn) {
      for (let i = 0; i < d.frames.length; i++) {
        const f = d.frames[i];
        if (f === cur || d.keys.has(f) !== pass) continue; // текущий кадр правится обычными инструментами
        const dist = Math.hypot(d.sp[i][0] - sx, d.sp[i][1] - sy);
        if (dist > r) continue;
        // путь может проходить по себе же: при равном расстоянии — кадр, ближайший к текущему
        const better = !best || dist < bd - 0.5 || (dist <= bd + 0.5 && Math.abs(f - cur) < Math.abs(best.f - cur));
        if (better) { bd = Math.min(bd, dist); best = { tg: d.tg, f, key: pass }; }
      }
    }
    if (best) {
      if (dc <= CUR_ZONE && dc <= bd + 1) return null;
      // точка кадра поверх самого объекта — пусть инструмент берёт объект (ромбики ключей важнее)
      if (!pass && overObject(sx, sy)) return null;
      return best;
    }
  }
  return null;
}

function setHover(hv) {
  const same = (a, b) => (!a && !b) || (a && b && a.tg.key === b.tg.key && a.f === b.f && a.key === b.key);
  if (same(hover, hv)) return;
  hover = hv;
  app.render();
}

// Кость: корневую кость с ключом положения на кадре — двигаем, иначе — поворачиваем (Alt — наоборот)
function boneMode(tg, f, alt) {
  const B = tg.L, b = tg.b;
  const root = b.parent == null || !B.bones.some((x) => x.id === b.parent);
  const canMove = root && keyIndex(b.pos, f) >= 0;
  if (!root) return 'rotate';
  return canMove !== !!alt ? 'move' : 'rotate';
}

let drag = null;

function startDrag(hit, e) {
  const tg = hit.tg, f = hit.f;
  const S = evaluate(miniDoc(tg), f);
  const w0 = worldPos(tg, S);
  const rec = S.layers.get(tg.L.id);
  if (!w0 || !rec) return null;
  const d = { tg, f, w0, start: e, moved: false, click: false };
  if (tg.kind === 'layer') {
    d.Pi = M.inv(M.mul(rec.world, M.inv(rec.local)));
    d.v0 = evalCh(tg.L.pos, f).slice();
  } else if (tg.kind === 'bone') {
    const b = tg.b;
    const pm = (b.parent != null && rec.bc && rec.bc.Mt.get(b.parent)) || M.id();
    d.Pi = M.inv(M.mul(rec.bc ? rec.bc.world : rec.world, pm));
    d.mode = boneMode(tg, f, e.alt);
    d.pos0 = evalCh(b.pos, f).slice();
    d.ang0 = evalCh(b.ang, f);
  } else {
    d.items = [];
    for (const pt of tg.pts) {
      const P = S.points.get(pt.id);
      if (P) d.items.push({ pt, Fi: M.inv(P.F), v0: evalCh(pt.pos, f).slice() });
    }
  }
  return d;
}

function applyDrag(e) {
  const d = drag;
  let dx = e.x - d.start.x, dy = e.y - d.start.y;
  if (e.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
  if (app.opts.snap) {
    const [sx, sy] = snapXY(d.w0[0] + dx, d.w0[1] + dy);
    dx = sx - d.w0[0]; dy = sy - d.w0[1];
  }
  const f = d.f, tg = d.tg;
  if (tg.kind === 'layer') {
    const v = M.applyV(d.Pi, dx, dy);
    setKey(tg.L.pos, f, [d.v0[0] + v[0], d.v0[1] + v[1]]);
  } else if (tg.kind === 'bone') {
    const b = tg.b;
    if (d.mode === 'move') {
      const v = M.applyV(d.Pi, dx, dy);
      setKey(b.pos, f, [d.pos0[0] + v[0], d.pos0[1] + v[1]]);
    } else {
      const t = M.apply(d.Pi, d.w0[0] + dx, d.w0[1] + dy), p = d.pos0;
      if (Math.hypot(t[0] - p[0], t[1] - p[1]) < 1e-6) return;
      const a = Math.atan2(t[1] - p[1], t[0] - p[0]) * RAD;
      setKey(b.ang, f, d.ang0 + normAngle((a - d.ang0) * DEG) * RAD);
    }
  } else {
    for (const it of d.items) {
      const v = M.applyV(it.Fi, dx, dy);
      setKey(it.pt.pos, f, [it.v0[0] + v[0], it.v0[1] + v[1]]);
    }
  }
  app.changed();
}

registerViewportHandler({
  hover(e) {
    if (!interactive()) { if (hover) setHover(null); return null; }
    const hit = hitTest(e.sx, e.sy);
    setHover(hit);
    if (!hit) return null;
    return hit.key && !hit.tg.L.lock && !(hit.tg.kind === 'bone' && hit.f === 0) ? 'move' : 'pointer';
  },
  down(e) {
    if (!interactive()) return false;
    const hit = hitTest(e.sx, e.sy);
    if (!hit) return false;
    // кадр 0 костей — поза покоя: её правят «Трансформировать кость», а не анимация
    if (!hit.key || hit.tg.L.lock || (hit.tg.kind === 'bone' && hit.f === 0)) {
      drag = { click: true, f: hit.f, start: e };
      return true;
    }
    drag = startDrag(hit, e);
    if (!drag) drag = { click: true, f: hit.f, start: e };
    return true;
  },
  move(e) {
    const d = drag;
    if (!d || d.click) return;
    if (!d.moved && Math.hypot(e.sx - d.start.sx, e.sy - d.start.sy) < 3) return;
    d.moved = true;
    applyDrag(e);
  },
  up() {
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.moved) { app.commit('Траектория: ключ кадра ' + d.f); return; }
    app.setFrame(d.f);
  },
});

// ---------- кнопка и меню ----------
function toggleButton() {
  const on = enabled();
  return h('button', {
    class: 'icon-btn tog mp-tog' + (on ? ' on' : ''),
    title: 'Траектория движения — пунктир пути выбранного слоя, кости или точек. Ромбики (ключи) можно тянуть',
    'aria-label': 'Траектория движения', 'aria-pressed': on,
    onclick: toggle,
  }, icon('motionpath', 18));
}
registerOptbarButton(toggleButton);

// курсор ушёл с холста — убрать подсказку
const vpCanvas = document.querySelector('#viewport canvas');
if (vpCanvas) vpCanvas.addEventListener('pointerleave', () => { if (hover && !drag) setHover(null); });

registerMenu('Вид', () => [
  { label: 'Траектория движения', icon: 'motionpath', checked: enabled(), action: toggle },
]);

// Только для чтения: что нарисовано сейчас (для тестов и других модулей)
app.motionPath = {
  toggle,
  drawn: () => (app.playing ? [] : drawn).map((d) => ({ key: d.tg.key, kind: d.tg.kind, frames: d.frames.slice(), sp: d.sp.map((p) => p.slice()), keys: [...d.keys] })),
};

// сброс кэша при открытии другого проекта
app.on('docloaded', () => { cache = new Map(); hover = null; drawn = []; });
