// «Библиотека» — готовые персонажи, природа, предметы и фоны: один клик или перетаскивание на холст.
// Всё строится программно из векторных контуров (помощники js/demo.js) прямо в целевом документе,
// поэтому id всегда свежие. Миниатюры рисует настоящий рендер из временного документа.
import { app } from '../app.js';
import { registerSideTab, registerTemplate, registerMenu, registerInspector, registerHook, registerViewportHandler, addStyle } from '../ext.js';
import { registerIcon, icon } from '../icons.js';
import { h, M, OVAL_CURV, distToSeg, pointInPoly } from '../util.js';
import { setKey, evalCh } from '../anim.js';
import { newDoc, newLayer } from '../model.js';
import { evaluate, layerWorldPoints, camMatrix } from '../scene.js';
import { Renderer } from '../render.js';
import { buildCharacter, makePath, style, oval, star, C, CHARACTER_COLORS } from '../demo.js';
import { setTool } from '../panels.js';
import { layerBox, placeFrame } from '../tools.js';

registerIcon('library', '<rect x="3" y="3.5" width="7.5" height="7.5" rx="1.5"/><circle cx="17.2" cy="7.2" r="3.8"/><path d="M6.8 13.5l4 7h-8z"/><path d="M14 13.5h7v7h-7z"/>');
registerIcon('lib-x', '<path d="M6 6l12 12M18 6L6 18"/>');
registerIcon('lib-search', '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>');

// ---------- геометрия ----------
const P = makePath;
const rect = (x0, y0, x1, y1) => [[x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0]];
const fillA = (hex, a) => ({ ...style(hex, null, 0), fill: C(hex, a) });
const line = (hex, w) => style(null, hex, w);

// Повёрнутый овал из 4 точек
function rotOval(cx, cy, rx, ry, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [[rx, 0], [0, ry], [-rx, 0], [0, -ry]].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c, OVAL_CURV]);
}
function vec(d, name, ...paths) { const L = newLayer(d, 'vector', name); L.paths.push(...paths.flat()); return L; }
function grp(d, name, ...kids) { const G = newLayer(d, 'group', name); G.children.push(...kids); return G; }
// Точка вращения/масштаба (например, у основания — чтобы дерево качалось от корня)
const pivot = (L, x, y) => { L.origin = [x, y]; return L; };

// Слитые круги с общим контуром: снизу круги с обводкой двойной толщины, сверху те же круги только заливкой
function blob(d, circles, fill, stroke, w) {
  const out = circles.map(([x, y, rx, ry = rx]) => P(d, oval(x, y, rx, ry), true, style(fill, stroke, w * 2)));
  for (const [x, y, rx, ry = rx] of circles) out.push(P(d, oval(x, y, rx, ry), true, style(fill, null, 0)));
  return out;
}

// Дуга окружности от a0 до a1, проходящая через угол through
function arc(cx, cy, r, a0, a1, through, n) {
  const TAU = Math.PI * 2, md = (x) => ((x % TAU) + TAU) % TAU;
  let span = md(a1 - a0);
  if (md(through - a0) > span) span -= TAU;
  return Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (span * i) / n; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });
}

// Полумесяц: круг R с центром (x, y) минус круг r со смещением (ox, oy)
function crescent(x, y, R, ox, oy, r) {
  const dd = Math.hypot(ox, oy), ux = ox / dd, uy = oy / dd;
  const a = (R * R - r * r + dd * dd) / (2 * dd), q = Math.sqrt(Math.max(0, R * R - a * a));
  const i1 = [ux * a - uy * q, uy * a + ux * q], i2 = [ux * a + uy * q, uy * a - ux * q];
  const away = Math.atan2(-uy, -ux);
  const outer = arc(0, 0, R, Math.atan2(i1[1], i1[0]), Math.atan2(i2[1], i2[0]), away, 6);
  const inner = arc(ox, oy, r, Math.atan2(i2[1] - oy, i2[0] - ox), Math.atan2(i1[1] - oy, i1[0] - ox), away, 4);
  return [
    ...outer.map(([px, py], i) => [x + px, y + py, i === 0 || i === 6 ? 0 : 1]),
    ...inner.slice(1, -1).map(([px, py]) => [x + px, y + py, 1]),
  ];
}

// Предсказуемый генератор случайных чисел (одинаковый результат при каждой сборке)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Фоны: на всю рамку кадра с запасом по краям
const BLEED = 40;
const skyRect = (d, cx, col) => P(d, rect(-cx.w / 2 - BLEED, -cx.h / 2 - BLEED, cx.w / 2 + BLEED, cx.h / 2 + BLEED), true, style(col, null, 0));
function hill(cx, yTop, amp, n, phase) {
  const hw = cx.w / 2 + BLEED, hb = cx.h / 2 + BLEED;
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push([-hw + (2 * hw * i) / n, yTop + Math.sin(i * 1.9 + phase) * amp, i === 0 || i === n ? 0 : 1]);
  pts.push([hw, hb, 0], [-hw, hb, 0]);
  return pts;
}
// ground — где у фона земля (доля половины высоты кадра от центра вниз): туда встают персонажи и деревья
function bgGroup(d, cx, name, kids, ground) {
  const G = grp(d, name, ...kids);
  G.libGround = (cx.h / 2) * ground;
  G.lock = true;
  G.open = false;
  G.lib = 'bg';
  G.libWH = [cx.w, cx.h]; // размер кадра, под который нарисован фон
  G.libFit = [cx.w, cx.h]; // размер кадра при последней подгонке
  return G;
}

// Фон из библиотеки накрывает кадр камеры на всех кадрах сцены: с учётом наезда, поворота и панорамы.
// Опора — поза покоя камеры (кадр 0); если камера потом едет, фон сдвигается к середине её пути
// и увеличивается ровно настолько, чтобы в кадре не было краёв.
function fitBg(G, doc) {
  const [w0, h0] = Array.isArray(G.libWH) ? G.libWH : [doc.w, doc.h];
  const ex = w0 / 2 + BLEED, ey = h0 / 2 + BLEED, hw = doc.w / 2, hh = doc.h / 2;
  const C0 = camMatrix(doc, 0);
  const last = Math.max(doc.end, doc.start, 0), step = Math.max(1, Math.ceil(last / 2000));
  // рамка всех кадров камеры в координатах кадра камеры в покое
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let f = 0; f <= last + step - 1; f += step) {
    const T = M.mul(C0, M.inv(camMatrix(doc, Math.min(f, last))));
    for (const [x, y] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) {
      const [u, v] = M.apply(T, x, y);
      if (!Number.isFinite(u) || !Number.isFinite(v)) continue;
      x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v);
    }
  }
  if (!(x1 >= x0 && y1 >= y0)) { x0 = -hw; x1 = hw; y0 = -hh; y1 = hh; }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cover = Math.max(1, (x1 - x0) / 2 / ex, (y1 - y0) / 2 / ey);
  const z0 = Math.abs(evalCh(doc.cam.zoom, 0)) || 1, r0 = evalCh(doc.cam.roll, 0), p0 = evalCh(doc.cam.pos, 0);
  const c = M.apply(M.rotate(r0 * Math.PI / 180), cx / z0, cy / z0), s = cover / z0;
  // анимированные пользователем каналы не трогаем
  if (G.pos.k.length === 1) G.pos.k[0].v = [p0[0] + c[0], p0[1] + c[1]];
  if (G.rot.k.length === 1) G.rot.k[0].v = r0;
  if (G.scl.k.length === 1 && Number.isFinite(s) && s > 0) G.scl.k[0].v = [s, s];
  G.libFit = [doc.w, doc.h];
}

// ---------- анимации ----------
// Сдвиг готовой анимации: с текущего кадра, если она помещается до конца сцены, иначе с начала
function animOffset(cx, len) {
  const base = cx.frame >= 1 && cx.frame + len <= cx.end ? cx.frame : cx.start;
  return Math.max(0, base - 1);
}
function keysFrom(o, c, list, i = 'smooth') {
  if (o > 0) setKey(c, o, c.k[0].v, i === 'smooth' ? 'ease' : i); // удержание позы покоя до начала
  for (const [f, v] of list) setKey(c, f + o, v, i);
}
// Моргание: масштаб по Y до 8% и обратно за 4 кадра, примерно раз в 2–3 секунды
function blinkKeys(L, cx) {
  const s0 = L.scl.k[0].v;
  L.scl.k = [L.scl.k[0]];
  L.scl.k[0].i = 'linear';
  const gaps = [2.6, 2.1, 3.0, 2.4];
  let t = cx.start + Math.round(cx.fps * 0.8), n = 0;
  while (t + 4 <= cx.end) {
    setKey(L.scl, t, s0, 'linear');
    setKey(L.scl, t + 2, [s0[0], s0[1] * 0.08], 'linear');
    setKey(L.scl, t + 4, s0, 'linear');
    t += Math.round(cx.fps * gaps[n++ % gaps.length]);
  }
}

// ---------- персонажи ----------
const GIRL = { shirt: '#ef5b6b', shirtDark: '#d0414f', outline: '#8a2333', hair: '#f2b33d', hairDark: '#c98a1c', pants: '#6a58a8', shoes: '#c23a4a' };
const GREEN = { shirt: '#4cb860', shirtDark: '#379a4a', outline: '#1f5e2e', hair: '#2a2a2e', hairDark: '#151518', skin: '#d39a6a', skinDark: '#7a4a2c', pants: '#3b4a6b' };

function character(d, cx, o) {
  const col = { ...CHARACTER_COLORS, ...(o.colors || {}) };
  const res = buildCharacter(d, { name: o.name, colors: o.colors });
  const { rig, bones, layers } = res;
  // рот — отдельным слоем, чтобы его было легко заменить ртом для липсинка
  const mouth = vec(d, 'Рот', layers.head.paths.splice(2, 1));
  mouth.bind = bones.head.id;
  rig.children.splice(rig.children.indexOf(layers.head) + 1, 0, mouth);
  rig.origin = [0, 207];
  rig.lib = 'char';
  if (o.extra) o.extra(d, layers, col);
  if (o.wave) wave(res, animOffset(cx, 48));
  return rig;
}

function girlExtra(d, layers, col) {
  const hp = layers.head.paths;
  hp.unshift( // хвостики — за лицом
    P(d, rotOval(-52, -44, 15, 23, 0.4), true, style(col.hair, col.hairDark, 3)),
    P(d, rotOval(52, -44, 15, 23, -0.4), true, style(col.hair, col.hairDark, 3)),
  );
  hp.push(
    P(d, oval(-40, -55, 5, 5), true, style('#ff6fae', '#c8407e', 2)),
    P(d, oval(40, -55, 5, 5), true, style('#ff6fae', '#c8407e', 2)),
    P(d, [[20, -84, 0], [6, -97, 0], [5, -73, 0]], true, style('#ff6fae', '#c8407e', 2.5)), // бантик
    P(d, [[20, -84, 0], [34, -97, 0], [35, -73, 0]], true, style('#ff6fae', '#c8407e', 2.5)),
    P(d, oval(20, -84, 4.5, 4.5), true, style('#ff6fae', '#c8407e', 2)),
  );
  layers.torso.paths.push(P(d, [[-38, 92, 0], [38, 92, 0], [62, 150, 0], [0, 157, 1], [-62, 150, 0]], true, style(col.shirt, col.outline, 4)));
}

function capExtra(d, layers) {
  layers.head.paths.push(
    P(d, [[-43, -56, 0], [-36, -82, 1], [0, -95, 1], [36, -82, 1], [43, -56, 0]], true, style('#ffb13b', '#c47f12', 3)),
    P(d, [[28, -62, 0], [74, -60, 0], [72, -52, 1], [30, -54, 0]], true, style('#ffb13b', '#c47f12', 3)),
  );
}

