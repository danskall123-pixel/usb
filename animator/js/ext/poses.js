// Позы: библиотека поз для скелетов — анимация «поза за позой» в несколько кликов.
// Позы хранятся в слое костей: B.poses = [{ id, name, data: { [boneId]: { ang, pos, scl } }, names: { [boneId]: имя }, thumb }].
import { app } from '../app.js';
import { registerSideTab, registerMenu, registerInspector, registerTimelineMenu, addStyle } from '../ext.js';
import { registerIcon, icon } from '../icons.js';
import { h, clamp } from '../util.js';
import { setKey, evalCh } from '../anim.js';
import { newDoc, layerOwnChannels, descendants } from '../model.js';
import { evaluate, layerWorldPoints } from '../scene.js';
import { Renderer } from '../render.js';
import { buildCharacter } from '../demo.js';
import { dialog, showMenu, selectField, checkField } from '../ui.js';
import { setTool } from '../panels.js';

registerIcon('poses', '<circle cx="12" cy="4.6" r="2.4"/><path d="M12 7.5v7M12 14.5l-3.6 6.5M12 14.5l3.6 6.5M12 10L7.5 13.5M12 10l4.2-4.6"/>');
registerIcon('ps-edit', '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>');
registerIcon('ps-mirror', '<path d="M12 3v18" stroke-dasharray="2.2 2.2"/><path d="M9 7l-5 5 5 5z"/><path d="M15 7l5 5-5 5z" fill="currentColor"/>');
registerIcon('ps-between', '<circle cx="4.5" cy="12" r="2.5"/><circle cx="19.5" cy="12" r="2.5"/><path d="M7 12h2.5M14.5 12H17" stroke-dasharray="1.6 1.6"/><path d="M12 8.5l3.5 3.5-3.5 3.5-3.5-3.5z" fill="currentColor"/>');
registerIcon('ps-walk', '<circle cx="13" cy="3.8" r="2"/><path d="M12.5 7l-1.5 6 3 3v5M11 13l-3 3.5-2.5 1M12.5 7.5L9 10l-1 3M12.5 7.5l3 3 3 .5"/>');
registerIcon('ps-save', '<path d="M5 3h11l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 1-2z"/><path d="M12 9v7M8.5 12.5h7"/>');

// ---------- настройки панели (личное удобство, хранятся в браузере) ----------
const LS = 'anim2d.poses';
const opt = { onlySel: false, advance: 0, cycles: '2', tempo: '24' };
try {
  const s = JSON.parse(localStorage.getItem(LS) || '{}');
  if (typeof s.onlySel === 'boolean') opt.onlySel = s.onlySel;
  if ([0, 6, 12, 24].includes(s.advance)) opt.advance = s.advance;
  if (['1', '2', '3', '4', 'end'].includes(s.cycles)) opt.cycles = s.cycles;
  if (['16', '24', '32'].includes(s.tempo)) opt.tempo = s.tempo;
} catch (e) { /* нет доступа */ }
const saveOpt = () => { try { localStorage.setItem(LS, JSON.stringify(opt)); } catch (e) { /* нет доступа */ } };

// ---------- мелочи ----------
const r3 = (v) => Math.round(v * 1000) / 1000;
const near = (a, b) => Math.abs(a - b) < 1e-4;
// Угол a, сдвинутый на 360° так, чтобы быть ближе всего к ref (без лишнего оборота при переходе)
const nearestAngle = (a, ref) => a + 360 * Math.round((ref - a) / 360);

const rigOf = () => (app.doc && app.idx && app.active ? app.boneLayerFor(app.active) : null);
const rigById = (id) => { const L = app.idx && app.idx.layers.get(id); return L && L.type === 'bone' ? L : null; };
const bonesWord = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'кость' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'кости' : 'костей');
const cyclesWord = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'цикл' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'цикла' : 'циклов');

function selectedOf(B) {
  const s = new Set();
  for (const b of B.bones) if (app.sel.bones.has(b.id)) s.add(b.id);
  return s;
}
// Кости, к которым применять действие: выделенные (если включена опция и что-то выделено) или все
function targetBones(B) {
  const sel = selectedOf(B);
  return opt.onlySel && sel.size ? sel : null;
}

function stopPlay() { if (app.playing) app.emit('stop'); }

// ---------- данные позы ----------
function capture(B, f) {
  const data = {}, names = {};
  for (const b of B.bones) {
    data[b.id] = { ang: r3(evalCh(b.ang, f)), pos: evalCh(b.pos, f).map(r3), scl: r3(evalCh(b.scl, f)) };
    names[b.id] = b.name;
  }
  return { data, names };
}

// Поза → Map(id кости скелета → { ang, pos, scl }). Кости ищутся по id, затем по имени (после копирования слоя id меняются).
function resolve(B, pose) {
  const out = new Map();
  if (!pose || !pose.data) return out;
  const byId = new Map(B.bones.map((b) => [String(b.id), b]));
  const cnt = new Map();
  for (const b of B.bones) cnt.set(b.name, (cnt.get(b.name) || 0) + 1);
  const byName = new Map(B.bones.filter((b) => cnt.get(b.name) === 1).map((b) => [b.name, b]));
  for (const [id, v] of Object.entries(pose.data)) {
    if (!v || !isFinite(v.ang)) continue;
    let b = byId.get(id);
    if (!b && pose.names && pose.names[id] != null) b = byName.get(pose.names[id]);
    if (b && !out.has(b.id)) out.set(b.id, { ang: +v.ang, pos: Array.isArray(v.pos) ? v.pos.slice(0, 2) : null, scl: isFinite(v.scl) ? +v.scl : null });
  }
  return out;
}

// Ключ позы на кости. Угол — всегда; положение и масштаб — только если отличаются или уже анимированы (меньше лишних ключей).
function keyBone(b, f, v) {
  let n = 0;
  if (isFinite(v.ang)) { setKey(b.ang, f, r3(nearestAngle(v.ang, evalCh(b.ang, f)))); n++; }
  if (v.pos) {
    const cur = evalCh(b.pos, f);
    if (b.pos.k.length > 1 || !near(cur[0], v.pos[0]) || !near(cur[1], v.pos[1])) { setKey(b.pos, f, v.pos.map(r3)); n++; }
  }
  if (v.scl != null) {
    const cur = evalCh(b.scl, f);
    if (b.scl.k.length > 1 || !near(cur, v.scl)) { setKey(b.scl, f, r3(v.scl)); n++; }
  }
  return n;
}

