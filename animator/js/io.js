// Сохранение/открытие, автосохранение (IndexedDB), импорт изображений и звука, экспорт PNG/ZIP/видео/GIF/SVG.
import { app } from './app.js';
import { h, download, readFile, pickFile, clamp, M, rgba, bezierSegs, segsPath, varStrokePath, SvgPath } from './util.js';
import { evalCh } from './anim.js';
import { newLayer, usedAssets } from './model.js';
import { evaluate } from './scene.js';
import { Renderer, renderFrameTo, activeSwitchChild } from './render.js';
import { encodeGIF } from './gif.js';
import { dialog, numField, selectField, checkField } from './ui.js';
import { snapshot } from './history.js';

// ---------- IndexedDB ----------
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('anim2d', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function idbSet(k, v) {
  const db = await idb();
  return new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
export async function idbGet(k) {
  const db = await idb();
  return new Promise((res, rej) => { const tx = db.transaction('kv'); const q = tx.objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}

function serialize() {
  const used = usedAssets(app.doc);
  const assets = {};
  for (const id of used) if (app.doc.assets[id]) assets[id] = app.doc.assets[id];
  const s = JSON.parse(snapshot(app.doc));
  s.assets = assets;
  return JSON.stringify(s);
}

let saveTimer = 0;
export function scheduleAutosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try { await idbSet('autosave', serialize()); app.emit('autosaved'); } catch (e) { console.warn('Автосохранение не удалось', e); }
  }, 1200);
}

export function flushAutosave() {
  clearTimeout(saveTimer);
  return idbSet('autosave', serialize());
}

export async function loadAutosave() {
  try {
    const s = await idbGet('autosave');
    if (!s) return false;
    app.loadDoc(JSON.parse(s));
    return true;
  } catch (e) { console.warn(e); return false; }
}

// ---------- ассеты ----------
let actx = null;
export function audioCtx() { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); return actx; }

export function loadAssets() {
  const A = app.doc.assets || {};
  for (const id in A) {
    const a = A[id];
    if (a.type === 'image' && !app.images.has(id)) {
      const img = new Image();
      img.onload = () => app.render();
      img.src = a.data;
      app.images.set(id, img);
    }
    if (a.type === 'audio' && !app.audio.has(id)) {
      const rec = { buffer: null, _peaks: null, _fps: 0 };
      rec.peaksFor = (fps) => {
        if (!rec.buffer) return new Float32Array(0);
        if (rec._fps === fps && rec._peaks) return rec._peaks;
        const b = rec.buffer, d = b.getChannelData(0), per = b.sampleRate / fps;
        const n = Math.ceil(d.length / per), p = new Float32Array(n);
        let mx = 0.0001;
        for (let i = 0; i < n; i++) {
          let m = 0;
          const s = Math.floor(i * per), e = Math.min(d.length, Math.floor((i + 1) * per));
          for (let j = s; j < e; j += 4) { const v = Math.abs(d[j]); if (v > m) m = v; }
          p[i] = m; if (m > mx) mx = m;
        }
        for (let i = 0; i < n; i++) p[i] /= mx;
        rec._peaks = p; rec._fps = fps;
        return p;
      };
      app.audio.set(id, rec);
      fetch(a.data).then((r) => r.arrayBuffer()).then((buf) => audioCtx().decodeAudioData(buf)).then((ab) => { rec.buffer = ab; app.refresh(['timeline']); })
        .catch((e) => { console.warn(e); app.toast('Не удалось декодировать звук'); });
    }
  }
}
app.on('assets', loadAssets);