function wave({ bones: b, layers }, o) {
  keysFrom(o, layers.eyes.scl, [[28, [1, 1]], [30, [1, 0.1]], [32, [1, 1]]], 'linear');
  layers.eyes.scl.k[0].i = 'linear';
  keysFrom(o, b.armR.ang, [[8, 40], [40, 40], [48, 165]]);
  keysFrom(o, b.foreR.ang, [[8, -40], [14, 12], [20, -40], [26, 12], [32, -40], [40, -10], [48, 0]]);
  keysFrom(o, b.armL.ang, [[24, 186], [48, 195]]);
  keysFrom(o, b.head.ang, [[12, -8], [24, 6], [36, -6], [48, 0]]);
  keysFrom(o, b.body.ang, [[24, -86], [48, -90]]);
  keysFrom(o, b.foreL.ang, [[24, -12], [48, 0]]);
}

// ---------- Морти ----------
// Те же кости, что у остальных персонажей (позы, ходьба и «Оживить» работают сразу), но свой рисунок:
// большая голова, глаза-«пуговицы», жёлтая футболка, джинсы и кеды. Рот — переключатель с 5 фазами (липсинк),
// глаза моргают. Тонкие тёмные контуры у линий рук и ног — нижним, более толстым штрихом.
const MORTY = {
  skin: '#fbd8b6', skinShade: '#ecc39c', ink: '#2d221c',
  hair: '#6b3f1f', hairInk: '#3d230f',
  shirt: '#f6df4c', shirtShade: '#e4c93c',
  pants: '#4e7cc6', pantsShade: '#4471b9',
  shoe: '#ffffff', sole: '#c7ccd4',
  mouth: '#6e2431', tongue: '#e97a86',
};

// Точка в системе руки: s — вдоль руки от плеча, t — поперёк (к телу у ближней руки)
const armPt = (x, y, deg) => { const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return (u, v, k = 1) => [x + u * c - v * s, y + u * s + v * c, k]; };

function mortyArm(d, L, x, y, deg, side, shade, bones) {
  const m = MORTY, at = armPt(x, y, deg), skin = shade ? m.skinShade : m.skin;
  const bone = [8, 32, 62, 90, 112].map((u) => at(u, 0));
  L.paths.push(
    P(d, bone, false, line(m.ink, 15)),
    P(d, bone, false, line(skin, 10)),
    // кисть — жёстко на предплечье: ладонь, большой палец и пальцы
    P(d, [at(112, 6.5 * side), at(118, 10.5 * side), at(126, 9 * side), at(131, 1 * side), at(129, -6 * side), at(121, -9.5 * side), at(112, -6.5 * side)], true, style(skin, m.ink, 2.5), bones[1]),
    P(d, [at(124, 7.5 * side), at(127, 3 * side)], false, line(m.ink, 1.8), bones[1]),
    // короткий рукав футболки — жёстко на плече
    P(d, [at(-7, 0), at(-1, 12.5), at(26, 12, 0), at(28.5, 0), at(26, -12, 0), at(-1, -12.5)], true, style(shade ? m.shirtShade : m.shirt, m.ink, 3), bones[0]),
  );
}

function mortyShoe(d, x, mir, bone) {
  const m = MORTY, X = (u) => x + u * mir;
  return [
    P(d, [[X(-17), 199], [X(-2), 194], [X(16), 197], [X(24), 205], [X(21), 212, 0], [X(-17), 212, 0], [X(-21), 205]], true, style(m.shoe, m.ink, 2.5), bone),
    P(d, [[X(-19), 208, 0], [X(22), 208, 0]], false, line(m.sole, 2.5), bone),
    P(d, [[X(-6), 198], [X(1), 202], [X(8), 199]], false, line(m.sole, 2), bone),
  ];
}

function mortyMouth(d) {
  const m = MORTY, inside = (pts) => P(d, pts, true, style(m.mouth, m.ink, 2.5));
  const teeth = (y0, y1, w) => P(d, [[-w, y0, 0], [w, y0, 0], [w - 1.5, y1, 0], [1.5 - w, y1, 0]], true, style('#ffffff', null, 0));
  const tongue = (y, rx, ry) => P(d, oval(0, y, rx, ry), true, style(m.tongue, null, 0));
  const sw = newLayer(d, 'switch', 'Рот');
  const shapes = [
    vec(d, 'Рот 1 — закрыт', P(d, [[-14, -15], [-5, -17.5], [4, -15.5], [13, -17]], false, line(m.ink, 3))),
    vec(d, 'Рот 2 — чуть открыт', inside([[-12, -17, 0], [0, -16], [12, -17, 0], [6, -12], [-6, -12]])),
    vec(d, 'Рот 3 — открыт', inside([[-13, -18, 0], [0, -16.5], [13, -18, 0], [8, -9.5], [0, -7], [-8, -9.5]]), tongue(-9.5, 5, 2.2)),
    vec(d, 'Рот 4 — широко', inside([[-15, -19, 0], [0, -17], [15, -19, 0], [10, -6.5], [0, -2.5], [-10, -6.5]]), teeth(-17.4, -14.6, 9.5), tongue(-6, 6, 2.6)),
    vec(d, 'Рот 5 — очень широко', inside([[-17, -21, 0], [0, -18], [17, -21, 0], [12, -4.5], [0, 1.5], [-12, -4.5]]), teeth(-19, -15.6, 11), tongue(-3, 7, 3.2)),
  ];
  sw.children.push(...shapes); // снизу вверх: закрыт → широко открыт (так работает «Липсинк по звуку»)
  sw.sw.k[0].v = String(shapes[0].id);
  sw.lib = 'mouth';
  sw.open = false;
  return sw;
}

function morty(d, cx, o = {}) {
  const m = MORTY;
  const res = buildCharacter(d, { name: o.name || 'Морти', colors: { skin: m.skin, skinDark: m.ink, outline: m.ink, shirt: m.shirt, pants: m.pants } });
  const { rig, bones: b, layers } = res;
  for (const L of Object.values(layers)) L.paths = [];

  mortyArm(d, layers.farArm, -38, 18, 105, -1, true, [b.armL.id, b.foreL.id]);
  mortyArm(d, layers.nearArm, 38, 18, 75, 1, false, [b.armR.id, b.foreR.id]);

  const leg = (x) => [[x, 106], [x + Math.sign(x), 152], [x + 2 * Math.sign(x), 196]];
  for (const [x, B] of [[-17, b.legL], [17, b.legR]]) {
    layers.legs.paths.push(P(d, leg(x), false, line(m.ink, 27)), P(d, leg(x), false, line(x < 0 ? m.pantsShade : m.pants, 22)));
    layers.legs.paths.push(...mortyShoe(d, x * 1.45, Math.sign(x), B.id));
  }

  layers.torso.paths.push(
    P(d, [[-8, -6, 0], [8, -6, 0], [9, 17, 0], [-9, 17, 0]], true, style(m.skin, m.ink, 3)), // шея
    P(d, [[-34, 94, 0], [34, 94, 0], [35, 122], [0, 128], [-35, 122]], true, style(m.pants, m.ink, 3)), // джинсы у пояса
    P(d, [[-15, 10, 0], [-33, 15], [-41, 27], [-41, 64], [-39, 103, 0], [0, 107], [39, 103, 0], [41, 64], [41, 27], [33, 15], [15, 10, 0], [0, 20]], true, style(m.shirt, m.ink, 3)),
    P(d, [[-17, 13], [0, 24], [17, 13]], false, line(m.shirtShade, 2.5)), // ворот
    P(d, [[-24, 96], [-14, 99]], false, line(m.shirtShade, 2.5)), // складка
  );

  const H = layers.head.paths;
  H.push(
    P(d, oval(-54, -42, 8, 11), true, style(m.skin, m.ink, 3)), // уши
    P(d, oval(54, -42, 8, 11), true, style(m.skin, m.ink, 3)),
    P(d, [[-55, -48], [-51, -42], [-55, -36]], false, line(m.ink, 2)),
    P(d, [[55, -48], [51, -42], [55, -36]], false, line(m.ink, 2)),
    // голова: широкий лоб, мягкий подбородок
    P(d, [[0, -100], [40, -92], [57, -62], [53, -24], [30, 2], [0, 8], [-30, 2], [-53, -24], [-57, -62], [-40, -92]], true, style(m.skin, m.ink, 3)),
    // волосы: шапочка с волнистой линией лба и бакенбардами
    P(d, [[-55, -46, 0], [-60, -72], [-46, -96], [-18, -107], [14, -107], [44, -97], [60, -73], [55, -46, 0], [50, -62], [40, -76], [21, -82], [3, -78, 0], [-12, -83], [-34, -78], [-49, -63]], true, style(m.hair, m.hairInk, 3)),
    P(d, [[-1, -32], [4, -27], [0, -22]], false, line(m.ink, 2.5)), // нос
  );

  const E = layers.eyes;
  E.paths.push(
    P(d, oval(-15.5, -50, 15.5, 15.5), true, style('#ffffff', m.ink, 3)),
    P(d, oval(15.5, -50, 15.5, 15.5), true, style('#ffffff', m.ink, 3)),
    P(d, oval(-12, -48, 2.6, 2.6), true, style(m.ink, null, 0)),
    P(d, oval(14, -49, 2.6, 2.6), true, style(m.ink, null, 0)),
  );
  E.origin = [0, -50];
  E.lib = 'eyes';
  blinkKeys(E, cx);

  const mouth = mortyMouth(d);
  mouth.bind = b.head.id;
  rig.children.splice(rig.children.indexOf(layers.head) + 1, 0, mouth);
  rig.origin = [0, 212];
  rig.lib = 'char';
  if (o.talk) mortyTalk(res, mouth, animOffset(cx, 48));
  return rig;
}

// «Ой, блин!»: всплёскивает руками, мотает головой и тараторит
function mortyTalk({ bones: b, layers }, mouth, o) {
  keysFrom(o, b.body.ang, [[12, -87], [24, -92], [36, -88], [48, -90]]);
  keysFrom(o, b.head.ang, [[6, -7], [14, 5], [22, -5], [30, 7], [38, -3], [48, 0]]);
  keysFrom(o, b.armR.ang, [[8, 118], [20, 108], [32, 124], [40, 118], [48, 165]]);
  keysFrom(o, b.foreR.ang, [[8, -72], [16, -50], [24, -82], [32, -56], [40, -64], [48, 0]]);
  keysFrom(o, b.armL.ang, [[10, 236], [22, 246], [34, 232], [48, 195]]);
  keysFrom(o, b.foreL.ang, [[10, 66], [22, 80], [34, 58], [48, 0]]);
  const kid = (i) => String(mouth.children[i].id);
  if (o > 0) setKey(mouth.sw, o, kid(0), 'step');
  [[4, 2], [6, 4], [8, 1], [10, 3], [13, 4], [15, 2], [17, 0], [20, 3], [22, 1], [24, 4], [27, 2], [29, 3], [32, 0], [34, 4], [37, 1], [39, 3], [42, 2], [44, 0]]
    .forEach(([f, i]) => setKey(mouth.sw, f + o, kid(i), 'step'));
  layers.eyes.scl.k = [layers.eyes.scl.k[0]];
  keysFrom(o, layers.eyes.scl, [[18, [1, 1]], [20, [1, 0.08]], [22, [1, 1]], [40, [1, 1]], [42, [1, 0.08]], [44, [1, 1]]], 'linear');
  layers.eyes.scl.k[0].i = 'linear';
}

// ---------- каталог ----------
// Поля: id, cat, name, tags, build(doc, cx) → слой (геометрия вокруг 0,0), kind ('char'|'bg'|'part'|'shadow'),
// anim (есть готовая анимация), loop [с, по] — кадры для живой миниатюры, thumbFrame, preview(doc, слой) — только для миниатюры,
// anchor — место на кости головы (0 — основание, 1 — конец), pin — точка части, которая встаёт туда (вместо центра рамки),
// replaces — имя слоя персонажа, который заменяет часть
const CATS = [
  { id: 'chars', name: 'Персонажи' },
  { id: 'nature', name: 'Природа' },
  { id: 'things', name: 'Предметы' },
  { id: 'bg', name: 'Фоны' },
  { id: 'parts', name: 'Части персонажа' },
];
const ITEMS = [];
const item = (o) => ITEMS.push(o);

