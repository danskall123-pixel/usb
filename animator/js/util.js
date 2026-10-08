// Математика, геометрия кривых, цвета и DOM-хелперы.

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');

// Аффинная матрица 2D в формате canvas: [a, b, c, d, e, f]
// x' = a*x + c*y + e;  y' = b*x + d*y + f
export const M = {
  id: () => [1, 0, 0, 1, 0, 0],
  mul(m, n) {
    return [
      m[0] * n[0] + m[2] * n[1],
      m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3],
      m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4],
      m[1] * n[4] + m[3] * n[5] + m[5],
    ];
  },
  inv(m) {
    const det = m[0] * m[3] - m[1] * m[2];
    if (Math.abs(det) < 1e-12) return [1, 0, 0, 1, -m[4], -m[5]];
    const i = 1 / det;
    return [m[3] * i, -m[1] * i, -m[2] * i, m[0] * i, (m[2] * m[5] - m[3] * m[4]) * i, (m[1] * m[4] - m[0] * m[5]) * i];
  },
  apply: (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]],
  applyV: (m, x, y) => [m[0] * x + m[2] * y, m[1] * x + m[3] * y],
  translate: (x, y) => [1, 0, 0, 1, x, y],
  rotate(a) { const c = Math.cos(a), s = Math.sin(a); return [c, s, -s, c, 0, 0]; },
  scale: (sx, sy = sx) => [sx, 0, 0, sy, 0, 0],
  scaleFactor: (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])),
  angle: (m) => Math.atan2(m[1], m[0]),
  addScaled(acc, m, w) { for (let i = 0; i < 6; i++) acc[i] += m[i] * w; return acc; },
};

export function normAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

export function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  const x = ax + dx * t, y = ay + dy * t;
  return { d: Math.hypot(px - x, py - y), t, x, y };
}

// Упрощение ломаной (Рамер — Дуглас — Пекер)
export function rdp(pts, eps) {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distToSeg(pts[i][0], pts[i][1], pts[a][0], pts[a][1], pts[b][0], pts[b][1]).d;
      if (d > md) { md = d; mi = i; }
    }
    if (md > eps && mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------- Кривые в стиле Moho: точки + кривизна ----------
// Кривизна 0 — острый угол, 1 — сплайн Катмулла — Рома, ~1.657 — идеальная окружность из 4 точек.
export const OVAL_CURV = 1.6569;

// Возвращает массив кубических сегментов [x0,y0, c1x,c1y, c2x,c2y, x1,y1]
export function bezierSegs(xs, ys, cs, closed) {
  const n = xs.length;
  const segs = [];
  if (n < 2) return segs;
  const hin = new Float64Array(n * 2), hout = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    const hasPrev = closed || i > 0, hasNext = closed || i < n - 1;
    const ip = (i - 1 + n) % n, inx = (i + 1) % n;
    const c = cs[i];
    const x = xs[i], y = ys[i];
    let ix = x, iy = y, ox = x, oy = y;
    if (c !== 0) {
      if (hasPrev && hasNext) {
        const tx = xs[inx] - xs[ip], ty = ys[inx] - ys[ip];
        const dp = Math.hypot(x - xs[ip], y - ys[ip]), dn = Math.hypot(xs[inx] - x, ys[inx] - y);
        const sum = dp + dn || 1;
        const ko = (c / 6) * (2 * dn) / sum, ki = (c / 6) * (2 * dp) / sum;
        ox = x + tx * ko; oy = y + ty * ko;
        ix = x - tx * ki; iy = y - ty * ki;
      } else if (hasNext) {
        ox = x + (xs[inx] - x) * c / 3; oy = y + (ys[inx] - y) * c / 3;
      } else if (hasPrev) {
        ix = x - (x - xs[ip]) * c / 3; iy = y - (y - ys[ip]) * c / 3;
      }
    }
    hin[i * 2] = ix; hin[i * 2 + 1] = iy; hout[i * 2] = ox; hout[i * 2 + 1] = oy;
  }
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % n;
    segs.push([xs[i], ys[i], hout[i * 2], hout[i * 2 + 1], hin[j * 2], hin[j * 2 + 1], xs[j], ys[j]]);
  }
  return segs;
}

// Построитель SVG-пути с интерфейсом Path2D (для экспорта SVG)
export class SvgPath {
  constructor() { this.d = ''; }
  n(v) { return Math.round(v * 100) / 100; }
  moveTo(x, y) { this.d += `M${this.n(x)} ${this.n(y)}`; }
  lineTo(x, y) { this.d += `L${this.n(x)} ${this.n(y)}`; }
  bezierCurveTo(a, b, c, d, e, f) { this.d += `C${this.n(a)} ${this.n(b)} ${this.n(c)} ${this.n(d)} ${this.n(e)} ${this.n(f)}`; }
  closePath() { this.d += 'Z'; }
  arc(x, y, r, a0, a1, ccw) {
    const s = ccw ? 0 : 1, n = (v) => this.n(v);
    this.d += `M${n(x + r)} ${n(y)}A${n(r)} ${n(r)} 0 1 ${s} ${n(x - r)} ${n(y)}A${n(r)} ${n(r)} 0 1 ${s} ${n(x + r)} ${n(y)}Z`;
  }
}

