// Рабочая область: отрисовка сцены, луковая кожа, сетка, оверлеи, навигация и маршрутизация мыши/пера.
import { app } from './app.js';
import { M, clamp, h } from './util.js';
import { evalCh } from './anim.js';
import { evaluate } from './scene.js';
import { Renderer } from './render.js';
import { tools, boneScreen, screenPathData } from './tools.js';
import { boneColor, descendants } from './model.js';

export function initViewport(el) {
  const canvas = h('canvas', { tabindex: 0, 'aria-label': 'Холст анимации' });
  const hud = h('div', { class: 'hud' });
  const hudR = h('div', { class: 'hud hud-r' });
  el.append(canvas, hud, hudR);
  app.viewEl = el;
  const ctx = canvas.getContext('2d');
  const renderer = new Renderer(), onionR = new Renderer();
  const onionC = document.createElement('canvas'), octx = onionC.getContext('2d');
  let raf = 0, dpr = 1;

  app.setCursor = (c) => { canvas.style.cursor = c; };
  app.on('render', () => { if (!raf) raf = requestAnimationFrame(draw); });

  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, el.clientWidth), hh = Math.max(1, el.clientHeight);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hh * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = hh + 'px';
    app.render();
  };
  new ResizeObserver(resize).observe(el);

  app.fitView = () => {
    const w = el.clientWidth, hh = el.clientHeight;
    app.view.z = Math.max(0.05, Math.min((w - 70) / app.doc.w, (hh - 70) / app.doc.h));
    app.view.x = 0; app.view.y = 0;
    app.render();
    app.refresh(['status']);
  };
  app.zoomView = (k, sx = el.clientWidth / 2, sy = el.clientHeight / 2) => {
    const v = app.view, z2 = clamp(v.z * k, 0.03, 64);
    const cx = el.clientWidth / 2, cy = el.clientHeight / 2;
    const qx = (sx - cx - v.x) / v.z, qy = (sy - cy - v.y) / v.z;
    v.z = z2;
    v.x = sx - cx - z2 * qx;
    v.y = sy - cy - z2 * qy;
    app.render();
    app.refresh(['status']);
  };

  function onionFilter() {
    const A = app.active;
    if (!A) return null;
    const ok = new Set([A.id, ...descendants(A).map((x) => x.id)]);
    let p = app.idx.parent.get(A.id);
    while (p) { ok.add(p.id); p = app.idx.parent.get(p.id); }
    return (L) => ok.has(L.id);
  }

  function drawOnion(VC, S) {
    const o = app.opts, doc = app.doc, W = canvas.width, H = canvas.height;
    if (onionC.width !== W || onionC.height !== H) { onionC.width = W; onionC.height = H; }
    const filter = o.onionActive ? onionFilter() : null;
    const list = [];
    for (let k = o.onionBefore; k >= 1; k--) list.push([app.frame - k * o.onionStep, k, true]);
    for (let k = o.onionAfter; k >= 1; k--) list.push([app.frame + k * o.onionStep, k, false]);
    for (const [f, k, before] of list) {
      if (f < 0) continue;
      const S2 = evaluate(doc, f);
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.globalCompositeOperation = 'source-over';
      octx.globalAlpha = 1;
      octx.clearRect(0, 0, W, H);
      octx.setTransform(...VC);
      onionR.drawLayers(octx, doc.layers, S2, { images: app.images, px: dpr * app.view.z, filter });
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.globalCompositeOperation = 'source-atop';
      octx.fillStyle = before ? 'rgba(255,70,90,.62)' : 'rgba(40,160,255,.62)';
      octx.fillRect(0, 0, W, H);
      octx.globalCompositeOperation = 'source-over';
      const n = before ? o.onionBefore : o.onionAfter;
      ctx.globalAlpha = o.onionOpacity * (1 - ((k - 1) / Math.max(1, n)) * 0.6);
      ctx.drawImage(onionC, 0, 0);
      ctx.globalAlpha = 1;
    }
  }

  function drawGrid(VC) {
    const g0 = app.opts.gridSize, W = canvas.width, H = canvas.height;
    const sc = M.scaleFactor(VC);
    let g = g0;
    while (g * sc < 8) g *= 5;
    const inv = M.inv(VC);
    const cs = [[0, 0], [W, 0], [W, H], [0, H]].map(([x, y]) => M.apply(inv, x, y));
    const x0 = Math.min(...cs.map((c) => c[0])), x1 = Math.max(...cs.map((c) => c[0]));
    const y0 = Math.min(...cs.map((c) => c[1])), y1 = Math.max(...cs.map((c) => c[1]));
    ctx.save();
    ctx.setTransform(...VC);
    ctx.lineWidth = 1 / sc;
    ctx.beginPath();
    for (let x = Math.floor(x0 / g) * g; x <= x1; x += g) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    for (let y = Math.floor(y0 / g) * g; y <= y1; y += g) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.strokeStyle = 'rgba(90,150,255,.18)';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, y0); ctx.lineTo(0, y1); ctx.moveTo(x0, 0); ctx.lineTo(x1, 0);
    ctx.strokeStyle = 'rgba(90,150,255,.42)';
    ctx.stroke();
    ctx.restore();
  }

  function draw() {
    raf = 0;
    const doc = app.doc;
    if (!doc) return;
    const S = app.rescene();
    const W = canvas.width, H = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#202227';
    ctx.fillRect(0, 0, W, H);
    const V = app.viewMatrix();
    const Vd = [V[0] * dpr, 0, 0, V[3] * dpr, V[4] * dpr, V[5] * dpr];
    ctx.setTransform(...Vd);
    ctx.fillStyle = doc.bg;
    ctx.fillRect(-doc.w / 2, -doc.h / 2, doc.w, doc.h);
    const VC = M.mul(Vd, S.cam);
    if (app.opts.onion && !app.playing) drawOnion(VC, S);
    ctx.setTransform(...VC);
    renderer.drawLayers(ctx, doc.layers, S, { images: app.images, px: dpr * app.view.z * Math.abs(evalCh(doc.cam.zoom, app.frame)) });
    // затемнение вне кадра камеры
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const fx = Vd[4] - (doc.w / 2) * Vd[0], fy = Vd[5] - (doc.h / 2) * Vd[3], fw = doc.w * Vd[0], fh = doc.h * Vd[3];
    const outside = new Path2D();
    outside.rect(0, 0, W, H);
    outside.rect(fx, fy, fw, fh);
    ctx.fillStyle = 'rgba(24,25,29,.66)';
    ctx.fill(outside, 'evenodd');
    ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(fx) - 0.5, Math.round(fy) - 0.5, Math.round(fw) + 1, Math.round(fh) + 1);
    if (app.opts.grid) drawGrid(VC);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!app.playing || app.opts.overlaysInPlay) drawOverlays(S);
    updateHud();
  }

  function drawOverlays(S) {
    const t = tools[app.tool];
    const L = app.active;
    const m = app.docToScreenM();
    if (L && L.vis && L.type === 'vector') {
      const rec = S.layers.get(L.id);
      if (rec && (t.group === 'draw' || t.group === 'bind')) drawPoints(rec, m, t.id === 'bindpts');
      if (rec && t.group === 'fill') drawSelectedShapes(rec, m);
    }
    const B = app.boneLayerFor(L);
    if (B && app.opts.showBones && B.vis) {
      const strong = L === B || t.group === 'bone' || t.id === 'bmanip' || t.group === 'bind';
      drawBones(B, S, { dim: !strong, str: t.id === 'bstrength' || B.showStr, bindL: t.id === 'bindlayer' ? L : null });
    }
    if (t.overlay) t.overlay(ctx);
  }

  function drawPoints(rec, m, byBone) {
    const B = byBone ? app.boneLayerFor(rec.layer) : null;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(70,150,255,.85)';
    for (const pr of rec.paths) {
      if (pr.xs.length < 2) continue;
      const { segs } = screenPathData(pr, m);
      ctx.beginPath();
      ctx.moveTo(segs[0][0], segs[0][1]);
      for (const g of segs) ctx.bezierCurveTo(g[2], g[3], g[4], g[5], g[6], g[7]);
      ctx.stroke();
    }
    const sel = app.sel.pts;
    for (const pr of rec.paths) {
      const n = pr.xs.length;
      for (let i = 0; i < n; i++) {
        const pt = pr.path.pts[i];
        const x = m[0] * pr.xs[i] + m[2] * pr.ys[i] + m[4], y = m[1] * pr.xs[i] + m[3] * pr.ys[i] + m[5];
        const isSel = sel.has(pt.id);
        const end = !pr.path.closed && (i === 0 || i === n - 1);
        let fill = isSel ? '#ff3d3d' : '#ffffff';
        if (B && pt.bone != null && B.bones.some((b) => b.id === pt.bone)) fill = boneColor(B, pt.bone);
        const r = isSel ? 4 : 3.2;
        ctx.fillStyle = fill;
        ctx.strokeStyle = isSel ? '#fff' : '#15171a';
        ctx.beginPath();
        if (end) ctx.arc(x, y, r + 0.6, 0, Math.PI * 2);
        else ctx.rect(x - r, y - r, r * 2, r * 2);
        ctx.fill();
        ctx.stroke();
        if (B && isSel) { ctx.strokeStyle = '#ff3d3d'; ctx.strokeRect(x - r - 2.5, y - r - 2.5, r * 2 + 5, r * 2 + 5); }
      }
    }
    ctx.restore();
  }

  function drawSelectedShapes(rec, m) {
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.5;
    for (const pr of rec.paths) {
      if (!app.sel.paths.has(pr.path.id) || pr.xs.length < 2) continue;
      const { segs } = screenPathData(pr, m);
      ctx.beginPath();
      ctx.moveTo(segs[0][0], segs[0][1]);
      for (const g of segs) ctx.bezierCurveTo(g[2], g[3], g[4], g[5], g[6], g[7]);
      if (pr.path.closed) ctx.closePath();
      ctx.strokeStyle = '#fff'; ctx.lineDashOffset = 0; ctx.stroke();
      ctx.strokeStyle = '#ff3d3d'; ctx.lineDashOffset = 4.5; ctx.stroke();
    }
    ctx.restore();
  }

  function drawBones(B, S, { dim, str, bindL }) {
    const rec = S.layers.get(B.id);
    if (!rec || !rec.bc) return;
    ctx.save();
    ctx.globalAlpha = dim ? 0.45 : 1;
    const m = app.docToScreenM();
    const sc = M.scaleFactor(M.mul(m, rec.bc.world));
    if (str) {
      ctx.lineCap = 'round';
      for (const b of B.bones) {
        const s = boneScreen(B, b);
        ctx.strokeStyle = app.sel.bones.has(b.id) ? 'rgba(255,90,90,.2)' : 'rgba(255,190,60,.16)';
        ctx.lineWidth = Math.max(1, b.str * sc * 2);
        ctx.beginPath(); ctx.moveTo(s.o[0], s.o[1]); ctx.lineTo(s.t[0], s.t[1]); ctx.stroke();
      }
    }
    const byId = new Map(B.bones.map((b) => [b.id, b]));
    for (const b of B.bones) {
      const s = boneScreen(B, b);
      const [ox, oy] = s.o, [tx, ty] = s.t;
      const dx = tx - ox, dy = ty - oy, L = Math.hypot(dx, dy);
      const sel = app.sel.bones.has(b.id);
      const bound = bindL && bindL.bind === b.id;
      // связь с родителем
      const p = b.parent != null ? byId.get(b.parent) : null;
      if (p) {
        const ps = boneScreen(B, p);
        if (Math.hypot(ps.t[0] - ox, ps.t[1] - oy) > 2) {
          ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(120,170,255,.7)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(ps.t[0], ps.t[1]); ctx.lineTo(ox, oy); ctx.stroke(); ctx.setLineDash([]);
        }
      }
      ctx.lineWidth = 1.4;
      const col = sel ? '#ff4545' : bound ? '#ffd23d' : b.lock ? '#9aa3ad' : '#4c9dff';
      if (L < 2) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(ox, oy, 4, 0, Math.PI * 2); ctx.fill(); continue; }
      const nx = -dy / L, ny = dx / L, w = clamp(L * 0.12, 3, 9);
      const mx = ox + dx * 0.2, my = oy + dy * 0.2;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(mx + nx * w, my + ny * w);
      ctx.lineTo(tx, ty);
      ctx.lineTo(mx - nx * w, my - ny * w);
      ctx.closePath();
      ctx.fillStyle = sel ? 'rgba(255,69,69,.55)' : bound ? 'rgba(255,210,61,.5)' : 'rgba(76,157,255,.38)';
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.stroke();
      ctx.beginPath(); ctx.arc(ox, oy, 3, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
      if (b.lim && !dim) {
        // дуга ограничений угла
        const pm = p ? boneScreen(B, p).W : M.mul(m, rec.bc.world);
        const base = Math.atan2(pm[1], pm[0]);
        ctx.strokeStyle = 'rgba(255,200,80,.8)';
        ctx.beginPath(); ctx.arc(ox, oy, Math.min(L * 0.5, 30), base + b.min * Math.PI / 180, base + b.max * Math.PI / 180); ctx.stroke();
      }
    }
    ctx.restore();
  }

  function updateHud() {
    const f = app.frame;
    hud.textContent = '';
    hud.append(h('b', null, 'Кадр ' + f), f === 0 ? h('span', { class: 'hud-setup' }, ' · поза покоя (настройка)') : ` / ${app.doc.end}`);
    hudR.textContent = Math.round(app.view.z * 100) + '%';
  }

  // ---------- Мышь / перо ----------
  let pan = null, drag = false, lastDown = { t: 0, x: 0, y: 0 };
  const mk = (ev) => {
    const r = canvas.getBoundingClientRect();
    const sx = ev.clientX - r.left, sy = ev.clientY - r.top;
    const [x, y] = app.toDoc(sx, sy);
    return { sx, sy, x, y, shift: ev.shiftKey, alt: ev.altKey, ctrl: ev.ctrlKey || ev.metaKey, pressure: ev.pressure || 0.5, pointerType: ev.pointerType, button: ev.button };
  };

  canvas.addEventListener('pointerdown', (ev) => {
    canvas.focus({ preventScroll: true });
    app.focus = 'viewport';
    if (app.playing) app.emit('stop');
    if (ev.button === 1 || ev.button === 2 || app.spaceHeld || app.tool === 'hand') {
      pan = { x: ev.clientX, y: ev.clientY, vx: app.view.x, vy: app.view.y };
      if (app.spaceHeld) app.spaceUsed = true;
      canvas.setPointerCapture(ev.pointerId);
      canvas.style.cursor = 'grabbing';
      ev.preventDefault();
      return;
    }
    if (ev.button !== 0) return;
    const e = mk(ev);
    const now = performance.now();
    e.dbl = now - lastDown.t < 320 && Math.hypot(e.sx - lastDown.x, e.sy - lastDown.y) < 6;
    lastDown = { t: e.dbl ? 0 : now, x: e.sx, y: e.sy };
    const t = tools[app.tool];
    if (!t.avail()) { app.toast('Инструмент недоступен для этого слоя'); return; }
    drag = true;
    canvas.setPointerCapture(ev.pointerId);
    if (t.down) t.down(e);
    ev.preventDefault();
  });

  canvas.addEventListener('pointermove', (ev) => {
    if (pan) {
      app.view.x = pan.vx + ev.clientX - pan.x;
      app.view.y = pan.vy + ev.clientY - pan.y;
      app.render();
      return;
    }
    const t = tools[app.tool];
    if (drag) {
      if (t.coalesce && ev.getCoalescedEvents) for (const ce of ev.getCoalescedEvents()) t.move && t.move(mk(ce));
      else if (t.move) t.move(mk(ev));
    } else {
      const e = mk(ev);
      if (t.hover) t.hover(e);
      else canvas.style.cursor = t.cursor || 'default';
      app.status(null, e);
    }
  });

  const end = (ev) => {
    if (pan) {
      pan = null;
      canvas.style.cursor = tools[app.tool].cursor || 'default';
      return;
    }
    if (!drag) return;
    drag = false;
    const t = tools[app.tool];
    if (t.up) t.up(mk(ev));
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
  canvas.addEventListener('pointerleave', () => { const t = tools[app.tool]; if (t.hv && !drag) { t.hv = null; app.render(); } });

  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const r = canvas.getBoundingClientRect();
    if (ev.shiftKey && !ev.ctrlKey) { app.view.x -= ev.deltaY || ev.deltaX; app.render(); return; }
    const d = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY;
    app.zoomView(Math.exp(-d * (ev.ctrlKey ? 0.01 : 0.0018)), ev.clientX - r.left, ev.clientY - r.top);
  }, { passive: false });

  resize();
  return { canvas };
}