// ---------- готовый персонаж (buildCharacter из demo.js) ----------
const RIG = {
  body: 'Корпус', head: 'Голова',
  armN: 'Плечо (ближнее)', foreN: 'Предплечье (ближнее)',
  armF: 'Плечо (дальнее)', foreF: 'Предплечье (дальнее)',
  legN: 'Нога (ближняя)', legF: 'Нога (дальняя)',
};
const normName = (s) => String(s || '').trim().toLowerCase().replace(/ё/g, 'е');
function rigMap(B) {
  if (!B || !B.bones || B.bones.length < 8) return null;
  const out = {};
  for (const [k, name] of Object.entries(RIG)) {
    const list = B.bones.filter((b) => normName(b.name) === normName(name));
    if (list.length !== 1) return null;
    out[k] = list[0];
  }
  return out;
}

// Цикл ходьбы на месте: смещения от исходной позы на четвертях цикла [0, ¼, ½, ¾].
// Углы в градусах (плюс — по часовой), pos — [dx, dy]. На ¼ поднята ближняя нога (справа), на ¾ — дальняя (слева).
// На фазе 0 все смещения нулевые: повторный запуск с того же кадра не «накапливает» сдвиг.
const WALK = [
  ['body', 'ang', [0, -2, 0, 2]],
  ['body', 'pos', [[0, 0], [0, -3], [0, 0], [0, -3]]],
  ['head', 'ang', [0, 3, 0, -3]],
  ['armN', 'ang', [0, -22, 0, 22]],
  ['armF', 'ang', [0, -22, 0, 22]],
  ['foreN', 'ang', [0, 0, 0, 12]],
  ['foreF', 'ang', [0, -12, 0, 0]],
  ['legN', 'ang', [0, -6, 0, 0]],
  ['legN', 'pos', [[0, 0], [0, -20], [0, 0], [0, 0]]],
  ['legF', 'ang', [0, 0, 0, 6]],
  ['legF', 'pos', [[0, 0], [0, 0], [0, 0], [0, -20]]],
];
function walkPhase(q) {
  const a = {}, p = {};
  for (const [k, ch, vals] of WALK) (ch === 'ang' ? a : p)[k] = vals[q];
  return { a, p };
}

// Готовые позы: смещения углов (и иногда положения) от позы покоя персонажа
const BUILTIN = [
  { id: 'stand', name: 'Стоит', tip: 'Спокойная поза — как в позе покоя', a: {} },
  { id: 'wave', name: 'Машет', tip: 'Приветственно машет рукой', a: { armN: -125, foreN: -40, head: 6, armF: 4 } },
  { id: 'hooray', name: 'Руки вверх', tip: 'Ура! Обе руки подняты', a: { armN: -145, foreN: -15, armF: 145, foreF: 15, legN: -5, legF: 5 } },
  { id: 'hips', name: 'Руки в бока', tip: 'Уверенная поза: руки на поясе', a: { armN: -40, foreN: 104, armF: 40, foreF: -104, legN: -4, legF: 4 } },
  { id: 'point', name: 'Указывает', tip: 'Показывает рукой вправо', a: { armN: -75, foreN: -6, head: 8, body: 3, armF: 6 } },
  { id: 'wow', name: 'Удивление', tip: 'Ого! Руки разведены, ладони вверх', a: { armN: -55, foreN: -90, armF: 55, foreF: 90, head: -5 }, p: { body: [0, -3] } },
  { id: 'think', name: 'Думает', tip: 'Рука у подбородка, голова наклонена', a: { armN: 69, foreN: 152, head: 8, armF: 6 } },
  { id: 'stepR', name: 'Шаг (правая)', tip: 'Поднята нога справа (на экране). Пара к «Шаг (левая)»', ...walkPhase(1) },
  { id: 'stepL', name: 'Шаг (левая)', tip: 'Поднята нога слева (на экране). Пара к «Шаг (правая)»', ...walkPhase(3) },
];

function builtinData(R, P) {
  const m = new Map();
  for (const [k, b] of Object.entries(R)) {
    const ang = b.ang.k[0].v, pos = b.pos.k[0].v, scl = b.scl.k[0].v;
    const da = (P.a && P.a[k]) || 0, dp = (P.p && P.p[k]) || [0, 0];
    m.set(b.id, { ang: ang + da, pos: [pos[0] + dp[0], pos[1] + dp[1]], scl });
  }
  return m;
}

// ---------- зеркало (ближнее ↔ дальнее, левое ↔ правое) ----------
const SIDES = [[/ближн/i, /дальн/i], [/лев/i, /прав/i], [/left/i, /right/i], [/(^|[\s._-])L$/, /(^|[\s._-])R$/]];
function pairsOf(B) {
  const groups = new Map();
  for (const b of B.bones) {
    const n = String(b.name || '');
    for (let i = 0; i < SIDES.length; i++) {
      const s = SIDES[i][0].test(n) ? 0 : SIDES[i][1].test(n) ? 1 : -1;
      if (s < 0) continue;
      const key = i + '|' + n.replace(SIDES[i][s], (m0, p1) => (typeof p1 === 'string' ? p1 : '') + '§').toLowerCase();
      const g = groups.get(key) || [[], []];
      g[s].push(b.id);
      groups.set(key, g);
      break;
    }
  }
  const out = new Map();
  for (const [a, b] of groups.values()) if (a.length === 1 && b.length === 1) { out.set(a[0], b[0]); out.set(b[0], a[0]); }
  return out;
}

