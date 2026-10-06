// SVG-grafieken (lijn en donut) met tooltip/hover. Geen afhankelijkheden.
import { h } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  return el;
};

export const pct1 = x => `${(x * 100).toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/**
 * series: [{ label, className?, color?, dashed?, hidden?, points: [{date, value|null}] }]
 * Alle series op dezelfde datums; null = (nog) geen waarde, de lijn begint later.
 * Opties: format (as + tooltip), zeroLine (0-lijn tonen), onToggle(index) maakt de legenda klikbaar.
 */
export function lineChart(series, { height = 260, format = String, zeroLine = false, onToggle = null } = {}) {
  const wrap = h('div', { class: 'chart' });
  const tip = h('div', { class: 'chart-tip', hidden: true });
  const swatch = s => h('i', { style: s.color ? `background:${s.color}` : null });
  wrap.append(h('div', { class: 'chart-legend' }, series.map((s, k) => onToggle
    ? h('button', { type: 'button', class: `key toggle ${s.className ?? ''}${s.hidden ? ' off' : ''}`, 'aria-pressed': String(!s.hidden), onclick: () => onToggle(k) }, swatch(s), s.label)
    : h('span', { class: `key ${s.className ?? ''}` }, swatch(s), s.label))));

  const shown = series.filter(s => !s.hidden);
  const base = series[0]?.points ?? [];
  const all = shown.flatMap(s => s.points.map(p => p.value)).filter(Number.isFinite);
  if (base.length < 2 || !all.length) {
    wrap.append(h('p', { class: 'muted' }, shown.length ? 'Nog te weinig koersdata voor een grafiek.' : 'Kies hierboven minstens één lijn.'));
    return wrap;
  }

  // Op smalle schermen tekenen we op een smallere maat, zodat as-tekst leesbaar blijft na schalen.
  const narrow = matchMedia('(max-width: 600px)').matches;
  const W = narrow ? 400 : 800, H = narrow ? Math.round(height * 0.85) : height, padL = narrow ? 48 : 64, padR = 8, padT = 10, padB = 26;
  const extra = zeroLine ? [0] : [];
  const { min, max, step } = niceScale(Math.min(...all, ...extra), Math.max(...all, ...extra));
  const x = i => padL + (i / (base.length - 1)) * (W - padL - padR);
  const y = v => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
  const stroke = s => (s.color ? { style: `stroke:${s.color}` } : {});

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': 'Grafiek van het verloop' });

  // rasterlijnen + y-labels
  for (let v = min; v <= max + step / 2; v += step) {
    const isZero = Math.abs(v) < step / 1000;
    svg.append(svgEl('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v), class: zeroLine && isZero ? 'grid zero' : 'grid' }));
    const t = svgEl('text', { x: padL - 8, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' });
    t.textContent = format(isZero ? 0 : v);
    svg.append(t);
  }
  // x-labels: begin, midden, eind
  for (const i of [0, Math.floor((base.length - 1) / 2), base.length - 1]) {
    const t = svgEl('text', { x: x(i), y: H - 6, class: 'axis', 'text-anchor': i === 0 ? 'start' : i === base.length - 1 ? 'end' : 'middle' });
    t.textContent = new Date(base[i].date).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: '2-digit' });
    svg.append(t);
  }
  for (const s of shown) {
    let d = '', pen = false;
    s.points.forEach((p, i) => {
      if (p.value == null || !Number.isFinite(p.value)) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;
      pen = true;
    });
    svg.append(svgEl('path', { d, class: `line ${s.className ?? ''}${s.dashed ? ' dashed' : ''}`, ...stroke(s) }));
  }

  const cross = svgEl('line', { y1: padT, y2: H - padB, class: 'cross', visibility: 'hidden' });
  const dots = shown.map(s => { const c = svgEl('circle', { r: 4, class: `dot ${s.className ?? ''}`, visibility: 'hidden', ...stroke(s) }); svg.append(c); return c; });
  svg.append(cross);

  const overlay = svgEl('rect', { x: padL, y: padT, width: W - padL - padR, height: H - padT - padB, fill: 'transparent' });
  svg.append(overlay);
  const move = e => {
    const r = svg.getBoundingClientRect();
    const px = ((e.touches?.[0]?.clientX ?? e.clientX) - r.left) / r.width * W;
    const i = Math.max(0, Math.min(base.length - 1, Math.round((px - padL) / (W - padL - padR) * (base.length - 1))));
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    shown.forEach((s, k) => {
      const v = s.points[i].value;
      dots[k].setAttribute('visibility', v == null ? 'hidden' : 'visible');
      if (v != null) { dots[k].setAttribute('cx', x(i)); dots[k].setAttribute('cy', y(v)); }
    });
    const rows = shown.filter(s => s.points[i].value != null);
    if (shown.length > 3) rows.sort((a, b) => b.points[i].value - a.points[i].value);
    tip.replaceChildren(
      h('strong', {}, new Date(base[i].date).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })),
      ...rows.map(s => h('div', { class: `key ${s.className ?? ''}` }, swatch(s), `${s.label}: ${format(s.points[i].value)}`)));
    tip.hidden = false;
    const left = (x(i) / W) * r.width;
    tip.style.left = `${Math.min(Math.max(left, 110), r.width - 110)}px`;
  };
  const leave = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dots.forEach(d => d.setAttribute('visibility', 'hidden')); };
  overlay.addEventListener('mousemove', move);
  overlay.addEventListener('touchmove', move, { passive: true });
  overlay.addEventListener('mouseleave', leave);
  overlay.addEventListener('touchend', leave);

  wrap.append(h('div', { class: 'chart-area' }, svg, tip));
  return wrap;
}

/**
 * Donutdiagram met legenda (naam, percentage, bedrag). rows: [{label, value, color}]
 * 2px tussenruimte tussen segmenten; aanwijzen/tikken toont het segment in het midden.
 */
export function donutChart(rows, { format = String, centerLabel = 'Totaal' } = {}) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  const size = 220, R = 100, r0 = 64, cx = size / 2, cy = size / 2;
  const svg = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, class: 'donut-svg', role: 'img', 'aria-label': 'Verdeling van de portefeuille' });
  const center = svgEl('text', { x: cx, y: cy - 2, 'text-anchor': 'middle', class: 'donut-value' });
  const centerSub = svgEl('text', { x: cx, y: cy + 18, 'text-anchor': 'middle', class: 'donut-label' });
  const showCenter = (value, label) => { center.textContent = value; centerSub.textContent = label; };
  showCenter(format(total), centerLabel);

  const legendItems = [];
  const p = (rad, ang) => `${(cx + rad * Math.cos(ang)).toFixed(2)},${(cy + rad * Math.sin(ang)).toFixed(2)}`;
  const gap = rows.length > 1 ? 2 / R : 0;
  let angle = -Math.PI / 2;
  rows.forEach((row, k) => {
    const frac = total ? row.value / total : 0;
    const a0 = angle + gap / 2, a1 = angle + frac * 2 * Math.PI - gap / 2;
    angle += frac * 2 * Math.PI;
    const pctText = pct1(frac);
    const focus = on => {
      seg?.classList.toggle('active', on);
      legendItems[k].classList.toggle('active', on);
      showCenter(on ? pctText : format(total), on ? (row.label.length > 24 ? `${row.label.slice(0, 23)}…` : row.label) : centerLabel);
    };
    let seg = null;
    if (a1 > a0) {
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const d = frac >= 0.9999
        ? `M${cx},${cy - R}A${R},${R} 0 1 1 ${cx - 0.01},${cy - R}ZM${cx},${cy - r0}A${r0},${r0} 0 1 0 ${cx + 0.01},${cy - r0}Z`
        : `M${p(R, a0)}A${R},${R} 0 ${large} 1 ${p(R, a1)}L${p(r0, a1)}A${r0},${r0} 0 ${large} 0 ${p(r0, a0)}Z`;
      seg = svgEl('path', { d, class: 'donut-seg', style: `fill:${row.color}`, tabindex: 0, 'aria-label': `${row.label}: ${pctText}` });
      for (const [ev, on] of [['mouseenter', true], ['mouseleave', false], ['focus', true], ['blur', false]]) seg.addEventListener(ev, () => focus(on));
      svg.append(seg);
    }
    legendItems[k] = h('li', { onmouseenter: () => focus(true), onmouseleave: () => focus(false) },
      h('i', { style: `background:${row.color}` }),
      h('span', { class: 'name' }, row.label),
      h('span', { class: 'pct' }, pctText),
      h('span', { class: 'muted amt' }, format(row.value)));
  });
  svg.append(center, centerSub);
  return h('div', { class: 'donut' }, svg, h('ul', { class: 'donut-legend' }, legendItems));
}

/** Ronde asverdeling met ca. 4-6 streepjes (1, 2, 2,5 of 5 × 10^n). */
function niceScale(lo, hi) {
  if (lo === hi) { lo -= 1; hi += 1; }
  const raw = (hi - lo) / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
  return { min: Math.floor(lo / step) * step, max: Math.ceil(hi / step) * step, step };
}

/** Horizontale staafjes voor spreiding. rows: [{label, value, pct}] */
export function barList(rows, format) {
  return h('ul', { class: 'bars' }, rows.map(r => h('li', {},
    h('div', { class: 'bar-label' }, h('span', {}, r.label), h('span', { class: 'muted' }, `${pct1(r.pct)} · ${format(r.value)}`)),
    h('div', { class: `bar${r.label === 'Onbekend' ? ' unknown' : ''}` }, h('i', { style: `width:${Math.max(0.5, r.pct * 100).toFixed(1)}%` })),
  )));
}
