// Текстовые слои: надписи прямо на холсте (инструмент «Текст», Y) и анимация текста в один клик —
// печатная машинка, появление по буквам, выпрыгивание, стирание.
import { app } from '../app.js';
import { registerTool, tools, hitShape, snapXY } from '../tools.js';
import { ch, evalCh, setKey, ease } from '../anim.js';
import { newLayer } from '../model.js';
import { activeSwitchChild } from '../render.js';
import { M, clamp, h, rgba, rgb2hex } from '../util.js';
import { registerIcon, icon } from '../icons.js';
import {
  registerLayerType, registerInspector, registerViewportHandler, registerShortcut, registerMenu, registerHook, addStyle,
} from '../ext.js';
import { colorField, rangeField } from '../ui.js';

registerIcon('text', '<path d="M5 7.5V5h14v2.5"/><path d="M12 5v14"/><path d="M9 19h6"/>');
registerIcon('txAlignL', '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>');
registerIcon('txAlignC', '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>');
registerIcon('txAlignR', '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>');
registerIcon('txType', '<path d="M3 18l4-11 4 11M4.5 14h5"/><path d="M15 6v12" stroke-width="2.2"/><path d="M13.5 6h3M13.5 18h3"/>');
registerIcon('txFade', '<path d="M2.5 18l3.5-10 3.5 10M3.8 14.5h4.4"/><path d="M11 18l3-8.5 3 8.5" opacity=".6"/><path d="M17.5 18l2.2-6.5 2.2 6.5" opacity=".3"/>');
registerIcon('txPop', '<path d="M7 19l4-11 4 11M8.5 15h5"/><path d="M5 7L3.5 5.5M11 5V2.5M17 7l1.5-1.5"/>');
registerIcon('txErase', '<path d="M2.5 17l3.5-10 3.5 10M3.8 13.5h4.4"/><path d="M22 7.5h-7l-3.5 4.5 3.5 4.5h7z"/><path d="M16.3 10l3 3.5M19.3 10l-3 3.5"/>');