// ---------- проект ----------
export function saveProject() {
  const name = (app.doc.name || 'animation').replace(/[\\/:*?"<>|]+/g, '_');
  download(new Blob([serialize()], { type: 'application/json' }), name + '.anim2d.json');
  app.dirty = false;
  app.toast('Проект сохранён в файл');
}

export async function openProject(file) {
  file = file || await pickFile('.json,.anim2d,application/json');
  if (!file) return;
  try {
    const doc = JSON.parse(await readFile(file, 'text'));
    if (!doc || !Array.isArray(doc.layers)) throw new Error('bad');
    if (!doc.name || doc.name === 'Без названия') doc.name = file.name.replace(/(\.anim2d)?\.json$/i, '');
    app.loadDoc(doc);
    app.fitView && app.fitView();
    app.toast('Открыт проект «' + app.doc.name + '»');
  } catch (e) {
    app.toast('Не удалось открыть файл: это не проект редактора');
  }
}

export async function importImage(file) {
  file = file || await pickFile('image/*');
  if (!file) return;
  const data = await readFile(file);
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = data; }).catch(() => null);
  if (!img.naturalWidth) { app.toast('Не удалось загрузить изображение'); return; }
  const id = 'img' + app.doc.nid++;
  app.doc.assets[id] = { type: 'image', name: file.name, data };
  app.images.set(id, img);
  const L = newLayer(app.doc, 'image', file.name.replace(/\.[^.]+$/, ''));
  const k = Math.min(1, (app.doc.w * 0.9) / img.naturalWidth, (app.doc.h * 0.9) / img.naturalHeight);
  L.asset = id; L.w = Math.round(img.naturalWidth * k); L.h = Math.round(img.naturalHeight * k);
  app.insertLayer(L, { inside: !!(app.active && app.active.children) });
  app.commit('Импорт изображения');
  app.toast('Изображение добавлено слоем');
}

export async function importAudio(file) {
  file = file || await pickFile('audio/*');
  if (!file) return;
  const data = await readFile(file);
  const id = 'aud' + app.doc.nid++;
  app.doc.assets[id] = { type: 'audio', name: file.name, data };
  const L = newLayer(app.doc, 'audio', file.name.replace(/\.[^.]+$/, ''));
  L.asset = id;
  L.start = 1;
  app.doc.layers.push(L);
  app.restructure();
  loadAssets();
  app.activeId = L.id;
  app.commit('Импорт звука');
  app.toast('Звук добавлен: волна видна на таймлайне');
}

app.on('importImage', () => importImage());
app.on('importAudio', () => importAudio());

