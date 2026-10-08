// Компактный кодировщик анимированного GIF (median cut палитра + LZW), без зависимостей.

function rgb15(r, g, b) { return ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3); }

function buildPalette(hist, maxColors) {
  const colors = [];
  for (let i = 0; i < 32768; i++) if (hist[i]) colors.push(i);
  const ch = (c, k) => (k === 0 ? (c >> 10) & 31 : k === 1 ? (c >> 5) & 31 : c & 31);
  const avg = (list) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (const c of list) { const w = hist[c]; r += ch(c, 0) * w; g += ch(c, 1) * w; b += ch(c, 2) * w; n += w; }
    n = n || 1;
    return [Math.round((r / n) * 8.2258), Math.round((g / n) * 8.2258), Math.round((b / n) * 8.2258)];
  };
  if (colors.length <= maxColors) return colors.map((c) => avg([c]));
  const boxes = [colors];
  const range = (list) => {
    const mn = [31, 31, 31], mx = [0, 0, 0];
    for (const c of list) for (let k = 0; k < 3; k++) { const v = ch(c, k); if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
    let best = 0, bk = 0;
    for (let k = 0; k < 3; k++) if (mx[k] - mn[k] > best) { best = mx[k] - mn[k]; bk = k; }
    return [best, bk];
  };
  while (boxes.length < maxColors) {
    let bi = -1, bs = -1, bk = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].length < 2) continue;
      const [r, k] = range(boxes[i]);
      let cnt = 0;
      for (const c of boxes[i]) cnt += hist[c];
      const s = r * Math.sqrt(cnt);
      if (s > bs) { bs = s; bi = i; bk = k; }
    }
    if (bi < 0 || bs <= 0) break;
    const list = boxes[bi].sort((a, b) => ch(a, bk) - ch(b, bk));
    let total = 0;
    for (const c of list) total += hist[c];
    let acc = 0, cut = 1;
    for (let i = 0; i < list.length - 1; i++) { acc += hist[list[i]]; if (acc >= total / 2) { cut = i + 1; break; } }
    boxes.splice(bi, 1, list.slice(0, cut), list.slice(cut));
  }
  return boxes.map(avg);
}

let table = null, gen = 0;
function lzw(index, minCode, out) {
  const clear = 1 << minCode, eoi = clear + 1;
  let next = eoi + 1, size = minCode + 1;
  if (!table || gen > 500000) { table = new Int32Array(1 << 20); gen = 0; }
  gen++;
  let cur = 0, shift = 0;
  const bytes = [];
  const emit = (code) => {
    cur |= code << shift;
    shift += size;
    while (shift >= 8) { bytes.push(cur & 255); cur >>>= 8; shift -= 8; }
  };
  emit(clear);
  let ib = index[0];
  for (let i = 1; i < index.length; i++) {
    const k = index[i];
    const key = (ib << 8) | k;
    const v = table[key];
    if ((v >>> 12) === gen) { ib = v & 4095; continue; }
    emit(ib);
    if (next === 4096) {
      emit(clear);
      next = eoi + 1;
      size = minCode + 1;
      gen++;
    } else {
      if (next >= 1 << size) size++;
      table[key] = (gen << 12) | next++;
    }
    ib = k;
  }
  emit(ib);
  emit(eoi);
  if (shift > 0) bytes.push(cur & 255);
  out.push(minCode);
  for (let i = 0; i < bytes.length; i += 255) {
    const n = Math.min(255, bytes.length - i);
    out.push(n);
    for (let j = 0; j < n; j++) out.push(bytes[i + j]);
  }
  out.push(0);
}

// frames: ImageData[] одного размера; delay — в сотых долях секунды
export function encodeGIF(frames, w, h, delay, transparent = false, onProgress) {
  const hist = new Uint32Array(32768);
  for (const fr of frames) {
    const d = fr.data;
    const step = d.length > 4e6 ? 8 : 4;
    for (let i = 0; i < d.length; i += step) { if (transparent && d[i + 3] < 128) continue; hist[rgb15(d[i], d[i + 1], d[i + 2])]++; }
  }
  const pal = buildPalette(hist, transparent ? 255 : 256);
  while (pal.length < 256) pal.push([0, 0, 0]);
  const lut = new Int16Array(32768).fill(-1);
  const nearest = (c) => {
    const r = ((c >> 10) & 31) * 8.2258, g = ((c >> 5) & 31) * 8.2258, b = (c & 31) * 8.2258;
    let bi = 0, bd = Infinity;
    const n = transparent ? 255 : 256;
    for (let i = 0; i < n; i++) {
      const p = pal[i], dr = p[0] - r, dg = p[1] - g, db = p[2] - b;
      const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
      if (d < bd) { bd = d; bi = i; }
    }
    return bi;
  };
  const out = [];
  const str = (s) => { for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i)); };
  const u16 = (v) => out.push(v & 255, (v >> 8) & 255);
  str('GIF89a');
  u16(w); u16(h);
  out.push(0xf7, 0, 0);
  for (const p of pal) out.push(p[0], p[1], p[2]);
  out.push(0x21, 0xff, 11); str('NETSCAPE2.0'); out.push(3, 1); u16(0); out.push(0);
  const idx = new Uint8Array(w * h);
  frames.forEach((fr, n) => {
    const d = fr.data;
    for (let i = 0, j = 0; j < idx.length; i += 4, j++) {
      if (transparent && d[i + 3] < 128) { idx[j] = 255; continue; }
      const c = rgb15(d[i], d[i + 1], d[i + 2]);
      let v = lut[c];
      if (v < 0) v = lut[c] = nearest(c);
      idx[j] = v;
    }
    out.push(0x21, 0xf9, 4, transparent ? (2 << 2) | 1 : 1 << 2);
    u16(delay);
    out.push(transparent ? 255 : 0, 0);
    out.push(0x2c); u16(0); u16(0); u16(w); u16(h); out.push(0);
    lzw(idx, 8, out);
    onProgress && onProgress((n + 1) / frames.length);
  });
  out.push(0x3b);
  return new Uint8Array(out);
}