// ---------- шрифты и стили ----------
const FONTS = {
  Inter: 'Inter',
  Arial: 'Arial',
  Verdana: 'Verdana',
  'Trebuchet MS': 'Trebuchet MS',
  Georgia: 'Georgia — с засечками',
  'Times New Roman': 'Times New Roman — с засечками',
  'Courier New': 'Courier New — моноширинный',
  Impact: 'Impact — плакатный',
  'Comic Sans MS': 'Comic Sans MS — комиксный',
};
const GENERIC = { Georgia: 'serif', 'Times New Roman': 'serif', 'Courier New': 'monospace', 'Comic Sans MS': 'cursive' };
const famCss = (f) => { const n = String(f || 'Inter').replace(/['"\\;]/g, ''); return `'${n}', ${GENERIC[n] || 'sans-serif'}`; };
const fontStr = (L) => `${L.italic ? 'italic ' : ''}${L.weight || 400} ${Math.max(1, +L.size || 72)}px ${famCss(L.font)}`;

// Как появляются буквы, когда «Показано» меньше 100 %
const FX = { type: 'Сразу целиком (машинка)', fade: 'Плавно проявляются', pop: 'Выпрыгивают', drop: 'Падают сверху' };

// Быстрые стили надписи
const LOOKS = {
  plain: { name: 'Обычный', fill: [38, 38, 46, 1], hf: true, hs: false, stroke: [255, 255, 255, 1], width: 6, sh: null },
  cartoon: { name: 'Мультяшный', fill: [255, 201, 77, 1], hf: true, hs: true, stroke: [42, 31, 46, 1], width: 6, sh: { col: '#2a1f2e', a: 0.55, x: 4, y: 6, blur: 0 } },
  subtitle: { name: 'Субтитры', fill: [255, 255, 255, 1], hf: true, hs: true, stroke: [18, 18, 22, 1], width: 5, sh: null },
  neon: { name: 'Неон', fill: [236, 252, 255, 1], hf: true, hs: true, stroke: [63, 208, 255, 1], width: 2.5, sh: { col: '#3fd0ff', a: 1, x: 0, y: 0, blur: 24 } },
};
const LOOK_ITEMS = { ...Object.fromEntries(Object.entries(LOOKS).map(([k, v]) => [k, v.name])), shape: 'Как у фигур' };

const opt = (k, d) => (app.toolOpts[k] === undefined ? d : app.toolOpts[k]);
const AUTO_NAME = /^Текст( \d+)?$/;
const HAS_LS = typeof CanvasRenderingContext2D !== 'undefined' && 'letterSpacing' in CanvasRenderingContext2D.prototype;
const SEG = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const graphemes = (s) => (SEG ? Array.from(SEG.segment(s), (x) => x.segment) : Array.from(s));
const nf = (v) => +(+v).toFixed(2);

function plural(n, forms) {
  const a = Math.abs(n) % 100, b = a % 10;
  return forms[a > 10 && a < 20 ? 2 : b === 1 ? 0 : b >= 2 && b <= 4 ? 1 : 2];
}

// ---------- раскладка текста (кэш измерений) ----------
const MEAS = document.createElement('canvas').getContext('2d');
const cache = new Map();
const requested = new Set();

function ensureFont(font, text) {
  if (requested.has(font) || !document.fonts || !document.fonts.load) return;
  requested.add(font);
  document.fonts.load(font, (text || '') + 'AaЯя').then((list) => { if (list && list.length) { cache.clear(); app.render(); } }).catch(() => {});
}
if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => { cache.clear(); app.render(); });

// Блок текста центрирован в (0,0) слоя; строки выравниваются внутри блока
function layout(L) {
  const text = String(L.text == null ? '' : L.text).replace(/\r/g, '');
  const font = fontStr(L);
  const size = Math.max(1, +L.size || 72), ls = +L.letterSpacing || 0, lhK = +L.lineHeight || 1.2;
  const align = L.align === 'left' || L.align === 'right' ? L.align : 'center';
  const key = [font, ls, lhK, align, text].join('\u0001');
  let lay = cache.get(key);
  if (lay) return lay;
  ensureFont(font, text);
  MEAS.font = font;
  if (HAS_LS) MEAS.letterSpacing = '0px';
  const fm = MEAS.measureText('Hg');
  const asc = isFinite(fm.fontBoundingBoxAscent) ? fm.fontBoundingBoxAscent : size * 0.8;
  const desc = isFinite(fm.fontBoundingBoxDescent) ? fm.fontBoundingBoxDescent : size * 0.2;
  let n = 0, W = 0;
  const wc = new Map();
  const mw = (s) => { let v = wc.get(s); if (v === undefined) { v = MEAS.measureText(s).width; wc.set(s, v); } return v; };
  const lines = text.split('\n').map((t) => {
    const chars = graphemes(t), xs = [], ws = [];
    if (chars.length <= 200) {
      // точные позиции: ширина начала строки (учитывает кернинг и лигатуры)
      let acc = '';
      for (let i = 0; i < chars.length; i++) { xs.push(i ? MEAS.measureText(acc).width + i * ls : 0); acc += chars[i]; }
    } else {
      // длинная строка: по парам букв (кернинг пар), без квадратичной сложности
      let x = 0;
      for (let i = 0; i < chars.length; i++) {
        xs.push(x + i * ls);
        x += i + 1 < chars.length ? mw(chars[i] + chars[i + 1]) - mw(chars[i + 1]) : mw(chars[i]);
      }
    }
    const w = chars.length ? MEAS.measureText(t).width + (chars.length - 1) * ls : 0;
    for (let i = 0; i < chars.length; i++) ws.push((i + 1 < chars.length ? xs[i + 1] - ls : w) - xs[i]);
    const ln = { text: t, chars, xs, ws, w, first: n };
    n += chars.length;
    W = Math.max(W, w);
    return ln;
  });
  const lh = size * lhK, H = lines.length * lh;
  lines.forEach((ln, i) => {
    ln.x = align === 'left' ? -W / 2 : align === 'right' ? W / 2 - ln.w : -ln.w / 2;
    ln.y = -H / 2 + i * lh + (lh - (asc + desc)) / 2 + asc;
  });
  lay = { lines, n, W, H, lh, asc, desc, size, ls, font, align, empty: !text.length };
  if (cache.size > 300) cache.clear();
  cache.set(key, lay);
  return lay;
}

// Цвета и толщина на кадре; null — рисовать нечего
function paintOf(L, f) {
  const fill = evalCh(L.fill, f), stroke = evalCh(L.stroke, f), width = evalCh(L.width, f);
  const doF = L.hf !== false && fill[3] > 0.001, doS = !!L.hs && width > 0 && stroke[3] > 0.001;
  return doF || doS ? { fill, stroke, width, doF, doS } : null;
}

const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const backOut = (t) => { const c1 = 1.70158, c3 = c1 + 1, u = t - 1; return 1 + c3 * u * u * u + c1 * u * u; };
const SOFT = 4; // по скольким буквам «растянуто» плавное появление

// Видимые буквы с учётом эффекта появления: [{ c, x, y, a, s, cx, cy }]
function glyphs(L, lay, r) {
  const fx = FX[L.revealFx] ? L.revealFx : 'type';
  const N = lay.n, out = [];
  if (fx === 'type' || r >= 1) {
    const k = r >= 1 ? N : Math.round(r * N);
    for (const ln of lay.lines) for (let i = 0; i < ln.chars.length && ln.first + i < k; i++) out.push({ c: ln.chars[i], x: ln.x + ln.xs[i], y: ln.y, a: 1, s: 1 });
    return out;
  }
  const soft = Math.min(SOFT, N), p = r * (N - 1 + soft);
  for (const ln of lay.lines) {
    for (let i = 0; i < ln.chars.length; i++) {
      const t = clamp((p - ln.first - i) / soft, 0, 1);
      if (t <= 0) continue;
      const g = { c: ln.chars[i], x: ln.x + ln.xs[i], y: ln.y, a: t, s: 1 };
      if (fx === 'fade') g.y += (1 - easeOut(t)) * lay.size * 0.35;
      else if (fx === 'pop') { g.s = backOut(t); g.a = Math.min(1, t * 2.5); g.cx = g.x + ln.ws[i] / 2; g.cy = ln.y - lay.size * 0.35; }
      else if (fx === 'drop') { g.y -= (1 - ease('bounce', t)) * lay.size * 1.1; g.a = Math.min(1, t * 3); }
      out.push(g);
    }
  }
  return out;
}

// Отрисовка в локальных координатах слоя (ctx уже с матрицей слоя)
function drawText(ctx, L, lay, f, forceFull) {
  const st = paintOf(L, f);
  if (!st || !lay.n) return;
  const r = forceFull ? 1 : clamp(evalCh(L.reveal, f), 0, 1);
  if (r <= 0) return;
  ctx.font = lay.font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.miterLimit = 2;
  ctx.lineWidth = st.width * 2; // обводка под заливкой: снаружи видна половина
  ctx.fillStyle = rgba(st.fill);
  ctx.strokeStyle = rgba(st.stroke);
  const fx = FX[L.revealFx] ? L.revealFx : 'type';
  if (r >= 1 || fx === 'type') {
    // строками целиком — сохраняются кернинг и лигатуры
    const k = r >= 1 ? lay.n : Math.round(r * lay.n);
    const native = lay.ls !== 0 && HAS_LS;
    if (native) ctx.letterSpacing = lay.ls + 'px';
    const parts = [];
    for (const ln of lay.lines) {
      const m = clamp(k - ln.first, 0, ln.chars.length);
      if (!m) continue;
      if (lay.ls === 0 || native) parts.push([ln.chars.slice(0, m).join(''), ln.x, ln.y]);
      else for (let i = 0; i < m; i++) parts.push([ln.chars[i], ln.x + ln.xs[i], ln.y]);
    }
    if (st.doS) for (const [s, x, y] of parts) ctx.strokeText(s, x, y);
    if (st.doF) for (const [s, x, y] of parts) ctx.fillText(s, x, y);
    if (native) ctx.letterSpacing = '0px';
    return;
  }
  const gl = glyphs(L, lay, r).filter((g) => g.c.trim() && g.s > 0.01);
  const ga = ctx.globalAlpha;
  for (const pass of ['s', 'f']) {
    if (pass === 's' ? !st.doS : !st.doF) continue;
    for (const g of gl) {
      ctx.globalAlpha = ga * g.a;
      if (g.s !== 1) {
        ctx.save();
        ctx.transform(g.s, 0, 0, g.s, g.cx - g.s * g.cx, g.cy - g.s * g.cy);
        pass === 's' ? ctx.strokeText(g.c, g.x, g.y) : ctx.fillText(g.c, g.x, g.y);
        ctx.restore();
      } else pass === 's' ? ctx.strokeText(g.c, g.x, g.y) : ctx.fillText(g.c, g.x, g.y);
    }
  }
  ctx.globalAlpha = ga;
}

function fixLayer(L) {
  const d = {};
  TYPE.defaults(d);
  for (const k in d) if (L[k] === undefined || L[k] === null) L[k] = d[k];
}

// ---------- тип слоя ----------
const TYPE = {
  label: 'Текст',
  icon: 'text',
  creatable: true,
  color: '#ffe14d',
  defaults(L) {
    L.text = 'Текст';
    L.font = 'Inter';
    L.size = 72;
    L.weight = 700;
    L.italic = false;
    L.align = 'center';
    L.lineHeight = 1.2;
    L.letterSpacing = 0;
    L.fill = ch([38, 38, 46, 1]);
    L.hf = true;
    L.stroke = ch([255, 255, 255, 1]);
    L.width = ch(6);
    L.hs = false;
    L.reveal = ch(1);
    L.revealFx = 'type';
  },
  channels: (L) => [L.fill, L.stroke, L.width, L.reveal].filter(Boolean),
  draw(ctx, L, rec, S) {
    if (!L.fill || !L.reveal) fixLayer(L);
    const lay = layout(L);
    if (!lay.n) return;
    ctx.save();
    ctx.transform(...rec.world);
    drawText(ctx, L, lay, S.f, !!ed && ed.id === L.id);
    ctx.restore();
  },
  bounds(L, rec, S) {
    if (!L.fill || !L.reveal) fixLayer(L);
    const lay = layout(L);
    if (lay.empty) return [];
    const pad = L.hs ? Math.max(0, evalCh(L.width, S ? S.f : app.frame)) : 0;
    const x = lay.W / 2 + pad, y = lay.H / 2 + pad;
    return [[-x, -y], [x, -y], [x, y], [-x, y]].map(([a, b]) => M.apply(rec.world, a, b));
  },
  svg(L, rec, S, { col, esc }) {
    if (!L.fill || !L.reveal) fixLayer(L);
    const lay = layout(L), st = paintOf(L, S.f);
    if (!lay.n || !st) return '';
    const r = clamp(evalCh(L.reveal, S.f), 0, 1);
    if (r <= 0) return '';
    let a = `font-family="${esc(famCss(L.font))}" font-size="${nf(lay.size)}" font-weight="${L.weight || 400}"`;
    if (L.italic) a += ' font-style="italic"';
    if (lay.ls) a += ` letter-spacing="${nf(lay.ls)}"`;
    a += st.doF ? ` fill="${col(st.fill)}"` + (st.fill[3] < 1 ? ` fill-opacity="${nf(st.fill[3])}"` : '') : ' fill="none"';
    if (st.doS) {
      a += ` stroke="${col(st.stroke)}"` + (st.stroke[3] < 1 ? ` stroke-opacity="${nf(st.stroke[3])}"` : '') +
        ` stroke-width="${nf(st.width * 2)}" stroke-linejoin="round" stroke-linecap="round" paint-order="stroke"`;
    }
    const tm = `matrix(${rec.world.map((v) => +v.toFixed(5)).join(' ')})`;
    const pre = 'xml:space="preserve" style="white-space:pre"';
    const fx = FX[L.revealFx] ? L.revealFx : 'type';
    if (r >= 1) {
      // целиком: выравнивание средствами SVG (надёжно, даже если шрифт у зрителя чуть другой)
      const anchor = lay.align === 'left' ? 'start' : lay.align === 'right' ? 'end' : 'middle';
      const ax = lay.align === 'left' ? -lay.W / 2 : lay.align === 'right' ? lay.W / 2 : 0;
      const sp = lay.lines.filter((ln) => ln.chars.length).map((ln) => `<tspan x="${nf(ax)}" y="${nf(ln.y)}">${esc(ln.text)}</tspan>`).join('');
      return `<text transform="${tm}" ${a} text-anchor="${anchor}" ${pre}>${sp}</text>`;
    }
    if (fx === 'type') {
      const k = Math.round(r * lay.n);
      const sp = lay.lines.map((ln) => {
        const m = clamp(k - ln.first, 0, ln.chars.length);
        return m ? `<tspan x="${nf(ln.x)}" y="${nf(ln.y)}">${esc(ln.chars.slice(0, m).join(''))}</tspan>` : '';
      }).join('');
      return sp ? `<text transform="${tm}" ${a} ${pre}>${sp}</text>` : '';
    }
    const gs = glyphs(L, lay, r).filter((g) => g.c.trim() && g.s > 0.01);
    return `<g transform="${tm}" ${a}>` + gs.map((g) => `<text x="${nf(g.x)}" y="${nf(g.y)}"` +
      (g.a < 1 ? ` opacity="${nf(g.a)}"` : '') +
      (g.s !== 1 ? ` transform="matrix(${nf(g.s)} 0 0 ${nf(g.s)} ${nf(g.cx - g.s * g.cx)} ${nf(g.cy - g.s * g.cy)})"` : '') +
      ` ${pre}>${esc(g.c)}</text>`).join('') + '</g>';
  },
};
registerLayerType('text', TYPE);

// ---------- общие помощники ----------
function nameFor(t) {
  const line = String(t || '').split('\n').map((s) => s.trim()).find(Boolean) || '';
  if (!line) return 'Текст';
  return line.length > 26 ? line.slice(0, 24).trimEnd() + '…' : line;
}
// Имя слоя следует за текстом, пока его не переименовали вручную
function syncName(L, oldText) {
  if (AUTO_NAME.test(L.name) || L.name === nameFor(oldText)) L.name = nameFor(L.text);
}

function setStatic(c, v) {
  if (c.k.length > 1) setKey(c, app.frame, v);
  else c.k[0].v = Array.isArray(v) ? v.slice() : v;
}

function applyLook(L, id) {
  let lk = LOOKS[id];
  if (id === 'shape') {
    const s = app.style;
    lk = { fill: s.fill.slice(), hf: s.hf, hs: s.hs, stroke: s.stroke.slice(), width: s.width, sh: null };
    if (!lk.hf && !lk.hs) lk.hf = true;
  }
  if (!lk) return;
  setStatic(L.fill, lk.fill);
  setStatic(L.stroke, lk.stroke);
  setStatic(L.width, lk.width);
  L.hf = lk.hf;
  L.hs = lk.hs;
  if (lk.sh) Object.assign(L, { shOn: true, shCol: lk.sh.col, shA: lk.sh.a, shX: lk.sh.x, shY: lk.sh.y, shBlur: lk.sh.blur });
  else L.shOn = false;
}

// Текстовые слои сверху вниз (как их видно на холсте)
function textLayersTopDown() {
  const out = [];
  const walk = (arr) => {
    for (const L of arr) {
      if (!L.vis) continue;
      if (L.type === 'switch') { const c = activeSwitchChild(L, app.frame); if (c) walk([c]); continue; }
      if (L.type === 'text') out.push(L);
      if (L.children) walk(L.children);
    }
  };
  walk(app.doc.layers);
  return out.reverse();
}

function hitText(sx, sy, tol = 5) {
  const S = app.scene(), V = app.docToScreenM();
  for (const L of textLayersTopDown()) {
    const rec = S.layers.get(L.id);
    if (!rec || rec.op <= 0.02 || !L.fill) continue;
    const lay = layout(L);
    if (lay.empty) continue;
    const m = M.mul(V, rec.world);
    const [x, y] = M.apply(M.inv(m), sx, sy);
    const t = tol / (M.scaleFactor(m) || 1);
    if (Math.abs(x) <= lay.W / 2 + t && Math.abs(y) <= lay.H / 2 + t) return L;
  }
  return null;
}

function drawTextBox(ctx, L, color, dash = [4, 3]) {
  const rec = app.scene().layers.get(L.id);
  if (!rec || !L.fill) return;
  const lay = layout(L);
  if (lay.empty) return;
  const m = M.mul(app.docToScreenM(), rec.world);
  const k = 4 / (M.scaleFactor(m) || 1), x = lay.W / 2 + k, y = lay.H / 2 + k;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash(dash);
  ctx.beginPath();
  [[-x, -y], [x, -y], [x, y], [-x, y]].forEach(([a, b], i) => { const [px, py] = M.apply(m, a, b); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function removeLayer(L) {
  const p = app.idx.parent.get(L.id);
  const arr = p ? p.children : app.doc.layers;
  const i = arr.indexOf(L);
  if (i >= 0) arr.splice(i, 1);
  app.restructure();
}

// Видна ли надпись сейчас (иначе редактор показывает текст сам)
function visibleNow(L) {
  const S = app.scene();
  let p = L;
  while (p) {
    const pr = S.layers.get(p.id);
    if (!p.vis || (pr && pr.op < 0.2)) return false;
    const par = app.idx.parent.get(p.id);
    if (par && par.type === 'switch' && activeSwitchChild(par, app.frame) !== p) return false;
    p = par;
  }
  const st = paintOf(L, app.frame);
  return !!st && ((st.doF && st.fill[3] > 0.25) || (st.doS && st.stroke[3] > 0.25));
}

// ---------- редактор прямо на холсте ----------
let ed = null;      // { id, ta, orig, isNew, prevActive }
let closedAt = 0;   // когда редактор закрыт кликом по холсту (чтобы тот же клик не создал новую надпись)
let hinted = false; // подсказка про анимацию показана

function openEditor(L, { isNew = false, prevActive = null, selectAll = false } = {}) {
  if (ed) finishEditor(true);
  if (!L || L.type !== 'text' || !app.viewEl) return;
  if (L.lock) { app.toast('Слой заблокирован — снимите замок в списке слоёв, чтобы изменить текст'); return; }
  fixLayer(L);
  const ta = h('textarea', {
    class: 'tx-ed', wrap: 'off', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off',
    'aria-label': 'Текст надписи. Enter — новая строка, Ctrl+Enter — готово, Esc — отмена',
  });
  ta.value = String(L.text);
  ed = { id: L.id, ta, orig: String(L.text), isNew, prevActive };
  ta.addEventListener('input', () => {
    const X = app.idx.layers.get(ed && ed.id);
    if (!X || !ed || ed.ta !== ta) return;
    X.text = ta.value;
    app.changed();
    place();
  });
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') { e.preventDefault(); finishEditor(false); }
    else if (e.key === 'Enter' && ctrl) { e.preventDefault(); finishEditor(true); }
    else if (ctrl && (e.code === 'KeyS')) { e.preventDefault(); finishEditor(true); app.cmd && app.cmd.saveProject && app.cmd.saveProject(); }
  });
  ta.addEventListener('keyup', (e) => e.stopPropagation());
  ta.addEventListener('blur', () => { if (ed && ed.ta === ta && document.hasFocus()) finishEditor(true); });
  ta.addEventListener('wheel', (e) => {
    e.preventDefault();
    const cv = app.viewEl.querySelector('canvas');
    if (cv) cv.dispatchEvent(new WheelEvent('wheel', e));
  }, { passive: false });
  app.viewEl.append(ta);
  place();
  ta.focus({ preventScroll: true });
  if (selectAll) ta.select();
  else ta.setSelectionRange(ta.value.length, ta.value.length);
  app.render();
  app.refresh(['layers', 'inspector', 'timeline', 'status']);
}

// Поставить <textarea> точно поверх надписи (с учётом зума, поворота, масштаба, костей)
function place() {
  if (!ed) return;
  const L = app.idx.layers.get(ed.id);
  if (!L || L.type !== 'text') { const E = ed; ed = null; E.ta.remove(); return; }
  const rec = app.scene().layers.get(L.id);
  if (!rec) return;
  const lay = layout(L);
  const m = M.mul(app.docToScreenM(), rec.world);
  const k = M.scaleFactor(m) || 1;
  const pad = lay.size * 0.6, W = lay.W, ls = lay.ls;
  let x0, w;
  // CSS добавляет интервал и после последней буквы — компенсируем
  if (lay.align === 'left') { x0 = -W / 2; w = W + pad; }
  else if (lay.align === 'right') { x0 = W / 2 - W - pad + ls; w = W + pad; }
  else { x0 = -W / 2 - pad + ls / 2; w = W + 2 * pad; }
  const T = M.mul(m, [1, 0, 0, 1, x0, -lay.H / 2]);
  const ta = ed.ta, s = ta.style;
  s.font = lay.font;
  s.lineHeight = lay.lh + 'px';
  s.letterSpacing = ls + 'px';
  s.textAlign = lay.align;
  s.width = w + 'px';
  s.height = lay.H + lay.lh * 0.25 + 'px';
  s.transform = `matrix(${T.map((v) => +v.toFixed(5)).join(',')})`;
  s.outlineWidth = 1.2 / k + 'px';
  s.outlineOffset = 4 / k + 'px';
  const show = !visibleNow(L);
  ta.classList.toggle('show', show);
  ta.scrollLeft = 0;
  ta.scrollTop = 0;
}

// Панель «Свойства» перестраивается после записи в историю — вернуть фокус в поле, куда кликнули
function keepFocus(fn) {
  const a = document.activeElement;
  const lab = a && a.closest && a.closest('#inspector') && a.getAttribute('aria-label');
  fn();
  if (!lab) return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const el = [...document.querySelectorAll('#inspector [aria-label]')].find((x) => x.tagName === a.tagName && x.getAttribute('aria-label') === lab);
    if (!el || el === document.activeElement) return;
    el.focus({ preventScroll: true });
    if (el.tagName === 'TEXTAREA' || el.type === 'text') el.setSelectionRange(el.value.length, el.value.length);
  }));
}