item({
  id: 'boy', stand: true, cat: 'chars', kind: 'char', name: 'Мальчик', tags: 'мальчик персонаж человек ребенок синий кости скелет герой',
  build: (d, cx) => character(d, cx, { name: 'Мальчик' }),
});
item({
  id: 'girl', stand: true, cat: 'chars', kind: 'char', name: 'Девочка', tags: 'девочка персонаж человек ребенок красный хвостики юбка бантик кости герой',
  build: (d, cx) => character(d, cx, { name: 'Девочка', colors: GIRL, extra: girlExtra }),
});
item({
  id: 'kid-wave', stand: true, cat: 'chars', kind: 'char', name: 'Мальчик машет', tags: 'мальчик в кепке персонаж зеленый кепка машет привет анимация готовая кости',
  anim: true, loop: [1, 48], thumbFrame: 14,
  build: (d, cx) => character(d, cx, { name: 'Мальчик в кепке', colors: GREEN, extra: capExtra, wave: true }),
});
item({
  id: 'morty', stand: true, cat: 'chars', kind: 'char', name: 'Морти', tags: 'морти morty мальчик подросток персонаж желтая футболка джинсы кеды кости скелет моргает рот липсинк',
  build: (d, cx) => morty(d, cx),
});
item({
  id: 'morty-talk', stand: true, cat: 'chars', kind: 'char', name: 'Морти говорит', tags: 'морти morty говорит болтает руки нервничает ой блин анимация готовая кости липсинк',
  anim: true, loop: [1, 48], thumbFrame: 10,
  build: (d, cx) => morty(d, cx, { name: 'Морти', talk: true }),
});

// --- природа ---
item({
  id: 'sun', cat: 'nature', sky: true, name: 'Солнце', tags: 'солнце свет небо день лето лучи',
  build: (d) => vec(d, 'Солнце',
    P(d, star(0, 0, 12, 98, 70), true, style('#ffe58a', null, 0)),
    P(d, oval(0, 0, 56, 56), true, style('#ffd44d', '#f0a623', 4)),
    P(d, oval(-31, 12, 9, 6), true, fillA('#ff8a5c', 0.45)),
    P(d, oval(31, 12, 9, 6), true, fillA('#ff8a5c', 0.45)),
    P(d, oval(-17, -10, 5, 7), true, style('#7a4410', null, 0)),
    P(d, oval(17, -10, 5, 7), true, style('#7a4410', null, 0)),
    P(d, [[-20, 12], [0, 24], [20, 12]], false, line('#7a4410', 4)),
  ),
});
item({
  id: 'cloud', cat: 'nature', sky: true, name: 'Облако', tags: 'облако небо тучка погода',
  build: (d) => vec(d, 'Облако', blob(d, [[-62, 8, 40], [-12, -20, 52], [46, -4, 42], [86, 16, 28], [0, 24, 104, 24]], '#ffffff', '#cfe2f5', 3)),
});
item({
  id: 'tree', stand: true, cat: 'nature', name: 'Дерево', tags: 'дерево лес природа зелень крона ствол',
  build: (d) => pivot(vec(d, 'Дерево',
    P(d, [[-15, 100, 0], [-10, 10, 0], [10, 10, 0], [15, 100, 0]], true, style('#a0693a', '#6e4424', 4)),
    blob(d, [[-48, -40, 44], [0, -80, 56], [48, -40, 44], [0, -26, 50]], '#6cc04a', '#3f8a2c', 3.5),
    P(d, [[-34, -64], [-22, -74], [-8, -70]], false, line('#4fa036', 4)),
    P(d, [[16, -36], [28, -46], [42, -40]], false, line('#4fa036', 4)),
  ), 0, 100),
});
item({
  id: 'fir', stand: true, cat: 'nature', name: 'Ёлка', tags: 'елка ель сосна дерево лес зима новый год хвоя',
  build: (d) => {
    const st = style('#3f9f5a', '#2a6e3e', 4);
    return pivot(vec(d, 'Ёлка',
      P(d, rect(-12, 60, 12, 100), true, style('#8a5a32', '#5e3b1e', 4)),
      P(d, [[-72, 66, 0], [0, -8, 0], [72, 66, 0], [0, 74, 1]], true, st),
      P(d, [[-56, 22, 0], [0, -56, 0], [56, 22, 0], [0, 30, 1]], true, st),
      P(d, [[-40, -24, 0], [0, -100, 0], [40, -24, 0], [0, -17, 1]], true, st),
    ), 0, 100);
  },
});
item({
  id: 'bush', stand: true, cat: 'nature', name: 'Куст', tags: 'куст кустарник ягоды зелень сад',
  build: (d) => pivot(vec(d, 'Куст',
    blob(d, [[-44, 6, 32], [0, -14, 40], [42, 4, 34], [0, 18, 70, 20]], '#5cb84a', '#3d8a30', 3.5),
    P(d, oval(-22, -6, 5, 5), true, style('#ff4d5a', '#c22a38', 1.5)),
    P(d, oval(14, -24, 5, 5), true, style('#ff4d5a', '#c22a38', 1.5)),
    P(d, oval(32, 8, 5, 5), true, style('#ff4d5a', '#c22a38', 1.5)),
  ), 0, 38),
});
item({
  id: 'flower', stand: true, cat: 'nature', name: 'Цветок', tags: 'цветок ромашка растение лепестки сад луг',
  build: (d) => {
    const petals = [];
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      petals.push(P(d, rotOval(Math.cos(a) * 21, -40 + Math.sin(a) * 21, 19, 12.5, a), true, style('#ff7eb6', '#d94f8c', 2.5)));
    }
    return pivot(vec(d, 'Цветок',
      P(d, [[0, 72], [-5, 26], [0, -30]], false, line('#4f9a3a', 5)),
      P(d, [[-3, 40, 0], [-20, 22], [-40, 20, 0], [-24, 40]], true, style('#6cc04a', '#3f8a2c', 2.5)),
      petals,
      P(d, oval(0, -40, 12, 12), true, style('#ffd44d', '#e0a020', 2.5)),
    ), 0, 72);
  },
});
item({
  id: 'grass', stand: true, cat: 'nature', name: 'Трава', tags: 'трава травка газон луг зелень',
  build: (d) => pivot(vec(d, 'Трава',
    P(d, [[-34, 24, 0], [-30, -20, 0], [-18, 6, 0], [-6, -40, 0], [4, 6, 0], [18, -30, 0], [26, 8, 0], [38, -12, 0], [40, 24, 0]], true, style('#5fae45', '#3f8a2c', 3)),
    P(d, [[-50, 26, 0], [-44, -12, 0], [-32, 8, 0], [-20, -32, 0], [-10, 6, 0], [2, -46, 0], [12, 6, 0], [24, -26, 0], [32, 8, 0], [48, -16, 0], [50, 26, 0]], true, style('#7cc95a', '#4f9a3a', 3)),
  ), 0, 26),
});
item({
  id: 'mountain', cat: 'nature', name: 'Гора', tags: 'гора горы вершина снег скалы пейзаж',
  build: (d) => pivot(vec(d, 'Гора',
    P(d, [[20, 90, 0], [120, -30, 0], [220, 90, 0]], true, style('#a9b8d0', '#7f90ad', 4)),
    P(d, [[-170, 90, 0], [-20, -110, 0], [150, 90, 0]], true, style('#8a9bb8', '#5f6f8c', 4)),
    P(d, [[-65, -50, 0], [-20, -110, 0], [31, -50, 0], [12, -38, 0], [-2, -54, 0], [-22, -36, 0], [-44, -54, 0]], true, style('#ffffff', '#c8d4e6', 3)),
  ), 0, 90),
});
item({
  id: 'moon', cat: 'nature', sky: true, name: 'Луна', tags: 'луна месяц ночь небо полумесяц',
  build: (d) => vec(d, 'Луна',
    P(d, crescent(0, 0, 52, 24, -14, 46), true, style('#fff2b0', '#e6c65c', 4)),
  ),
});
item({
  id: 'star', cat: 'nature', name: 'Звезда', tags: 'звезда звездочка ночь небо блеск',
  build: (d) => vec(d, 'Звезда',
    P(d, star(0, 4, 5, 52, 23).map(([x, y], i) => [x, y, i % 2 ? 0 : 0.25]), true, style('#ffd84d', '#e0a020', 4)),
    P(d, rotOval(-14, -10, 7, 4, -0.6), true, fillA('#ffffff', 0.7)),
  ),
});
item({
  id: 'drop', cat: 'nature', name: 'Капля', tags: 'капля вода дождь роса слеза',
  build: (d) => vec(d, 'Капля',
    P(d, [[0, -58, 0], [26, -14], [34, 20], [0, 52], [-34, 20], [-26, -14]], true, style('#5fb3ff', '#2f7fd6', 4)),
    P(d, rotOval(-14, 12, 5, 10, 0.25), true, fillA('#ffffff', 0.75)),
  ),
});