// ---------- ZIP (без сжатия) ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export function makeZip(files) {
  const parts = [], central = [];
  let off = 0;
  const enc = new TextEncoder();
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true); lh.setUint32(18, sz, true); lh.setUint32(22, sz, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true); ch.setUint32(20, sz, true); ch.setUint32(24, sz, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + sz;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

// ---------- рендер для экспорта ----------
function exportCanvas(scale) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(app.doc.w * scale));
  c.height = Math.max(1, Math.round(app.doc.h * scale));
  return c;
}
const renderer = new Renderer();
function renderFrame(c, f, scale, transparent) {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  renderFrameTo(ctx, app.doc, evaluate(app.doc, f), renderer, app.images, scale, transparent);
  return ctx;
}
const toBlob = (c, type = 'image/png') => new Promise((r) => c.toBlob(r, type));
const fname = () => (app.doc.name || 'animation').replace(/[\\/:*?"<>|]+/g, '_');
const pad = (n) => String(n).padStart(4, '0');

function progressDialog(title) {
  const bar = h('div', { class: 'pbar' }, h('div', { class: 'pbar-in' }));
  const txt = h('div', { class: 'insp-note' }, 'Подготовка…');
  let cancelled = false;
  const d = dialog({ title, body: h('div', null, bar, txt), buttons: [{ label: 'Отмена', action: () => { cancelled = true; } }], width: 360 });
  return {
    set(p, t) { bar.firstChild.style.width = Math.round(p * 100) + '%'; if (t) txt.textContent = t; },
    get cancelled() { return cancelled; },
    close() { d.close(); },
  };
}

async function exportPNG(o) {
  const c = exportCanvas(o.scale);
  renderFrame(c, app.frame, o.scale, o.transparent);
  download(await toBlob(c), `${fname()}_${pad(app.frame)}.png`);
}

async function exportZip(o) {
  const pd = progressDialog('PNG-последовательность');
  const c = exportCanvas(o.scale), files = [];
  for (let f = o.from; f <= o.to; f++) {
    if (pd.cancelled) return;
    renderFrame(c, f, o.scale, o.transparent);
    const b = await toBlob(c);
    files.push({ name: `${fname()}_${pad(f)}.png`, data: new Uint8Array(await b.arrayBuffer()) });
    pd.set((f - o.from + 1) / (o.to - o.from + 1), `Кадр ${f} из ${o.to}`);
  }
  pd.close();
  download(makeZip(files), fname() + '_png.zip');
}

async function exportGIF(o) {
  const pd = progressDialog('GIF');
  const c = exportCanvas(o.scale), frames = [];
  for (let f = o.from; f <= o.to; f++) {
    if (pd.cancelled) return;
    const ctx = renderFrame(c, f, o.scale, o.transparent);
    frames.push(ctx.getImageData(0, 0, c.width, c.height));
    pd.set(((f - o.from + 1) / (o.to - o.from + 1)) * 0.5, `Рендер кадра ${f}`);
    if (f % 4 === 0) await new Promise((r) => setTimeout(r));
  }
  pd.set(0.5, 'Кодирование…');
  await new Promise((r) => setTimeout(r, 30));
  const data = encodeGIF(frames, c.width, c.height, Math.max(2, Math.round(100 / app.doc.fps)), o.transparent);
  pd.close();
  download(new Blob([data], { type: 'image/gif' }), fname() + '.gif');
}

function pickMime() {
  const list = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8,opus', 'video/webm'];
  if (!window.MediaRecorder) return null;
  return list.find((m) => MediaRecorder.isTypeSupported(m)) || null;
}

async function exportVideo(o) {
  const mime = pickMime();
  if (!mime) { app.toast('Браузер не поддерживает запись видео (MediaRecorder)'); return; }
  const c = exportCanvas(o.scale);
  const fps = app.doc.fps;
  const stream = c.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const sources = [];
  if (o.audio) {
    const ac = audioCtx();
    await ac.resume();
    const dest = ac.createMediaStreamDestination();
    for (const L of app.idx.list) {
      const a = L.type === 'audio' && L.vis && app.audio.get(L.asset);
      if (!a || !a.buffer) continue;
      const src = ac.createBufferSource(), g = ac.createGain();
      src.buffer = a.buffer; g.gain.value = L.vol;
      src.connect(g).connect(dest);
      sources.push({ src, off: (o.from - L.start) / fps });
    }
    if (sources.length) stream.addTrack(dest.stream.getAudioTracks()[0]);
  }
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: Math.round(8e6 * o.scale * o.scale) + 2e6 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((r) => (rec.onstop = r));
  const pd = progressDialog('Видео (' + (mime.includes('mp4') ? 'MP4' : 'WebM') + ')');
  renderFrame(c, o.from, o.scale, false);
  rec.start(250);
  const t0 = performance.now();
  for (const s of sources) {
    const ac = audioCtx();
    if (s.off >= 0) s.src.start(0, s.off); else s.src.start(ac.currentTime - s.off);
  }
  for (let f = o.from, i = 0; f <= o.to; f++, i++) {
    if (pd.cancelled) break;
    renderFrame(c, f, o.scale, false);
    track.requestFrame && track.requestFrame();
    pd.set((i + 1) / (o.to - o.from + 1), `Запись кадра ${f} (в реальном времени)`);
    const wait = t0 + ((i + 1) * 1000) / fps - performance.now();
    await new Promise((r) => setTimeout(r, Math.max(0, wait)));
  }
  for (const s of sources) try { s.src.stop(); } catch (e) { /* уже остановлен */ }
  rec.stop();
  await done;
  pd.close();
  if (pd.cancelled) return;
  const ext = mime.includes('mp4') ? 'mp4' : 'webm';
  download(new Blob(chunks, { type: mime.split(';')[0] }), `${fname()}.${ext}`);
}

// ---------- SVG ----------
function svgFrame(f, transparent) {
  const doc = app.doc, S = evaluate(doc, f);
  const c = S.cam;
  const defs = [];
  let uid = 0;
  const col = (v) => `rgb(${clamp(Math.round(v[0]), 0, 255)},${clamp(Math.round(v[1]), 0, 255)},${clamp(Math.round(v[2]), 0, 255)})`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]);
  const layer = (L) => {
    if (!L.vis || L.type === 'audio') return '';
    const rec = S.layers.get(L.id);
    if (!rec) return '';
    let body = '';
    if (L.type === 'vector') {
      for (const pr of rec.paths) {
        if (pr.xs.length < 2) continue;
        const segs = bezierSegs(pr.xs, pr.ys, pr.cs, pr.path.closed);
        const P = segsPath(segs, pr.path.closed, new SvgPath());
        if (pr.path.hf && pr.path.closed && pr.fill[3] > 0) body += `<path d="${P.d}" fill="${col(pr.fill)}" fill-opacity="${pr.fill[3]}"/>`;
        if (pr.path.hs && pr.width > 0 && pr.stroke[3] > 0) {
          const lw = pr.width * rec.lw;
          if ([...pr.ws].every((w) => w === 1)) body += `<path d="${P.d}" fill="none" stroke="${col(pr.stroke)}" stroke-opacity="${pr.stroke[3]}" stroke-width="${lw.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`;
          else body += `<path d="${varStrokePath(segs, pr.ws, lw, pr.path.closed, new SvgPath()).d}" fill="${col(pr.stroke)}" fill-opacity="${pr.stroke[3]}"/>`;
        }
      }
    } else if (L.type === 'image') {
      const a = doc.assets[L.asset];
      if (a) body = `<image href="${a.data}" x="${-L.w / 2}" y="${-L.h / 2}" width="${L.w}" height="${L.h}" transform="matrix(${rec.world.map((v) => v.toFixed(4)).join(' ')})" preserveAspectRatio="none"/>`;
    } else if (L.type === 'switch') {
      const ch = activeSwitchChild(L, f);
      if (ch) body = layer(ch);
    } else if (L.type === 'group' && L.mask && L.children.length > 1) {
      const id = 'm' + uid++;
      const m = layer(L.children[0]);
      defs.push(`<mask id="${id}" mask-type="alpha" maskUnits="userSpaceOnUse" x="-100000" y="-100000" width="200000" height="200000">${m}</mask>`);
      body = (L.maskShow ? m : '') + `<g mask="url(#${id})">${L.children.slice(1).map(layer).join('')}</g>`;
    } else if (L.children) body = L.children.map(layer).join('');
    const op = clamp(rec.op, 0, 1);
    const attrs = [`data-name="${esc(L.name)}"`];
    if (op < 1) attrs.push(`opacity="${op.toFixed(3)}"`);
    if (L.blend && L.blend !== 'source-over') attrs.push(`style="mix-blend-mode:${L.blend === 'lighter' ? 'plus-lighter' : L.blend}"`);
    if (L.blur > 0 || L.shOn) {
      const id = 'f' + uid++;
      let fx = '';
      if (L.shOn) fx += `<feDropShadow dx="${L.shX}" dy="${L.shY}" stdDeviation="${L.shBlur / 2}" flood-color="${L.shCol}" flood-opacity="${L.shA}"/>`;
      if (L.blur > 0) fx += `<feGaussianBlur stdDeviation="${L.blur / 2}"/>`;
      defs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">${fx}</filter>`);
      attrs.push(`filter="url(#${id})"`);
    }
    return op <= 0 ? '' : `<g ${attrs.join(' ')}>${body}</g>`;
  };
  const content = doc.layers.map(layer).join('');
  const m = [c[0], c[1], c[2], c[3], c[4] + doc.w / 2, c[5] + doc.h / 2].map((v) => +v.toFixed(5)).join(' ');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${doc.w}" height="${doc.h}" viewBox="0 0 ${doc.w} ${doc.h}">` +
    `<defs>${defs.join('')}</defs>` + (transparent ? '' : `<rect width="100%" height="100%" fill="${doc.bg}"/>`) +
    `<g transform="matrix(${m})">${content}</g></svg>`;
}