// Через отложенный вызов клик по панели успевает сработать до перестройки панелей
function later(fn) {
  let done = false, tm = 0;
  const run = () => {
    if (done) return;
    done = true;
    clearTimeout(tm);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onUp, true);
    fn();
  };
  const onUp = () => setTimeout(run, 0);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onUp, true);
  tm = setTimeout(run, 8000);
}

function finishEditor(keep, defer = false) {
  if (!ed) return;
  const E = ed;
  ed = null;
  E.ta.remove();
  // данные меняем сразу, а запись в историю (и удаление ненужной новой надписи) — возможно, чуть позже
  const L0 = app.idx.layers.get(E.id);
  let drop = false;
  if (L0 && L0.type === 'text') {
    if (!keep) L0.text = E.orig;
    const empty = !String(L0.text).trim();
    if (E.isNew && (!keep || empty)) drop = true;
    else {
      if (empty) { L0.text = E.orig; app.toast('Пустой текст не сохранён. Чтобы убрать надпись, удалите слой.', 3000); }
      syncName(L0, E.orig);
    }
  }
  const done = () => {
    const L = app.idx.layers.get(E.id);
    if (!L || L.type !== 'text') { app.render(); return; }
    if (drop) {
      removeLayer(L);
      if (E.prevActive != null && app.idx.layers.has(E.prevActive)) app.activeId = E.prevActive;
      app.fixTool();
      app.refresh();
      app.render();
      if (keep) app.toast('Надпись пустая — слой не создан');
      return;
    }
    keepFocus(() => {
      if (E.isNew) {
        app.commit('Новый текст');
        if (!hinted) { hinted = true; app.toast('Надпись готова! Оживите её одной кнопкой: «Печатная машинка» в панели «Свойства» справа.', 5000); }
      } else app.commit('Текст'); // без изменений история не пополнится
    });
  };
  if (defer) later(done); else done();
  app.render();
}

