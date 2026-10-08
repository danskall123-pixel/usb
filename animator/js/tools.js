// Инструменты (в духе Moho): точки, рисование, фигуры, заливка, кости, привязка, слой, камера.
import { app, reparentBone } from './app.js';
import {
  M, RAD, DEG, clamp, distToSeg, rdp, bezierSegs, cubicAt, nearestOnSegs, pointInPoly, OVAL_CURV, normAngle, segsPath, rgba,
} from './util.js';
import { setKey, evalCh } from './anim.js';
import { newPoint, newPath, newBone, boneColor, boneDescendants } from './model.js';
import { boneMats, layerWorldPoints } from './scene.js';

export const tools = {};
export const TOOL_ORDER = [];
const def = (t) => { tools[t.id] = t; TOOL_ORDER.push(t.id); return t; };

const hctx = document.createElement('canvas').getContext('2d');
const S = () => app.scene();
const recOf = (L) => S().layers.get(L.id);
const isVec = () => !!app.active && app.active.type === 'vector';
const isBoneL = () => !!app.active && app.active.type === 'bone';
const opt = (k, d) => (app.toolOpts[k] === undefined ? d : app.toolOpts[k]);
const camZoom = () => Math.abs(evalCh(app.doc.cam.zoom, app.frame)) || 1;

function editable(L, kind) {
  if (!L || (kind && L.type !== kind)) return false;
  if (L.lock) { app.toast('Слой заблокирован'); return false; }
  return true;
}

export function snapXY(x, y) {
  if (!app.opts.snap) return [x, y];
  const g = app.opts.gridSize;
  return [Math.round(x / g) * g, Math.round(y / g) * g];
}

// ---------- Попадания ----------
export function screenPathData(pr, m) {
  const n = pr.xs.length;
  const xs = new Float64Array(n), ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = m[0] * pr.xs[i] + m[2] * pr.ys[i] + m[4];
    ys[i] = m[1] * pr.xs[i] + m[3] * pr.ys[i] + m[5];
  }
  return { xs, ys, segs: bezierSegs(xs, ys, pr.cs, pr.path.closed) };
}

export function hitPoint(L, sx, sy, r = 8) {
  if (!L || L.type !== 'vector') return null;
  const m = app.docToScreenM();
  let best = null, bd = r;
  for (const p of L.paths) for (const pt of p.pts) {
    const P = S().points.get(pt.id);
    if (!P) continue;
    const d = Math.hypot(m[0] * P.x + m[2] * P.y + m[4] - sx, m[1] * P.x + m[3] * P.y + m[5] - sy);
    if (d <= bd) { bd = d; best = pt.id; }
  }
  return best;
}

function hitSegment(L, sx, sy, tol = 6) {
  const rec = recOf(L);
  if (!rec || !rec.paths) return null;
  const m = app.docToScreenM();
  let best = null;
  for (const pr of rec.paths) {
    if (pr.xs.length < 2) continue;
    const { segs } = screenPathData(pr, m);
    const r = nearestOnSegs(segs, sx, sy);
    if (r.d <= tol && (!best || r.d < best.d)) best = { path: pr.path, seg: r.seg, t: r.t, d: r.d };
  }
  return best;
}

export function hitShape(L, sx, sy) {
  const rec = L && recOf(L);
  if (!rec || !rec.paths) return null;
  const m = app.docToScreenM();
  const k = app.view.z * camZoom();
  for (let i = rec.paths.length - 1; i >= 0; i--) {
    const pr = rec.paths[i];
    if (pr.xs.length < 2) continue;
    const { segs } = screenPathData(pr, m);
    const P = segsPath(segs, pr.path.closed);
    if (pr.path.closed && hctx.isPointInPath(P, sx, sy)) return pr.path;
    hctx.lineWidth = Math.max(10, (pr.path.hs ? pr.width * rec.lw : 0) * k);
    if (hctx.isPointInStroke(P, sx, sy)) return pr.path;
  }
  return null;
}

export function boneScreen(B, b) {
  const rec = recOf(B);
  if (!rec || !rec.bc) return null;
  const W = M.mul(app.docToScreenM(), M.mul(rec.bc.world, rec.bc.Mt.get(b.id)));
  return { o: M.apply(W, 0, 0), t: M.apply(W, b.len, 0), W };
}

export function hitBone(B, sx, sy, tol = 9) {
  if (!B || !B.bones) return null;
  let best = null;
  for (const b of B.bones) {
    const s = boneScreen(B, b);
    if (!s) continue;
    const r = distToSeg(sx, sy, s.o[0], s.o[1], s.t[0], s.t[1]);
    if (r.d > tol) continue;
    if (!best || r.d < best.d - 0.01) {
      const lenPx = Math.hypot(s.t[0] - s.o[0], s.t[1] - s.o[1]);
      const tipD = Math.hypot(sx - s.t[0], sy - s.t[1]);
      best = { bone: b, d: r.d, t: r.t, tip: tipD < clamp(lenPx * 0.3, 6, 16) };
    }
  }
  return best;
}

// ---------- Перетаскивание точек (с учётом деформации костями) ----------
function dragItems(ids, wfn) {
  const out = [];
  for (const id of ids) {
    const P = S().points.get(id);
    if (!P) continue;
    const w = wfn ? wfn(P) : 1;
    if (w <= 0) continue;
    out.push({ pt: P.pt, x0: P.x, y0: P.y, Fi: M.inv(P.F), w });
  }
  return out;
}

function applyDrag(items, fn) {
  const f = app.frame;
  for (const it of items) {
    const [nx, ny] = fn(it);
    setKey(it.pt.pos, f, M.apply(it.Fi, nx, ny));
  }
  app.changed();
}

function moveItems(st, e) {
  if (!st.moved && Math.hypot(e.sx - st.start.sx, e.sy - st.start.sy) < 3) return;
  st.moved = true;
  let dx = e.x - st.start.x, dy = e.y - st.start.y;
  if (e.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
  if (app.opts.snap && st.anchor) {
    const [ax, ay] = snapXY(st.anchor[0] + dx, st.anchor[1] + dy);
    dx = ax - st.anchor[0]; dy = ay - st.anchor[1];
  }
  applyDrag(st.items, (it) => [it.x0 + dx * it.w, it.y0 + dy * it.w]);
}

function toLocal(L, x, y) {
  const rec = recOf(L);
  return M.apply(M.inv(rec.world), x, y);
}

// Хинт о рисовании вне кадра 0 на слое с костями
let warnedDraw = false;
function drawWarn(L) {
  if (warnedDraw || app.frame === 0 || !app.boneLayerFor(L)) return;
  warnedDraw = true;
  app.toast('Совет: рисуйте и привязывайте точки на кадре 0 (поза покоя)', 3500);
}

// ---------- Рамка / лассо ----------
const box = {
  on: false,
  start(e) { this.on = true; this.x0 = this.x1 = e.sx; this.y0 = this.y1 = e.sy; this.lasso = opt('lasso', false) ? [[e.sx, e.sy]] : null; },
  move(e) { this.x1 = e.sx; this.y1 = e.sy; if (this.lasso) this.lasso.push([e.sx, e.sy]); app.render(); },
  test(x, y) {
    if (this.lasso) return pointInPoly(x, y, this.lasso);
    return x >= Math.min(this.x0, this.x1) && x <= Math.max(this.x0, this.x1) && y >= Math.min(this.y0, this.y1) && y <= Math.max(this.y0, this.y1);
  },
  big() { return Math.abs(this.x1 - this.x0) + Math.abs(this.y1 - this.y0) > 4 || (this.lasso && this.lasso.length > 3); },
  selectPoints(L) {
    if (!L || L.type !== 'vector' || !this.big()) return;
    const m = app.docToScreenM();
    for (const p of L.paths) for (const pt of p.pts) {
      const P = S().points.get(pt.id);
      if (!P) continue;
      const [x, y] = M.apply(m, P.x, P.y);
      if (this.test(x, y)) app.sel.pts.add(pt.id);
    }
  },
  draw(ctx) {
    if (!this.on) return;
    ctx.save();
    ctx.strokeStyle = '#7fb6ff';
    ctx.fillStyle = 'rgba(90,150,255,.08)';
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (this.lasso) { this.lasso.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); }
    else ctx.rect(Math.min(this.x0, this.x1) + 0.5, Math.min(this.y0, this.y1) + 0.5, Math.abs(this.x1 - this.x0), Math.abs(this.y1 - this.y0));
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  },
  end() { this.on = false; },
};