// --- предметы ---
item({
  id: 'ball', cat: 'things', name: 'Мяч', tags: 'мяч игрушка спорт круг прыгать',
  build: (d) => vec(d, 'Мяч',
    P(d, oval(0, 0, 46, 46), true, style('#ff5a5a', null, 0)),
    P(d, [[-43, -16, 0], [0, -5], [43, -16, 0], [45, 8, 0], [0, 19], [-45, 8, 0]], true, style('#ffffff', null, 0)),
    P(d, oval(0, 0, 46, 46), true, line('#c43a3a', 4)),
    P(d, rotOval(-19, -27, 9, 5, -0.6), true, fillA('#ffffff', 0.75)),
  ),
});
item({
  id: 'house', stand: true, cat: 'things', name: 'Дом', tags: 'дом домик здание крыша окно дверь',
  build: (d) => {
    const win = (x0) => [
      P(d, rect(x0, 14, x0 + 30, 44), true, style('#bfe4ff', '#5f7fa0', 3.5)),
      P(d, [[x0 + 15, 14], [x0 + 15, 44]], false, line('#5f7fa0', 3)),
      P(d, [[x0, 29], [x0 + 30, 29]], false, line('#5f7fa0', 3)),
    ];
    return pivot(vec(d, 'Дом',
      P(d, rect(36, -80, 58, -30), true, style('#c0583e', '#8a3524', 3.5)),
      P(d, rect(-72, -12, 72, 92), true, style('#ffe2b0', '#c8955a', 4)),
      P(d, [[-92, -4, 0], [0, -94, 0], [92, -4, 0]], true, style('#e0533d', '#9c3324', 4)),
      P(d, oval(0, -36, 12, 12), true, style('#bfe4ff', '#9c3324', 3)),
      P(d, [[-18, 92, 0], [-18, 48, 0], [0, 32, 1.2], [18, 48, 0], [18, 92, 0]], true, style('#a0663a', '#6e4424', 3.5)),
      P(d, oval(10, 66, 3, 3), true, style('#ffd44d', null, 0)),
      win(-60), win(30),
    ), 0, 92);
  },
});
item({
  id: 'car', stand: true, cat: 'things', name: 'Машина', tags: 'машина автомобиль машинка транспорт колеса ехать',
  build: (d) => {
    const body = vec(d, 'Кузов',
      P(d, [[-114, 34, 0], [-116, 4, 1], [-100, -12, 0], [-62, -14, 0], [-40, -54, 0], [40, -54, 0], [64, -14, 0], [102, -10, 1], [116, 8, 1], [114, 34, 0]], true, style('#ff6b4a', '#b8402a', 4)),
      P(d, [[-52, -16, 0], [-34, -46, 0], [-6, -46, 0], [-6, -16, 0]], true, style('#cfeaff', '#b8402a', 3)),
      P(d, [[6, -16, 0], [6, -46, 0], [34, -46, 0], [52, -16, 0]], true, style('#cfeaff', '#b8402a', 3)),
      P(d, oval(107, 8, 6, 5), true, style('#ffe58a', '#d9a520', 2)),
      P(d, [[-22, 0], [-10, 0]], false, line('#b8402a', 3)),
    );
    const wheel = (name, x) => {
      const L = vec(d, name,
        P(d, oval(x, 34, 22, 22), true, style('#2e2f36', '#17181b', 3)),
        P(d, oval(x, 34, 10, 10), true, style('#c9ced6', '#8a8f99', 2)),
        P(d, [[x - 9, 34], [x + 9, 34]], false, line('#6c737c', 3)),
        P(d, [[x, 25], [x, 43]], false, line('#6c737c', 3)),
      );
      L.origin = [x, 34]; // колесо вращается вокруг своего центра
      return L;
    };
    return pivot(grp(d, 'Машина', body, wheel('Колесо заднее', -64), wheel('Колесо переднее', 64)), 0, 56);
  },
});
item({
  id: 'balloon', cat: 'things', name: 'Воздушный шар', tags: 'воздушный шар шарик праздник день рождения',
  build: (d) => {
    const L = vec(d, 'Воздушный шар',
      P(d, [[0, 50], [-8, 80], [6, 112], [0, 140]], false, line('#7a7a88', 2.5)),
      P(d, [[0, 44, 0], [-8, 57, 0], [8, 57, 0]], true, style('#ff5a7a', '#c0395a', 2.5)),
      P(d, [[0, -64, 1], [44, -24, 1], [32, 22, 1], [0, 48, 0.7], [-32, 22, 1], [-44, -24, 1]], true, style('#ff5a7a', '#c0395a', 4)),
      P(d, rotOval(-18, -28, 7, 13, 0.4), true, fillA('#ffffff', 0.6)),
    );
    L.origin = [0, 140]; // покачивание — от конца ниточки
    return L;
  },
});
item({
  id: 'heart', cat: 'things', name: 'Сердце', tags: 'сердце сердечко любовь валентинка',
  build: (d) => vec(d, 'Сердце',
    P(d, [[0, -24, 0], [24, -50, 1], [52, -38, 1], [52, -6, 1], [0, 50, 0], [-52, -6, 1], [-52, -38, 1], [-24, -50, 1]], true, style('#ff4d6d', '#c22a48', 4)),
    P(d, rotOval(-30, -28, 9, 6, -0.7), true, fillA('#ffffff', 0.6)),
  ),
});
item({
  id: 'gift', stand: true, cat: 'things', name: 'Подарок', tags: 'подарок коробка праздник бант сюрприз',
  build: (d) => {
    const rib = style('#ffd44d', '#d9a520', 3);
    return vec(d, 'Подарок',
      P(d, rect(-50, -8, 50, 62), true, style('#4c9dff', '#2a64b8', 4)),
      P(d, rect(-11, -8, 11, 62), true, rib),
      P(d, rect(-58, -30, 58, -6), true, style('#6fb2ff', '#2a64b8', 4)),
      P(d, rect(-11, -30, 11, -6), true, rib),
      P(d, [[0, -30, 0], [-20, -58, 1], [-42, -50, 1], [-34, -34, 1]], true, rib),
      P(d, [[0, -30, 0], [20, -58, 1], [42, -50, 1], [34, -34, 1]], true, rib),
      P(d, oval(0, -31, 9, 7), true, rib),
    );
  },
});
item({
  id: 'bubble', cat: 'things', name: 'Речевой пузырь', tags: 'речевой пузырь облачко реплика текст диалог комикс говорит',
  build: (d) => {
    const rx = 110, ry = 62, cy = -14, pts = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      pts.push([Math.cos(a) * rx, cy + Math.sin(a) * ry, 1]);
      if (i === 3) pts.push([-47, 42, 0], [-96, 84, 0], [-71, 33, 0]); // хвостик
    }
    return vec(d, 'Речевой пузырь', P(d, pts, true, style('#ffffff', '#2b2b3a', 4)));
  },
});

// --- фоны ---
item({
  id: 'bg-meadow', cat: 'bg', kind: 'bg', name: 'Летний луг', tags: 'фон луг поле лето небо трава холмы день',
  build: (d, cx) => {
    const hw = cx.w / 2, hh = cx.h / 2;
    const marks = [[-0.8, 0.62], [-0.45, 0.82], [-0.1, 0.6], [0.3, 0.86], [0.62, 0.64], [0.88, 0.9]]
      .map(([x, y]) => P(d, [[x * hw - 12, y * hh + 4], [x * hw - 3, y * hh - 9], [x * hw + 7, y * hh + 3]], false, line('#5a9a3e', 4)));
    const flowers = [[-0.62, 0.76, '#ffffff'], [-0.3, 0.92, '#ffd44d'], [0.12, 0.78, '#ff7eb6'], [0.45, 0.72, '#ffffff'], [0.76, 0.8, '#ffd44d']]
      .flatMap(([x, y, c]) => [P(d, oval(x * hw, y * hh, 6, 6), true, style(c, null, 0)), P(d, oval(x * hw, y * hh, 2.2, 2.2), true, style('#ffb13b', null, 0))]);
    return bgGroup(d, cx, 'Фон: летний луг', [
      vec(d, 'Небо', skyRect(d, cx, '#bfe4ff')),
      vec(d, 'Холмы', P(d, hill(cx, hh * 0.12, hh * 0.07, 5, 0.4), true, style('#a8dc86', '#86c466', 4))),
      vec(d, 'Земля', P(d, hill(cx, hh * 0.42, hh * 0.035, 6, 2.1), true, style('#8fd16b', '#5a9a3e', 5)), marks, flowers),
    ], 0.56);
  },
});
item({
  id: 'bg-night', cat: 'bg', kind: 'bg', name: 'Ночь со звёздами', tags: 'фон ночь звезды луна небо темно вечер',
  anim: true, loop: [1, 48],
  build: (d, cx) => {
    const hw = cx.w / 2, hh = cx.h / 2, r = rng(7);
    const calm = [], twinkle = [];
    for (let i = 0; i < 30; i++) {
      const x = (r() * 2 - 1) * hw, y = -hh + r() * hh * 1.25;
      const big = i < 10, s = big ? 6 + r() * 4 : 1.8 + r() * 1.2;
      const p = big ? P(d, star(x, y, 4, s, s * 0.38), true, style('#fff3b8', null, 0)) : P(d, oval(x, y, s, s), true, fillA('#ffffff', 0.85));
      (i % 3 === 0 ? twinkle : calm).push(p);
    }
    const tw = vec(d, 'Звёзды (мерцают)', twinkle);
    for (let f = cx.start + 6, on = false; f <= cx.end; f += 12, on = !on) setKey(tw.op, f, on ? 1 : 0.3, 'smooth');
    const mx = hw * 0.6, my = -hh * 0.55;
    return bgGroup(d, cx, 'Фон: ночь со звёздами', [
      vec(d, 'Небо', skyRect(d, cx, '#14204a')),
      vec(d, 'Звёзды', calm),
      tw,
      vec(d, 'Луна',
        P(d, oval(mx, my, 84, 84), true, fillA('#fff0b4', 0.06)),
        P(d, oval(mx, my, 62, 62), true, fillA('#fff0b4', 0.08)),
        P(d, crescent(mx, my, 44, 20, -12, 39), true, style('#fff2b0', '#e6c65c', 3.5)),
      ),
      vec(d, 'Холмы вдали', P(d, hill(cx, hh * 0.38, hh * 0.07, 4, 0.8), true, style('#22325c', '#1a2850', 3))),
      vec(d, 'Холмы', P(d, hill(cx, hh * 0.6, hh * 0.05, 5, 2.4), true, style('#16223f', '#0f1830', 3))),
    ], 0.68);
  },
});
item({
  id: 'bg-sea', cat: 'bg', kind: 'bg', name: 'Море', tags: 'фон море океан пляж песок волны вода лето',
  build: (d, cx) => {
    const hw = cx.w / 2, hh = cx.h / 2, W = hw + BLEED, H = hh + BLEED, hy = -hh * 0.02, sx = hw * 0.42;
    const waves = [[-0.75, 0.12], [-0.35, 0.26], [0.12, 0.16], [0.7, 0.3], [-0.6, 0.42], [0.28, 0.44], [-0.08, 0.34], [0.86, 0.12]]
      .map(([x, y]) => { const X = x * hw, Y = y * hh; return P(d, [[X - 24, Y], [X - 12, Y - 6], [X, Y], [X + 12, Y - 6], [X + 24, Y]], false, line('#bfe6ff', 4)); });
    const glints = [[0, 18, 46], [8, 34, 32], [-6, 50, 20]].map(([dx, dy, l]) => P(d, [[sx + dx - l, hy + dy, 0], [sx + dx + l, hy + dy, 0]], false, line('#ffe9a8', 5)));
    const bird = (x, y) => P(d, [[x - 14, y + 3, 0], [x - 7, y - 4], [x, y, 0], [x + 7, y - 4], [x + 14, y + 3, 0]], false, line('#3b4a6b', 3));
    return bgGroup(d, cx, 'Фон: море', [
      vec(d, 'Небо', skyRect(d, cx, '#a8dcff'), bird(-hw * 0.5, -hh * 0.55), bird(-hw * 0.38, -hh * 0.64)),
      vec(d, 'Солнце', P(d, oval(sx, hy, 70, 70), true, style('#ffe08a', '#ffc94d', 4))),
      vec(d, 'Море', P(d, rect(-W, hy, W, H), true, style('#3d9be0', null, 0)), P(d, rect(-W, hy, W, hy + hh * 0.06), true, style('#3489d0', null, 0)), glints, waves),
      vec(d, 'Песок', P(d, hill(cx, hh * 0.6, hh * 0.03, 4, 1.3), true, style('#f3d99a', '#d9b86a', 4))),
    ], 0.75);
  },
});