async function exportSVG(o) {
  download(new Blob([svgFrame(app.frame, o.transparent)], { type: 'image/svg+xml' }), `${fname()}_${pad(app.frame)}.svg`);
}

const FORMATS = {
  video: 'Видео (MP4/WebM)',
  gif: 'Анимированный GIF',
  zip: 'PNG-последовательность (ZIP)',
  png: 'PNG — текущий кадр',
  svg: 'SVG — текущий кадр',
};

let lastExport = { fmt: 'video', scale: 1, transparent: false, audio: true };
export function exportDialog(fmt) {
  const o = { ...lastExport, fmt: fmt || lastExport.fmt, from: app.doc.start, to: app.doc.end };
  const body = h('div', { class: 'form' });
  const build = () => {
    body.textContent = '';
    const seq = ['video', 'gif', 'zip'].includes(o.fmt);
    body.append(
      selectField('Формат', o.fmt, FORMATS, (v) => { o.fmt = v; build(); }),
      selectField('Размер', String(o.scale), { 0.25: '25%', 0.5: '50%', 1: '100%', 2: '200%' }, (v) => { o.scale = +v; info(); }),
    );
    if (seq) body.append(h('div', { class: 'insp-row' },
      numField('С кадра', o.from, { min: 0, step: 1, prec: 0, onCommit: (v) => { o.from = Math.round(v); } }),
      numField('по', o.to, { min: 0, step: 1, prec: 0, onCommit: (v) => { o.to = Math.round(v); } }),
    ));
    if (o.fmt !== 'video') body.append(checkField('Прозрачный фон', o.transparent, (v) => { o.transparent = v; }));
    if (o.fmt === 'video') body.append(checkField('Со звуком (аудиослои)', o.audio, (v) => { o.audio = v; }));
    body.append(infoEl);
    info();
  };
  const infoEl = h('div', { class: 'insp-note' });
  const info = () => {
    const w = Math.round(app.doc.w * o.scale), hh = Math.round(app.doc.h * o.scale);
    let t = `${w}×${hh} px`;
    if (o.fmt === 'video') t += ` · ${app.doc.fps} к/с · запись идёт в реальном времени` + (pickMime() ? '' : ' · ⚠ не поддерживается браузером');
    if (o.fmt === 'gif') t += ' · для GIF лучше размер 50%';
    infoEl.textContent = t;
  };
  build();
  dialog({
    title: 'Экспорт',
    body,
    width: 400,
    buttons: [{ label: 'Отмена' }, { label: 'Экспортировать', primary: true, action: () => {
      lastExport = { fmt: o.fmt, scale: o.scale, transparent: o.transparent, audio: o.audio };
      o.from = clamp(o.from, 0, 100000); o.to = Math.max(o.from, o.to);
      setTimeout(() => {
        const run = { png: exportPNG, zip: exportZip, gif: exportGIF, video: exportVideo, svg: exportSVG }[o.fmt];
        run(o).catch((e) => { console.error(e); app.toast('Ошибка экспорта: ' + e.message); });
      }, 50);
    } }],
  });
}

export { svgFrame, renderFrame, M, rgba, evalCh };