function pickPoint(st, L, id, e) {
  if (e.shift) {
    if (app.sel.pts.has(id)) { app.sel.pts.delete(id); return false; }
    app.sel.pts.add(id);
  } else if (!app.sel.pts.has(id)) { app.sel.pts.clear(); app.sel.pts.add(id); }
  const P = S().points.get(id);
  st.items = dragItems(app.sel.pts);
  st.anchor = [P.x, P.y];
  return true;
}

function selBBox() {
  if (app.sel.pts.size < 2) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of app.sel.pts) {
    const P = S().points.get(id);
    if (!P) continue;
    x0 = Math.min(x0, P.x); y0 = Math.min(y0, P.y); x1 = Math.max(x1, P.x); y1 = Math.max(y1, P.y);
  }
  if (!isFinite(x0) || (x1 - x0 < 1e-6 && y1 - y0 < 1e-6)) return null;
  return { x0, y0, x1, y1, toS: (x, y) => app.toScreen(x, y) };
}

// Ручки рамки в локальных координатах (lx/ly — оси рамки)
function bboxHandles(bb) {
  const { x0, y0, x1, y1 } = bb, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return [
    { x: x0, y: y0, px: x1, py: y1, ax: 1, ay: 1, c: 1 }, { x: x1, y: y0, px: x0, py: y1, ax: 1, ay: 1, c: 1 },
    { x: x1, y: y1, px: x0, py: y0, ax: 1, ay: 1, c: 1 }, { x: x0, y: y1, px: x1, py: y0, ax: 1, ay: 1, c: 1 },
    { x: cx, y: y0, px: cx, py: y1, ax: 0, ay: 1 }, { x: x1, y: cy, px: x0, py: cy, ax: 1, ay: 0 },
    { x: cx, y: y1, px: cx, py: y0, ax: 0, ay: 1 }, { x: x0, y: cy, px: x1, py: cy, ax: 1, ay: 0 },
  ];
}

function handleAt(bb, sx, sy) {
  const hs = bboxHandles(bb);
  for (const hd of hs) {
    const [x, y] = bb.toS(hd.x, hd.y);
    if (Math.hypot(x - sx, y - sy) <= 7) return { type: 'scale', ...hd };
  }
  const poly = [hs[0], hs[1], hs[2], hs[3]].map((hd) => bb.toS(hd.x, hd.y));
  if (pointInPoly(sx, sy, poly)) return { type: 'inside' };
  for (const hd of hs.slice(0, 4)) {
    const [x, y] = bb.toS(hd.x, hd.y);
    const d = Math.hypot(x - sx, y - sy);
    if (d > 7 && d <= 26) return { type: 'rotate' };
  }
  return null;
}

function drawBBox(ctx, bb, color = '#5aa0ff') {
  const hs = bboxHandles(bb);
  const c = hs.slice(0, 4).map((hd) => bb.toS(hd.x, hd.y));
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  c.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  for (const hd of hs) {
    const [x, y] = bb.toS(hd.x, hd.y);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = color;
    ctx.fillRect(x - 4, y - 4, 8, 8);
    ctx.strokeRect(x - 4 + 0.5, y - 4 + 0.5, 7, 7);
  }
  ctx.restore();
}

function selectedEndpoint(L) {
  if (app.sel.pts.size !== 1) return null;
  const [id] = app.sel.pts;
  const info = app.idx.points.get(id);
  if (!info || info.layer !== L || info.path.closed) return null;
  const i = info.path.pts.indexOf(info.pt);
  if (i === info.path.pts.length - 1) return { path: info.path, atStart: false, pt: info.pt };
  if (i === 0) return { path: info.path, atStart: true, pt: info.pt };
  return null;
}

function localPathAt(path, f) {
  const n = path.pts.length;
  const xs = new Float64Array(n), ys = new Float64Array(n), cs = new Float64Array(n);
  path.pts.forEach((pt, i) => { const v = evalCh(pt.pos, f); xs[i] = v[0]; ys[i] = v[1]; cs[i] = evalCh(pt.curv, f); });
  return bezierSegs(xs, ys, cs, path.closed);
}

function insertOnSegment(path, seg, t) {
  const n = path.pts.length;
  const a = path.pts[seg], b = path.pts[(seg + 1) % n];
  const frames = new Set([0]);
  for (const k of a.pos.k) frames.add(k.f);
  for (const k of b.pos.k) frames.add(k.f);
  const pt = newPoint(app.doc, 0, 0, 1, (a.w + b.w) / 2);
  pt.pos.k = [...frames].sort((x, y) => x - y).map((f) => {
    const g = localPathAt(path, f)[seg];
    const ka = a.pos.k.find((k) => k.f === f) || b.pos.k.find((k) => k.f === f);
    return { f, v: cubicAt(g, t), i: ka ? ka.i : 'smooth' };
  });
  pt.bone = a.bone === b.bone ? a.bone : null;
  path.pts.splice(seg + 1, 0, pt);
  return pt;
}

export function cleanupPaths(L) {
  if (!L || !L.paths) return;
  const before = L.paths.length;
  L.paths = L.paths.filter((p) => p.pts.length >= 2);
  if (L.paths.length !== before) app.restructure();
}

// ======================= РИСОВАНИЕ =======================

def({
  id: 'select', name: 'Выделить точки', icon: 'select', key: 'g', group: 'draw', avail: isVec,
  hint: 'Клик — точка, рамка — несколько, Shift — добавить/убрать, двойной клик по фигуре — все её точки. Тяните выделенные точки.',
  options: () => [{ type: 'check', key: 'lasso', label: 'Лассо' }],
  down(e) {
    const L = app.active;
    if (!editable(L, 'vector')) return;
    this.mode = null; this.moved = false; this.start = e;
    if (e.dbl) {
      const p = hitShape(L, e.sx, e.sy);
      if (p) { if (!e.shift) app.sel.pts.clear(); p.pts.forEach((pt) => app.sel.pts.add(pt.id)); app.refresh(); app.render(); return; }
    }
    const id = hitPoint(L, e.sx, e.sy);
    if (id != null) { if (pickPoint(this, L, id, e)) this.mode = 'move'; }
    else { this.mode = 'box'; box.start(e); if (!e.shift) app.sel.pts.clear(); }
    app.render();
    app.refresh(['inspector', 'status']);
  },
  move(e) {
    if (this.mode === 'move') moveItems(this, e);
    else if (this.mode === 'box') box.move(e);
  },
  up() {
    if (this.mode === 'move' && this.moved) app.commit('Перемещение точек');
    if (this.mode === 'box') { box.selectPoints(app.active); box.end(); app.render(); app.refresh(); }
    this.mode = null;
  },
  overlay(ctx) { box.draw(ctx); },
});

def({
  id: 'transform', name: 'Трансформировать точки', icon: 'transform', key: 't', group: 'draw', avail: isVec,
  hint: 'Тяните точки. Углы рамки — масштаб (Shift — пропорционально, Alt — от центра), за углами — поворот (Shift — шаг 15°).',
  options: () => [{ type: 'check', key: 'lasso', label: 'Лассо' }],
  down(e) {
    const L = app.active;
    if (!editable(L, 'vector')) return;
    this.mode = null; this.moved = false; this.start = e;
    const bb = selBBox();
    const hd = bb && handleAt(bb, e.sx, e.sy);
    const id = hitPoint(L, e.sx, e.sy);
    if (hd && (hd.type === 'scale' || hd.type === 'rotate')) {
      this.mode = hd.type; this.h = hd; this.bb = bb; this.items = dragItems(app.sel.pts); return;
    }
    if (id != null) { if (pickPoint(this, L, id, e)) this.mode = 'move'; }
    else if (hd && hd.type === 'inside') { this.mode = 'move'; this.items = dragItems(app.sel.pts); this.anchor = null; }
    else { this.mode = 'box'; box.start(e); if (!e.shift) app.sel.pts.clear(); }
    app.render();
    app.refresh(['inspector', 'status']);
  },
  move(e) {
    const st = this;
    if (st.mode === 'move') return moveItems(st, e);
    if (st.mode === 'box') return box.move(e);
    if (!st.moved && Math.hypot(e.sx - st.start.sx, e.sy - st.start.sy) < 2) return;
    st.moved = true;
    const bb = st.bb, cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
    if (st.mode === 'scale') {
      const hd = st.h;
      const px = e.alt ? cx : hd.px, py = e.alt ? cy : hd.py;
      let sx = hd.ax && Math.abs(st.start.x - px) > 1e-6 ? (e.x - px) / (st.start.x - px) : 1;
      let sy = hd.ay && Math.abs(st.start.y - py) > 1e-6 ? (e.y - py) / (st.start.y - py) : 1;
      if (e.shift && hd.c) { const s = Math.abs(sx) > Math.abs(sy) ? sx : sy; sx = sy = s; }
      applyDrag(st.items, (it) => [px + (it.x0 - px) * sx, py + (it.y0 - py) * sy]);
    } else if (st.mode === 'rotate') {
      let a = Math.atan2(e.y - cy, e.x - cx) - Math.atan2(st.start.y - cy, st.start.x - cx);
      if (e.shift) a = Math.round(a / (15 * DEG)) * 15 * DEG;
      const c = Math.cos(a), s = Math.sin(a);
      applyDrag(st.items, (it) => [cx + (it.x0 - cx) * c - (it.y0 - cy) * s, cy + (it.x0 - cx) * s + (it.y0 - cy) * c]);
    }
  },
  up() {
    if (this.mode === 'box') { box.selectPoints(app.active); box.end(); app.render(); app.refresh(); }
    else if (this.mode && this.moved) app.commit('Трансформация точек');
    this.mode = null;
  },
  hover(e) {
    const bb = selBBox();
    const hd = bb && handleAt(bb, e.sx, e.sy);
    app.setCursor(hd ? (hd.type === 'rotate' ? 'alias' : hd.type === 'scale' ? 'nwse-resize' : 'move') : 'default');
  },
  overlay(ctx) {
    const bb = selBBox();
    if (bb && this.mode !== 'box') drawBBox(ctx, bb);
    box.draw(ctx);
  },
});