// --- части персонажа ---
item({
  id: 'mouth', cat: 'parts', kind: 'part', name: 'Рот для липсинка', tags: 'рот губы липсинк говорить речь голос звук переключатель',
  anchor: 0.4, pin: [0, 0], replaces: 'Рот', anim: true, loop: [1, 24], thumbFrame: 13,
  build: (d) => {
    const lip = '#5a1a22', ins = '#7a2230', tongue = '#ff7a8a';
    const sw = newLayer(d, 'switch', 'Рот (липсинк)');
    const shapes = [
      vec(d, 'Рот 1 — закрыт', P(d, [[-14, -2], [0, 4], [14, -2]], false, line('#8d5a3b', 3.5))),
      vec(d, 'Рот 2 — чуть открыт', P(d, [[-13, -2, 0], [0, -0.5], [13, -2, 0], [7, 3.5], [0, 5.5], [-7, 3.5]], true, style(ins, lip, 2.5))),
      vec(d, 'Рот 3 — открыт',
        P(d, [[-14, -4, 0], [0, -2], [14, -4, 0], [9, 6.5], [0, 11], [-9, 6.5]], true, style(ins, lip, 2.5)),
        P(d, oval(0, 7, 6, 2.6), true, style(tongue, null, 0))),
      vec(d, 'Рот 4 — широко',
        P(d, [[-16, -6, 0], [0, -3], [16, -6, 0], [11, 9], [0, 16], [-11, 9]], true, style(ins, lip, 2.5)),
        P(d, [[-10, -4.5, 0], [10, -4.5, 0], [8, -1, 0], [-8, -1, 0]], true, style('#ffffff', null, 0)),
        P(d, oval(0, 11, 7, 3.4), true, style(tongue, null, 0))),
      vec(d, 'Рот 5 — очень широко',
        P(d, [[-17, -8, 0], [0, -5], [17, -8, 0], [13, 12], [0, 22], [-13, 12]], true, style(ins, lip, 2.5)),
        P(d, [[-11, -6.5, 0], [11, -6.5, 0], [9, -2.5, 0], [-9, -2.5, 0]], true, style('#ffffff', null, 0)),
        P(d, oval(0, 15, 8, 4.5), true, style(tongue, null, 0))),
    ];
    sw.children.push(...shapes); // снизу вверх: закрыт → широко открыт (так работает «Липсинк по звуку»)
    sw.sw.k[0].v = String(shapes[0].id);
    sw.lib = 'mouth';
    return sw;
  },
  preview: (d, L) => { [0, 2, 4, 1, 3, 2, 4, 0].forEach((lvl, i) => setKey(L.sw, 1 + i * 3, String(L.children[lvl].id), 'step')); },
});
item({
  id: 'eyes', cat: 'parts', kind: 'part', name: 'Глаза с морганием', tags: 'глаза моргание моргать взгляд лицо',
  anchor: 0.69, pin: [0, 0], replaces: 'Глаза', anim: true, loop: [1, 72],
  build: (d, cx) => {
    const L = vec(d, 'Глаза (моргают)',
      P(d, oval(-14, 0, 9, 11), true, style('#ffffff', '#2b2b3a', 2.5)),
      P(d, oval(14, 0, 9, 11), true, style('#ffffff', '#2b2b3a', 2.5)),
      P(d, oval(-12.5, 1.5, 4.8, 5.8), true, style('#1d1d24', null, 0)),
      P(d, oval(15.5, 1.5, 4.8, 5.8), true, style('#1d1d24', null, 0)),
      P(d, oval(-11, -1, 1.7, 1.7), true, style('#ffffff', null, 0)),
      P(d, oval(17, -1, 1.7, 1.7), true, style('#ffffff', null, 0)),
    );
    L.lib = 'eyes';
    blinkKeys(L, cx);
    return L;
  },
});
item({
  id: 'shadow', cat: 'parts', kind: 'shadow', name: 'Тень под ногами', tags: 'тень пятно земля под ногами',
  build: (d) => {
    const L = vec(d, 'Тень', P(d, oval(0, 0, 80, 13), true, { ...style('#000000', null, 0), fill: [20, 40, 20, 0.22] }));
    L.blur = 4;
    return L;
  },
});

const byId = new Map(ITEMS.map((it) => [it.id, it]));

// ---------- вставка в документ ----------
const CAM0 = newDoc().cam;
const ctxOf = (d) => ({ w: d.w, h: d.h, fps: d.fps, start: d.start, end: d.end, frame: d === app.doc ? app.frame : 0 });

function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return pts.length ? [x0, y0, x1, y1] : [0, 0, 0, 0];
}
// Рамка содержимого слоя в координатах его родителя (слой вычисляется отдельно, на кадре 0)
const contentBox = (L) => bbox(layerWorldPoints(evaluate({ cam: CAM0, layers: [L] }, 0), L));
const mid = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
// Поставить центр содержимого слоя (или его точку pin) в точку (x, y) координат родителя — без ключей анимации
function placeAt(L, x, y, pin = null) {
  const c = pin || mid(contentBox(L));
  L.pos.k[0].v = [L.pos.k[0].v[0] + x - c[0], L.pos.k[0].v[1] + y - c[1]];
}

function viewCenter() {
  const el = app.viewEl;
  return el ? app.toDoc(el.clientWidth / 2, el.clientHeight / 2) : [0, 0];
}
// Видимая часть кадра в координатах документа (экран ∩ рамка кадра; если они не пересекаются — экран)
function viewRect() {
  const d = app.doc, F = [-d.w / 2, -d.h / 2, d.w / 2, d.h / 2], el = app.viewEl;
  if (!el || !el.clientWidth) return F;
  const a = app.toDoc(0, 0), c = app.toDoc(el.clientWidth, el.clientHeight);
  const V = [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[0], c[0]), Math.max(a[1], c[1])];
  const I = [Math.max(V[0], F[0]), Math.max(V[1], F[1]), Math.min(V[2], F[2]), Math.min(V[3], F[3])];
  return I[2] - I[0] > 40 && I[3] - I[1] > 40 ? I : V;
}
// Рамки объектов сцены (слоёв верхнего уровня) на текущем кадре — кроме фонов и того, что занимает почти весь кадр
function obstacles(skip) {
  const S = app.scene(), d = app.doc, A = d.w * d.h, out = [];
  for (const X of d.layers) {
    if (X === skip || X.lib === 'bg' || !X.vis || X.type === 'audio') continue;
    const pts = layerWorldPoints(S, X);
    if (!pts.length) continue;
    const b = bbox(pts);
    if ((b[2] - b[0]) * (b[3] - b[1]) > A * 0.45) continue;
    out.push({ b, stand: X.lib === 'char' || !!X.libStand });
  }
  return out;
}
const overlap = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