// Клик мимо редактора — готово
document.addEventListener('pointerdown', (e) => {
  if (!ed || e.target === ed.ta) return;
  const t = e.target;
  const defer = !!(t && t.closest && t.closest('#side, #toolbox, #optbar, #timeline'));
  if (app.viewEl && app.viewEl.contains(t)) closedAt = performance.now();
  finishEditor(true, defer);
}, true);
window.addEventListener('focus', () => { if (ed && document.activeElement !== ed.ta) ed.ta.focus({ preventScroll: true }); });
app.on('render', () => { if (ed) place(); });
app.on('docloaded', () => { if (ed) { const E = ed; ed = null; E.ta.remove(); } });

// Новый текстовый слой из меню «+» — сразу печатать
const autoOpened = new Set();
app.on('commit', () => {
  const L = app.active, top = app.history.stack[app.history.i];
  if (!L || L.type !== 'text' || ed || !top || top.label !== 'Новый слой' || L.text !== 'Текст' || autoOpened.has(L.id)) return;
  autoOpened.add(L.id);
  setTimeout(() => { if (app.active === L && !ed) openEditor(L, { selectAll: true }); }, 60);
});

// ---------- создание ----------
function createAt(e) {
  const prev = app.activeId;
  // внутрь переключателя не кладём — надпись встанет рядом с ним
  const par = app.active && app.idx.parent.get(app.active.id);
  if (par && par.type === 'switch') app.activeId = par.id;
  const A = app.active;
  const n = app.idx.list.filter((l) => l.type === 'text').length + 1;
  const L = newLayer(app.doc, 'text', 'Текст ' + n);
  L.font = FONTS[opt('txFont', 'Inter')] ? opt('txFont', 'Inter') : 'Inter';
  L.size = clamp(+opt('txSize', 72) || 72, 4, 2000);
  applyLook(L, opt('txLook', 'plain'));
  app.insertLayer(L, { inside: !!(A && A.children && A.type !== 'switch') });
  // положение в пространстве родителя: текст появляется там, где кликнули
  const rec = app.rescene().layers.get(L.id);
  const P = M.mul(rec.world, M.inv(rec.local));
  L.pos.k[0].v = M.apply(M.inv(P), ...snapXY(e.x, e.y));
  app.render();
  openEditor(L, { isNew: true, prevActive: prev, selectAll: true });
}