// get(b) → { ang, pos, scl } исходной позы; результат — зеркальная поза (Map)
function mirrorMap(B, get, f) {
  const byId = new Map(B.bones.map((b) => [b.id, b]));
  const partner = pairsOf(B);
  const isRoot = (b) => b.parent == null || !byId.has(b.parent);
  // вертикальная ось симметрии для корневых костей — по позе покоя
  let xs = B.bones.filter((b) => isRoot(b) && partner.has(b.id)).map((b) => b.pos.k[0].v[0]);
  if (!xs.length) xs = B.bones.filter(isRoot).map((b) => b.pos.k[0].v[0]);
  const x0 = xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
  const out = new Map();
  for (const b of B.bones) {
    const m = byId.get(partner.get(b.id)) || b;
    const v = get(m);
    if (!v) continue;
    const pos = v.pos || evalCh(m.pos, f);
    const root = isRoot(b);
    out.set(b.id, {
      ang: nearestAngle(root ? 180 - v.ang : -v.ang, evalCh(b.ang, f)),
      pos: root ? [2 * x0 - pos[0], pos[1]] : [pos[0], -pos[1]],
      scl: v.scl != null ? v.scl : evalCh(m.scl, f),
    });
  }
  return out;
}

// ---------- миниатюры ----------
const TS = 112;
const thumbR = new Renderer();

// Копия поддерева скелета в отдельном документе: всё замирает как на кадре f (на кадре 1 копии), а кости можно ставить в позу
function thumbScene(B, f) {
  const C = JSON.parse(JSON.stringify(B, (k, v) => (k === 'poses' || (k && k[0] === '_') ? undefined : v)));
  C.vis = true;
  const from = [B, ...descendants(B)], to = [C, ...descendants(C)];
  for (let i = 0; i < from.length && i < to.length; i++) {
    const a = layerOwnChannels(from[i]), b = layerOwnChannels(to[i]);
    for (let j = 0; j < a.length && j < b.length; j++) {
      if (!b[j] || !b[j].k || !b[j].k.length) continue;
      b[j].k = [b[j].k[0], { f: 1, v: JSON.parse(JSON.stringify(evalCh(a[j], f))), i: 'step' }];
    }
  }
  const d = newDoc();
  d.layers.push(C);
  const base = new Map(C.bones.map((b) => [b.id, { ang: b.ang.k[1].v, pos: b.pos.k[1].v.slice(), scl: b.scl.k[1].v }]));
  const rest = new Map(C.bones.map((b) => [b.id, { ang: b.ang.k[0].v, pos: b.pos.k[0].v.slice(), scl: b.scl.k[0].v }]));
  return { d, C, base, rest, ref: null };
}

function poseScene(ts, data) {
  for (const b of ts.C.bones) {
    const v = (data && data.get(b.id)) || ts.base.get(b.id), o = ts.base.get(b.id);
    b.ang.k[1].v = v.ang;
    b.pos.k[1].v = (v.pos || o.pos).slice();
    b.scl.k[1].v = v.scl != null ? v.scl : o.scl;
  }
  return evaluate(ts.d, 1);
}

function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return isFinite(x0) ? [x0, y0, x1, y1] : [-50, -50, 50, 50];
}
const PAD = 7;
const fitScale = (b) => Math.min((TS - 2 * PAD) / Math.max(1, b[2] - b[0]), (TS - 2 * PAD) / Math.max(1, b[3] - b[1]), 6);

// Миниатюра позы → PNG data URL (масштаб одинаковый для всех поз скелета — по позе покоя)
function renderThumb(ts, data) {
  if (ts.ref == null) ts.ref = fitScale(bbox(layerWorldPoints(poseScene(ts, ts.rest), ts.C)));
  const S = poseScene(ts, data);
  const bb = bbox(layerWorldPoints(S, ts.C));
  const s = Math.min(ts.ref, fitScale(bb));
  const cv = document.createElement('canvas');
  cv.width = cv.height = TS;
  const ctx = cv.getContext('2d');
  ctx.setTransform(s, 0, 0, s, TS / 2 - (s * (bb[0] + bb[2])) / 2, TS / 2 - (s * (bb[1] + bb[3])) / 2);
  thumbR.drawLayers(ctx, ts.d.layers, S, { images: app.images, px: s });
  return cv.toDataURL('image/png');
}

function safeThumb(B, f, data) {
  try { return renderThumb(thumbScene(B, f), data); } catch (e) { console.error('Миниатюра позы', e); return ''; }
}

// Кэш миниатюр готовых поз: ключ — содержимое скелета (без сохранённых поз)
const builtinCache = { key: '', map: new Map() };
function builtinThumbs(B, R) {
  const key = B.id + ':' + JSON.stringify(B, (k, v) => (k === 'poses' || (k && k[0] === '_') ? undefined : v));
  if (builtinCache.key !== key) {
    builtinCache.key = key;
    builtinCache.map = new Map();
    try {
      const ts = thumbScene(B, 0);
      for (const P of BUILTIN) builtinCache.map.set(P.id, renderThumb(ts, builtinData(R, P)));
    } catch (e) { console.error('Миниатюры готовых поз', e); }
  }
  return builtinCache.map;
}

// ---------- кадр 0 = поза покоя ----------
// → кадр для ключей или null (отмена). На кадре 0 спрашиваем: менять позу покоя почти никогда не нужно.
function askFrame(what) {
  const f = app.frame;
  if (f > 0) return Promise.resolve(f);
  const alt = Math.max(1, app.doc.start || 1);
  return new Promise((res) => {
    dialog({
      title: 'Это кадр 0 — поза покоя',
      width: 460,
      body: h('div', null,
        h('p', null, 'К позе покоя привязан рисунок персонажа. ', what, ' здесь сдвинет только кости, а рисунок останется на месте — и на других кадрах персонаж может исказиться.'),
        h('p', { class: 'muted' }, `Для анимации ставьте позы на кадры ${alt}, 12, 24… — движение между ними появится само.`)),
      buttons: [
        { label: 'Отмена', value: null },
        { label: 'Изменить позу покоя', value: 0 },
        { label: `Поставить на кадр ${alt}`, primary: true, value: alt },
      ],
      onClose: (v) => res(v == null ? null : v),
    });
  });
}