// Свободное место для нового объекта L: центр его содержимого рядом с p, без наложения на другие объекты,
// в видимой части кадра. ground — линия земли (низ объекта встаёт на неё; ищем место только вбок).
// Если свободного места нет — наименьшее наложение, а при полном — лесенка от p (не ровно поверх).
function findSpot(L, p, { ground = null, stand = false } = {}) {
  const b = contentBox(L), w = Math.max(1, b[2] - b[0]), hgt = Math.max(1, b[3] - b[1]);
  const R = viewRect(), m = app.pxToDoc(12);
  const obs = obstacles(L), gap = app.pxToDoc(6);
  const q = [p[0], ground != null ? ground - hgt / 2 : p[1]];
  const span = (lo, hi, size, c, step, fixed) => {
    if (fixed) return [c];
    const a = lo + m + size / 2, z = hi - m - size / 2;
    if (a > z) return [(lo + hi) / 2];
    const cc = Math.min(z, Math.max(a, c)), out = [cc];
    for (let k = 1; k < 200; k++) {
      const u = cc - k * step, v = cc + k * step;
      if (u < a && v > z) break;
      if (u >= a) out.push(u);
      if (v <= z) out.push(v);
    }
    return out;
  };
  const step = Math.max(app.pxToDoc(10), Math.min(w, hgt) * 0.2);
  const xs = span(R[0], R[2], w, q[0], step, false), ys = span(R[1], R[3], hgt, q[1], step, ground != null);
  const RW = R[2] - R[0], RH = R[3] - R[1], area = w * hgt;
  let best = null;
  for (const x of xs) for (const y of ys) {
    const c = [x - w / 2 - gap, y - hgt / 2 - gap, x + w / 2 + gap, y + hgt / 2 + gap];
    let ov = 0;
    for (const o of obs) ov += overlap(c, o.b);
    // ближе к желаемой точке; стоящие на земле предпочитают сдвиг вбок, а не вверх-вниз
    const sc = (ov / area) * 10 + Math.hypot((x - q[0]) / RW, ((y - q[1]) / RH) * (stand ? 3 : 1));
    if (!best || sc < best.sc) best = { x, y, sc, ov: ov / area };
  }
  let r = best ? [best.x, best.y] : q;
  if (best && best.ov > 0.9) {
    // всё занято — хотя бы не ровно поверх: лесенкой от желаемой точки
    const tol = app.pxToDoc(3), d = app.pxToDoc(28), centers = obs.map((o) => mid(o.b));
    r = q;
    for (let n = 1; n <= 12 && centers.some((c) => Math.abs(c[0] - r[0]) < tol && Math.abs(c[1] - r[1]) < tol); n++) r = [q[0] + d * n, q[1] + (ground != null ? 0 : d * 0.6 * n)];
  }
  return r;
}
// Высота земли фона из библиотеки под точкой p (если земля видна в нижней части экрана), иначе null
function groundAt(p) {
  const G = app.doc.layers.find((X) => X.lib === 'bg' && typeof X.libGround === 'number' && X.vis);
  const rec = G && app.scene().layers.get(G.id);
  if (!rec || !app.viewEl) return null;
  const l = M.apply(M.inv(rec.world), p[0], p[1]);
  const q = M.apply(rec.world, l[0], G.libGround);
  const sy = app.toScreen(q[0], q[1])[1], H = app.viewEl.clientHeight;
  return Number.isFinite(q[1]) && sy > H * 0.35 && sy < H * 0.98 ? q[1] : null;
}
// Линия, на которую ставить стоящие объекты: земля фона из библиотеки, а без него — низ уже стоящих персонажей и предметов
function standLine(p) {
  const g = groundAt(p);
  if (g != null) return g;
  const R = viewRect(), feet = obstacles(null).filter((o) => o.stand && o.b[3] > R[1] && o.b[3] < R[3] + app.pxToDoc(4)).map((o) => o.b[3]);
  return feet.length ? Math.max(...feet) : null;
}
function topAncestor(L) {
  let T = L;
  while (T && app.idx.parent.get(T.id)) T = app.idx.parent.get(T.id);
  return T || null;
}
function uniqueName(base) {
  const names = new Set(app.idx.list.map((X) => X.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(base + ' ' + n)) n++;
  return base + ' ' + n;
}

const HEAD = /голов|head/i;
// Персонажи документа — видимые слои костей, в которых есть кости
const rigs = () => app.idx.list.filter((X) => X.type === 'bone' && X.bones && X.bones.length && X.vis);
// Персонаж для частей: выбранный, а если не выбран никакой — единственный в проекте
function partRig() {
  const A = app.active && app.boneLayerFor(app.active);
  if (A && A.bones.length) return { B: A, auto: false };
  const all = rigs();
  return all.length === 1 ? { B: all[0], auto: true } : { B: null, many: all.length > 1 };
}
// Ближайшая к точке документа кость персонажа B; near — точка рядом с персонажем
function nearBone(B, p) {
  const rec = app.scene().layers.get(B.id);
  if (!rec || !rec.bc) return null;
  let best = null, bd = Infinity;
  for (const b of B.bones) {
    const m = rec.bc.Mt.get(b.id);
    if (!m) continue;
    const W = M.mul(rec.bc.world, m);
    const o = M.apply(W, 0, 0), t = M.apply(W, b.len, 0);
    const dd = distToSeg(p[0], p[1], o[0], o[1], t[0], t[1]).d;
    if (dd < bd) { bd = dd; best = b; }
  }
  if (!best) return null;
  const lim = 140 * (M.scaleFactor(rec.bc.world) || 1);
  return { B, bone: best, near: bd <= lim, r: bd / lim, local: M.apply(M.inv(M.mul(rec.bc.world, rec.bc.D.get(best.id))), p[0], p[1]) };
}

// Куда прикрепить часть персонажа: слой костей и кость (голова или ближайшая к точке броска)
function partTarget(it, at) {
  const pr = partRig();
  if (at) {
    // бросили на холст — к тому персонажу, на которого бросили (выбранный — при равенстве)
    let best = null, bs = Infinity;
    for (const B of rigs()) {
      const n = nearBone(B, at), sc = n ? n.r - (B === pr.B ? 0.05 : 0) : Infinity;
      if (n && n.near && sc < bs) { best = n; bs = sc; }
    }
    if (best) return best;
    return pr.B ? { B: pr.B, far: true } : pr.many ? { many: true } : null; // далеко от персонажа — отдельный объект
  }
  const B = pr.B;
  if (!B) return pr.many ? { many: true } : null;
  const rec = app.scene().layers.get(B.id);
  if (!rec || !rec.bc) return null;
  const head = B.bones.find((b) => HEAD.test(b.name));
  if (head && rec.bc.M0.get(head.id)) {
    // поза покоя: точка на кости головы
    return { B, bone: head, auto: pr.auto, local: M.apply(rec.bc.M0.get(head.id), head.len * (it.anchor || 0.5), 0) };
  }
  const n = nearBone(B, viewCenter());
  return n && n.near ? { ...n, auto: pr.auto } : { B, far: true };
}

let ownCommit = false;
function libCommit(label) { ownCommit = true; try { app.commit(label); } finally { ownCommit = false; } }

// Только что добавленный объект: первое перетаскивание инструментом «Трансформировать слой»
// переставляет его без анимации и на кадре дальше первого (на первом кадре сцены так делает сам инструмент —
// см. placeFrame; здесь то же правило продлено на объект, который добавили посреди анимации)
let placing = null;
app.on('commit', () => { if (!ownCommit) placing = null; });
app.on('docloaded', () => { placing = null; });

// at — точка документа (бросок на холст) или null (центр видимой области)
function insertItem(it, at = null) {
  const doc = app.doc;
  if (!it || !doc) return null;
  if (app.playing) app.emit('stop');
  let L;
  try { L = it.build(doc, ctxOf(doc)); } catch (e) { console.error('Библиотека:', it.id, e); app.toast('Не удалось добавить «' + it.name + '»'); return null; }
  let msg, tool = 'ltransform';
  if (it.kind === 'bg') {
    // фон всегда в самом низу; прежний фон из библиотеки заменяется
    const had = doc.layers.some((X) => X.lib === 'bg');
    const T = topAncestor(app.active), inOld = !!(T && T.lib === 'bg');
    doc.layers = doc.layers.filter((X) => X.lib !== 'bg');
    fitBg(L, doc);
    doc.layers.unshift(L);
    app.restructure();
    // активный слой не меняем: заблокированная группа фона мешала бы рисовать
    if (inOld || app.activeId == null || !app.idx.layers.has(app.activeId)) {
      const top = doc.layers.filter((X) => X !== L && !X.lock && X.vis && X.type !== 'audio').reverse();
      app.setActive((top.find((X) => X.type === 'vector') || top[0] || L).id);
    }
    tool = null;
    msg = (had ? 'Фон заменён: ' : 'Фон добавлен: ') + it.name + '. Он в самом низу списка слоёв и заблокирован от случайных правок (значок замка).';
  } else {
    L.name = uniqueName(L.name);
    let tgt = it.kind === 'part' ? partTarget(it, at) : null;
    const far = tgt && tgt.far ? tgt.B : null, many = !!(tgt && tgt.many);
    if (far || many) tgt = null;
    if (tgt) {
      placeAt(L, tgt.local[0], tgt.local[1], it.pin);
      L.bind = tgt.bone.id;
      const kids = tgt.B.children;
      const hide = kids.filter((X) => X.vis && (X.name === it.replaces || (X.lib && X.lib === L.lib)));
      for (const X of hide) X.vis = false;
      // над заменённым слоем или над верхним слоем той же кости (ближняя рука остаётся впереди лица)
      let j = -1;
      kids.forEach((X, i) => { if (hide.includes(X) || X.bind === tgt.bone.id) j = i; });
      kids.splice(j >= 0 ? j + 1 : kids.length, 0, L);
      tgt.B.open = true;
      msg = `«${it.name}» — прикреплено к персонажу «${tgt.B.name}» (кость «${tgt.bone.name}»)` + (hide.length ? `. Прежний слой «${hide[0].name}» скрыт` : '');
    } else {
      const T = topAncestor(app.active);
      let i = T ? doc.layers.indexOf(T) + 1 : doc.layers.length;
      let p = at;
      const tb = it.kind === 'shadow' && T && T.lib !== 'bg' ? bbox(layerWorldPoints(app.scene(), T)) : null;
      if (tb && tb[2] > tb[0] && (T.type === 'bone' || (tb[2] - tb[0]) * (tb[3] - tb[1]) < doc.w * doc.h * 0.3)) {
        // тень — под выбранным персонажем или предметом, у его нижнего края (не под землёй или фоном)
        i = doc.layers.indexOf(T);
        if (!p) p = [(tb[0] + tb[2]) / 2, tb[3] - 6];
        msg = `Добавлено: Тень — под «${T.name}»`;
      }
      if (!p) {
        // персонажи, деревья, дом… встают на землю фона из библиотеки (или рядом с уже стоящими), солнце и облака — в небо,
        // остальное — к центру экрана; всё — на свободное место, не поверх других объектов
        let c = viewCenter();
        if (it.sky) { const R = viewRect(), b = contentBox(L); c = [c[0], R[1] + app.pxToDoc(12) + (b[3] - b[1]) / 2 + (R[3] - R[1]) * 0.04]; }
        p = findSpot(L, c, { ground: it.stand ? standLine(c) : null, stand: !!it.stand });
      }
      if (it.stand) L.libStand = true;
      placeAt(L, p[0], p[1], at ? it.pin : null);
      doc.layers.splice(i, 0, L);
      if (it.kind === 'char') {
        tool = 'bmanip';
        // готовая анимация длиннее сцены — сцену удлиняем, чтобы движение не обрывалось
        const last = it.anim ? Math.max(0, ...app.allKeyFrames(L)) : 0;
        const longer = last > doc.end;
        if (longer) doc.end = last;
        msg = it.anim ? `Добавлено: ${it.name} — с готовой анимацией` + (longer ? ` (сцена удлинена до ${last} кадров)` : '') + '. Нажмите Пробел, чтобы посмотреть'
          : `Добавлено: ${it.name}. Тяните руки, ноги и голову — инструмент «Управление костями» (Z)`;
      } else if (it.kind === 'part') {
        msg = far ? `Добавлено: ${it.name} — отдельно, далеко от «${far.name}». Чтобы прикрепить, перетащите карточку прямо на лицо персонажа`
          : many ? `Добавлено: ${it.name} — отдельно. В проекте несколько персонажей: выберите нужного в списке слоёв или перетащите карточку прямо на его лицо`
            : `Добавлено: ${it.name} — отдельно: в проекте нет персонажа на костях. Добавьте персонажа (раздел «Персонажи»), затем снова эту часть`;
      }
    }
    msg = msg || `Добавлено: ${it.name}. Тяните объект мышью, чтобы поставить на место`;
    app.restructure();
    app.setActive(L.id);
  }
  app.clearSel();
  app.fixTool();
  if (tool && app.tool !== tool) setTool(tool);
  libCommit('Библиотека: ' + it.name);
  placing = it.kind === 'bg' ? null : { L };
  app.toast(msg, 3600);
  return L;
}

registerViewportHandler({
  down(e) {
    const p = placing, L = app.active;
    if (!p || !L || L !== p.L || app.tool !== 'ltransform' || app.frame === 0 || L.lock) return false;
    if (L.pos.k.length > 1) { placing = null; return false; } // положение уже анимировано — не вмешиваемся
    if (placeFrame(L) === 0) return false; // на первом кадре сцены расстановку без ключа делает сам инструмент
    const bb = layerBox(L);
    if (!bb) return false;
    const c = [[bb.x0, bb.y0], [bb.x1, bb.y0], [bb.x1, bb.y1], [bb.x0, bb.y1]].map(([x, y]) => bb.toS(x, y));
    if (!pointInPoly(e.sx, e.sy, c)) return false;
    // у ручек масштаба (как в инструменте — 7 пикселей) работает сам инструмент
    const mids = c.map((q, i) => { const r = c[(i + 1) % 4]; return [(q[0] + r[0]) / 2, (q[1] + r[1]) / 2]; });
    if ([...c, ...mids].some(([x, y]) => Math.hypot(x - e.sx, y - e.sy) <= 7)) return false;
    const rec = app.scene().layers.get(L.id);
    p.Pi = M.inv(M.mul(rec.world, M.inv(rec.local)));
    p.a = M.apply(p.Pi, e.x, e.y);
    p.pos0 = L.pos.k[0].v.slice();
    p.s = [e.sx, e.sy];
    p.moved = false;
    return true;
  },
  move(e) {
    const p = placing;
    if (!p || !p.a) return;
    if (!p.moved && Math.hypot(e.sx - p.s[0], e.sy - p.s[1]) < 2) return;
    p.moved = true;
    const c = M.apply(p.Pi, e.x, e.y);
    let dx = c[0] - p.a[0], dy = c[1] - p.a[1];
    if (e.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    p.L.pos.k[0].v = [p.pos0[0] + dx, p.pos0[1] + dy];
    app.changed();
  },
  up() {
    const p = placing;
    if (!p || !p.a) return;
    p.a = null;
    if (!p.moved) return;
    placing = null;
    libCommit('Расстановка слоя');
    app.toast('Объект переставлен (это не ключ анимации). Следующее перемещение на этом кадре уже создаст ключ — так объект и оживает.', 4600);
  },
});

// ---------- миниатюры ----------
const TW = 168, TH = 112; // пиксели холста миниатюры (вдвое больше CSS-размера)
const thumbR = new Renderer();
const tcache = new Map();

function thumbData(it) {
  const key = it.kind === 'bg' ? app.doc.w + 'x' + app.doc.h : '';
  let t = tcache.get(it.id);
  if (t && t.key === key) return t;
  const d = newDoc();
  d.nid = 1e9; // id не пересекаются с документом (кэш весов костей общий для всех сцен)
  if (it.kind === 'bg') { d.w = app.doc.w; d.h = app.doc.h; }
  const L = it.build(d, ctxOf(d));
  if (it.preview) it.preview(d, L);
  d.layers.push(L);
  const box = it.kind === 'bg' ? [-d.w / 2, -d.h / 2, d.w / 2, d.h / 2] : bbox(layerWorldPoints(evaluate(d, 0), L));
  t = { d, box, key };
  tcache.set(it.id, t);
  return t;
}

function drawThumb(cv, it, f) {
  const t = thumbData(it);
  const ctx = cv.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, cv.width, cv.height);
  const [x0, y0, x1, y1] = t.box, bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
  const s = it.kind === 'bg' ? Math.max(cv.width / bw, cv.height / bh) : Math.min((cv.width * 0.8) / bw, (cv.height * 0.8) / bh, 4);
  ctx.setTransform(s, 0, 0, s, cv.width / 2 - (s * (x0 + x1)) / 2, cv.height / 2 - (s * (y0 + y1)) / 2);
  thumbR.drawLayers(ctx, t.d.layers, evaluate(t.d, f), { images: app.images, px: s });
}

// Живая миниатюра: анимация проигрывается при наведении
let hoverAnim = null;
function startAnim(c) {
  stopAnim();
  const [a, b] = c.it.loop || [1, 48];
  const t0 = performance.now();
  const loop = (now) => {
    if (!hoverAnim || hoverAnim.c !== c) return;
    if (!c.btn.offsetParent) { stopAnim(); return; } // вкладку скрыли, а курсор не ушёл
    try { drawThumb(c.cv, c.it, a + (Math.floor(((now - t0) / 1000) * 24) % (b - a + 1))); } catch (e) { console.error(e); return; }
    hoverAnim.raf = requestAnimationFrame(loop);
  };
  hoverAnim = { c, raf: requestAnimationFrame(loop) };
}
function stopAnim() {
  if (!hoverAnim) return;
  cancelAnimationFrame(hoverAnim.raf);
  const { c } = hoverAnim;
  hoverAnim = null;
  drawCard(c);
}

function drawCard(c) {
  try { drawThumb(c.cv, c.it, c.it.thumbFrame || 0); } catch (e) { console.error('Миниатюра', c.it.id, e); }
}
const queue = [];
let pumping = false;
function pump() {
  if (pumping) return;
  pumping = true;
  const step = () => {
    const t0 = performance.now();
    while (queue.length && performance.now() - t0 < 12) drawCard(queue.shift());
    if (queue.length) requestAnimationFrame(step); else pumping = false;
  };
  requestAnimationFrame(step);
}

// ---------- вкладка «Библиотека» ----------
const DND = 'application/x-anim2d-library';
const LS = 'anim2d.library.cat', LS_HINT = 'anim2d.library.hint';
const norm = (s) => s.toLowerCase().replace(/ё/g, 'е');
let ui = null;

function flash(el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }

function mount(el) {
  let cat = 'all';
  try { const v = localStorage.getItem(LS); if (v && (v === 'all' || CATS.some((c) => c.id === v))) cat = v; } catch (e) { /* нет доступа */ }
  const q = h('input', {
    class: 'txt lib-q', type: 'search', placeholder: 'Найти: луна…', title: 'Поиск по библиотеке: дерево, машина, луна…', 'aria-label': 'Поиск в библиотеке',
    oninput: () => filter(),
    onkeydown: (e) => { if (e.key === 'Escape' && q.value) { q.value = ''; filter(); e.preventDefault(); } e.stopPropagation(); },
  });
  // разделы — компактный список в одной строке с поиском (на невысоком экране карточкам нужно место)
  const sel = h('select', {
    class: 'lib-catsel', 'aria-label': 'Раздел библиотеки', title: 'Раздел библиотеки',
    onchange: () => { cat = sel.value; try { localStorage.setItem(LS, cat); } catch (e) { /* нет доступа */ } filter(); el.scrollTop = 0; },
  }, [{ id: 'all', name: 'Все' }, ...CATS].map((c) => h('option', { value: c.id, selected: c.id === cat }, c.name)));
  // подсказка — один раз, пока её не закрыли (и только если по высоте есть место)
  let hint = null;
  let hintOff = false;
  try { hintOff = localStorage.getItem(LS_HINT) === '1'; } catch (e) { /* нет доступа */ }
  if (!hintOff) {
    hint = h('div', { class: 'lib-hint' },
      h('span', null, 'Нажмите на карточку — объект появится на холсте. Или перетащите её прямо в нужное место.'),
      h('button', { class: 'lib-hint-x', title: 'Понятно, скрыть', 'aria-label': 'Скрыть подсказку', onclick: () => { hint.remove(); try { localStorage.setItem(LS_HINT, '1'); } catch (e) { /* нет доступа */ } } }, icon('lib-x', 11)));
  }
  const partsNote = h('div', { class: 'lib-note' });
  const empty = h('div', { class: 'lib-empty', hidden: true }, 'Ничего не найдено. Попробуйте другое слово или раздел «Все».');
  const cards = [], sections = [];
  const list = h('div', { class: 'lib-list' });
  for (const c of CATS) {
    const grid = h('div', { class: 'lib-grid' });
    const secCards = [];
    for (const it of ITEMS.filter((x) => x.cat === c.id)) {
      const cv = h('canvas', { class: 'lib-thumb', width: TW, height: TH, 'aria-hidden': 'true' });
      const tip = it.kind === 'bg' ? 'Нажмите — фон на весь кадр (встанет в самый низ)'
        : it.kind === 'part' ? 'Нажмите — прикрепить к голове персонажа (выбранного или единственного). Или перетащите прямо на лицо'
          : it.stand ? 'Нажмите — добавить на свободное место (на фоне из библиотеки встанет на землю). Или перетащите в нужное место'
            : 'Нажмите — добавить на свободное место холста. Или перетащите в нужное место';
      const btn = h('button', { class: 'lib-card', draggable: 'true', title: it.name + '\n' + tip + (it.anim ? '\nС готовой анимацией — наведите, чтобы посмотреть' : ''), 'data-item': it.id },
        cv, h('span', { class: 'lib-name' }, it.name),
        it.anim ? h('span', { class: 'lib-badge', title: 'С готовой анимацией' }, icon('play', 9)) : null,
        h('span', { class: 'lib-plus', 'aria-hidden': 'true' }, icon('plus', 12)));
      const card = { it, cv, btn, hay: norm([it.name, it.tags, c.name].join(' ')) };
      btn.addEventListener('click', () => { if (insertItem(it)) flash(btn); });
      btn.addEventListener('dragstart', (e) => {
        stopAnim();
        e.dataTransfer.setData(DND, it.id);
        e.dataTransfer.effectAllowed = 'copy';
        try { e.dataTransfer.setDragImage(cv, cv.clientWidth / 2, cv.clientHeight / 2); } catch (er) { /* нет поддержки */ }
      });
      btn.addEventListener('dragend', () => { if (app.viewEl) app.viewEl.classList.remove('lib-drop'); });
      if (it.anim) {
        btn.addEventListener('pointerenter', () => startAnim(card));
        btn.addEventListener('pointerleave', () => { if (hoverAnim && hoverAnim.c === card) stopAnim(); });
      }
      cards.push(card);
      secCards.push(card);
      grid.append(btn);
      queue.push(card);
    }
    const secEl = h('section', { class: 'lib-cat' }, h('div', { class: 'insp-title' }, c.name), c.id === 'parts' ? partsNote : null, grid);
    sections.push({ el: secEl, cards: secCards });
    list.append(secEl);
  }
  el.classList.add('lib-tab');
  el.append(
    h('div', { class: 'lib-top' }, h('div', { class: 'lib-qwrap' }, icon('lib-search', 14, 'lib-qic'), q), sel),
    hint, list, empty,
  );
  // подсказка видна, только когда вкладка достаточно высокая: на невысоком экране место — карточкам
  if (hint && typeof ResizeObserver === 'function') {
    const fit = () => { if (el.clientHeight) hint.hidden = el.clientHeight < 480; };
    new ResizeObserver(fit).observe(el);
    fit();
  }
  function filter() {
    stopAnim();
    const words = norm(q.value.trim()).split(/\s+/).filter(Boolean);
    let any = false;
    for (const s of sections) {
      let n = 0;
      for (const c of s.cards) {
        const ok = (cat === 'all' || cat === c.it.cat) && words.every((w) => c.hay.includes(w));
        c.btn.hidden = !ok;
        if (ok) n++;
      }
      s.el.hidden = !n;
      any = any || n > 0;
    }
    empty.hidden = any;
    if (sel.value !== cat) sel.value = cat;
    sel.classList.toggle('on', cat !== 'all');
  }
  ui = { cards, partsNote, bgKey: app.doc.w + 'x' + app.doc.h, q, filter };
  filter();
  pump();
}

function refresh() {
  if (!ui || !app.doc) return;
  const key = app.doc.w + 'x' + app.doc.h;
  if (key !== ui.bgKey) {
    ui.bgKey = key;
    for (const c of ui.cards) if (c.it.kind === 'bg') queue.push(c);
    pump();
  }
  const { B, many } = partRig();
  const sig = B ? B.id + '|' + B.name : many ? 'many' : '';
  if (ui.noteSig === sig) return;
  ui.noteSig = sig;
  ui.partsNote.replaceChildren(...(B
    ? [h('span', null, 'Прикрепятся к персонажу «'), h('b', null, B.name), h('span', null, B.bones.some((b) => HEAD.test(b.name)) ? '» — к голове и будут двигаться вместе с ней.' : '».')]
    : [many ? 'Выберите персонажа в списке слоёв (или перетащите карточку прямо на его лицо) — рот и глаза прикрепятся к голове и будут двигаться вместе с ней.'
      : 'Сначала добавьте персонажа из раздела «Персонажи» — рот и глаза прикрепятся к его голове.']));
}

registerSideTab({ id: 'library', title: 'Библиотека', icon: 'library', order: 5, mount, refresh });
registerMenu('Слой', () => [{ label: 'Добавить из библиотеки…', icon: 'library', action: () => app.showSideTab && app.showSideTab('library') }]);

// ---------- перетаскивание карточек на холст ----------
function initDrop() {
  const vp = app.viewEl || document.getElementById('viewport');
  if (!vp) return false;
  const isLib = (e) => e.dataTransfer && [...e.dataTransfer.types].includes(DND);
  vp.addEventListener('dragover', (e) => {
    if (!isLib(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    vp.classList.add('lib-drop');
  });
  vp.addEventListener('dragleave', (e) => { if (!vp.contains(e.relatedTarget)) vp.classList.remove('lib-drop'); });
  vp.addEventListener('drop', (e) => {
    if (!isLib(e)) return;
    e.preventDefault();
    e.stopPropagation();
    vp.classList.remove('lib-drop');
    const it = byId.get(e.dataTransfer.getData(DND));
    const cv = vp.querySelector('canvas');
    if (!it || !cv) return;
    const r = cv.getBoundingClientRect();
    insertItem(it, it.kind === 'bg' ? null : app.toDoc(e.clientX - r.left, e.clientY - r.top));
  });
  return true;
}
let dropReady = initDrop();
if (!dropReady) app.on('docloaded', () => { if (!dropReady) dropReady = initDrop(); });

// ---------- свойства частей персонажа ----------
// «Болтать без звука»: случайная смена фаз рта с текущего кадра до конца сцены
function chatter(L) {
  const kids = L.children, doc = app.doc;
  if (kids.length < 2) return;
  const f0 = Math.max(app.frame, doc.start, 1), f1 = doc.end;
  if (f0 >= f1 - 2) { app.toast('Перейдите на кадр подальше от конца сцены'); return; }
  L.sw.k = L.sw.k.filter((k) => k.f === 0 || k.f < f0);
  const r = rng(L.id * 31 + f0);
  let prev = -1;
  for (let f = f0; f < f1 - 1; f += 2 + Math.floor(r() * 3)) {
    let lvl = 0;
    if (r() > 0.12 || prev === 0) do { lvl = 1 + Math.floor(r() * (kids.length - 1)); } while (lvl === prev && kids.length > 2);
    setKey(L.sw, f, String(kids[lvl].id), 'step');
    prev = lvl;
  }
  setKey(L.sw, f1, String(kids[0].id), 'step');
  app.commit('Рот болтает');
  app.toast(`Рот «говорит» с кадра ${f0} по ${f1}. Нажмите Пробел, чтобы посмотреть`, 3500);
}
function silence(L) {
  if (!L.children.length) return;
  L.sw.k = [{ ...L.sw.k[0], v: String(L.children[0].id) }];
  app.commit('Рот молчит');
  app.toast('Рот закрыт на всех кадрах');
}

registerInspector({
  id: 'library-mouth', order: 40,
  when: (L) => L.type === 'switch' && L.lib === 'mouth',
  build: (L, { sec }) => sec('Рот',
    h('div', { class: 'insp-note' }, 'Нижний дочерний слой — закрытый рот, верхний — широко открытый. Есть запись голоса? Добавьте её (Файл → Импорт звука…) — ниже, в свойствах слоя, появится кнопка «Липсинк по звуку».'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn sm', title: 'Случайно менять фазы рта с текущего кадра до конца сцены — как будто персонаж говорит', onclick: () => chatter(L) }, 'Болтать без звука'),
      h('button', { class: 'btn sm', title: 'Удалить ключи рта: он будет закрыт на всех кадрах', onclick: () => silence(L) }, 'Молчать'))),
});
registerInspector({
  id: 'library-eyes', order: 40,
  when: (L) => L.type === 'vector' && L.lib === 'eyes',
  build: (L, { sec }) => sec('Моргание',
    h('div', { class: 'insp-note' }, 'Глаза моргают примерно раз в 2–3 секунды.'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn sm', title: 'Заново расставить моргания до конца сцены (ключи масштаба слоя будут заменены)', onclick: () => { blinkKeys(L, ctxOf(app.doc)); app.commit('Моргание'); app.toast(`Моргание до кадра ${app.doc.end}`); } }, 'Моргать до конца сцены'),
      h('button', { class: 'btn sm', title: 'Удалить ключи масштаба: глаза всегда открыты', onclick: () => { L.scl.k = [L.scl.k[0]]; app.commit('Без моргания'); app.toast('Моргание убрано'); } }, 'Не моргать'))),
});

registerInspector({
  id: 'library-bg', order: 40,
  when: (L) => L.lib === 'bg' && !!L.children,
  build: (L, { sec }) => sec('Фон из библиотеки',
    h('div', { class: 'insp-note' }, L.lock
      ? 'Фон заблокирован (замок в списке слоёв), чтобы случайно не сдвинуть его при рисовании. Новый фон из библиотеки заменит этот.'
      : 'Новый фон из библиотеки заменит этот.'),
    h('div', { class: 'btn-row' },
      h('button', {
        class: 'btn sm', title: 'Растянуть фон на весь кадр — с учётом камеры (наезд, поворот, панорама) и размера кадра',
        onclick: () => { fitBg(L, app.doc); app.commit('Фон: подогнать под кадр'); app.toast('Фон подогнан под кадр и камеру'); },
      }, 'Подогнать под кадр'))),
});

// Размер кадра изменили в «Настройках проекта» — фон из библиотеки снова накрывает весь кадр
registerHook('beforeCommit', (label, doc) => {
  if (!doc) return;
  for (const G of doc.layers) {
    if (G.lib === 'bg' && Array.isArray(G.libFit) && (G.libFit[0] !== doc.w || G.libFit[1] !== doc.h)) fitBg(G, doc);
  }
});

// ---------- шаблоны нового проекта ----------
let tplActive = null; // { doc, id, hint } — какой слой сделать активным после открытия шаблона

function addTo(d, list, id, x, y, sc = 1) {
  const L = byId.get(id).build(d, ctxOf(d));
  const same = list.filter((X) => X.name === L.name || X.name.startsWith(L.name + ' ')).length;
  if (same) L.name += ' ' + (same + 1);
  if (sc !== 1) L.scl.k[0].v = [sc, sc];
  if (byId.get(id).stand) L.libStand = true;
  placeAt(L, x, y);
  list.push(L);
  return L;
}
function drift(L, d, dx) {
  const p = L.pos.k[0].v;
  L.pos.k[0].i = 'linear';
  setKey(L.pos, d.end, [p[0] + dx, p[1]], 'linear');
}
function drawLayer(d) { const L = newLayer(d, 'vector', 'Мой рисунок'); d.layers.push(L); return L; }

function tplCharacter() {
  const d = newDoc();
  d.name = 'Персонаж на лугу';
  d.end = 72;
  const cx = ctxOf(d), hw = d.w / 2, hh = d.h / 2, out = d.layers;
  out.push(byId.get('bg-meadow').build(d, cx));
  addTo(d, out, 'sun', -hw * 0.7, -hh * 0.6, 0.85);
  drift(addTo(d, out, 'cloud', hw * 0.3, -hh * 0.62), d, 70);
  drift(addTo(d, out, 'cloud', -hw * 0.25, -hh * 0.78, 0.65), d, 40);
  addTo(d, out, 'tree', hw * 0.64, hh * 0.08, 1.15);
  addTo(d, out, 'bush', -hw * 0.68, hh * 0.5);
  const feet = hh * 0.42 + 50; // ступни чуть ниже кромки травы
  addTo(d, out, 'shadow', 0, feet - 9);
  const rig = byId.get('boy').build(d, cx);
  rig.pos.k[0].v = [0, feet - 216];
  out.push(rig);
  drawLayer(d);
  tplActive = { doc: d, id: rig.id, tool: 'bmanip', hint: 'Это персонаж на костях: тяните руки, ноги и голову (инструмент «Управление костями», Z) на разных кадрах — анимация готова. Пробел — просмотр.' };
  return d;
}

function tplLandscape() {
  const d = newDoc();
  d.name = 'Пейзаж';
  d.end = 120;
  const cx = ctxOf(d), hw = d.w / 2, hh = d.h / 2, out = d.layers;
  const bg = byId.get('bg-meadow').build(d, cx);
  out.push(bg);
  // горы — между небом и холмами
  const far = [];
  addTo(d, far, 'mountain', -hw * 0.5, hh * 0.0, 0.95);
  addTo(d, far, 'mountain', hw * 0.3, -hh * 0.06, 1.35);
  bg.children.splice(1, 0, ...far);
  addTo(d, out, 'sun', -hw * 0.72, -hh * 0.64, 0.75);
  drift(addTo(d, out, 'cloud', hw * 0.05, -hh * 0.68), d, 90);
  drift(addTo(d, out, 'cloud', -hw * 0.42, -hh * 0.46, 0.7), d, 55);
  addTo(d, out, 'fir', -hw * 0.8, hh * 0.2, 1.1);
  addTo(d, out, 'fir', -hw * 0.64, hh * 0.28, 0.85);
  addTo(d, out, 'tree', hw * 0.7, hh * 0.14, 1.2);
  addTo(d, out, 'bush', hw * 0.42, hh * 0.56);
  addTo(d, out, 'flower', -hw * 0.22, hh * 0.62, 0.8);
  addTo(d, out, 'flower', -hw * 0.1, hh * 0.72, 0.65);
  addTo(d, out, 'grass', hw * 0.12, hh * 0.78);
  const draw = drawLayer(d);
  tplActive = { doc: d, id: draw.id, hint: 'Добавляйте персонажей и предметы из вкладки «Библиотека» — одним кликом или перетаскиванием на холст.' };
  return d;
}

// Ночной оттенок: смешать цвета с тёмно-синим
function tint(L, t, skip) {
  const nb = [20, 32, 74];
  const mix = (c) => { const v = c.k[0].v; c.k[0].v = [0, 1, 2].map((i) => v[i] * (1 - t) + nb[i] * t).concat(v[3]); };
  if (L.paths) for (const p of L.paths) if (!skip || !skip(p)) { mix(p.fill); mix(p.stroke); }
  if (L.children) for (const X of L.children) tint(X, t, skip);
}

function tplNight() {
  const d = newDoc();
  d.name = 'Ночная сцена';
  d.end = 96;
  d.bg = '#14204a';
  const cx = ctxOf(d), hw = d.w / 2, hh = d.h / 2, out = d.layers;
  out.push(byId.get('bg-night').build(d, cx));
  const house = addTo(d, out, 'house', -hw * 0.32, hh * 0.36, 1.1);
  // окна светятся: перекрасить в жёлтый и не затемнять
  const glass = C('#bfe4ff').slice(0, 3).join();
  const wins = new Set(house.paths.filter((q) => q.fill.k[0].v.slice(0, 3).join() === glass));
  for (const q of wins) q.fill.k[0].v = C('#ffd75a');
  tint(house, 0.45, (q) => wins.has(q));
  for (const [x, y, s] of [[hw * 0.3, hh * 0.38, 0.95], [hw * 0.5, hh * 0.46, 1.2], [hw * 0.74, hh * 0.4, 0.9]]) tint(addTo(d, out, 'fir', x, y, s), 0.55);
  const draw = drawLayer(d);
  tplActive = { doc: d, id: draw.id, hint: 'Звёзды уже мерцают — нажмите Пробел, чтобы посмотреть. Персонажей и другие предметы добавляйте из вкладки «Библиотека».' };
  return d;
}

// Миниатюра шаблона для диалога «Новый проект»: тот же рендер, что у карточек библиотеки (рисуется один раз)
function tplPreview(build) {
  let src = null;
  return () => {
    if (!src) {
      const keep = tplActive;
      let d;
      try { d = build(); } finally { tplActive = keep; } // сборка для картинки не должна менять активный слой следующего открытия
      const W = 320, H = 180, s = Math.max(W / d.w, H / d.h);
      src = document.createElement('canvas');
      src.width = W; src.height = H;
      const ctx = src.getContext('2d');
      ctx.setTransform(s, 0, 0, s, W / 2, H / 2);
      ctx.fillStyle = d.bg || '#ffffff';
      ctx.fillRect(-d.w / 2, -d.h / 2, d.w, d.h);
      thumbR.drawLayers(ctx, d.layers, evaluate(d, Math.max(1, d.start)), { images: app.images, px: s });
    }
    const cv = document.createElement('canvas');
    cv.width = src.width; cv.height = src.height;
    cv.getContext('2d').drawImage(src, 0, 0);
    return cv;
  };
}

registerTemplate({ id: 'lib-character', order: 10, name: 'Персонаж на лугу', description: 'Летний луг, солнце, облака и персонаж на костях — сразу можно оживлять', build: tplCharacter, preview: tplPreview(tplCharacter) });
registerTemplate({ id: 'lib-landscape', order: 11, name: 'Пейзаж', description: 'Горы, деревья и плывущие облака. Персонажей добавите из «Библиотеки»', build: tplLandscape, preview: tplPreview(tplLandscape) });
registerTemplate({ id: 'lib-night', order: 12, name: 'Ночная сцена', description: 'Звёздное небо с луной, мерцающие звёзды и домик с горящими окнами', build: tplNight, preview: tplPreview(tplNight) });

registerHook('docLoaded', (doc) => {
  const t = tplActive;
  tplActive = null;
  if (!t || t.doc !== doc || !app.idx.layers.has(t.id)) return;
  app.activeId = t.id;
  app.clearSel();
  app.fixTool();
  if (t.tool && app.tool !== t.tool) setTool(t.tool);
  if (t.hint) setTimeout(() => app.toast(t.hint, 6500), 700);
});

// Доступ для других модулей и скриптов: app.library.insert('tree') / insert('boy', [x, y])
app.library = { items: ITEMS, categories: CATS, insert: (id, at) => insertItem(byId.get(id), at || null) };

addStyle(`
.lib-tab { padding-top: 0; }
.lib-top { position: sticky; top: 0; z-index: 2; display: flex; gap: 5px; background: var(--bg1); padding: 6px 0 4px; }
.lib-qwrap { position: relative; display: flex; flex: 1; min-width: 0; }
.lib-q { width: 100%; min-width: 0; padding-left: 26px; }
.lib-qic { position: absolute; left: 8px; top: 50%; transform: translateY(-50%); color: var(--text3); pointer-events: none; }
.lib-catsel { flex: none; width: auto; max-width: 112px; color: var(--text2); }
.lib-catsel.on { color: var(--accent); border-color: rgba(76,157,255,.45); }
.lib-hint { display: flex; align-items: flex-start; gap: 6px; color: var(--text3); font-size: 11.5px; line-height: 1.35; margin: 1px 0 2px; }
.lib-hint[hidden] { display: none; }
.lib-hint > span { flex: 1; }
.lib-hint-x { flex: none; display: inline-flex; padding: 2px; border: 0; border-radius: 4px; background: none; color: var(--text3); }
.lib-hint-x:hover { color: var(--text); background: var(--bg3); }
.lib-cat { margin-top: 4px; }
.lib-cat[hidden], .lib-card[hidden] { display: none; }
.lib-cat .insp-title { margin-bottom: 4px; }
.lib-note { color: var(--text3); font-size: 11.5px; margin: -2px 0 7px; }
.lib-note b { color: var(--accent); font-weight: 600; }
.lib-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); gap: 5px; }
.lib-card { position: relative; display: flex; flex-direction: column; gap: 2px; min-width: 0; padding: 3px 3px 4px; border: 1px solid var(--line); border-radius: 7px; background: var(--bg2); color: var(--text); text-align: center; cursor: grab; transition: border-color .12s, background-color .12s; }
.lib-card:hover { border-color: var(--accent); background: #26354a; }
.lib-card:active { cursor: grabbing; }
.lib-card.flash { animation: lib-flash .5s ease-out; }
@keyframes lib-flash { 0% { transform: scale(.93); border-color: #7fd36b; box-shadow: 0 0 0 3px rgba(127,211,107,.35); } 100% { transform: none; } }
.lib-thumb { display: block; width: 100%; height: auto; aspect-ratio: 3 / 2; border-radius: 4px; background: linear-gradient(#f1f6fb, #d8e4ef); }
.lib-name { font-size: 11px; line-height: 1.2; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.lib-badge { position: absolute; top: 6px; right: 6px; display: inline-flex; align-items: center; justify-content: center; width: 17px; height: 17px; border-radius: 50%; background: rgba(23,24,27,.78); color: #7fd36b; pointer-events: none; }
.lib-plus { position: absolute; top: 6px; left: 6px; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; background: var(--accent2); color: #fff; opacity: 0; transition: opacity .12s; pointer-events: none; }
.lib-card:hover .lib-plus, .lib-card:focus-visible .lib-plus { opacity: 1; }
.lib-empty { padding: 24px 8px; text-align: center; color: var(--text3); }
#viewport.lib-drop::after { content: 'Отпустите, чтобы добавить сюда'; position: absolute; inset: 0; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 16px; border: 2px dashed var(--accent); background: rgba(76,157,255,.06); color: var(--accent); font-weight: 600; pointer-events: none; }
`, 'library-css');