// ---------- анимации текста ----------
function autoDur(L) {
  const n = layout(L).n, fps = (app.doc && app.doc.fps) || 24;
  return clamp(Math.round((n * fps) / 12), 6, 120); // ≈ 12 букв в секунду
}
const durUser = new Map(); // id слоя → длительность, заданная вручную (настройка панели)
const durOf = (L) => durUser.get(L.id) || autoDur(L);
const startFrame = () => (app.frame <= 0 ? Math.max(1, app.doc.start) : app.frame);

const ANIMS = {
  type: { name: 'Печатная машинка', icon: 'txType', title: 'Буквы печатаются по одной, как на пишущей машинке' },
  fade: { name: 'Появление по буквам', icon: 'txFade', title: 'Буквы плавно проявляются одна за другой' },
  pop: { name: 'Выпрыгивание букв', icon: 'txPop', title: 'Буквы весело выпрыгивают по очереди' },
  erase: { name: 'Стереть', icon: 'txErase', title: 'Текст исчезает с конца, буква за буквой' },
};

function holdBefore(c, f) {
  const i = c.k.findIndex((k) => k.f === f);
  const p = c.k[i - 1];
  if (i > 0 && Math.abs(p.v - c.k[i].v) > 1e-6) p.i = 'step';
}

function animateText(L, kind) {
  if (!L || L.type !== 'text') return;
  if (L.lock) { app.toast('Слой заблокирован'); return; }
  fixLayer(L);
  if (!layout(L).n) { app.toast('Сначала напишите текст'); return; }
  const doc = app.doc, c = L.reveal, A = ANIMS[kind];
  const f0 = startFrame(), f1 = f0 + durOf(L);
  const erase = kind === 'erase';
  let v0 = erase ? clamp(evalCh(c, f0), 0, 1) : 0;
  if (erase && v0 < 0.01) v0 = 1;
  const interp = kind === 'type' || (erase && (L.revealFx || 'type') === 'type') ? 'linear' : 'ease';
  c.k = c.k.filter((k) => k.f === 0 || k.f < f0 || k.f > f1);
  // до начала печати текста не видно (кадр 0 — поза покоя — остаётся с полным текстом)
  const fresh = !erase && f0 > 1 && !c.k.some((k) => k.f > 0 && k.f < f0);
  if (fresh) setKey(c, 1, 0, 'step');
  setKey(c, f0, v0, interp);
  setKey(c, f1, erase ? 0 : 1, 'smooth');
  if (fresh) holdBefore(c, 1);
  holdBefore(c, f0);
  if (!erase) L.revealFx = kind;
  let longer = '';
  if (f1 > doc.end) { doc.end = f1; longer = ` Сцена удлинена до ${f1} ${plural(f1, ['кадра', 'кадров', 'кадров'])}.`; }
  app.commit(A.name);
  app.toast(`«${A.name}»: кадры ${f0}–${f1}. Нажмите Пробел, чтобы посмотреть.${longer}`, 4500);
}