def({
  id: 'addpoint', name: 'Добавить точку', icon: 'addpoint', key: 'a', group: 'draw', avail: () => true,
  hint: 'Клик/протяжка — новые точки. При выделенной крайней точке — продолжить линию; клик по кривой — вставить точку; клик по первой точке — замкнуть.',
  options: () => [{ type: 'check', key: 'sharp', label: 'Острые углы' }],
  down(e) {
    const L = app.ensureVector();
    if (!L) return;
    drawWarn(L);
    app.rescene();
    this.mode = null; this.moved = false; this.start = e; this.created = null;
    const curv = opt('sharp', false) ? 0 : 1;
    const id = hitPoint(L, e.sx, e.sy);
    const end = selectedEndpoint(L);
    if (id != null) {
      const info = app.idx.points.get(id);
      const i = info.path.pts.indexOf(info.pt);
      if (end && end.path === info.path && info.pt !== end.pt && info.path.pts.length >= 3 && (i === 0 || i === info.path.pts.length - 1)) {
        info.path.closed = true;
        app.commit('Замкнуть контур');
        app.toast('Контур замкнут');
        return;
      }
      app.sel.pts.clear();
      app.sel.pts.add(id);
      this.items = dragItems([id]); this.anchor = [S().points.get(id).x, S().points.get(id).y];
      this.mode = 'move';
      app.render(); app.refresh(['inspector']);
      return;
    }
    const hs = hitSegment(L, e.sx, e.sy);
    if (hs) {
      const pt = insertOnSegment(hs.path, hs.seg, hs.t);
      app.restructure(); app.rescene();
      app.sel.pts.clear(); app.sel.pts.add(pt.id);
      this.items = dragItems([pt.id]); this.anchor = [S().points.get(pt.id).x, S().points.get(pt.id).y];
      this.mode = 'move'; this.created = true;
      app.changed();
      return;
    }
    const [sx, sy] = snapXY(e.x, e.y);
    const [lx, ly] = toLocal(L, sx, sy);
    const pt = newPoint(app.doc, lx, ly, curv);
    if (end) {
      if (end.atStart) end.path.pts.unshift(pt); else end.path.pts.push(pt);
    } else {
      L.paths.push(newPath(app.doc, [pt], false, app.style));
      this.newStart = pt;
    }
    app.restructure(); app.rescene();
    app.sel.pts.clear(); app.sel.pts.add(pt.id);
    this.items = dragItems([pt.id]); this.anchor = [sx, sy];
    this.mode = end ? 'move' : 'new';
    this.created = true;
    app.changed();
  },
  move(e) {
    if (this.mode === 'new') {
      if (Math.hypot(e.sx - this.start.sx, e.sy - this.start.sy) < 4) return;
      // протяжка от новой точки — сразу вторая точка
      const info = app.idx.points.get(this.newStart.id);
      const pt = newPoint(app.doc, ...this.newStart.pos.k[0].v, this.newStart.curv.k[0].v);
      info.path.pts.push(pt);
      app.restructure(); app.rescene();
      app.sel.pts.clear(); app.sel.pts.add(pt.id);
      this.items = dragItems([pt.id]);
      this.mode = 'move';
    }
    if (this.mode === 'move') moveItems(this, e);
  },
  up() {
    if (this.created || this.moved) app.commit('Добавление точки');
    this.mode = null;
  },
  hover(e) { this.hv = e; app.render(); },
  overlay(ctx) {
    const L = app.active;
    if (!this.hv || this.mode || !L || L.type !== 'vector') return;
    const end = selectedEndpoint(L);
    if (!end) return;
    const P = S().points.get(end.pt.id);
    if (!P) return;
    const [x, y] = app.toScreen(P.x, P.y);
    ctx.save();
    ctx.strokeStyle = 'rgba(90,160,255,.8)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(this.hv.sx, this.hv.sy); ctx.stroke();
    ctx.restore();
  },
});

def({
  id: 'curvature', name: 'Кривизна', icon: 'curvature', key: 'c', group: 'draw', avail: isVec,
  hint: 'Тяните точку влево/вправо — меньше/больше кривизна. Клик — переключить острый угол / гладкую точку.',
  down(e) {
    const L = app.active;
    if (!editable(L, 'vector')) return;
    this.mode = null; this.moved = false; this.start = e;
    const id = hitPoint(L, e.sx, e.sy);
    if (id == null) { this.mode = 'box'; box.start(e); if (!e.shift) app.sel.pts.clear(); return; }
    if (!app.sel.pts.has(id)) { if (!e.shift) app.sel.pts.clear(); app.sel.pts.add(id); }
    this.items = [...app.sel.pts].map((i) => app.idx.points.get(i)).filter(Boolean).map((x) => ({ pt: x.pt, c0: evalCh(x.pt.curv, app.frame) }));
    this.mode = 'curv';
    app.render();
  },
  move(e) {
    if (this.mode === 'box') return box.move(e);
    if (this.mode !== 'curv') return;
    const dx = e.sx - this.start.sx;
    if (!this.moved && Math.abs(dx) < 3) return;
    this.moved = true;
    for (const it of this.items) setKey(it.pt.curv, app.frame, clamp(it.c0 + dx / 80, 0, 3));
    app.changed();
  },
  up() {
    if (this.mode === 'box') { box.selectPoints(app.active); box.end(); app.render(); app.refresh(); }
    else if (this.mode === 'curv') {
      if (!this.moved) for (const it of this.items) setKey(it.pt.curv, app.frame, it.c0 > 0.5 ? 0 : 1);
      app.commit('Кривизна');
    }
    this.mode = null;
  },
  overlay(ctx) { box.draw(ctx); },
});

def({
  id: 'magnet', name: 'Магнит', icon: 'magnet', key: 'x', group: 'draw', avail: isVec,
  hint: 'Тяните — точки в радиусе смещаются с плавным затуханием. Удобно для «живой» анимации формы.',
  options: () => [{ type: 'range', key: 'magR', label: 'Радиус', min: 10, max: 400, def: 90 }],
  down(e) {
    const L = app.active;
    if (!editable(L, 'vector')) return;
    const R = app.pxToDoc(opt('magR', 90));
    this.start = e; this.moved = false;
    const ids = L.paths.flatMap((p) => p.pts.map((pt) => pt.id));
    this.items = dragItems(ids, (P) => {
      const d = Math.hypot(P.x - e.x, P.y - e.y) / R;
      return d >= 1 ? 0 : (1 - d * d) * (1 - d * d);
    });
    this.on = true;
  },
  move(e) {
    this.hv = e;
    if (!this.on) return;
    this.moved = true;
    const dx = e.x - this.start.x, dy = e.y - this.start.y;
    applyDrag(this.items, (it) => [it.x0 + dx * it.w, it.y0 + dy * it.w]);
  },
  up() { if (this.on && this.moved) app.commit('Магнит'); this.on = false; },
  hover(e) { this.hv = e; app.render(); },
  overlay(ctx) {
    if (!this.hv) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,170,60,.9)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(this.hv.sx, this.hv.sy, opt('magR', 90), 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  },
});

