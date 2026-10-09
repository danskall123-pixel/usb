// UI-примитивы: меню, контекстные меню, диалоги, уведомления, числовые поля с перетаскиванием, цвет.
import { h, clamp, fmt, rgb2hex, hex2rgb } from './util.js';
import { icon } from './icons.js';

// ---------- Меню ----------
let openMenu = null;
export function closeMenu() {
  if (openMenu) { openMenu.el.remove(); openMenu.onClose && openMenu.onClose(); openMenu = null; }
}
document.addEventListener('pointerdown', (e) => { if (openMenu && !openMenu.el.contains(e.target) && !(openMenu.anchor && openMenu.anchor.contains(e.target))) closeMenu(); }, true);
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);

// items: [{ label, key, action, checked, disabled, sep, sub: [] }]
export function showMenu(items, x, y, { anchor, onClose, minWidth } = {}) {
  closeMenu();
  const el = buildMenu(items);
  if (minWidth) el.style.minWidth = minWidth + 'px';
  document.body.append(el);
  const r = el.getBoundingClientRect();
  el.style.left = clamp(x, 4, window.innerWidth - r.width - 4) + 'px';
  el.style.top = clamp(y, 4, window.innerHeight - r.height - 4) + 'px';
  openMenu = { el, anchor, onClose };
  return el;
}

function buildMenu(items) {
  const el = h('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (!it) continue;
    if (it.sep) { el.append(h('div', { class: 'menu-sep' })); continue; }
    if (it.title) { el.append(h('div', { class: 'menu-title' }, it.title)); continue; }
    const dis = typeof it.disabled === 'function' ? it.disabled() : it.disabled;
    const chk = typeof it.checked === 'function' ? it.checked() : it.checked;
    const row = h('button', { class: 'menu-item' + (dis ? ' dis' : ''), role: 'menuitem', disabled: !!dis },
      h('span', { class: 'menu-check' }, chk ? '✓' : ''),
      it.icon ? icon(it.icon, 16) : h('span', { class: 'menu-ic' }),
      h('span', { class: 'menu-label' }, typeof it.label === 'function' ? it.label() : it.label),
      h('span', { class: 'menu-key' }, it.key || ''),
      it.sub ? h('span', { class: 'menu-sub' }, '›') : null,
    );
    if (it.sub) {
      row.addEventListener('pointerenter', () => {
        el.querySelectorAll('.menu.sub').forEach((s) => s.remove());
        const sub = buildMenu(it.sub);
        sub.classList.add('sub');
        el.append(sub);
        const rr = row.getBoundingClientRect(), pr = el.getBoundingClientRect();
        sub.style.left = rr.width - 2 + 'px';
        sub.style.top = rr.top - pr.top - 4 + 'px';
        const sr = sub.getBoundingClientRect();
        if (sr.right > window.innerWidth) sub.style.left = -sr.width + 2 + 'px';
        const over = sr.bottom - (window.innerHeight - 4);
        if (over > 0) sub.style.top = Math.max(4 - pr.top, rr.top - pr.top - 4 - over) + 'px';
      });
    } else {
      row.addEventListener('pointerenter', () => el.querySelectorAll(':scope > .menu.sub').forEach((s) => s.remove()));
      row.addEventListener('click', (e) => { e.stopPropagation(); if (dis) return; closeMenu(); it.action && it.action(); });
    }
    el.append(row);
  }
  return el;
}

// ---------- Уведомления ----------
let toastWrap = null;
export function toast(msg, ms = 2200) {
  if (!toastWrap) { toastWrap = h('div', { class: 'toasts', 'aria-live': 'polite' }); document.body.append(toastWrap); }
  const t = h('div', { class: 'toast' }, msg);
  toastWrap.append(t);
  while (toastWrap.children.length > 3) toastWrap.firstChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

// ---------- Диалоги ----------
export function dialog({ title, body, buttons = [{ label: 'OK', primary: true }], width = 420, onClose }) {
  const back = h('div', { class: 'modal-back' });
  const close = (v) => { back.remove(); document.removeEventListener('keydown', key, true); onClose && onClose(v); };
  const foot = h('div', { class: 'modal-foot' });
  for (const b of buttons) {
    foot.append(h('button', { class: 'btn' + (b.primary ? ' primary' : ''), onclick: async () => { if (b.action) { const r = await b.action(); if (r === false) return; } close(b.value); } }, b.label));
  }
  const box = h('div', { class: 'modal', style: { width: width + 'px' }, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' }, h('span', null, title), h('button', { class: 'icon-btn', title: 'Закрыть', onclick: () => close() }, '✕')),
    h('div', { class: 'modal-body' }, body),
    foot,
  );
  back.append(box);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  const key = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
      const p = buttons.find((b) => b.primary);
      if (p) {
        e.preventDefault();
        e.stopPropagation();
        // сначала применить введённое значение поля, затем подтвердить
        if (e.target.tagName === 'INPUT') e.target.dispatchEvent(new Event('change'));
        foot.querySelector('.primary').click();
      }
    }
  };
  document.addEventListener('keydown', key, true);
  document.body.append(back);
  const first = box.querySelector('input, select, button.primary');
  if (first) setTimeout(() => first.focus(), 0);
  return { close, box };
}

export function confirmDialog(title, text, okLabel = 'OK') {
  return new Promise((res) => {
    dialog({ title, body: h('p', null, text), buttons: [{ label: 'Отмена', value: false }, { label: okLabel, primary: true, value: true }], onClose: (v) => res(!!v) });
  });
}

