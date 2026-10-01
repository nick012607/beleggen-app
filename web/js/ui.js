// Kleine DOM- en opmaakhulpen. Alles via textContent/attributen, nooit innerHTML met data.

/** h('div', {class: 'x', onclick: fn}, 'tekst', kindNode, [meer]) */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function mount(target, ...children) {
  target.replaceChildren();
  append(target, children);
}

const nf = (opts) => new Intl.NumberFormat('nl-NL', opts);
const eurFmt = nf({ style: 'currency', currency: 'EUR' });

export const fmtEur = n => (n == null || Number.isNaN(+n) ? '–' : eurFmt.format(+n));
export const fmtMoney = (n, ccy = 'EUR') => (n == null ? '–' : nf({ style: 'currency', currency: ccy, maximumFractionDigits: 4, minimumFractionDigits: 2 }).format(+n));
export const fmtNum = (n, max = 4) => (n == null ? '–' : nf({ maximumFractionDigits: max }).format(+n));
export const fmtPct = n => (n == null || !Number.isFinite(n) ? '–' : nf({ style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(n));
export const fmtSignedEur = n => (n == null ? '–' : nf({ style: 'currency', currency: 'EUR', signDisplay: 'exceptZero' }).format(+n));
export const fmtDate = iso => (iso ? new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) : '–');
export const fmtDateTime = iso => (iso ? new Date(iso).toLocaleString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');

/** Klasse voor positief/negatief rendement. */
export const signClass = n => (n == null || n === 0 ? '' : n > 0 ? 'pos' : 'neg');

/** Leest een getal uit een invoerveld; accepteert komma of punt. */
export function inputNumber(value) {
  const s = String(value ?? '').trim().replace(/\s/g, '');
  if (!s) return null;
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? n : NaN;
}

let toastTimer;
export function toast(message, kind = 'info') {
  let el = document.getElementById('toast');
  if (!el) { el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(el); }
  el.textContent = message;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), kind === 'error' ? 7000 : 3500);
}

export const KIND_LABELS = { etf: 'ETF', stock: 'Aandeel', fund: 'Fonds', cash: 'Cash', other: 'Overig' };