// Если ключ дальше конца сцены — удлинить сцену, чтобы он попал в воспроизведение
function extendEnd(f) {
  if (f <= app.doc.end) return '';
  app.doc.end = f;
  return ` Сцена удлинена до кадра ${f}.`;
}

// ---------- действия ----------
async function applyPose(rigId, pose, { mirror = false, flash = '', title = '' } = {}) {
  stopPlay();
  let B = rigById(rigId);
  if (!B) return;
  if (B.lock) { app.toast('Слой костей заблокирован — снимите замок в списке слоёв'); return; }
  const f = await askFrame(mirror ? 'Зеркальная поза' : 'Поза');
  if (f == null) return;
  B = rigById(rigId);
  if (!B) return;
  if (f !== app.frame) app.setFrame(f);
  let data = typeof pose.data === 'function' ? pose.data(B) : resolve(B, pose);
  if (mirror) {
    const src = data;
    data = mirrorMap(B, (b) => src.get(b.id) || { ang: evalCh(b.ang, f), pos: evalCh(b.pos, f), scl: evalCh(b.scl, f) }, f);
  }
  const only = targetBones(B);
  let n = 0;
  for (const b of B.bones) {
    const v = data.get(b.id);
    if (!v || (only && !only.has(b.id))) continue;
    keyBone(b, f, v);
    n++;
  }
  if (!n) { app.toast(only ? 'Среди выделенных костей нет костей этой позы' : 'В этом скелете нет костей из этой позы'); return; }
  const ext = extendEnd(f);
  const what = title || `Поза «${pose.name + (mirror ? ' (зеркально)' : '')}»`;
  if (ui) ui.flash = flash;
  app.commit(what);
  let msg = f === 0 ? `${what} стала позой покоя` : `${what} на кадре ${f}`;
  if (only) msg += ` (только выделенные: ${n})`;
  if (opt.advance && f > 0) {
    app.setFrame(f + opt.advance);
    msg += ` → теперь кадр ${f + opt.advance}, выберите следующую позу`;
  }
  app.toast(msg + ext, 3200);
}

function savePose(nameIn) {
  const B = rigOf();
  if (!B) { app.toast('Сначала выберите персонажа (слой костей)'); return; }
  if (!B.bones.length) { app.toast('В скелете ещё нет костей'); return; }
  const f = app.frame;
  const list = B.poses || [];
  let name = String(nameIn || '').trim();
  if (!name) { let i = list.length + 1; while (list.some((p) => p.name === 'Поза ' + i)) i++; name = 'Поза ' + i; }
  const { data, names } = capture(B, f);
  const thumb = safeThumb(B, f, null);
  const id = app.doc.nid++;
  (B.poses ||= []).push({ id, name, data, names, thumb });
  if (ui) { ui.input.value = ''; ui.flash = 'u' + id; }
  app.commit('Сохранение позы');
  app.toast(`Поза «${name}» сохранена. Перейдите на другой кадр и нажмите на неё — персонаж встанет так же.`, 3800);
}

function updatePose(rigId, poseId) {
  const B = rigById(rigId);
  const p = B && (B.poses || []).find((x) => x.id === poseId);
  if (!p) return;
  const f = app.frame;
  Object.assign(p, capture(B, f));
  p.thumb = safeThumb(B, f, null);
  if (ui) ui.flash = 'u' + p.id;
  app.commit('Обновление позы');
  app.toast(`Поза «${p.name}» заменена текущей позой (кадр ${f})`);
}

function copyBuiltin(rigId, P) {
  const B = rigById(rigId), R = B && rigMap(B);
  if (!R) return;
  const data = {}, names = {};
  for (const [id, v] of builtinData(R, P)) {
    const b = B.bones.find((x) => x.id === id);
    data[id] = { ang: r3(v.ang), pos: v.pos.map(r3), scl: r3(v.scl) };
    names[id] = b.name;
  }
  const thumb = builtinThumbs(B, R).get(P.id) || '';
  const list = B.poses || [];
  let name = P.name, i = 2;
  while (list.some((p) => p.name === name)) name = `${P.name} ${i++}`;
  const id = app.doc.nid++;
  (B.poses ||= []).push({ id, name, data, names, thumb });
  if (ui) ui.flash = 'u' + id;
  app.commit('Сохранение позы');
  app.toast(`«${name}» добавлена в «Мои позы»`);
}

function renamePose(rigId, poseId) {
  const B = rigById(rigId);
  const p = B && (B.poses || []).find((x) => x.id === poseId);
  if (!p) return;
  const inp = h('input', { class: 'txt', value: p.name, maxlength: 60, 'aria-label': 'Название позы', onkeydown: (e) => e.stopPropagation() });
  dialog({
    title: 'Название позы',
    width: 340,
    body: h('div', { class: 'form' }, inp),
    buttons: [{ label: 'Отмена' }, {
      label: 'Переименовать', primary: true, action: () => {
        const v = inp.value.trim();
        const B2 = rigById(rigId), P2 = B2 && (B2.poses || []).find((x) => x.id === poseId);
        if (!v || !P2 || v === P2.name) return;
        P2.name = v;
        app.commit('Переименование позы');
      },
    }],
  });
  setTimeout(() => inp.select(), 20);
}

function deletePose(rigId, poseId) {
  const B = rigById(rigId);
  const i = B && B.poses ? B.poses.findIndex((x) => x.id === poseId) : -1;
  if (i < 0) return;
  const [p] = B.poses.splice(i, 1);
  app.commit('Удаление позы');
  app.toast(`Поза «${p.name}» удалена (Ctrl+Z — вернуть)`);
}

function movePose(rigId, poseId, d) {
  const B = rigById(rigId);
  const i = B && B.poses ? B.poses.findIndex((x) => x.id === poseId) : -1;
  const j = i + d;
  if (i < 0 || j < 0 || j >= B.poses.length) return;
  const [p] = B.poses.splice(i, 1);
  B.poses.splice(j, 0, p);
  app.commit('Порядок поз');
}

