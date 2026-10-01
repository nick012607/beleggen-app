// Eenvoudige SVG-lijngrafiek met tooltip. Geen afhankelijkheden.
import { h } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

/**
 * series: [{ label, className, points: [{date, value}], dashed? }] – alle series op dezelfde datums.
 * format: getal -> tekst (as en tooltip).
 */
export function lineChart(series, { height = 260, format = String } = {}) {
  const wrap = h('div', { class: 'chart' });
  const tip = h('div', { class: 'chart-tip', hidden: true });
  const legend = h('div', { class: 'chart-legend' },
    series.map(s => h('span', { class: `key ${s.className}` }, h('i', {}), s.label)));
  wrap.append(legend);

  const base = series[0]?.points ?? [];
  if (base.length < 2) {
    wrap.append(h('p', { class: 'muted' }, 'Nog te weinig koersdata voor een grafiek.'));
    return wrap;
  }

  const W = 800, H = height, padL = 64, padR = 12, padT = 10, padB = 26;
  const all = series.flatMap(s => s.points.map(p => p.value)).filter(Number.isFinite);
  const { min, max, step } = niceScale(Math.min(...all), Math.max(...all));
  const x = i => padL + (i / (base.length - 1)) * (W - padL - padR);
  const y = v => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': 'Grafiek van het verloop' });

  // rasterlijnen + y-labels
  for (let v = min; v <= max + step / 2; v += step) {
    svg.append(svgEl('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v), class: 'grid' }));
    const t = svgEl('text', { x: padL - 8, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' });
    t.textContent = format(v);
    svg.append(t);
  }
  // x-labels: begin, midden, eind
  for (const i of [0, Math.floor((base.length - 1) / 2), base.length - 1]) {
    const t = svgEl('text', { x: x(i), y: H - 6, class: 'axis', 'text-anchor': i === 0 ? 'start' : i === base.length - 1 ? 'end' : 'middle' });
    t.textContent = new Date(base[i].date).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: '2-digit' });
    svg.append(t);
  }
  for (const s of series) {
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
    svg.append(svgEl('path', { d, class: `line ${s.className}${s.dashed ? ' dashed' : ''}` }));
  }

  const cross = svgEl('line', { y1: padT, y2: H - padB, class: 'cross', visibility: 'hidden' });
  const dots = series.map(s => { const c = svgEl('circle', { r: 4, class: `dot ${s.className}`, visibility: 'hidden' }); svg.append(c); return c; });
  svg.append(cross);

  const overlay = svgEl('rect', { x: padL, y: padT, width: W - padL - padR, height: H - padT - padB, fill: 'transparent' });
  svg.append(overlay);
  const move = e => {
    const r = svg.getBoundingClientRect();
    const px = ((e.touches?.[0]?.clientX ?? e.clientX) - r.left) / r.width * W;
    const i = Math.max(0, Math.min(base.length - 1, Math.round((px - padL) / (W - padL - padR) * (base.length - 1))));
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    series.forEach((s, k) => {
      dots[k].setAttribute('cx', x(i)); dots[k].setAttribute('cy', y(s.points[i].value)); dots[k].setAttribute('visibility', 'visible');
    });
    tip.replaceChildren(
      h('strong', {}, new Date(base[i].date).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })),
      ...series.map(s => h('div', { class: `key ${s.className}` }, h('i', {}), `${s.label}: ${format(s.points[i].value)}`)));
    tip.hidden = false;
    const left = (x(i) / W) * r.width;
    tip.style.left = `${Math.min(Math.max(left, 80), r.width - 80)}px`;
  };
  const leave = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dots.forEach(d => d.setAttribute('visibility', 'hidden')); };
  overlay.addEventListener('mousemove', move);
  overlay.addEventListener('touchmove', move, { passive: true });
  overlay.addEventListener('mouseleave', leave);
  overlay.addEventListener('touchend', leave);

  wrap.append(h('div', { class: 'chart-area' }, svg, tip));
  return wrap;
}

/** Ronde asverdeling met ca. 4-6 streepjes (1, 2, 2,5 of 5 × 10^n). */
function niceScale(lo, hi) {
  if (lo === hi) { lo -= 1; hi += 1; }
  const raw = (hi - lo) / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
  return { min: Math.floor(lo / step) * step, max: Math.ceil(hi / step) * step, step };
}

export const pct1 = x => `${(x * 100).toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/** Horizontale staafjes voor spreiding. rows: [{label, value, pct}] */
export function barList(rows, format) {
  return h('ul', { class: 'bars' }, rows.map(r => h('li', {},
    h('div', { class: 'bar-label' }, h('span', {}, r.label), h('span', { class: 'muted' }, `${pct1(r.pct)} · ${format(r.value)}`)),
    h('div', { class: `bar${r.label === 'Onbekend' ? ' unknown' : ''}` }, h('i', { style: `width:${Math.max(0.5, r.pct * 100).toFixed(1)}%` })),
  )));
}