def({
  id: 'freehand', name: 'Кисть (от руки)', icon: 'freehand', key: 'f', group: 'draw', avail: () => true, coalesce: true, cursor: 'crosshair',
  hint: 'Рисуйте мышью или пером. Замкнутые линии заливаются цветом заливки. Перо поддерживает нажим.',
  options: () => [
    { type: 'check', key: 'fhClose', label: 'Замыкать', def: true },
    { type: 'check', key: 'fhPressure', label: 'Нажим пера', def: true },
    { type: 'check', key: 'fhTaper', label: 'Сужение концов', def: false },
    { type: 'range', key: 'fhSmooth', label: 'Сглаживание', min: 0, max: 10, def: 4 },
  ],
  down(e) {
    const L = app.ensureVector();
    if (!L) return;
    drawWarn(L);
    app.rescene();
    this.L = L;
    this.pts = [[e.x, e.y, e.pressure]];
    this.pen = e.pointerType === 'pen';
  },
  move(e) {
    if (!this.pts) return;
    const l = this.pts[this.pts.length - 1];
    if (Math.hypot(e.x - l[0], e.y - l[1]) < app.pxToDoc(1.5)) return;
    this.pts.push([e.x, e.y, e.pressure]);
    app.render();
  },
  up() {
    const raw = this.pts;
    this.pts = null;
    const L = this.L;
    if (!raw || raw.length < 2 || !L) { app.render(); return; }
    const sm = opt('fhSmooth', 4);
    let pts = raw.map((p) => p.slice());
    for (let it = 0; it < Math.round(sm / 3) + 1; it++) {
      const q = pts.map((p) => p.slice());
      for (let i = 1; i < pts.length - 1; i++) for (let j = 0; j < 3; j++) q[i][j] = (pts[i - 1][j] + 2 * pts[i][j] + pts[i + 1][j]) / 4;
      pts = q;
    }
    pts = rdp(pts, app.pxToDoc(0.6 + sm * 0.7));
    let closed = false;
    const f0 = pts[0], fl = pts[pts.length - 1];
    if (opt('fhClose', true) && pts.length >= 4 && Math.hypot(f0[0] - fl[0], f0[1] - fl[1]) < app.pxToDoc(18)) {
      closed = true;
      pts.pop();
    }
    const n = pts.length;
    if (n < 2) { app.render(); return; }
    const rec = recOf(L), Wi = M.inv(rec.world);
    const usePress = opt('fhPressure', true) && this.pen;
    const taper = opt('fhTaper', false) && !closed;
    const out = pts.map((p, i) => {
      let w = usePress ? clamp(0.15 + p[2] * 1.7, 0.1, 2.5) : 1;
      if (taper) { const t = Math.min(i, n - 1 - i) / Math.max(1, (n - 1) * 0.22); w *= 0.12 + 0.88 * clamp(t, 0, 1); }
      const [x, y] = M.apply(Wi, p[0], p[1]);
      return newPoint(app.doc, x, y, 1, Math.round(w * 100) / 100);
    });
    L.paths.push(newPath(app.doc, out, closed, app.style));
    app.restructure();
    app.commit('Рисование');
  },
  overlay(ctx) {
    if (!this.pts || this.pts.length < 2) return;
    ctx.save();
    ctx.strokeStyle = rgba(app.style.stroke);
    ctx.lineWidth = Math.max(1, app.style.width * app.view.z * camZoom());
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath();
    this.pts.forEach((p, i) => { const [x, y] = app.toScreen(p[0], p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    ctx.restore();
  },
});

export const SHAPES = { rect: 'Прямоугольник', oval: 'Овал', tri: 'Треугольник', poly: 'Многоугольник', star: 'Звезда', arrow: 'Стрелка', heart: 'Сердце', line: 'Линия' };

function shapePoints(type, x0, y0, x1, y1, n) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
  const L = Math.min(x0, x1), R = Math.max(x0, x1), T = Math.min(y0, y1), B = Math.max(y0, y1);
  const W = R - L, H = B - T;
  switch (type) {
    case 'rect': return { closed: true, pts: [[L, T, 0], [R, T, 0], [R, B, 0], [L, B, 0]] };
    case 'oval': return { closed: true, pts: [[cx + rx, cy, OVAL_CURV], [cx, cy + ry, OVAL_CURV], [cx - rx, cy, OVAL_CURV], [cx, cy - ry, OVAL_CURV]] };
    case 'tri': return { closed: true, pts: [[cx, T, 0], [R, B, 0], [L, B, 0]] };
    case 'poly': case 'star': {
      const pts = [], k = type === 'star' ? 2 : 1, cnt = n * k;
      for (let i = 0; i < cnt; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / cnt, r = type === 'star' && i % 2 ? 0.45 : 1;
        pts.push([cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r, 0]);
      }
      return { closed: true, pts };
    }
    case 'arrow': {
      const sh = H * 0.36, hx = L + W * 0.6;
      return { closed: true, pts: [[L, cy - sh / 2, 0], [hx, cy - sh / 2, 0], [hx, T, 0], [R, cy, 0], [hx, B, 0], [hx, cy + sh / 2, 0], [L, cy + sh / 2, 0]] };
    }
    case 'heart':
      return { closed: true, pts: [[cx, T + H * 0.28, 0], [L + W * 0.78, T + H * 0.04, 1], [R, T + H * 0.32, 1], [cx, B, 0], [L, T + H * 0.32, 1], [L + W * 0.22, T + H * 0.04, 1]] };
    case 'line': return { closed: false, pts: [[x0, y0, 0], [x1, y1, 0]] };
  }
  return { closed: true, pts: [] };
}

def({
  id: 'shape', name: 'Фигура', icon: 'shape', key: 'r', group: 'draw', avail: () => true, cursor: 'crosshair',
  hint: 'Протяните, чтобы нарисовать фигуру. Shift — равные стороны, Alt — от центра.',
  options: () => [
    { type: 'select', key: 'shType', label: 'Тип', items: SHAPES, def: 'rect' },
    { type: 'number', key: 'shSides', label: 'Углов', min: 3, max: 32, def: 5, show: () => ['poly', 'star'].includes(opt('shType', 'rect')) },
  ],
  geom(e) {
    let [x1, y1] = snapXY(e.x, e.y);
    const [ax, ay] = this.start;
    let dx = x1 - ax, dy = y1 - ay;
    const type = opt('shType', 'rect');
    if (e.shift) {
      if (type === 'line') {
        const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), l = Math.hypot(dx, dy);
        dx = Math.cos(a) * l; dy = Math.sin(a) * l;
      } else { const m = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * m; dy = Math.sign(dy || 1) * m; }
    }
    let x0 = ax, y0 = ay;
    if (e.alt && type !== 'line') { x0 = ax - dx; y0 = ay - dy; }
    return shapePoints(type, x0, y0, ax + dx, ay + dy, clamp(opt('shSides', 5) | 0, 3, 32));
  },
  down(e) {
    const L = app.ensureVector();
    if (!L) return;
    drawWarn(L);
    app.rescene();
    this.L = L; this.start = snapXY(e.x, e.y); this.cur = null; this.s0 = e;
  },
  move(e) { if (this.L) { this.cur = this.geom(e); this.e = e; app.render(); } },
  up(e) {
    const L = this.L;
    this.L = null;
    if (!L || !this.cur || Math.hypot(e.sx - this.s0.sx, e.sy - this.s0.sy) < 4) { this.cur = null; app.render(); return; }
    const g = this.geom(e);
    this.cur = null;
    const Wi = M.inv(recOf(L).world);
    const pts = g.pts.map(([x, y, c]) => { const [lx, ly] = M.apply(Wi, x, y); return newPoint(app.doc, lx, ly, c); });
    const st = { ...app.style };
    if (!g.closed) st.hs = true;
    L.paths.push(newPath(app.doc, pts, g.closed, st));
    app.restructure();
    app.commit('Фигура');
  },
  overlay(ctx) {
    if (!this.cur || this.cur.pts.length < 2) return;
    const g = this.cur;
    const sp = g.pts.map(([x, y]) => app.toScreen(x, y));
    const segs = bezierSegs(sp.map((p) => p[0]), sp.map((p) => p[1]), g.pts.map((p) => p[2]), g.closed);
    const P = segsPath(segs, g.closed);
    ctx.save();
    if (g.closed && app.style.hf) { ctx.fillStyle = rgba(app.style.fill); ctx.globalAlpha = 0.6; ctx.fill(P); ctx.globalAlpha = 1; }
    ctx.strokeStyle = app.style.hs || !g.closed ? rgba(app.style.stroke) : '#5aa0ff';
    ctx.lineWidth = Math.max(1, (app.style.hs || !g.closed ? app.style.width : 1) * app.view.z * camZoom());
    ctx.lineJoin = 'round';
    ctx.stroke(P);
    ctx.restore();
  },
});

def({
  id: 'width', name: 'Толщина линии', icon: 'width', key: 'w', group: 'draw', avail: isVec,
  hint: 'Тяните точку вправо/влево, чтобы сделать линию толще/тоньше в этом месте. Клик — сбросить.',
  down(e) {
    const L = app.active;
    if (!editable(L, 'vector')) return;
    this.mode = null; this.moved = false; this.start = e;
    const id = hitPoint(L, e.sx, e.sy);
    if (id == null) { this.mode = 'box'; box.start(e); if (!e.shift) app.sel.pts.clear(); return; }
    if (!app.sel.pts.has(id)) { if (!e.shift) app.sel.pts.clear(); app.sel.pts.add(id); }
    this.items = [...app.sel.pts].map((i) => app.idx.points.get(i)).filter(Boolean).map((x) => ({ pt: x.pt, w0: x.pt.w }));
    this.mode = 'w';
    app.render();
  },
  move(e) {
    if (this.mode === 'box') return box.move(e);
    if (this.mode !== 'w') return;
    const dx = e.sx - this.start.sx;
    if (!this.moved && Math.abs(dx) < 3) return;
    this.moved = true;
    for (const it of this.items) it.pt.w = Math.round(clamp(it.w0 * Math.exp(dx / 70), 0.05, 8) * 100) / 100;
    app.changed();
  },
  up() {
    if (this.mode === 'box') { box.selectPoints(app.active); box.end(); app.render(); app.refresh(); }
    else if (this.mode === 'w') { if (!this.moved) for (const it of this.items) it.pt.w = 1; app.commit('Толщина линии'); }
    this.mode = null;
  },
  overlay(ctx) { box.draw(ctx); },
});

def({
  id: 'cut', name: 'Разрезать контур', icon: 'cut', key: 'd', group: 'draw', avail: isVec, cursor: 'crosshair',
  hint: 'Клик по ребру — удалить его: замкнутый контур размыкается, открытый делится на два.',
  down(e) {
    const L = app.active;
    if (!editable(L, 'vector')) return;
    const hs = hitSegment(L, e.sx, e.sy, 7);
    if (!hs) return;
    const p = hs.path;
    if (p.closed) {
      p.pts = p.pts.slice(hs.seg + 1).concat(p.pts.slice(0, hs.seg + 1));
      p.closed = false;
    } else {
      const a = p.pts.slice(0, hs.seg + 1), b = p.pts.slice(hs.seg + 1);
      p.pts = a;
      if (b.length >= 2) {
        const np = JSON.parse(JSON.stringify({ ...p, pts: [] }));
        np.id = app.doc.nid++;
        np.pts = b;
        L.paths.splice(L.paths.indexOf(p) + 1, 0, np);
      }
    }
    L.paths = L.paths.filter((x) => x.pts.length >= 2);
    app.restructure();
    app.commit('Разрез контура');
  },
  hover(e) { this.hv = e; app.render(); },
  overlay(ctx) {
    const L = app.active;
    if (!this.hv || !L || L.type !== 'vector') return;
    const hs = hitSegment(L, this.hv.sx, this.hv.sy, 7);
    if (!hs) return;
    const pr = recOf(L).paths.find((x) => x.path === hs.path);
    const { segs } = screenPathData(pr, app.docToScreenM());
    const g = segs[hs.seg];
    ctx.save();
    ctx.strokeStyle = '#ff4b4b';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(g[0], g[1]); ctx.bezierCurveTo(g[2], g[3], g[4], g[5], g[6], g[7]); ctx.stroke();
    ctx.restore();
  },
});

// ======================= ЗАЛИВКА =======================

def({
  id: 'selshape', name: 'Выделить фигуру', icon: 'selshape', key: 'q', group: 'fill', avail: isVec,
  hint: 'Клик по фигуре — выделить (Shift — добавить). Тяните, чтобы двигать. Стиль справа применяется к выделенным.',
  options: () => [
    { type: 'button', label: 'Вперёд', action: () => reorderShapes(1) },
    { type: 'button', label: 'Назад', action: () => reorderShapes(-1) },
    { type: 'button', label: 'Удалить', action: () => app.deleteSelectedPoints() },
  ],
  down(e) {
    const L = app.active;
    if (!editable(L, 'vector')) return;
    this.mode = null; this.moved = false; this.start = e;
    const p = hitShape(L, e.sx, e.sy);
    if (p) {
      if (e.shift) { if (app.sel.paths.has(p.id)) app.sel.paths.delete(p.id); else app.sel.paths.add(p.id); }
      else if (!app.sel.paths.has(p.id)) { app.sel.paths.clear(); app.sel.paths.add(p.id); }
      const ids = [];
      for (const pid of app.sel.paths) { const x = app.idx.paths.get(pid); if (x) x.path.pts.forEach((pt) => ids.push(pt.id)); }
      this.items = dragItems(ids); this.anchor = null; this.mode = 'move';
    } else if (!e.shift) app.sel.paths.clear();
    app.render();
    app.refresh();
  },
  move(e) { if (this.mode === 'move') moveItems(this, e); },
  up() { if (this.mode === 'move' && this.moved) app.commit('Перемещение фигур'); this.mode = null; },
});

function reorderShapes(dir) {
  const L = app.active;
  if (!L || L.type !== 'vector' || !app.sel.paths.size) { app.toast('Выделите фигуру'); return; }
  const arr = L.paths;
  const idxs = arr.map((p, i) => (app.sel.paths.has(p.id) ? i : -1)).filter((i) => i >= 0);
  if (dir > 0) for (let k = idxs.length - 1; k >= 0; k--) { const i = idxs[k]; if (i < arr.length - 1 && !app.sel.paths.has(arr[i + 1].id)) [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]]; }
  else for (const i of idxs) if (i > 0 && !app.sel.paths.has(arr[i - 1].id)) [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]];
  app.commit('Порядок фигур');
}