// Промежуточная поза: каждый канал кости — среднее предыдущего и следующего ключей
function breakdown() {
  stopPlay();
  const B = rigOf();
  if (!B || !B.bones.length) { app.toast('Сначала выберите персонажа (слой костей)'); return; }
  if (B.lock) { app.toast('Слой костей заблокирован'); return; }
  const f = app.frame;
  if (f === 0) { app.toast('Кадр 0 — поза покоя. Встаньте между двумя позами, например на кадр 6 между 1 и 12.', 3600); return; }
  const only = targetBones(B);
  let n = 0;
  const spans = new Map();
  for (const b of B.bones) {
    if (only && !only.has(b.id)) continue;
    for (const c of [b.ang, b.pos, b.scl]) {
      let prev = null, next = null, here = null;
      for (const k of c.k) { if (k.f < f) prev = k; else if (k.f === f) here = k; else { next = k; break; } }
      if (!prev || !next) continue;
      const arr = Array.isArray(prev.v);
      const same = arr ? prev.v.every((x, i) => near(x, next.v[i])) : near(prev.v, next.v);
      if (same && !here) continue; // между одинаковыми ключами и так стоит та же поза
      const v = arr ? prev.v.map((x, i) => r3((x + next.v[i]) / 2)) : r3((prev.v + next.v) / 2);
      setKey(c, f, v, here ? undefined : prev.i);
      const sk = prev.f + '–' + next.f;
      spans.set(sk, (spans.get(sk) || 0) + 1);
      n++;
    }
  }
  if (!n) {
    app.toast(`Нужны две разные позы: до кадра ${f} и после него. Поставьте их, затем встаньте между ними.`, 3800);
    return;
  }
  const span = [...spans.entries()].sort((a, b) => b[1] - a[1])[0][0];
  app.commit('Промежуточная поза');
  app.toast(`Промежуточная поза на кадре ${f} (между кадрами ${span})`);
}

async function mirrorNow() {
  stopPlay();
  const B = rigOf();
  if (!B || !B.bones.length) { app.toast('Сначала выберите персонажа (слой костей)'); return; }
  if (!pairsOf(B).size) { app.toast('Нет парных костей (ближнее/дальнее или левое/правое) — зеркалить нечего'); return; }
  const f = app.frame;
  const cur = new Map(B.bones.map((b) => [b.id, { ang: evalCh(b.ang, f), pos: evalCh(b.pos, f), scl: evalCh(b.scl, f) }]));
  await applyPose(B.id, { name: 'Зеркальная поза', data: () => cur }, { mirror: true, title: 'Зеркальная поза' });
}

// Ходьба на месте: циклы ключей от текущего кадра
function walkInPlace() {
  stopPlay();
  const B = rigOf(), R = rigMap(B);
  if (!B) { app.toast('Сначала выберите персонажа (слой костей)'); return; }
  if (!R) { app.toast('Автоходьба работает с готовым персонажем (кости «Корпус», «Голова», «Нога (ближняя)»…)', 3600); return; }
  if (B.lock) { app.toast('Слой костей заблокирован'); return; }
  let f0 = app.frame, note = '';
  if (f0 === 0) { f0 = Math.max(1, app.doc.start || 1); note = ` Начато с кадра ${f0}: кадр 0 — поза покоя.`; }
  const P = +opt.tempo || 24, q = P / 4;
  const n = opt.cycles === 'end' ? Math.max(1, Math.floor((app.doc.end - f0) / P)) : +opt.cycles || 1;
  const T = n * P;
  // исходные значения — поза на кадре начала
  const jobs = WALK.map(([k, ch, vals]) => { const c = R[k][ch]; return { c, vals, base: evalCh(c, f0) }; });
  for (const { c } of jobs) c.k = c.k.filter((k) => !(k.f > f0 && k.f <= f0 + T));
  const val = (base, o) => (Array.isArray(base) ? [r3(base[0] + o[0]), r3(base[1] + o[1])] : r3(base + o));
  for (const { c, vals, base } of jobs) {
    for (let i = 0; i < n; i++) for (let j = 0; j < 4; j++) setKey(c, f0 + i * P + j * q, val(base, vals[j]), 'smooth');
    setKey(c, f0 + T, val(base, vals[0]), 'smooth');
  }
  const ext = extendEnd(f0 + T);
  if (app.frame !== f0) app.setFrame(f0);
  app.commit('Ходьба на месте');
  app.toast(`Ходьба на месте: кадры ${f0}–${f0 + T}, ${n} ${cyclesWord(n)}. Нажмите Пробел, чтобы посмотреть.${ext}${note}`, 4200);
}

// Новый персонаж из demo.js — чтобы было с чем работать
function addCharacter() {
  const n = app.idx.list.filter((L) => L.type === 'bone').length;
  const half = (app.doc.w || 1280) / 2 - 90;
  const x = n ? clamp((n % 2 ? 1 : -1) * 240 * Math.ceil(n / 2), -half, half) : 0;
  const names = new Set(app.idx.list.map((L) => L.name));
  let name = 'Персонаж', i = 2;
  while (names.has(name)) name = 'Персонаж ' + i++;
  const { rig } = buildCharacter(app.doc, { name, x, y: -40 });
  app.doc.layers.push(rig);
  app.restructure();
  app.activeId = rig.id;
  app.clearSel();
  app.fixTool();
  app.commit('Новый персонаж');
  setTool('bmanip');
  if (app.frame === 0) app.setFrame(Math.max(1, app.doc.start || 1));
  app.toast(`Добавлен «${name}». Нажмите на готовую позу — или тяните кости мышью.`, 3600);
}

function pickRig(id) {
  app.setActive(id);
  const t = app.tool;
  if (!['bmanip', 'bselect', 'btransform', 'badd', 'breparent', 'bstrength'].includes(t)) setTool('bmanip');
}

export function openPoses() { if (app.showSideTab) app.showSideTab('poses'); }

// ---------- вкладка «Позы» ----------
let ui = null;
let ver = 0; // счётчик изменений документа (для перестройки вкладки)

function mount(el) {
  el.classList.add('ps');
  const input = h('input', {
    class: 'txt ps-in', type: 'text', maxlength: 60, placeholder: 'Название позы', 'aria-label': 'Название новой позы',
    onkeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); savePose(input.value); } },
  });
  ui = { el, input, sig: '', flash: '', frameEls: [] };
  refresh();
}