// ---------- Поля ввода ----------
// Числовое поле: перетаскивание подписи меняет значение (Shift ×10, Alt ×0.1)
export function numField(label, value, o = {}) {
  const { step = 1, min = -Infinity, max = Infinity, prec = 2, unit, onLive, onCommit, title, width } = o;
  let v = value, moved = false;
  const inp = h('input', { class: 'num-in', type: 'text', inputmode: 'decimal', value: fmt(v, prec), 'aria-label': title || label, style: width ? { width: width + 'px' } : null });
  const lab = h('span', { class: 'num-l', title: (title || label) + ' — тяните влево/вправо' }, label);
  const wrap = h('label', { class: 'num' }, lab, inp, unit ? h('span', { class: 'num-u' }, unit) : null);
  lab.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    lab.setPointerCapture(e.pointerId);
    const x0 = e.clientX, v0 = v;
    moved = false;
    const mv = (ev) => {
      const k = (ev.shiftKey ? 10 : 1) * (ev.altKey ? 0.1 : 1);
      const nv = clamp(v0 + Math.round((ev.clientX - x0) / 2) * step * k, min, max);
      if (nv !== v) { v = nv; moved = true; inp.value = fmt(v, prec); onLive && onLive(v); }
    };
    const up = () => { lab.removeEventListener('pointermove', mv); lab.removeEventListener('pointerup', up); if (moved) onCommit && onCommit(v); };
    lab.addEventListener('pointermove', mv);
    lab.addEventListener('pointerup', up);
  });
  const commit = () => {
    let nv = parseFloat(String(inp.value).replace(',', '.'));
    if (!isFinite(nv)) { inp.value = fmt(v, prec); return; }
    nv = clamp(nv, min, max);
    if (nv !== v) { v = nv; onLive && onLive(v); onCommit && onCommit(v); }
    inp.value = fmt(v, prec);
  };
  inp.addEventListener('change', commit);
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { commit(); inp.blur(); }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const k = (e.shiftKey ? 10 : 1) * (e.altKey ? 0.1 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
      v = clamp(v + step * k, min, max); inp.value = fmt(v, prec); onLive && onLive(v); onCommit && onCommit(v);
    }
    e.stopPropagation();
  });
  wrap.set = (nv) => { v = nv; if (document.activeElement !== inp) inp.value = fmt(v, prec); };
  return wrap;
}

export function rangeField(label, value, o = {}) {
  const { min = 0, max = 1, step = 0.01, onLive, onCommit, prec = 2 } = o;
  const out = h('span', { class: 'rng-v' }, fmt(value, prec));
  const r = h('input', { type: 'range', min, max, step, value, 'aria-label': label });
  r.addEventListener('input', () => { out.textContent = fmt(+r.value, prec); onLive && onLive(+r.value); });
  r.addEventListener('change', () => onCommit && onCommit(+r.value));
  r.addEventListener('keydown', (e) => e.stopPropagation());
  const wrap = h('label', { class: 'rng' }, h('span', { class: 'rng-l' }, label), r, out);
  wrap.set = (v) => { r.value = v; out.textContent = fmt(v, prec); };
  return wrap;
}

export function checkField(label, value, onChange, title) {
  const c = h('input', { type: 'checkbox', checked: !!value });
  c.addEventListener('change', () => onChange(c.checked));
  return h('label', { class: 'chk', title: title || '' }, c, h('span', null, label));
}

export function selectField(label, value, items, onChange) {
  const s = h('select', { 'aria-label': label }, Object.entries(items).map(([k, v]) => h('option', { value: k, selected: k === String(value) }, v)));
  s.addEventListener('change', () => onChange(s.value));
  s.addEventListener('keydown', (e) => e.stopPropagation());
  return label ? h('label', { class: 'sel' }, h('span', null, label), s) : s;
}

// Цвет RGBA: образец + нативный выбор + прозрачность
export function colorField(label, rgbaV, { onLive, onCommit, enabled, onToggle } = {}) {
  let c = rgbaV.slice();
  const inp = h('input', { type: 'color', value: rgb2hex(c), 'aria-label': label });
  const sw = h('span', { class: 'swatch' }, h('span', { class: 'swatch-c', style: { background: `rgba(${c[0]},${c[1]},${c[2]},${c[3]})` } }), inp);
  const a = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: c[3], class: 'alpha', title: 'Непрозрачность', 'aria-label': label + ': непрозрачность' });
  const upd = () => { sw.firstChild.style.background = `rgba(${c[0]},${c[1]},${c[2]},${c[3]})`; };
  inp.addEventListener('input', () => { const [r, g, b] = hex2rgb(inp.value); c = [r, g, b, c[3]]; upd(); onLive && onLive(c.slice()); });
  inp.addEventListener('change', () => onCommit && onCommit(c.slice()));
  a.addEventListener('input', () => { c[3] = +a.value; upd(); onLive && onLive(c.slice()); });
  a.addEventListener('change', () => onCommit && onCommit(c.slice()));
  a.addEventListener('keydown', (e) => e.stopPropagation());
  const kids = [];
  if (onToggle) {
    const cb = h('input', { type: 'checkbox', checked: !!enabled, title: 'Включить', 'aria-label': label + ': включить' });
    cb.addEventListener('change', () => onToggle(cb.checked));
    kids.push(cb);
  }
  return h('div', { class: 'colorf' }, ...kids, h('span', { class: 'colorf-l' }, label), sw, a);
}

export function iconBtn(name, title, onclick, cls = '') {
  return h('button', { class: 'icon-btn ' + cls, title, 'aria-label': title, onclick }, icon(name, 18));
}