def({
  id: 'bucket', name: 'Заливка / пипетка', icon: 'bucket', key: 'p', group: 'fill', avail: isVec, cursor: 'copy',
  hint: 'Клик по фигуре — применить текущий стиль. Alt+клик — пипетка (взять стиль фигуры).',
  options: () => [
    { type: 'check', key: 'bkFill', label: 'Заливка', def: true },
    { type: 'check', key: 'bkStroke', label: 'Контур', def: false },
  ],
  down(e) {
    const L = app.active;
    if (!editable(L, 'vector')) return;
    const p = hitShape(L, e.sx, e.sy);
    if (!p) return;
    const f = app.frame;
    if (e.alt) {
      app.style.fill = evalCh(p.fill, f).slice();
      app.style.stroke = evalCh(p.stroke, f).slice();
      app.style.width = evalCh(p.width, f);
      app.style.hf = p.hf; app.style.hs = p.hs;
      app.toast('Стиль взят с фигуры');
      app.rebuildInspector();
      return;
    }
    const doFill = opt('bkFill', true) && p.closed;
    const doStroke = opt('bkStroke', false) || !p.closed;
    if (doFill) { setKey(p.fill, f, app.style.fill); p.hf = true; }
    if (doStroke) { setKey(p.stroke, f, app.style.stroke); setKey(p.width, f, app.style.width); p.hs = true; }
    app.commit('Заливка');
  },
});

// ======================= КОСТИ =======================

function singleBone(B) {
  if (app.sel.bones.size !== 1) return null;
  const [id] = app.sel.bones;
  return B.bones.find((b) => b.id === id) || null;
}

def({
  id: 'bselect', name: 'Выделить кость', icon: 'bselect', key: 'g', group: 'bone', avail: isBoneL,
  hint: 'Клик по кости — выделить (Shift — добавить). Параметры кости — в панели справа. Delete — удалить.',
  down(e) {
    const B = app.active;
    const hb = hitBone(B, e.sx, e.sy);
    if (hb) {
      if (e.shift) { if (app.sel.bones.has(hb.bone.id)) app.sel.bones.delete(hb.bone.id); else app.sel.bones.add(hb.bone.id); }
      else { app.sel.bones.clear(); app.sel.bones.add(hb.bone.id); }
    } else if (!e.shift) app.sel.bones.clear();
    app.refresh(); app.render();
  },
});

