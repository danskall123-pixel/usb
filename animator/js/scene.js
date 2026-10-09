// Вычисление сцены на кадре: матрицы слоёв, скелеты, деформация точек костями.
import { M, DEG, clamp, distToSeg } from './util.js';
import { evalCh } from './anim.js';
import { registry } from './ext.js';

export function layerLocal(L, f) {
  const p = evalCh(L.pos, f), r = evalCh(L.rot, f) * DEG, s = evalCh(L.scl, f), o = L.origin;
  // T(pos + origin) · R · S · T(-origin)
  const c = Math.cos(r), sn = Math.sin(r);
  const a = c * s[0], b = sn * s[0], cc = -sn * s[1], d = c * s[1];
  const e = p[0] + o[0] - (a * o[0] + cc * o[1]);
  const ff = p[1] + o[1] - (b * o[0] + d * o[1]);
  return [a, b, cc, d, e, ff];
}

// Документ → координаты кадра камеры (центр кадра = 0,0)
export function camMatrix(doc, f) {
  const p = evalCh(doc.cam.pos, f), z = evalCh(doc.cam.zoom, f), r = evalCh(doc.cam.roll, f) * DEG;
  return M.mul(M.scale(z), M.mul(M.rotate(-r), M.translate(-p[0], -p[1])));
}

export function boneAngle(b, f) {
  let a = evalCh(b.ang, f);
  if (b.lim) a = clamp(a, b.min, b.max);
  return a;
}

// Матрицы костей в пространстве слоя костей
export function boneMats(B, f) {
  const out = new Map();
  const byId = new Map();
  for (const b of B.bones) byId.set(b.id, b);
  const get = (b, guard) => {
    const done = out.get(b.id);
    if (done) return done;
    let pm = M.id();
    const par = b.parent != null ? byId.get(b.parent) : null;
    if (par && guard < 64) pm = get(par, guard + 1);
    const p = evalCh(b.pos, f), a = boneAngle(b, f) * DEG, s = evalCh(b.scl, f);
    const c = Math.cos(a) * s, sn = Math.sin(a) * s;
    const m = M.mul(pm, [c, sn, -sn, c, p[0], p[1]]);
    out.set(b.id, m);
    return m;
  };
  for (const b of B.bones) get(b, 0);
  return out;
}

let wcache = new Map(), wdoc = null;
export function invalidateWeights() { wcache = new Map(); }

function flexWeights(bc, ptId, x, y) {
  const c = wcache.get(ptId);
  if (c && c.bl === bc.layer.id) return c.w;
  let w = [], sum = 0, best = null, bestD = Infinity;
  for (const s of bc.segs) {
    const d = distToSeg(x, y, s.ax, s.ay, s.bx, s.by).d;
    if (d < bestD) { bestD = d; best = s.id; }
    if (s.str > 0 && d < s.str) {
      const t = 1 - d / s.str;
      const wt = t * t * (3 - 2 * t);
      w.push([s.id, wt]);
      sum += wt;
    }
  }
  if (sum > 1e-6) for (const e of w) e[1] /= sum;
  else if (bc.layer.outside === 'static' || best == null) w = [];
  else if (bestD < 1e-6) w = [[best, 1]];
  else {
    // вне всех зон влияния — плавное взвешивание по обратному расстоянию (без «рывка» между костями)
    w = [];
    sum = 0;
    for (const s of bc.segs) {
      const d = distToSeg(x, y, s.ax, s.ay, s.bx, s.by).d / (bestD || 1);
      const wt = 1 / (d * d * d * d);
      if (wt > 0.02) { w.push([s.id, wt]); sum += wt; }
    }
    for (const e of w) e[1] /= sum;
  }
  wcache.set(ptId, { bl: bc.layer.id, w });
  return w;
}

function makeBoneCtx(B, f, world) {
  // B._rest — временная поза покоя (предпросмотр «Управления костями» на кадре 0)
  const Mt = boneMats(B, f), M0 = B._rest || (f === 0 ? Mt : boneMats(B, 0));
  const ident = M0 === Mt;
  const D = new Map(), segs = [];
  for (const b of B.bones) {
    const r = M0.get(b.id) || Mt.get(b.id), m = Mt.get(b.id);
    D.set(b.id, ident ? M.id() : M.mul(m, M.inv(r)));
    const o = M.apply(r, 0, 0), t = M.apply(r, b.len, 0);
    segs.push({ id: b.id, ax: o[0], ay: o[1], bx: t[0], by: t[1], str: b.str });
  }
  return { layer: B, world, Mt, M0, D, segs, any: B.bones.length > 0 };
}

