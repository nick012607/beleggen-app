// Rekenwerk voor het dashboard (puur, zonder DOM of database) – getest in web/tests/.

const amsDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' });
export const localDay = isoTs => amsDate.format(new Date(isoTs));

/** Netto-inleg van een transactie in EUR: koop positief, verkoop negatief. */
const flowOf = t => (t.total_eur != null ? -t.total_eur : t.quantity * t.price);

/**
 * Waardeverloop uit transacties en dagkoersen.
 * txs: [{instrument_id, executed_at, quantity, total_eur, price}]
 * prices: Map instrument_id -> [{date, close_eur}] (oplopend)
 * Geeft { points: [{date, value, invested, flow}], excluded: [instrument_id] }.
 * Instrumenten zonder koersen tellen niet mee (excluded).
 */
export function portfolioSeries(txs, prices) {
  const included = new Set(txs.map(t => t.instrument_id).filter(id => prices.get(id)?.length));
  const excluded = [...new Set(txs.map(t => t.instrument_id))].filter(id => !included.has(id));
  const list = txs.filter(t => included.has(t.instrument_id))
    .map(t => ({ ...t, day: localDay(t.executed_at) }))
    .sort((a, b) => a.day.localeCompare(b.day));
  if (!list.length) return { points: [], excluded };

  const start = list[0].day;
  const dates = [...new Set([...included].flatMap(id => prices.get(id).map(p => p.date)))].filter(d => d >= start).sort();
  const qty = new Map(), last = new Map(), idx = new Map();
  let invested = 0, ti = 0;
  const points = [];

  for (const date of dates) {
    let flow = 0;
    while (ti < list.length && list[ti].day <= date) {
      const t = list[ti++];
      qty.set(t.instrument_id, (qty.get(t.instrument_id) ?? 0) + +t.quantity);
      const f = flowOf(t);
      invested += f; flow += f;
      if (!last.has(t.instrument_id)) last.set(t.instrument_id, +t.price); // tot eerste slotkoers: aankoopkoers
    }
    for (const id of included) {
      const rows = prices.get(id);
      let i = idx.get(id) ?? 0;
      while (i < rows.length && rows[i].date <= date) { last.set(id, +rows[i].close_eur); i++; }
      idx.set(id, i);
    }
    let value = 0;
    for (const [id, q] of qty) value += q * (last.get(id) ?? 0);
    points.push({ date, value: round(value), invested: round(invested), flow: round(flow) });
  }
  return { points, excluded };
}

/**
 * Benchmark met dezelfde geldstromen: elke aankoop (verkoop) wordt op die dag in de benchmark gestoken (eruit gehaald).
 * Geeft [{date, value}] op dezelfde datums als points.
 */
export function benchmarkSeries(points, benchPrices) {
  if (!benchPrices?.length || !points.length) return [];
  let units = 0, i = 0, close = null;
  return points.map(p => {
    while (i < benchPrices.length && benchPrices[i].date <= p.date) { close = +benchPrices[i].close_eur; i++; }
    if (close == null) close = +benchPrices[0].close_eur;
    units += p.flow / close;
    return { date: p.date, value: round(units * close) };
  });
}

/**
 * Rendement over een periode volgens Modified Dietz (corrigeert voor stortingen).
 * values: [{date, value, flow}] – flow op de dag zelf telt als storting.
 */
export function periodReturn(series) {
  if (series.length < 2) return { result: 0, pct: null };
  const v0 = series[0].value, v1 = series.at(-1).value;
  const t0 = Date.parse(series[0].date), T = Date.parse(series.at(-1).date) - t0 || 1;
  let F = 0, weighted = 0;
  for (const p of series.slice(1)) {
    if (!p.flow) continue;
    F += p.flow;
    weighted += p.flow * (1 - (Date.parse(p.date) - t0) / T);
  }
  const result = v1 - v0 - F;
  const base = v0 + weighted;
  return { result: round(result), pct: base > 0 ? result / base : null };
}

/** Koersverandering laatste handelsdag: [{date, close_eur}] -> fractie of null. */
export function dayChange(rows) {
  if (!rows || rows.length < 2) return null;
  const a = +rows.at(-2).close_eur, b = +rows.at(-1).close_eur;
  return a ? b / a - 1 : null;
}

/**
 * Spreiding naar dimensie ('sectors' | 'regions' | 'currencies').
 * items: [{name, kind, currency, value, profile}] ; profile[dim] = {label: pct}
 */