def({
  id: 'btransform', name: 'Трансформировать кость', icon: 'btransform', key: 't', group: 'bone', avail: isBoneL,
  hint: 'Тяните кость — переместить; тяните за кончик — повернуть (на кадре 0 — ещё и длина). Shift — шаг 15°.',
  down(e) {
    const B = app.active;
    if (!editable(B, 'bone')) return;
    this.b = null;
    const hb = hitBone(B, e.sx, e.sy);
    if (!hb) { app.sel.bones.clear(); app.refresh(); app.render(); return; }
    if (!e.shift || !app.sel.bones.has(hb.bone.id)) { app.sel.bones.clear(); app.sel.bones.add(hb.bone.id); }
    const rec = recOf(B), b = hb.bone, f = app.frame;
    const pm = b.parent != null && rec.bc.Mt.get(b.parent) ? rec.bc.Mt.get(b.parent) : M.id();
    this.Pi = M.inv(M.mul(rec.bc.world, pm));
    this.b = b; this.mode = hb.tip ? 'tip' : 'move'; this.start = e; this.moved = false;
    this.pos0 = evalCh(b.pos, f).slice();
    this.scl = evalCh(b.scl, f) || 1;
    this.tipKids = f === 0 ? B.bones.filter((c) => c.parent === b.id && Math.abs(c.pos.k[0].v[0] - b.len) < 0.6 && Math.abs(c.pos.k[0].v[1]) < 0.6) : [];
    app.refresh(); app.render();
  },
  move(e) {
    const b = this.b;
    if (!b) return;
    if (!this.moved && Math.hypot(e.sx - this.start.sx, e.sy - this.start.sy) < 2) return;
    this.moved = true;
    const f = app.frame;
    if (this.mode === 'move') {
      const a = M.apply(this.Pi, this.start.x, this.start.y), c = M.apply(this.Pi, e.x, e.y);
      setKey(b.pos, f, [this.pos0[0] + c[0] - a[0], this.pos0[1] + c[1] - a[1]]);
    } else {
      const c = M.apply(this.Pi, e.x, e.y), p = evalCh(b.pos, f);
      const cur = evalCh(b.ang, f);
      let ang = Math.atan2(c[1] - p[1], c[0] - p[0]) * RAD;
      ang = cur + normAngle((ang - cur) * DEG) * RAD;
      if (e.shift) ang = Math.round(ang / 15) * 15;
      setKey(b.ang, f, ang);
      if (f === 0) {
        b.len = Math.max(1, Math.hypot(c[0] - p[0], c[1] - p[1]) / this.scl);
        for (const k of this.tipKids) k.pos.k[0].v = [b.len, 0];
      }
    }
    app.changed();
  },
  up() { if (this.b && this.moved) app.commit('Трансформация кости'); this.b = null; },
});

def({
  id: 'badd', name: 'Добавить кость', icon: 'badd', key: 'a', group: 'bone', avail: isBoneL, cursor: 'crosshair',
  hint: 'Протяните, чтобы создать кость (кадр 0). Новая кость — дочерняя к выделенной; начните у её кончика, чтобы соединить. Alt — корневая.',
  down(e) {
    const B = app.active;
    this.b = null;
    if (!editable(B, 'bone')) return;
    if (app.frame !== 0) { app.toast('Кости добавляются на кадре 0 — поза покоя (клавиша Home)', 3500); return; }
    const rec = recOf(B);
    this.Wi = M.inv(rec.world);
    let parent = e.alt ? null : singleBone(B);
    let p = M.apply(this.Wi, ...snapXY(e.x, e.y));
    if (parent) {
      const s = boneScreen(B, parent);
      if (Math.hypot(s.t[0] - e.sx, s.t[1] - e.sy) < 14) p = M.apply(rec.bc.Mt.get(parent.id), parent.len, 0);
    }
    const PM = parent ? rec.bc.Mt.get(parent.id) : M.id();
    this.PMi = M.inv(PM);
    const lp = M.apply(this.PMi, p[0], p[1]);
    const b = newBone(app.doc, parent ? parent.id : null, lp[0], lp[1], 0, 0.001, B.bones.length + 1);
    B.bones.push(b);
    app.restructure();
    app.sel.bones.clear(); app.sel.bones.add(b.id);
    this.b = b; this.lp = lp; this.start = e;
    app.changed();
  },
  move(e) {
    const b = this.b;
    if (!b) return;
    const q = M.apply(this.Wi, ...snapXY(e.x, e.y));
    const c = M.apply(this.PMi, q[0], q[1]);
    let ang = Math.atan2(c[1] - this.lp[1], c[0] - this.lp[0]) * RAD;
    if (e.shift) ang = Math.round(ang / 15) * 15;
    const len = Math.hypot(c[0] - this.lp[0], c[1] - this.lp[1]);
    b.ang.k[0].v = ang;
    b.len = Math.max(0.001, len);
    b.str = Math.round(Math.max(16, len * 0.45));
    app.changed();
  },
  up(e) {
    const b = this.b;
    if (!b) return;
    this.b = null;
    const B = app.active;
    if (Math.hypot(e.sx - this.start.sx, e.sy - this.start.sy) < 5) {
      B.bones = B.bones.filter((x) => x !== b);
      app.restructure();
      app.sel.bones.clear();
      if (b.parent != null) app.sel.bones.add(b.parent);
      app.toast('Протяните мышью, чтобы задать направление и длину кости');
      app.changed();
      return;
    }
    app.commit('Новая кость');
  },
});

def({
  id: 'breparent', name: 'Сменить родителя', icon: 'breparent', key: 'p', group: 'bone', avail: isBoneL,
  hint: 'Выделите кость (Shift+клик), затем кликните новую родительскую кость. Клик в пустоту — сделать кость корневой.',
  down(e) {
    const B = app.active;
    if (!editable(B, 'bone')) return;
    const hb = hitBone(B, e.sx, e.sy);
    const cur = singleBone(B);
    if (!cur || e.shift) {
      if (hb) { app.sel.bones.clear(); app.sel.bones.add(hb.bone.id); app.refresh(); app.render(); }
      return;
    }
    if (!hb) {
      if (cur.parent != null) { reparentBone(B, cur, null); app.commit('Корневая кость'); app.toast(`«${cur.name}» теперь корневая`); }
      return;
    }
    if (hb.bone === cur) return;
    if (boneDescendants(B, cur.id).has(hb.bone.id)) { app.toast('Нельзя: выбранная кость — потомок'); return; }
    reparentBone(B, cur, hb.bone.id);
    app.commit('Смена родителя кости');
    app.toast(`«${cur.name}» → родитель «${hb.bone.name}»`);
  },
});

def({
  id: 'bstrength', name: 'Сила кости', icon: 'bstrength', key: 's', group: 'bone', avail: isBoneL,
  hint: 'Тяните по кости вправо/влево — увеличить/уменьшить радиус влияния на точки (гибкая привязка).',
  down(e) {
    const B = app.active;
    this.b = null;
    if (!editable(B, 'bone')) return;
    const hb = hitBone(B, e.sx, e.sy, 14);
    if (!hb) return;
    app.sel.bones.clear(); app.sel.bones.add(hb.bone.id);
    this.b = hb.bone; this.s0 = hb.bone.str; this.start = e;
    this.k = 1 / (M.scaleFactor(app.docToScreenM()) * M.scaleFactor(recOf(B).world) || 1);
    app.refresh(); app.render();
  },
  move(e) {
    if (!this.b) return;
    this.b.str = Math.max(0, Math.round(this.s0 + (e.sx - this.start.sx) * this.k));
    app.changed();
  },
  up() { if (this.b) app.commit('Сила кости'); this.b = null; },
});

function ikSolve(B, f, chain, effId, gl, target) {
  for (let it = 0; it < 14; it++) {
    for (const bone of chain) {
      const Mt = boneMats(B, f);
      const e = M.apply(Mt.get(effId), gl[0], gl[1]);
      const m = Mt.get(bone.id);
      const o = M.apply(m, 0, 0);
      if (Math.hypot(e[0] - o[0], e[1] - o[1]) < 1e-6) continue;
      let d = normAngle(Math.atan2(target[1] - o[1], target[0] - o[0]) - Math.atan2(e[1] - o[1], e[0] - o[0])) * RAD;
      if (m[0] * m[3] - m[1] * m[2] < 0) d = -d;
      let nv = evalCh(bone.ang, f) + d;
      if (bone.lim) nv = clamp(nv, bone.min, bone.max);
      setKey(bone.ang, f, nv);
    }
    const e = M.apply(boneMats(B, f).get(effId), gl[0], gl[1]);
    if (Math.hypot(e[0] - target[0], e[1] - target[1]) < 0.25) break;
  }
}