export function segsPath(segs, closed, p = new Path2D()) {
  if (!segs.length) return p;
  p.moveTo(segs[0][0], segs[0][1]);
  for (const g of segs) p.bezierCurveTo(g[2], g[3], g[4], g[5], g[6], g[7]);
  if (closed) p.closePath();
  return p;
}

export function cubicAt(g, t) {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * g[0] + b * g[2] + c * g[4] + d * g[6], a * g[1] + b * g[3] + c * g[5] + d * g[7]];
}

export function cubicTan(g, t) {
  const u = 1 - t;
  let dx = 3 * u * u * (g[2] - g[0]) + 6 * u * t * (g[4] - g[2]) + 3 * t * t * (g[6] - g[4]);
  let dy = 3 * u * u * (g[3] - g[1]) + 6 * u * t * (g[5] - g[3]) + 3 * t * t * (g[7] - g[5]);
  if (dx * dx + dy * dy < 1e-10) { dx = g[6] - g[0]; dy = g[7] - g[1]; }
  const l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}

export function segLen(g) {
  return Math.hypot(g[2] - g[0], g[3] - g[1]) + Math.hypot(g[4] - g[2], g[5] - g[3]) + Math.hypot(g[6] - g[4], g[7] - g[5]);
}

// Ближайшая точка на наборе сегментов
export function nearestOnSegs(segs, x, y) {
  let best = { d: Infinity, seg: -1, t: 0, x: 0, y: 0 };
  for (let s = 0; s < segs.length; s++) {
    const g = segs[s];
    const N = 24;
    let prev = [g[0], g[1]];
    for (let j = 1; j <= N; j++) {
      const p = cubicAt(g, j / N);
      const r = distToSeg(x, y, prev[0], prev[1], p[0], p[1]);
      if (r.d < best.d) best = { d: r.d, seg: s, t: (j - 1 + r.t) / N, x: r.x, y: r.y };
      prev = p;
    }
  }
  return best;
}

// Контур переменной толщины как заливаемый Path2D (всё в одном направлении обхода → nonzero = объединение)
export function varStrokePath(segs, ws, lw, closed, P = new Path2D()) {
  const n = ws.length;
  const Lx = [], Ly = [], Rx = [], Ry = [];
  for (let s = 0; s < segs.length; s++) {
    const g = segs[s];
    const w0 = ws[s] * lw / 2, w1 = ws[(s + 1) % n] * lw / 2;
    const steps = clamp(Math.ceil(segLen(g) / 3), 2, 64);
    for (let j = s === 0 ? 0 : 1; j <= steps; j++) {
      const t = j / steps;
      const [x, y] = cubicAt(g, t);
      const [dx, dy] = cubicTan(g, t);
      const hw = w0 + (w1 - w0) * t;
      Lx.push(x - dy * hw); Ly.push(y + dx * hw);
      Rx.push(x + dy * hw); Ry.push(y - dx * hw);
    }
  }
  const m = Lx.length;
  if (m < 2) return P;
  if (closed) {
    P.moveTo(Lx[0], Ly[0]);
    for (let i = 1; i < m; i++) P.lineTo(Lx[i], Ly[i]);
    P.closePath();
    P.moveTo(Rx[m - 1], Ry[m - 1]);
    for (let i = m - 2; i >= 0; i--) P.lineTo(Rx[i], Ry[i]);
    P.closePath();
  } else {
    P.moveTo(Lx[0], Ly[0]);
    for (let i = 1; i < m; i++) P.lineTo(Lx[i], Ly[i]);
    for (let i = m - 1; i >= 0; i--) P.lineTo(Rx[i], Ry[i]);
    P.closePath();
  }
  // Круглые соединения/концы: окружности против часовой — то же направление, что у полосы
  const circ = (x, y, r) => { if (r > 0.01) { P.moveTo(x + r, y); P.arc(x, y, r, 0, Math.PI * 2, true); } };
  for (let s = 0; s < segs.length; s++) circ(segs[s][0], segs[s][1], ws[s] * lw / 2);
  if (!closed) { const g = segs[segs.length - 1]; circ(g[6], g[7], ws[n - 1] * lw / 2); }
  return P;
}

// ---------- Цвета ----------
export function hex2rgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const v = parseInt(h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
export function rgb2hex(c) {
  return '#' + [c[0], c[1], c[2]].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}
export function rgba(c) {
  return `rgba(${clamp(Math.round(c[0]), 0, 255)},${clamp(Math.round(c[1]), 0, 255)},${clamp(Math.round(c[2]), 0, 255)},${clamp(c[3], 0, 1)})`;
}

// ---------- DOM ----------
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function fmt(v, prec = 2) {
  if (!isFinite(v)) return '0';
  const r = Math.round(v * 10 ** prec) / 10 ** prec;
  return String(Object.is(r, -0) ? 0 : r);
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function readFile(file, as = 'dataURL') {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    if (as === 'text') r.readAsText(file);
    else if (as === 'buffer') r.readAsArrayBuffer(file);
    else r.readAsDataURL(file);
  });
}

export function pickFile(accept) {
  return new Promise((res) => {
    const inp = h('input', { type: 'file', accept, style: { display: 'none' } });
    inp.addEventListener('change', () => { res(inp.files[0] || null); inp.remove(); });
    document.body.append(inp);
    inp.click();
  });
}