function refresh() {
  if (!ui || !app.doc) return;
  const B = rigOf();
  const sig = B
    ? [B.id, B.name, B.lock, B.bones.map((b) => b.id + b.name).join(','), (B.poses || []).map((p) => p.id + ':' + p.name + ':' + (p.thumb || '').length).join(','),
      selectedOf(B).size, ver, app.history.i, app.frame === 0].join('|')
    : 'none|' + app.idx.list.filter((L) => L.type === 'bone').map((L) => L.id + L.name).join(',');
  if (sig !== ui.sig) { ui.sig = sig; build(); } else updateFrame();
}

function updateFrame() {
  if (!ui) return;
  for (const fn of ui.frameEls) fn();
  if ((app.frame === 0) !== ui.zero) refresh();
}

app.on('frame', () => { if (ui && ui.el.offsetParent) updateFrame(); });
app.on('docloaded', () => { builtinCache.key = ''; if (ui) ui.sig = ''; });
app.on('commit', () => { ver++; });

function sec(title, ...kids) { return h('section', { class: 'ps-sec' }, title ? h('div', { class: 'insp-title' }, title) : null, ...kids); }

function card({ key, name, tip, thumb, onApply, menu, acts }) {
  const img = thumb ? h('img', { class: 'ps-thumb', src: thumb, alt: '', draggable: 'false' }) : h('span', { class: 'ps-thumb ps-ph' }, icon('poses', 30));
  const main = h('button', { class: 'ps-main', title: `${name}\n${tip || ''}\nНажмите — поставить позу на текущий кадр. Правая кнопка — ещё действия.`.replace('\n\n', '\n'), onclick: onApply }, img, h('span', { class: 'ps-name' }, name));
  const el = h('div', { class: 'ps-card' + (ui.flash === key ? ' flash' : '') }, main, acts && acts.length ? h('div', { class: 'ps-acts' }, ...acts) : null);
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); showMenu(menu(), e.clientX, e.clientY); });
  return el;
}
const act = (ic, title, fn, cls = '') => h('button', { class: 'ps-act ' + cls, title, 'aria-label': title, onclick: (e) => { e.stopPropagation(); fn(); } }, icon(ic, 14));

function build() {
  const el = ui.el;
  // поле названия переживает перестройку вкладки: сохраняем фокус и курсор
  const inp = ui.input, focused = document.activeElement === inp;
  const caret = focused ? [inp.selectionStart, inp.selectionEnd] : null;
  buildBody(el);
  if (focused && inp.isConnected) { inp.focus({ preventScroll: true }); try { inp.setSelectionRange(caret[0], caret[1]); } catch (e) { /* нет поддержки */ } }
}