def({
  id: 'bmanip', name: 'Управление костями (IK)', icon: 'bmanip', key: 'z', group: 'bone', avail: () => !!app.boneLayerFor(),
  hint: 'Тяните кость — цепочка изгибается (IK). Alt — вращать только эту кость. Корневую кость можно двигать. На кадре 0 — только предпросмотр позы.',
  options: () => [
    { type: 'check', key: 'ikRoot', label: 'IK до корня', def: false },
    { type: 'number', key: 'ikChain', label: 'Длина цепи', min: 1, max: 20, def: 6 },
  ],
  down(e) {
    const B = app.boneLayerFor();
    this.b = null;
    if (!B || B.lock) return;
    const hb = hitBone(B, e.sx, e.sy, 11);
    if (!hb) { if (app.active === B && !e.shift) { app.sel.bones.clear(); app.refresh(); app.render(); } return; }
    const b = hb.bone, f = app.frame;
    if (app.active === B) { app.sel.bones.clear(); app.sel.bones.add(b.id); }
    this.B = B; this.b = b; this.start = e; this.moved = false;
    if (f === 0) {
      this.saved = B.bones.map((x) => [x, JSON.stringify(x.ang), JSON.stringify(x.pos)]);
      B._rest = boneMats(B, 0);
    } else this.saved = null;
    const rec = recOf(B);
    this.Wi = M.inv(rec.world);
    const byId = new Map(B.bones.map((x) => [x.id, x]));
    const isRoot = b.parent == null || !byId.has(b.parent);
    this.mode = isRoot && !hb.tip && !e.alt ? 'translate' : 'ik';
    this.gl = [Math.max(hb.tip ? 1 : hb.t, 0.35) * b.len, 0];
    this.pos0 = evalCh(b.pos, f).slice();
    this.p0 = M.apply(this.Wi, e.x, e.y);
    const chain = [b];
    if (!e.alt && !isRoot) {
      let cur = b;
      const maxLen = clamp(opt('ikChain', 6) | 0, 1, 50), toRoot = opt('ikRoot', false);
      while (chain.length < maxLen && cur.parent != null) {
        const p = byId.get(cur.parent);
        if (!p || p.lock) break;
        const pRoot = p.parent == null || !byId.has(p.parent);
        if (pRoot && !toRoot) break;
        chain.push(p);
        cur = p;
      }
    }
    this.chain = chain;
    app.refresh(); app.render();
  },
  move(e) {
    if (!this.b) return;
    if (!this.moved && Math.hypot(e.sx - this.start.sx, e.sy - this.start.sy) < 2) return;
    this.moved = true;
    const f = app.frame, t = M.apply(this.Wi, e.x, e.y);
    if (this.mode === 'translate') setKey(this.b.pos, f, [this.pos0[0] + t[0] - this.p0[0], this.pos0[1] + t[1] - this.p0[1]]);
    else ikSolve(this.B, f, this.chain, this.b.id, this.gl, t);
    app.changed();
  },
  up() {
    if (!this.b) return;
    const B = this.B;
    this.b = null;
    if (this.saved) {
      for (const [x, a, p] of this.saved) { x.ang = JSON.parse(a); x.pos = JSON.parse(p); }
      delete B._rest;
      this.saved = null;
      app.changed();
      if (this.moved && !this.hinted) { this.hinted = true; app.toast('Кадр 0 — предпросмотр. Для анимации перейдите на другой кадр.', 3200); }
      return;
    }
    if (this.moved) app.commit('Поза костей');
  },
});

def({
  id: 'bindpts', name: 'Привязать точки', icon: 'bindpts', key: 'i', group: 'bind', avail: () => isVec() && !!app.boneLayerFor(),
  hint: 'Выделите точки (рамкой/кликом), затем кликните кость — точки жёстко привяжутся к ней. Цвет точки = цвет кости.',
  options: () => [
    { type: 'button', label: 'Гибкая привязка (отвязать)', action: () => {
      let n = 0;
      for (const id of app.sel.pts) { const x = app.idx.points.get(id); if (x && x.pt.bone != null) { x.pt.bone = null; n++; } }
      if (n) app.commit('Отвязка точек'); app.toast(n ? `Отвязано точек: ${n}` : 'Выделите привязанные точки');
    } },
    { type: 'check', key: 'lasso', label: 'Лассо' },
  ],
  down(e) {
    const L = app.active, B = app.boneLayerFor(L);
    this.mode = null;
    if (!editable(L, 'vector') || !B) return;
    const id = hitPoint(L, e.sx, e.sy);
    if (id != null) {
      if (e.shift) { if (app.sel.pts.has(id)) app.sel.pts.delete(id); else app.sel.pts.add(id); }
      else { app.sel.pts.clear(); app.sel.pts.add(id); }
      app.render(); app.refresh(); return;
    }
    const hb = hitBone(B, e.sx, e.sy);
    if (hb) {
      if (!app.sel.pts.size) { app.toast('Сначала выделите точки, затем кликните кость'); return; }
      for (const pid of app.sel.pts) { const x = app.idx.points.get(pid); if (x) x.pt.bone = hb.bone.id; }
      app.commit('Привязка точек');
      app.toast(`Точек: ${app.sel.pts.size} → «${hb.bone.name}»`);
      return;
    }
    this.mode = 'box'; box.start(e);
    if (!e.shift) app.sel.pts.clear();
  },
  move(e) { if (this.mode === 'box') box.move(e); },
  up() { if (this.mode === 'box') { box.selectPoints(app.active); box.end(); app.render(); app.refresh(); } this.mode = null; },
  overlay(ctx) { box.draw(ctx); },
});

def({
  id: 'bindlayer', name: 'Привязать слой', icon: 'bindlayer', key: 'l', group: 'bind',
  avail: () => !!app.active && app.active.type !== 'bone' && !!app.boneLayerFor(),
  hint: 'Клик по кости — весь слой жёстко следует за ней (голова, глаза, предметы). Клик в пустоту — отвязать.',
  down(e) {
    const L = app.active, B = app.boneLayerFor(L);
    if (!L || !B || L.lock) return;
    const hb = hitBone(B, e.sx, e.sy);
    if (hb) { L.bind = hb.bone.id; app.commit('Привязка слоя'); app.toast(`«${L.name}» привязан к «${hb.bone.name}»`); }
    else if (L.bind != null) { L.bind = null; app.commit('Отвязка слоя'); app.toast('Слой отвязан от кости'); }
  },
});

// ======================= СЛОЙ =======================

function layerBox(L) {
  const rec = recOf(L);
  if (!rec) return null;
  const pts = layerWorldPoints(S(), L);
  if (!pts.length) return null;
  const Wi = M.inv(rec.world);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    const [a, b] = M.apply(Wi, x, y);
    x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, a); y1 = Math.max(y1, b);
  }
  if (x1 - x0 < 1e-6 && y1 - y0 < 1e-6) return null;
  const m = M.mul(app.docToScreenM(), rec.world);
  return { x0, y0, x1, y1, toS: (x, y) => M.apply(m, x, y) };
}

