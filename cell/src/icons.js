// icons.js — иконки PWA генерируются кодом на offscreen-canvas и
// подставляются как data-URL: apple-touch-icon в <head>, а манифест
// пересобирается в памяти и подключается через Blob-URL.

/** Рисует иконку размера size. maskable — с запасом полей под маску Android. */
export function drawIcon(size, maskable = false) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d');
  const s = size;

  // Фон — вода с виньеткой.
  const bg = c.createLinearGradient(0, 0, 0, s);
  bg.addColorStop(0, 'hsl(186 55% 22%)');
  bg.addColorStop(0.55, 'hsl(192 60% 12%)');
  bg.addColorStop(1, 'hsl(198 65% 6%)');
  c.fillStyle = bg;
  c.fillRect(0, 0, s, s);

  // Лучи света.
  c.save();
  c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 3; i++) {
    const x = s * (0.2 + i * 0.3);
    const g = c.createLinearGradient(x, 0, x + s * 0.18, s);
    g.addColorStop(0, 'hsl(180 80% 70% / .10)');
    g.addColorStop(1, 'transparent');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(x - s * 0.06, 0);
    c.lineTo(x + s * 0.08, 0);
    c.lineTo(x + s * 0.3, s);
    c.lineTo(x + s * 0.06, s);
    c.closePath();
    c.fill();
  }
  c.restore();

  // Клетка: тело, ядро, жгутик — та же геометрия, что и в игре.
  const k = maskable ? 0.62 : 0.78;   // запас полей для маски
  const cx = s * 0.54, cy = s * 0.5, r = s * 0.26 * k / 0.78;

  c.save();
  c.translate(cx, cy);

  // Жгутик.
  c.strokeStyle = 'hsl(165 80% 58%)';
  c.lineWidth = r * 0.26;
  c.lineCap = 'round';
  c.beginPath();
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const x = -r * 0.85 - t * r * 1.7;
    const y = Math.sin(t * 4.4 + 1.2) * r * 0.5 * t;
    i ? c.lineTo(x, y) : c.moveTo(x, y);
  }
  c.stroke();

  // Тело.
  c.beginPath();
  for (let i = 0; i <= 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    const rr = r * (1 + Math.sin(a * 3 + 0.6) * 0.07 + Math.sin(a * 5 - 1.1) * 0.035);
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr * 0.86;
    i ? c.lineTo(x, y) : c.moveTo(x, y);
  }
  c.closePath();
  const g = c.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r * 1.25);
  g.addColorStop(0, 'hsl(160 85% 74%)');
  g.addColorStop(0.55, 'hsl(174 72% 48%)');
  g.addColorStop(1, 'hsl(192 70% 26%)');
  c.fillStyle = g;
  c.fill();
  c.strokeStyle = 'hsl(186 90% 82% / .55)';
  c.lineWidth = Math.max(1, r * 0.05);
  c.stroke();

  // Ядро и блик.
  c.fillStyle = 'hsl(150 90% 76% / .95)';
  c.beginPath();
  c.arc(-r * 0.1, r * 0.06, r * 0.3, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = 'hsl(0 0% 100% / .35)';
  c.beginPath();
  c.ellipse(-r * 0.34, -r * 0.36, r * 0.3, r * 0.16, -0.6, 0, Math.PI * 2);
  c.fill();
  c.restore();

  return cv.toDataURL('image/png');
}

/**
 * Генерирует иконки и подключает их: apple-touch-icon ссылкой,
 * манифест — пересобранным Blob-URL (в файле manifest.json иконок нет).
 */
export function installIcons(manifestPath = './manifest.json') {
  try {
    const apple = drawIcon(180);
    const link = document.createElement('link');
    link.rel = 'apple-touch-icon';
    link.href = apple;
    document.head.appendChild(link);

    // Обычный favicon — маленький, чтобы вкладка тоже была своя.
    const fav = document.createElement('link');
    fav.rel = 'icon';
    fav.type = 'image/png';
    fav.href = drawIcon(64);
    document.head.appendChild(fav);

    fetch(manifestPath)
      .then((r) => r.json())
      .then((m) => {
        m.icons = [
          { src: drawIcon(192), sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: drawIcon(512), sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: drawIcon(512, true), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ];
        const blob = new Blob([JSON.stringify(m)], { type: 'application/manifest+json' });
        const url = URL.createObjectURL(blob);
        const ml = document.querySelector('link[rel="manifest"]') || document.createElement('link');
        ml.rel = 'manifest';
        ml.href = url;
        if (!ml.parentNode) document.head.appendChild(ml);
      })
      .catch(() => { /* без манифеста игра всё равно работает */ });
  } catch (e) { /* генерация иконок не критична */ }
}