function clearAnim(L) {
  const c = L.reveal;
  c.k = [{ f: 0, v: 1, i: 'smooth' }];
  app.commit('Убрать анимацию текста');
  app.toast('Анимация текста убрана — надпись видна целиком');
}

// ---------- инструмент ----------
registerTool({
  id: 'text', name: 'Текст', icon: 'text', key: 'y', group: 'draw', simple: true, cursor: 'crosshair',
  avail: () => true,
  hint: 'Клик — новая надпись, клик по надписи — изменить текст, тяните надпись — передвинуть. Enter — новая строка, Ctrl+Enter или клик мимо — готово, Esc — отмена.',
  options: () => [
    { type: 'select', key: 'txFont', label: 'Шрифт', items: FONTS, def: 'Inter' },
    { type: 'number', key: 'txSize', label: 'Размер', min: 6, max: 600, def: 72 },
    { type: 'select', key: 'txLook', label: 'Стиль', items: LOOK_ITEMS, def: 'plain' },
  ],
  down(e) {
    this.st = null;
    const hit = hitText(e.sx, e.sy);
    if (!hit) {
      // этот клик только закрыл редактор
      if (performance.now() - closedAt < 400) return;
      this.st = { create: true, e };
      return;
    }
    if (hit.id !== app.activeId) app.setActive(hit.id);
    if (hit.lock) { app.toast('Слой заблокирован'); return; }
    const rec = app.scene().layers.get(hit.id);
    this.st = { L: hit, e, moved: false, Pi: M.inv(M.mul(rec.world, M.inv(rec.local))), pos0: evalCh(hit.pos, app.frame).slice() };
  },
  move(e) {
    const st = this.st;
    if (!st || !st.L) return;
    if (!st.moved && Math.hypot(e.sx - st.e.sx, e.sy - st.e.sy) < 4) return;
    st.moved = true;
    const a = M.apply(st.Pi, st.e.x, st.e.y), c = M.apply(st.Pi, e.x, e.y);
    let dx = c[0] - a[0], dy = c[1] - a[1];
    if (e.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    setKey(st.L.pos, app.frame, [st.pos0[0] + dx, st.pos0[1] + dy]);
    app.setCursor('move');
    app.changed();
  },
  up() {
    const st = this.st;
    this.st = null;
    if (!st) return;
    if (st.L) {
      if (st.moved) app.commit('Перемещение текста');
      else openEditor(st.L);
      return;
    }
    if (st.create) createAt(st.e);
  },
  hover(e) {
    const hit = ed ? null : hitText(e.sx, e.sy);
    app.setCursor(hit ? 'text' : 'crosshair');
    if (hit !== this.hv) { this.hv = hit; app.render(); }
  },
  cancel() { this.st = null; this.hv = null; },
  overlay(ctx) {
    const A = app.active;
    if (A && A.type === 'text' && (!ed || ed.id !== A.id)) drawTextBox(ctx, A, '#ffad5c');
    if (this.hv && this.hv !== A && !ed) drawTextBox(ctx, this.hv, '#4c9dff', [3, 3]);
  },
});

// Двойной клик по надписи любым инструментом — редактировать
let dblHit = null;
registerViewportHandler({
  down(e) {
    if (!e.dbl || ed || app.tool === 'text') return false;
    const hit = hitText(e.sx, e.sy);
    if (!hit) return false;
    const A = app.active, t = tools[app.tool];
    // двойной клик по фигуре на векторном слое нужен инструментам точек
    if (A && A !== hit && A.type === 'vector' && t && (t.group === 'draw' || t.group === 'fill') && hitShape(A, e.sx, e.sy)) return false;
    dblHit = hit;
    return true;
  },
  up() {
    const L = dblHit;
    dblHit = null;
    if (!L) return;
    if (L.id !== app.activeId) app.setActive(L.id);
    openEditor(L);
  },
});

registerShortcut({ key: 'enter', when: () => !!app.active && app.active.type === 'text' && !ed, run: () => openEditor(app.active) });

registerMenu('Слой', () => {
  const A = app.active;
  const items = [{ label: 'Добавить надпись', icon: 'text', key: 'Y', action: () => { app.cmd.setTool('text'); app.toast('Кликните на холсте там, где нужна надпись'); } }];
  if (A && A.type === 'text') items.push({ label: 'Изменить текст на холсте', key: 'Enter', action: () => openEditor(A) });
  return items;
});
registerMenu('Анимация', () => {
  const A = app.active;
  if (!A || A.type !== 'text') return [];
  return Object.entries(ANIMS).map(([k, v]) => ({ label: 'Текст: ' + v.name.toLowerCase(), icon: v.icon, action: () => animateText(A, k) }));
});

registerHook('docLoaded', (doc) => {
  const walk = (arr) => { for (const L of arr || []) { if (L.type === 'text') fixLayer(L); if (L.children) walk(L.children); } };
  walk(doc.layers);
});

// ---------- панель «Свойства» ----------
function colorRow(L, key, label, enKey, upd, commitLabel, toggleLabel) {
  const box = h('div', { class: 'tx-col' });
  let shown = null;
  const get = () => evalCh(L[key], app.frame);
  const render = () => {
    shown = get().slice();
    box.replaceChildren(colorField(label, shown, {
      enabled: L[enKey],
      onToggle: (v) => { L[enKey] = v; app.commit(toggleLabel); },
      onLive: (c) => { setKey(L[key], app.frame, c); shown = c.slice(); app.changed(); },
      onCommit: (c) => { setKey(L[key], app.frame, c); shown = c.slice(); app.commit(commitLabel); },
    }));
  };
  render();
  box.set = () => {
    const c = get();
    if (shown && c.every((v, i) => Math.abs(v - shown[i]) < 1e-6)) return;
    if (!box.contains(document.activeElement)) render();
  };
  return upd(box, () => 0);
}

function textSection(L, H) {
  const { sec, row, upd, live, f, numField, selectField } = H;
  fixLayer(L);
  // текст
  const ta = h('textarea', { class: 'txt tx-area', spellcheck: 'false', rows: clamp(String(L.text).split('\n').length, 2, 6), placeholder: 'Напишите что-нибудь…', 'aria-label': 'Текст надписи' });
  ta.value = String(L.text);
  let before = String(L.text);
  ta.addEventListener('focus', () => { before = String(L.text); });
  ta.addEventListener('input', () => { L.text = ta.value; live(); });
  ta.addEventListener('change', () => { if (L.text !== before) { syncName(L, before); app.commit('Текст'); } });
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ta.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); ta.value = before; L.text = before; live(); ta.blur(); }
  });
  ta.set = (v) => { if (document.activeElement !== ta) ta.value = v; };
  upd(ta, () => String(L.text));
  const editBtn = h('button', { class: 'btn sm', title: 'Редактировать прямо на холсте (Enter или двойной клик по надписи)', onclick: () => openEditor(L, { selectAll: false }) }, icon('text', 15), 'На холсте');

  // шрифт
  const fontSel = selectField('Шрифт', FONTS[L.font] ? L.font : 'Inter', FONTS, (v) => { L.font = v; app.commit('Шрифт'); });
  fontSel.querySelectorAll('option').forEach((o) => { o.style.fontFamily = famCss(o.value); });
  const tog = (label, title, on, fn, cls = '') => h('button', { class: 'icon-btn tog tx-tog ' + cls + (on ? ' on' : ''), title, 'aria-label': title, 'aria-pressed': !!on, onclick: fn }, label);
  const size = numField('Размер', L.size, { min: 4, max: 2000, step: 1, prec: 0, unit: 'px', onLive: (v) => { L.size = v; live(); }, onCommit: () => app.commit('Размер текста') });
  const bold = tog('Ж', 'Жирный', (L.weight || 400) >= 600, () => { L.weight = (L.weight || 400) >= 600 ? 400 : 700; app.commit('Жирный'); }, 'b');
  const ital = tog('К', 'Курсив', !!L.italic, () => { L.italic = !L.italic; app.commit('Курсив'); }, 'i');
  const al = (v, ic, title) => h('button', { class: 'icon-btn tog' + ((L.align || 'center') === v ? ' on' : ''), title, 'aria-label': title, 'aria-pressed': (L.align || 'center') === v, onclick: () => { if (L.align !== v) { L.align = v; app.commit('Выравнивание'); } } }, icon(ic, 17));
  const lh = numField('Между строк', L.lineHeight, { min: 0.5, max: 5, step: 0.05, prec: 2, title: 'Межстрочный интервал (× размер шрифта)', onLive: (v) => { L.lineHeight = v; live(); }, onCommit: () => app.commit('Межстрочный интервал') });
  const ls = numField('Между букв', L.letterSpacing, { min: -100, max: 500, step: 0.5, prec: 1, unit: 'px', title: 'Расстояние между буквами', onLive: (v) => { L.letterSpacing = v; live(); }, onCommit: () => app.commit('Расстояние между буквами') });

  // цвета
  const fill = colorRow(L, 'fill', 'Цвет', 'hf', upd, 'Цвет текста', 'Заливка текста');
  const stroke = colorRow(L, 'stroke', 'Обводка', 'hs', upd, 'Цвет обводки', 'Обводка текста');
  const sw = upd(numField('Толщина обводки', evalCh(L.width, f()), { min: 0, max: 200, step: 0.5, prec: 1, unit: 'px', onLive: (v) => { setKey(L.width, f(), v); live(); }, onCommit: () => app.commit('Толщина обводки') }), () => evalCh(L.width, f()));

  // быстрые стили
  const looks = h('div', { class: 'tx-looks' }, Object.entries(LOOKS).map(([id, lk]) => {
    const sh = lk.sh ? `${lk.sh.x}px ${lk.sh.y}px ${lk.sh.blur / 2}px ${lk.sh.col}` : 'none';
    const pv = h('span', {
      class: 'tx-look-p',
      style: {
        color: rgba(lk.fill),
        webkitTextStroke: lk.hs ? `${Math.min(lk.width, 4) * 0.5}px ${rgb2hex(lk.stroke)}` : '0',
        paintOrder: 'stroke fill',
        textShadow: id === 'neon' ? `0 0 6px ${lk.sh.col}, 0 0 2px ${lk.sh.col}` : id === 'cartoon' ? `1px 2px 0 ${lk.sh.col}` : sh,
      },
    }, 'Аа');
    return h('button', { class: 'tx-look', title: 'Стиль «' + lk.name + '»: цвет, обводка и тень', onclick: () => { applyLook(L, id); app.commit('Стиль текста'); } }, pv, h('span', { class: 'tx-look-n' }, lk.name));
  }));

  return sec('Текст',
    ta,
    h('div', { class: 'insp-row tx-r' }, editBtn, h('span', { class: 'insp-note tx-kbd' }, 'Ctrl+Enter — готово')),
    row(fontSel),
    row(size, bold, ital),
    row(al('left', 'txAlignL', 'По левому краю'), al('center', 'txAlignC', 'По центру'), al('right', 'txAlignR', 'По правому краю'), lh),
    row(ls),
    fill, stroke, row(sw),
    h('div', { class: 'tx-sub' }, 'Быстрый стиль'),
    looks,
    f() > 0 ? h('div', { class: 'insp-note' }, `Цвета и обводка анимируются: изменения на кадре ${f()} становятся ключами.`) : null,
  );
}