export function evaluate(doc, f) {
  // кэш весов привязан к документу (превью и миниатюры вычисляют другие документы)
  if (doc !== wdoc) { wcache = new Map(); wdoc = doc; }
  const S = { f, layers: new Map(), points: new Map(), cam: camMatrix(doc, f) };
  const ctx = { world: M.id(), bc: null, rel: null, rel0: null, bind: null };
  for (const L of doc.layers) evalLayer(S, L, ctx, f);
  return S;
}

function evalLayer(S, L, ctx, f) {
  const local = layerLocal(L, f);
  const rec = { layer: L, local, op: evalCh(L.op, f), world: null, bc: null, paths: null, lw: 1, boneCtx: ctx.bc };
  const bind = L.bind != null ? L.bind : ctx.bind;
  let rel = null, rel0 = null;
  if (ctx.bc) {
    rel = M.mul(ctx.rel, local);
    rel0 = M.mul(ctx.rel0, f === 0 ? local : layerLocal(L, 0));
    const D = bind != null ? ctx.bc.D.get(bind) : null;
    rec.world = D ? M.mul(ctx.bc.world, M.mul(D, rel)) : M.mul(ctx.bc.world, rel);
  } else {
    rec.world = M.mul(ctx.world, local);
  }
  rec.lw = M.scaleFactor(rec.world);
  S.layers.set(L.id, rec);
  if (L.type === 'bone') {
    rec.bc = makeBoneCtx(L, f, rec.world);
    const c2 = { world: rec.world, bc: rec.bc, rel: M.id(), rel0: M.id(), bind: null };
    for (const C of L.children) evalLayer(S, C, c2, f);
  } else if (L.children) {
    const c2 = { world: rec.world, bc: ctx.bc, rel, rel0, bind };
    for (const C of L.children) evalLayer(S, C, c2, f);
  } else if (L.type === 'vector') {
    rec.paths = L.paths.map((p) => evalPath(S, p, L, rec, ctx.bc, rel, rel0, bind, f));
  }
}

function evalPath(S, p, L, rec, bc, rel, rel0, bind, f) {
  const n = p.pts.length;
  const xs = new Float64Array(n), ys = new Float64Array(n), cs = new Float64Array(n), ws = new Float64Array(n);
  const skin = bc && bc.any;
  for (let i = 0; i < n; i++) {
    const pt = p.pts[i];
    const v = evalCh(pt.pos, f);
    let F = rec.world;
    if (skin) {
      const b = pt.bone != null ? pt.bone : bind;
      let Sm = b != null ? bc.D.get(b) : null;
      if (!Sm) {
        const v0 = pt.pos.k[0].v;
        const q0 = M.apply(rel0, v0[0], v0[1]);
        const w = flexWeights(bc, pt.id, q0[0], q0[1]);
        if (w.length === 1) Sm = bc.D.get(w[0][0]);
        else if (w.length === 0) Sm = M.id();
        else { Sm = [0, 0, 0, 0, 0, 0]; for (const [id, wt] of w) M.addScaled(Sm, bc.D.get(id), wt); }
      }
      F = M.mul(bc.world, M.mul(Sm, rel));
    }
    const x = F[0] * v[0] + F[2] * v[1] + F[4], y = F[1] * v[0] + F[3] * v[1] + F[5];
    xs[i] = x; ys[i] = y;
    cs[i] = evalCh(pt.curv, f);
    ws[i] = pt.w;
    S.points.set(pt.id, { x, y, F, pt, path: p, layer: L, i });
  }
  return { path: p, xs, ys, cs, ws, fill: evalCh(p.fill, f), stroke: evalCh(p.stroke, f), width: evalCh(p.width, f) };
}

// Мировые (документ) координаты кости
export function boneWorld(rec, id) {
  const m = rec.bc.Mt.get(id);
  return m ? M.mul(rec.bc.world, m) : null;
}

// Мировые точки, описывающие содержимое слоя (для рамки трансформации)
export function layerWorldPoints(S, L, out = []) {
  const rec = S.layers.get(L.id);
  if (!rec) return out;
  if (L.type === 'vector') {
    for (const pr of rec.paths) for (let i = 0; i < pr.xs.length; i++) out.push([pr.xs[i], pr.ys[i]]);
  } else if (L.type === 'image') {
    const w = L.w / 2, h = L.h / 2;
    for (const [x, y] of [[-w, -h], [w, -h], [w, h], [-w, h]]) out.push(M.apply(rec.world, x, y));
  }
  if (L.type === 'bone' && rec.bc) {
    for (const b of L.bones) {
      const m = boneWorld(rec, b.id);
      out.push(M.apply(m, 0, 0), M.apply(m, b.len, 0));
    }
  }
  const ext = registry.layerTypes[L.type];
  if (ext && ext.bounds) for (const p of ext.bounds(L, rec, S) || []) out.push(p);
  if (L.children) for (const C of L.children) layerWorldPoints(S, C, out);
  return out;
}