function buildBody(el) {
  el.textContent = '';
  ui.frameEls = [];
  const B = rigOf();
  ui.zero = app.frame === 0;
  if (!B) { buildNone(el); ui.flash = ''; return; }
  const rigId = B.id;
  const R = rigMap(B);

  // заголовок: какой скелет и какой кадр
  const frameLbl = h('span', { class: 'ps-frame', title: 'Текущий кадр — сюда встанет поза' });
  const hint = h('div', { class: 'ps-hint' });
  ui.frameEls.push(() => {
    const f = app.frame;
    frameLbl.textContent = 'Кадр ' + f;
    frameLbl.classList.toggle('zero', f === 0);
    hint.textContent = f === 0 ? '' : `Нажмите на позу — она встанет на кадр ${f}. Ставьте позы на разные кадры (1, 12, 24…), движение между ними появится само.`;
  });
  ui.frameEls[0]();
  el.append(h('div', { class: 'ps-head' }, icon('bone', 16), h('span', { class: 'ps-rig', title: B.name }, h('b', null, B.name), ` · ${B.bones.length} ${bonesWord(B.bones.length)}`), frameLbl), hint);
  if (app.frame === 0) {
    const alt = Math.max(1, app.doc.start || 1);
    el.append(h('div', { class: 'ps-warn' }, h('span', null, 'Сейчас кадр 0 — поза покоя. Для анимации перейдите дальше.'),
      h('button', { class: 'btn sm', onclick: () => app.setFrame(alt) }, `На кадр ${alt}`)));
  }
  if (B.lock) el.append(h('div', { class: 'ps-warn' }, 'Слой костей заблокирован — позы не применятся. Снимите замок в списке слоёв.'));
  if (!B.bones.length) {
    el.append(sec(null, h('div', { class: 'ps-empty' }, 'В этом слое пока нет костей. Перейдите на кадр 0 и добавьте их инструментом «Добавить кость» (A).'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn sm', onclick: () => { app.setFrame(0); setTool('badd'); } }, icon('badd', 15), 'Добавить кости'))));
    ui.flash = '';
    return;
  }

  // ---- мои позы ----
  const saveBtn = h('button', { class: 'btn sm primary', title: 'Запомнить, как сейчас стоит персонаж (все кости на текущем кадре)', onclick: () => savePose(ui.input.value) }, icon('ps-save', 15), 'Сохранить позу');
  const poses = B.poses || [];
  const grid = h('div', { class: 'ps-grid' });
  poses.forEach((p, i) => {
    const key = 'u' + p.id;
    grid.append(card({
      key, name: p.name, thumb: p.thumb,
      onApply: () => applyPose(rigId, p, { flash: key }),
      acts: [act('ps-edit', 'Переименовать', () => renamePose(rigId, p.id)), act('trash', 'Удалить позу', () => deletePose(rigId, p.id), 'del')],
      menu: () => [
        { label: `Поставить на кадр ${app.frame}`, icon: 'poses', action: () => applyPose(rigId, p, { flash: key }) },
        { label: 'Поставить зеркально', icon: 'ps-mirror', disabled: !pairsOf(B).size, action: () => applyPose(rigId, p, { mirror: true, flash: key }) },
        { sep: true },
        { label: 'Переименовать…', icon: 'ps-edit', action: () => renamePose(rigId, p.id) },
        { label: 'Заменить текущей позой', icon: 'ps-save', action: () => updatePose(rigId, p.id) },
        { label: 'Сдвинуть влево', icon: 'prev', disabled: i === 0, action: () => movePose(rigId, p.id, -1) },
        { label: 'Сдвинуть вправо', icon: 'next', disabled: i === poses.length - 1, action: () => movePose(rigId, p.id, 1) },
        { sep: true },
        { label: 'Удалить', icon: 'trash', action: () => deletePose(rigId, p.id) },
      ],
    }));
  });
  el.append(sec('Мои позы',
    h('div', { class: 'ps-save' }, ui.input, saveBtn),
    poses.length ? grid : h('div', { class: 'ps-empty' }, 'Поставьте персонажа в позу (тяните кости инструментом «Управление костями», Z) и нажмите «Сохранить позу». Потом она ставится одним кликом на любой кадр.'),
  ));

  // ---- готовые позы ----
  if (R) {
    const thumbs = builtinThumbs(B, R);
    const g2 = h('div', { class: 'ps-grid' });
    for (const P of BUILTIN) {
      const key = 'b' + P.id;
      const pose = { name: P.name, data: (B2) => { const R2 = rigMap(B2); return R2 ? builtinData(R2, P) : new Map(); } };
      g2.append(card({
        key, name: P.name, tip: P.tip, thumb: thumbs.get(P.id),
        onApply: () => applyPose(rigId, pose, { flash: key }),
        menu: () => [
          { label: `Поставить на кадр ${app.frame}`, icon: 'poses', action: () => applyPose(rigId, pose, { flash: key }) },
          { label: 'Поставить зеркально', icon: 'ps-mirror', action: () => applyPose(rigId, pose, { mirror: true, flash: key }) },
          { sep: true },
          { label: 'Копировать в «Мои позы»', icon: 'copy', action: () => copyBuiltin(rigId, P) },
        ],
      }));
    }
    el.append(sec('Готовые позы', g2));
  }

  // ---- помощники ----
  const tool = (ic, title, desc, fn, extra) => h('div', { class: 'ps-toolw' },
    h('button', { class: 'ps-tool', onclick: fn }, icon(ic, 18), h('span', null, h('b', null, title), h('span', { class: 'd' }, desc))), extra || null);
  const tools = [
    tool('ps-between', 'Промежуточная поза', 'Встаньте между двумя позами — кости займут среднее положение. Движение станет живее.', breakdown),
  ];
  if (pairsOf(B).size) tools.push(tool('ps-mirror', 'Зеркально', 'Отразить текущую позу: ' + (R ? 'ближние и дальние руки и ноги меняются местами.' : 'левые и правые кости меняются местами.'), mirrorNow));
  if (R) {
    const walkOpts = h('div', { class: 'ps-walk-opts' },
      selectField('Темп', opt.tempo, { 16: 'быстро', 24: 'обычно', 32: 'медленно' }, (v) => { opt.tempo = v; saveOpt(); }),
      selectField('Длина', opt.cycles, { 1: '1 цикл', 2: '2 цикла', 3: '3 цикла', 4: '4 цикла', end: 'до конца сцены' }, (v) => { opt.cycles = v; saveOpt(); }),
    );
    tools.push(tool('ps-walk', 'Автоанимация: ходьба на месте', 'Ноги шагают, руки качаются, корпус пружинит — ключи от текущего кадра.', walkInPlace, walkOpts));
  }
  el.append(sec('Помощники', h('div', { class: 'ps-tools' }, ...tools)));

  // ---- настройки ----
  const sel = selectedOf(B);
  const opts = [
    selectField('После позы перейти', String(opt.advance), { 0: 'остаться на кадре', 6: 'на 6 кадров вперёд', 12: 'на 12 кадров вперёд', 24: 'на 24 кадра вперёд' }, (v) => { opt.advance = +v; saveOpt(); }),
  ];
  if (sel.size) {
    opts.unshift(checkField(`Только выделенные кости (${sel.size})`, opt.onlySel, (v) => { opt.onlySel = v; saveOpt(); app.refresh(['sidetabs']); },
      'Позы, промежуточная и зеркальная поза меняют только выделенные кости — например, только руку'));
  }
  el.append(sec('Настройки', h('div', { class: 'ps-opts' }, ...opts)));
  ui.flash = '';
}

function buildNone(el) {
  const rigs = app.idx.list.filter((L) => L.type === 'bone');
  const kids = [
    h('div', { class: 'ps-none-ic' }, icon('poses', 40)),
    h('b', null, 'Выберите слой костей или персонажа'),
    h('p', null, 'Позы работают со скелетом. Выберите персонажа в списке слоёв — подойдёт сам слой костей или любой слой внутри него.'),
  ];
  if (rigs.length) {
    kids.push(h('div', { class: 'ps-rigs' }, ...rigs.slice(0, 8).map((L) => h('button', { class: 'btn sm', onclick: () => pickRig(L.id) }, icon('bone', 15), `Выбрать «${L.name}»`))));
  } else {
    kids.push(h('p', { class: 'muted' }, 'В проекте пока нет скелета.'));
    kids.push(h('button', { class: 'btn primary', onclick: addCharacter }, icon('plus', 16), 'Добавить готового персонажа'));
    kids.push(h('p', { class: 'ps-small' }, 'Или нарисуйте своего и добавьте кости — подробности в справке (F1).'));
  }
  el.append(h('div', { class: 'ps-none' }, ...kids));
}

registerSideTab({ id: 'poses', title: 'Позы', icon: 'poses', order: 6, mount, refresh });

// ---------- меню, таймлайн, свойства ----------
registerMenu('Анимация', () => {
  const B = rigOf();
  return [
    { label: 'Позы персонажа…', icon: 'poses', action: openPoses },
    { label: 'Сохранить позу', icon: 'ps-save', disabled: () => !B || !B.bones.length, action: () => { savePose(''); openPoses(); } },
    { label: 'Промежуточная поза', icon: 'ps-between', disabled: () => !B || !B.bones.length, action: breakdown },
    { label: 'Зеркальная поза', icon: 'ps-mirror', disabled: () => !B || !pairsOf(B).size, action: mirrorNow },
    { label: 'Ходьба на месте', icon: 'ps-walk', disabled: () => !rigMap(B), action: walkInPlace },
  ];
});

registerTimelineMenu((ctx) => {
  const B = rigOf();
  if (!B || !B.bones.length || !ctx || !(ctx.frame > 0)) return [];
  return [{ label: `Промежуточная поза на кадре ${ctx.frame}`, icon: 'ps-between', action: () => { app.setFrame(ctx.frame); breakdown(); } }];
});

registerInspector({
  id: 'poses',
  order: 40,
  when: (L) => L.type === 'bone' && L.bones.length > 0,
  build: (L, { sec: section, h: hh }) => {
    const n = (L.poses || []).length;
    return section('Позы',
      hh('div', { class: 'insp-note' }, n ? `Сохранено поз: ${n}. ` : '', 'Ставьте готовые и свои позы на кадры в один клик.'),
      hh('div', { class: 'btn-row' }, hh('button', { class: 'btn sm', onclick: openPoses }, icon('poses', 15), 'Открыть позы')));
  },
});

addStyle(`
#side-body > #inspector[hidden] { display: none; }
.ps { padding: 8px 10px 24px; overflow-x: hidden; }
.ps-head { display: flex; align-items: center; gap: 7px; padding: 2px 0 8px; border-bottom: 1px solid var(--line); min-width: 0; }
.ps-head > .ic { color: var(--accent); }
.ps-rig { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 12.5px; color: var(--text2); }
.ps-rig b { color: #fff; font-weight: 600; }
.ps-frame { flex: none; font-size: 11.5px; color: var(--text); background: var(--bg2); border: 1px solid var(--line2); border-radius: 10px; padding: 1px 8px; font-variant-numeric: tabular-nums; }
.ps-frame.zero { color: #ffd2a6; border-color: rgba(255,173,92,.55); background: rgba(255,173,92,.12); }
.ps-hint { color: var(--text3); font-size: 11.5px; margin: 7px 0 0; }
.ps-hint:empty { display: none; }
.ps-warn { display: flex; align-items: center; gap: 8px; margin: 8px 0 0; padding: 7px 9px; border-radius: 6px; background: rgba(255,173,92,.1); border: 1px solid rgba(255,173,92,.35); color: #ffd9b0; font-size: 12px; }
.ps-warn > span { flex: 1; }
.ps-warn .btn { flex: none; }
.ps-sec { padding: 10px 0 6px; }
.ps-sec + .ps-sec { border-top: 1px solid var(--line); }
.ps-save { display: flex; gap: 6px; margin-bottom: 8px; }
.ps-save .txt { min-width: 0; font-size: 12px; }
.ps-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); gap: 6px; }
.ps-card { position: relative; min-width: 0; }
.ps-main { display: flex; flex-direction: column; align-items: stretch; gap: 3px; width: 100%; padding: 3px 3px 4px; border-radius: 7px; border: 1px solid var(--line2); background: var(--bg2); color: var(--text); text-align: center; }
.ps-main:hover { border-color: var(--accent); background: #26354a; }
.ps-main:active { transform: translateY(1px); }
.ps-thumb { display: block; width: 100%; aspect-ratio: 1; border-radius: 5px; background: linear-gradient(#f1f6fb, #d8e4ef); object-fit: contain; }
.ps-ph { display: flex; align-items: center; justify-content: center; color: #9fb2c6; }
.ps-name { font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 2px; }
.ps-acts { position: absolute; top: 6px; right: 6px; display: flex; gap: 3px; opacity: 0; transition: opacity .12s; }
.ps-card:hover .ps-acts, .ps-card:focus-within .ps-acts { opacity: 1; }
@media (hover: none) { .ps-acts { opacity: 1; } }
.ps-act { width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; padding: 0; border-radius: 5px; border: 1px solid rgba(0,0,0,.2); background: rgba(31,33,37,.85); color: var(--text); }
.ps-act:hover { background: var(--accent2); color: #fff; }
.ps-act.del:hover { background: #a8323f; }
.ps-card.flash .ps-main { animation: ps-flash .9s ease-out; }
@keyframes ps-flash { from { box-shadow: 0 0 0 3px rgba(76,157,255,.85); border-color: var(--accent); } to { box-shadow: 0 0 0 3px rgba(76,157,255,0); } }
.ps-empty { color: var(--text3); font-size: 12px; padding: 10px; border: 1px dashed var(--line2); border-radius: 7px; text-align: center; }
.ps-tools { display: flex; flex-direction: column; gap: 6px; }
.ps-tool { display: flex; align-items: flex-start; gap: 9px; width: 100%; padding: 7px 9px; border-radius: 7px; border: 1px solid var(--line2); background: var(--bg2); color: var(--text); text-align: left; }
.ps-tool:hover { border-color: var(--accent); background: #26354a; }
.ps-tool > .ic { color: var(--accent); margin-top: 1px; }
.ps-tool b { display: block; font-weight: 600; font-size: 12.5px; }
.ps-tool .d { display: block; color: var(--text2); font-size: 11.5px; margin-top: 1px; }
.ps-walk-opts { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 6px 8px; padding: 6px 0 0 30px; }
.ps-walk-opts > .sel { min-width: 0; gap: 5px; }
.ps-walk-opts select { width: 100%; }
.ps-walk-opts .sel, .ps-opts .sel { font-size: 12px; }
.ps-opts { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
.ps-none { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; padding: 24px 8px; }
.ps-none p { margin: 0; color: var(--text2); font-size: 12.5px; }
.ps-none b { color: #fff; font-size: 13.5px; }
.ps-none-ic { color: var(--accent); opacity: .8; }
.ps-rigs { display: flex; flex-direction: column; gap: 6px; align-items: stretch; width: 100%; max-width: 260px; }
.ps-rigs .btn { justify-content: center; overflow: hidden; text-overflow: ellipsis; }
.ps-small { font-size: 11.5px !important; color: var(--text3) !important; }
`, 'poses-css');