function animSection(L, H) {
  const { sec, row, upd, live, f, numField, selectField } = H;
  fixLayer(L);
  const lay = layout(L), fps = app.doc.fps || 24;
  const dur = durOf(L), f0 = startFrame();
  const btns = h('div', { class: 'tx-anims' }, Object.entries(ANIMS).map(([k, A]) => h('button', {
    class: 'btn sm tx-anim' + (k === 'erase' ? ' tx-anim-erase' : ''), title: A.title, disabled: !lay.n, onclick: () => animateText(L, k),
  }, icon(A.icon, 18), h('span', null, A.name))));
  const durF = numField('Длительность', dur, {
    min: 2, max: 2000, step: 1, prec: 0, unit: 'кадр.', title: 'Сколько кадров длится анимация текста',
    onCommit: (v) => { durUser.set(L.id, Math.round(v)); app.rebuildInspector(); },
  });
  const secs = (dur / fps).toFixed(1).replace('.', ',');
  const kids = [
    btns,
    row(durF),
    h('div', { class: 'insp-note' }, lay.n
      ? `Начнётся с кадра ${f0} и займёт ≈ ${secs} с (${lay.n} ${plural(lay.n, ['буква', 'буквы', 'букв'])}). Потом нажмите Пробел.`
      : 'Напишите текст, чтобы его анимировать.'),
  ];
  const fxSel = selectField('Эффект', FX[L.revealFx] ? L.revealFx : 'type', FX, (v) => { L.revealFx = v; app.commit('Как появляются буквы'); });
  fxSel.title = 'Как появляются и исчезают буквы, пока текст показан не целиком';
  kids.push(row(fxSel));
  const pct = () => Math.round(clamp(evalCh(L.reveal, f()), 0, 1) * 100);
  const rev = upd(rangeField('Показано, %', pct(), {
    min: 0, max: 100, step: 1, prec: 0, onLive: (v) => { setKey(L.reveal, f(), v / 100); live(); }, onCommit: () => app.commit('Показ текста'),
  }), pct);
  rev.title = 'Какая часть текста видна на этом кадре (на кадрах > 0 создаётся ключ)';
  kids.push(rev);
  if (L.reveal.k.length > 1) kids.push(h('div', { class: 'btn-row' }, h('button', { class: 'btn sm danger', onclick: () => clearAnim(L) }, 'Убрать анимацию текста')));
  return sec('Анимация текста', ...kids);
}