export function allocation(items, dim) {
  const sums = new Map();
  const add = (label, v) => sums.set(label, (sums.get(label) ?? 0) + v);
  let total = 0;
  for (const it of items) {
    if (!(it.value > 0)) continue;
    total += it.value;
    if (it.kind === 'cash') { add(dim === 'currencies' ? it.currency : 'Cash', it.value); continue; }
    const map = it.profile?.[dim];
    const entries = map ? Object.entries(map).filter(([, p]) => +p > 0) : [];
    if (!entries.length) {
      add(dim === 'currencies' && it.kind === 'stock' ? it.currency : 'Onbekend', it.value);
      continue;
    }
    let covered = 0;
    for (const [label, p] of entries) { add(label, it.value * +p / 100); covered += +p; }
    if (covered < 99.5) add('Overig', it.value * (100 - covered) / 100);
  }
  return [...sums].map(([label, value]) => ({ label, value: round(value), pct: total ? value / total : 0 }))
    .sort((a, b) => (a.label === 'Onbekend') - (b.label === 'Onbekend') || b.value - a.value || a.label.localeCompare(b.label));
}

const holdingKey = h => (h.ticker ? h.ticker.toUpperCase().replace(/\..*$/, '') : '') || normName(h.name);
const normName = s => String(s ?? '').toLowerCase().replace(/\b(inc|corp|corporation|co|ltd|plc|nv|sa|ag|class [a-c]|cl [a-c])\b\.?/g, '').replace(/[^a-z0-9]/g, '');

/** Overlap tussen twee fondsen: som van min(gewicht A, gewicht B) over gedeelde posities, in %. */
export function overlap(holdingsA, holdingsB) {
  const a = new Map(holdingsA.map(h => [holdingKey(h), +h.weight_pct || 0]));
  let sum = 0;
  const shared = [];
  for (const h of holdingsB) {
    const k = holdingKey(h);
    if (a.has(k)) { const m = Math.min(a.get(k), +h.weight_pct || 0); sum += m; shared.push(h.name); }
  }
  return { pct: round(sum, 1), shared };
}

/** Indirecte blootstelling per bedrijf over alle fondsen (en directe aandelen). */
export function companyExposure(items) {
  const total = items.reduce((s, it) => s + (it.value > 0 ? it.value : 0), 0);
  const m = new Map();
  for (const it of items) {
    if (!(it.value > 0) || it.kind === 'cash') continue;
    if (it.kind === 'stock') {
      const k = normName(it.name);
      const e = m.get(k) ?? { name: it.name, value: 0, via: [] };
      e.value += it.value; e.via.push(it.name); m.set(k, e);
      continue;
    }
    for (const h of it.profile?.holdings ?? []) {
      const k = holdingKey(h);
      const e = m.get(k) ?? { name: h.name, value: 0, via: [] };
      e.value += it.value * (+h.weight_pct || 0) / 100; e.via.push(it.name); m.set(k, e);
    }
  }
  return [...m.values()].map(e => ({ ...e, value: round(e.value), pct: total ? e.value / total : 0 }))
    .sort((a, b) => b.value - a.value);
}

/** Waarschuwingen over concentratie en overlap. Informatief, geen advies. */
export function warnings(items, settings = {}) {
  const limit = (+settings.concentration_pct || 25) / 100;
  const out = [];
  const total = items.reduce((s, it) => s + (it.value > 0 ? it.value : 0), 0);
  if (!total) return out;

  for (const it of items) {
    if (it.kind !== 'cash' && it.value / total > limit) {
      out.push({ level: 'info', text: `${it.name} is ${pct(it.value / total)} van je portefeuille (signaalgrens ${pct(limit)}).` });
    }
  }
  for (const [dim, label, max] of [['sectors', 'sector', 0.4], ['regions', 'regio', 0.75]]) {
    const top = allocation(items, dim).find(a => !['Onbekend', 'Overig', 'Cash'].includes(a.label));
    if (top && top.pct > max) out.push({ level: 'info', text: `${pct(top.pct)} van je portefeuille zit in ${label} ${top.label}.` });
  }
  const etfs = items.filter(it => it.profile?.holdings?.length);
  for (let i = 0; i < etfs.length; i++) {
    for (let j = i + 1; j < etfs.length; j++) {
      const o = overlap(etfs[i].profile.holdings, etfs[j].profile.holdings);
      if (o.pct >= 20) {
        out.push({ level: 'warn', text: `Overlap van ${o.pct.toFixed(0)}% tussen ${etfs[i].name} en ${etfs[j].name} in de top-holdings (o.a. ${o.shared.slice(0, 4).join(', ')}).` });
      }
    }
  }
  for (const c of companyExposure(items).slice(0, 5)) {
    if (c.pct > 0.08 && c.via.length > 1) {
      out.push({ level: 'info', text: `${c.name}: ${pct(c.pct)} van je portefeuille, via ${c.via.length} posities (${c.via.join(', ')}).` });
    }
  }
  return out;
}

const pct = x => `${(x * 100).toFixed(0)}%`;
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
