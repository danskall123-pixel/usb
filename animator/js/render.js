// Отрисовка вычисленной сцены на canvas (с прозрачностью слоёв, масками, режимами наложения, эффектами).
import { clamp, rgba, bezierSegs, segsPath, varStrokePath } from './util.js';
import { evalCh } from './anim.js';

export function activeSwitchChild(L, f) {
  if (!L.children.length) return null;
  const v = evalCh(L.sw, f);
  return L.children.find((c) => String(c.id) === v) || L.children[L.children.length - 1];
}

export class Renderer {
  constructor() { this.pool = []; }

  off(i, w, h) {
    let o = this.pool[i];
    if (!o) {
      const c = document.createElement('canvas');
      o = this.pool[i] = { c, ctx: c.getContext('2d') };
    }
    if (o.c.width !== w || o.c.height !== h) { o.c.width = w; o.c.height = h; }
    else { o.ctx.setTransform(1, 0, 0, 1, 0, 0); o.ctx.globalAlpha = 1; o.ctx.globalCompositeOperation = 'source-over'; o.ctx.clearRect(0, 0, w, h); }
    return o;
  }

  // o: { images: Map, px: масштаб пикселя (для размытия/тени), filter?: (L) => bool }
  drawLayers(ctx, list, S, o, depth = 0) {
    for (const L of list) this.drawLayer(ctx, L, S, o, depth);
  }

  drawLayer(ctx, L, S, o, depth) {
    if (!L.vis || L.type === 'audio') return;
    if (o.filter && !o.filter(L)) return;
    const rec = S.layers.get(L.id);
    if (!rec) return;
    const op = clamp(rec.op, 0, 1);
    if (op <= 0.002) return;
    const special = op < 0.999 || (L.blend && L.blend !== 'source-over') || (L.type === 'group' && L.mask) || L.blur > 0 || L.shOn;
    if (!special) { this.content(ctx, L, rec, S, o, depth); return; }
    const cv = ctx.canvas;
    const off = this.off(depth, cv.width, cv.height);
    off.ctx.setTransform(ctx.getTransform());
    this.content(off.ctx, L, rec, S, o, depth + 1);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha *= op;
    ctx.globalCompositeOperation = L.blend || 'source-over';
    const px = o.px || 1;
    if (L.shOn) {
      const c = L.shCol || '#000000';
      const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
      ctx.shadowColor = `rgba(${r},${g},${b},${L.shA})`;
      ctx.shadowBlur = L.shBlur * px;
      ctx.shadowOffsetX = L.shX * px;
      ctx.shadowOffsetY = L.shY * px;
    }
    if (L.blur > 0) ctx.filter = `blur(${(L.blur * px).toFixed(2)}px)`;
    ctx.drawImage(off.c, 0, 0);
    ctx.restore();
  }

  content(ctx, L, rec, S, o, depth) {
    switch (L.type) {
      case 'vector':
        for (const pr of rec.paths) this.drawPath(ctx, pr, rec);
        break;
      case 'image': {
        const img = o.images && o.images.get(L.asset);
        if (img && img.complete && img.naturalWidth) {
          ctx.save();
          ctx.transform(...rec.world);
          ctx.drawImage(img, -L.w / 2, -L.h / 2, L.w, L.h);
          ctx.restore();
        }
        break;
      }
      case 'switch': {
        const c = activeSwitchChild(L, S.f);
        if (c) this.drawLayer(ctx, c, S, o, depth);
        break;
      }
      case 'group':
        if (L.mask && L.children.length > 1) { this.drawMasked(ctx, L, S, o, depth); break; }
      // fallthrough
      case 'bone':
        this.drawLayers(ctx, L.children, S, o, depth);
        break;
    }
  }

  // Нижний дочерний слой группы — маска для остальных
  drawMasked(ctx, L, S, o, depth) {
    const cv = ctx.canvas, T = ctx.getTransform();
    const m = this.off(depth, cv.width, cv.height);
    m.ctx.setTransform(T);
    this.drawLayer(m.ctx, L.children[0], S, o, depth + 2);
    const c = this.off(depth + 1, cv.width, cv.height);
    c.ctx.setTransform(T);
    this.drawLayers(c.ctx, L.children.slice(1), S, o, depth + 2);
    c.ctx.setTransform(1, 0, 0, 1, 0, 0);
    c.ctx.globalCompositeOperation = 'destination-in';
    c.ctx.drawImage(m.c, 0, 0);
    c.ctx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (L.maskShow) ctx.drawImage(m.c, 0, 0);
    ctx.drawImage(c.c, 0, 0);
    ctx.restore();
  }

  drawPath(ctx, pr, rec) {
    const p = pr.path, n = pr.xs.length;
    if (n < 2) return;
    const segs = bezierSegs(pr.xs, pr.ys, pr.cs, p.closed);
    const P = segsPath(segs, p.closed);
    if (p.hf && p.closed && pr.fill[3] > 0) {
      ctx.fillStyle = rgba(pr.fill);
      ctx.fill(P);
    }
    if (p.hs && pr.width > 0 && pr.stroke[3] > 0) {
      const lw = pr.width * rec.lw;
      let uniform = true;
      for (let i = 0; i < n; i++) if (pr.ws[i] !== 1) { uniform = false; break; }
      if (uniform) {
        ctx.strokeStyle = rgba(pr.stroke);
        ctx.lineWidth = lw;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke(P);
      } else {
        ctx.fillStyle = rgba(pr.stroke);
        ctx.fill(varStrokePath(segs, pr.ws, lw, p.closed));
      }
    }
  }
}

// Отрисовка кадра в отдельный canvas размера документа (экспорт/превью)
export function renderFrameTo(ctx, doc, S, renderer, images, scale = 1, transparent = false) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, W, H);
  if (!transparent) { ctx.fillStyle = doc.bg; ctx.fillRect(0, 0, W, H); }
  const c = S.cam;
  // кадр → пиксели: масштаб + перенос центра
  const sx = scale, tx = W / 2, ty = H / 2;
  ctx.setTransform(c[0] * sx, c[1] * sx, c[2] * sx, c[3] * sx, c[4] * sx + tx, c[5] * sx + ty);
  renderer.drawLayers(ctx, doc.layers, S, { images, px: scale * evalCh(doc.cam.zoom, S.f) });
}