registerInspector({ id: 'text-anim', order: 4, when: (L) => L.type === 'text', build: animSection });
registerInspector({ id: 'text', order: 5, when: (L) => L.type === 'text', build: textSection });

// ---------- стили ----------
addStyle(`
.ltype.t-text { color: #ffe14d; }
.tx-ed { position: absolute; left: 0; top: 0; z-index: 3; margin: 0; padding: 0; border: 0; box-sizing: content-box; background: transparent; color: transparent; caret-color: #4c9dff;
  resize: none; overflow: hidden; white-space: pre; transform-origin: 0 0; outline: 1px dashed rgba(76,157,255,.95); font-kerning: normal; }
.tx-ed::selection { background: rgba(76,157,255,.35); color: transparent; }
.tx-ed.show { color: rgba(76,157,255,.95); }
.tx-ed.show::selection { color: #fff; }
.tx-area { display: block; width: 100%; min-height: 54px; max-height: 220px; resize: vertical; font: 14px/1.4 var(--font); color: var(--text); }
.tx-r { justify-content: space-between; }
.tx-kbd { margin: 0; }
.tx-tog { width: 28px; font-weight: 700; font-size: 14px; }
.tx-tog.i { font-style: italic; font-family: Georgia, serif; font-weight: 400; }
.tx-sub { font-size: 11px; color: var(--text2); margin: 10px 0 5px; }
.tx-looks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; }
.tx-look { display: flex; align-items: center; gap: 7px; padding: 3px; border-radius: 6px; border: 1px solid var(--line2); background: var(--bg3); color: var(--text); min-width: 0; text-align: left; }
.tx-look:hover { border-color: var(--accent); background: var(--bg4); }
.tx-look-p { flex: none; width: 42px; padding: 3px 0 2px; border-radius: 4px; background: #e9ecf1; font: 700 18px/1.1 Inter, Arial, sans-serif; text-align: center; }
.tx-look-n { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.tx-anims { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; }
.tx-anim { justify-content: flex-start; white-space: normal; text-align: left; line-height: 1.2; min-height: 36px; padding: 5px 8px; }
.tx-anim .ic { color: #ffe14d; flex: none; }
.tx-anim.tx-anim-erase .ic { color: #ff9aa5; }
.tx-anim:disabled { opacity: .45; cursor: default; }
`, 'text-css');