def({
  id: 'ltransform', name: 'Трансформировать слой', icon: 'move', key: 'm', group: 'layer', avail: () => !!app.active,
  hint: 'Тяните — переместить слой. Ручки рамки — масштаб (Shift — пропорционально), за углами — поворот вокруг точки вращения.',
  options: () => [{ type: 'button', label: 'Сбросить трансформацию', action: () => {
    const L = app.active;
    if (!L) return;
    setKey(L.pos, app.frame, [0, 0]); setKey(L.rot, app.frame, 0); setKey(L.scl, app.frame, [1, 1]);
    app.commit('Сброс трансформации');
  } }],
  down(e) {
    const L = app.active;
    this.L = null;
    if (!L || L.lock) { if (L) app.toast('Слой заблокирован'); return; }
    const rec = recOf(L), f = app.frame;
    this.L = L; this.start = e; this.moved = false;
    this.Pi = M.inv(M.mul(rec.world, M.inv(rec.local)));
    this.pos0 = evalCh(L.pos, f).slice(); this.rot0 = evalCh(L.rot, f); this.scl0 = evalCh(L.scl, f).slice();
    this.piv = M.apply(rec.local, L.origin[0], L.origin[1]);
    const bb = layerBox(L);
    const hd = bb && handleAt(bb, e.sx, e.sy);
    this.mode = hd && hd.type !== 'inside' ? hd.type : 'move';
    this.h = hd;
  },
  move(e) {
    const L = this.L;
    if (!L) return;
    if (!this.moved && Math.hypot(e.sx - this.start.sx, e.sy - this.start.sy) < 2) return;
    this.moved = true;
    const f = app.frame;
    const a = M.apply(this.Pi, this.start.x, this.start.y), c = M.apply(this.Pi, e.x, e.y);
    const o = this.piv;
    if (this.mode === 'move') {
      let dx = c[0] - a[0], dy = c[1] - a[1];
      if (e.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      setKey(L.pos, f, [this.pos0[0] + dx, this.pos0[1] + dy]);
    } else if (this.mode === 'rotate') {
      let d = (Math.atan2(c[1] - o[1], c[0] - o[0]) - Math.atan2(a[1] - o[1], a[0] - o[0])) * RAD;
      d = normAngle(d * DEG) * RAD;
      let r = this.rot0 + d;
      if (e.shift) r = Math.round(r / 15) * 15;
      setKey(L.rot, f, r);
    } else if (this.mode === 'scale') {
      const r = -this.rot0 * DEG, cs = Math.cos(r), sn = Math.sin(r);
      const ua = [(a[0] - o[0]) * cs - (a[1] - o[1]) * sn, (a[0] - o[0]) * sn + (a[1] - o[1]) * cs];
      const uc = [(c[0] - o[0]) * cs - (c[1] - o[1]) * sn, (c[0] - o[0]) * sn + (c[1] - o[1]) * cs];
      let sx = this.h.ax && Math.abs(ua[0]) > 1e-3 ? uc[0] / ua[0] : 1;
      let sy = this.h.ay && Math.abs(ua[1]) > 1e-3 ? uc[1] / ua[1] : 1;
      if (e.shift && this.h.c) { const s = Math.abs(sx - 1) > Math.abs(sy - 1) ? sx : sy; sx = sy = s; }
      setKey(L.scl, f, [this.scl0[0] * sx, this.scl0[1] * sy]);
    }
    app.changed();
  },
  up() { if (this.L && this.moved) app.commit('Трансформация слоя'); this.L = null; },
  hover(e) {
    const L = app.active;
    const bb = L && layerBox(L);
    const hd = bb && handleAt(bb, e.sx, e.sy);
    app.setCursor(hd && hd.type === 'rotate' ? 'alias' : hd && hd.type === 'scale' ? 'nwse-resize' : 'move');
  },
  overlay(ctx) {
    const L = app.active;
    if (!L) return;
    const bb = layerBox(L);
    if (bb) drawBBox(ctx, bb, '#ffad5c');
    drawOrigin(ctx, L);
  },
});

function drawOrigin(ctx, L) {
  const rec = recOf(L);
  if (!rec) return;
  const [x, y] = app.toScreen(...M.apply(rec.world, L.origin[0], L.origin[1]));
  ctx.save();
  ctx.strokeStyle = '#ffad5c';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.moveTo(x - 10, y); ctx.lineTo(x + 10, y); ctx.moveTo(x, y - 10); ctx.lineTo(x, y + 10); ctx.stroke();
  ctx.restore();
}

def({
  id: 'origin', name: 'Точка вращения', icon: 'origin', key: 'o', group: 'layer', avail: () => !!app.active, cursor: 'crosshair',
  hint: 'Клик/протяжка — задать точку вращения и масштаба слоя. Слой при этом не сдвигается.',
  options: () => [{ type: 'button', label: 'В центр содержимого', action: () => {
    const L = app.active, bb = L && layerBox(L);
    if (!bb) return;
    setOrigin(L, [(bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2]);
    app.commit('Точка вращения');
  } }],
  down(e) {
    const L = app.active;
    this.L = null;
    if (!L || L.lock) return;
    this.L = L;
    this.Wi = M.inv(recOf(L).world);
    setOrigin(L, M.apply(this.Wi, e.x, e.y));
    app.changed();
  },
  move(e) { if (this.L) { setOrigin(this.L, M.apply(this.Wi, ...snapXY(e.x, e.y))); app.changed(); } },
  up() { if (this.L) app.commit('Точка вращения'); this.L = null; },
  overlay(ctx) { if (app.active) drawOrigin(ctx, app.active); },
});

function setOrigin(L, no) {
  const o = L.origin, dx = o[0] - no[0], dy = o[1] - no[1];
  for (const k of L.pos.k) {
    const r = evalCh(L.rot, k.f) * DEG, s = evalCh(L.scl, k.f), c = Math.cos(r), sn = Math.sin(r);
    const rx = c * s[0] * dx - sn * s[1] * dy, ry = sn * s[0] * dx + c * s[1] * dy;
    k.v = [k.v[0] + dx - rx, k.v[1] + dy - ry];
  }
  L.origin = [no[0], no[1]];
}

// ======================= КАМЕРА =======================

const camReset = { type: 'button', label: 'Сбросить камеру', action: () => {
  const c = app.doc.cam, f = app.frame;
  setKey(c.pos, f, [0, 0]); setKey(c.zoom, f, 1); setKey(c.roll, f, 0);
  app.commit('Сброс камеры');
} };

def({
  id: 'camtrack', name: 'Камера: панорама', icon: 'camtrack', key: '4', group: 'camera', avail: () => true, cursor: 'move',
  hint: 'Тяните — сдвинуть камеру (на кадрах > 0 создаются ключи камеры).', options: () => [camReset],
  down(e) { this.start = e; this.p0 = evalCh(app.doc.cam.pos, app.frame).slice(); this.on = true; },
  move(e) {
    if (!this.on) return;
    const c = app.doc.cam, f = app.frame, z = evalCh(c.zoom, f) || 1, r = evalCh(c.roll, f) * DEG;
    const fx = (e.sx - this.start.sx) / app.view.z, fy = (e.sy - this.start.sy) / app.view.z;
    const cs = Math.cos(r), sn = Math.sin(r);
    setKey(c.pos, f, [this.p0[0] - (cs * fx - sn * fy) / z, this.p0[1] - (sn * fx + cs * fy) / z]);
    app.changed();
  },
  up() { if (this.on) app.commit('Камера'); this.on = false; },
});

def({
  id: 'camzoom', name: 'Камера: зум', icon: 'camzoom', key: '5', group: 'camera', avail: () => true, cursor: 'ns-resize',
  hint: 'Тяните вверх/вниз — приблизить/отдалить камеру.', options: () => [camReset],
  down(e) { this.start = e; this.z0 = evalCh(app.doc.cam.zoom, app.frame); this.on = true; },
  move(e) {
    if (!this.on) return;
    setKey(app.doc.cam.zoom, app.frame, clamp(this.z0 * Math.exp(-(e.sy - this.start.sy) / 160), 0.02, 50));
    app.changed();
  },
  up() { if (this.on) app.commit('Камера'); this.on = false; },
});

def({
  id: 'camroll', name: 'Камера: наклон', icon: 'camroll', key: '6', group: 'camera', avail: () => true, cursor: 'alias',
  hint: 'Тяните по кругу — наклонить камеру. Shift — шаг 15°.', options: () => [camReset],
  down(e) { this.start = e; this.r0 = evalCh(app.doc.cam.roll, app.frame); this.on = true; },
  move(e) {
    if (!this.on) return;
    const V = app.viewMatrix(), cx = V[4], cy = V[5];
    const a = (Math.atan2(e.sy - cy, e.sx - cx) - Math.atan2(this.start.sy - cy, this.start.sx - cx)) * RAD;
    let r = this.r0 - normAngle(a * DEG) * RAD;
    if (e.shift) r = Math.round(r / 15) * 15;
    setKey(app.doc.cam.roll, app.frame, r);
    app.changed();
  },
  up() { if (this.on) app.commit('Камера'); this.on = false; },
});

def({
  id: 'hand', name: 'Рука (вид)', icon: 'hand', key: 'h', group: 'view', avail: () => true, cursor: 'grab',
  hint: 'Тяните — двигать вид. Колесо — зум, Пробел+тяните или правая кнопка — рука из любого инструмента.',
});

export const GROUPS = { draw: 'Рисование', fill: 'Заливка', bone: 'Кости', bind: 'Привязка', layer: 'Слой', camera: 'Камера', view: 'Вид' };

// Подобрать инструмент по клавише с учётом контекста слоя
export function toolForKey(k) {
  const kind = app.ctxKind();
  const cands = TOOL_ORDER.map((id) => tools[id]).filter((t) => t.key === k && t.avail());
  if (!cands.length) return null;
  const pref = kind === 'bone' ? ['bone', 'bind'] : kind === 'vector' ? ['draw', 'fill', 'bind'] : ['bind', 'layer'];
  cands.sort((a, b) => (pref.includes(b.group) ? 1 : 0) - (pref.includes(a.group) ? 1 : 0));
  return cands[0];
}

export { boneColor };
