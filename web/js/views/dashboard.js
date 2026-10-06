import { listPositions, listPrices, listTransactions, listEtfProfiles, getSettings, listInstruments } from '../db.js';
import { refreshPrices, workerConfigured } from '../api.js';
import { portfolioSeries, benchmarkSeries, periodReturn, dayChange, allocation, companyExposure, warnings, relativeSeries, localDay } from '../analytics.js';
import { lineChart, barList, donutChart, pct1 } from '../chart.js';
import { h, mount, toast, fmtEur, fmtPct, fmtSignedEur, fmtDateTime, signClass } from '../ui.js';

const RANGES = [['1M', 31], ['3M', 92], ['YTD', 'ytd'], ['1J', 366], ['Alles', null]];
let state = { range: 'Alles', perfRange: 'Alles', dim: 'sectors', hiddenLines: new Set() };

/** Lange fondsnamen inkorten voor legenda's: "VANECK URANIUM AND NUCLEAR TECHN..." -> "VanEck Uranium and Nuclear Techn…" */
function shortName(name) {
  let s = name.replace(/\.{3}$/, '').replace(/\b(UCITS|ETF|ACC|USD|EUR|DIST|PLC|- ?1C|1C)\b/gi, '').replace(/\s{2,}/g, ' ').trim();
  if (s === s.toUpperCase()) s = s.toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase()).replace(/\bS&p\b/, 'S&P').replace(/\bEqqq\b/, 'EQQQ').replace(/\bVaneck\b/, 'VanEck').replace(/\bAnd\b/g, 'and');
  return s.length > 34 ? `${s.slice(0, 33)}…` : s;
}

export async function dashboardView(root) {
  mount(root, h('p', { class: 'muted' }, 'Laden…'));
  const [positions, prices, txs, profiles, settings, instruments] = await Promise.all([
    listPositions(), listPrices(), listTransactions(), listEtfProfiles(), getSettings(), listInstruments(),
  ]);
  const profileOf = new Map(profiles.map(p => [p.instrument_id, p]));

  if (!positions.length) {
    mount(root, h('div', { class: 'card empty' },
      h('h1', {}, 'Welkom'),
      h('p', { class: 'muted' }, 'Importeer eerst je DEGIRO-transacties en -portefeuille.'),
      h('a', { class: 'button primary', href: '#/import' }, 'CSV importeren')));
    return;
  }

  // ---- posities met waarde en dagverandering
  const items = positions.map(p => {
    const value = p.last_value_eur == null ? null : +p.last_value_eur;
    const cost = p.cost_basis_eur == null ? null : +p.cost_basis_eur;
    const chg = dayChange(prices.get(p.instrument_id));
    return {
      id: p.instrument_id, name: p.instrument.name, kind: p.instrument.kind, currency: p.instrument.currency,
      symbol: p.instrument.symbol, value, cost, chg,
      gain: value != null && cost != null && p.instrument.kind !== 'cash' ? value - cost : null,
      today: value != null && chg != null ? value - value / (1 + chg) : null,
      profile: profileOf.get(p.instrument_id), lastPriceAt: p.last_price_at,
    };
  });
  const total = items.reduce((s, i) => s + (i.value ?? 0), 0);
  const withGain = items.filter(i => i.gain != null);
  const totalCost = withGain.reduce((s, i) => s + i.cost, 0);
  const totalGain = withGain.reduce((s, i) => s + i.gain, 0);
  const today = items.reduce((s, i) => s + (i.today ?? 0), 0);
  const lastUpdate = items.map(i => i.lastPriceAt).filter(Boolean).sort().at(-1);
  const noSymbol = items.filter(i => i.kind !== 'cash' && !i.symbol);

  // ---- tijdreeks en benchmark
  const { points, excluded } = portfolioSeries(txs, prices);
  const bench = instruments.find(i => i.symbol && i.symbol === settings.benchmark_symbol);
  const benchPts = bench ? benchmarkSeries(points, prices.get(bench.id)) : [];

  const refreshBtn = h('button', { onclick: onRefresh, disabled: !workerConfigured, title: workerConfigured ? '' : 'Worker nog niet gekoppeld' }, 'Koersen verversen');
  async function onRefresh() {
    refreshBtn.disabled = true; refreshBtn.textContent = 'Bezig…';
    try {
      const r = await refreshPrices();
      const parts = [`${r.updated} koers(en) bijgewerkt`];
      if (r.resolved.length) parts.push(`${r.resolved.length} ticker(s) gekoppeld`);
      if (r.unresolved.length) parts.push(`geen ticker gevonden voor: ${r.unresolved.join(', ')}`);
      if (r.errors.length) parts.push(`${r.errors.length} fout(en): ${r.errors[0]}`);
      toast(parts.join(' · '), r.errors.length ? 'error' : 'info');
      dashboardView(root);
    } catch (e) {
      toast(`Verversen mislukt: ${e.message}`, 'error');
      refreshBtn.disabled = false; refreshBtn.textContent = 'Koersen verversen';
    }
  }

  const chartCard = h('section', { class: 'card' });
  const renderChart = () => {
    const sliced = sliceRange(points, state.range);
    const benchSliced = benchPts.length ? benchPts.slice(points.length - sliced.length) : [];
    const pr = periodReturn(sliced);
    const series = [
      { label: 'Waarde', className: 's-value', points: sliced },
      { label: 'Inleg', className: 's-invested', dashed: true, points: sliced.map(p => ({ date: p.date, value: p.invested })) },
    ];
    let benchLine = null;
    if (benchSliced.length === sliced.length && benchSliced.length) {
      series.push({ label: `MSCI World (${bench.symbol}), zelfde stortingen`, className: 's-bench', points: benchSliced });
      const br = periodReturn(benchSliced.map((b, i) => ({ ...b, flow: sliced[i].flow })));
      benchLine = h('span', {}, ' · Benchmark: ', h('strong', { class: signClass(br.result) }, `${fmtSignedEur(br.result)} (${fmtPct(br.pct)})`));
    }
    mount(chartCard,
      h('div', { class: 'card-head' },
        h('h2', {}, 'Verloop'),
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Periode' }, RANGES.map(([label]) =>
          h('button', { class: state.range === label ? 'active' : '', 'aria-pressed': String(state.range === label), onclick: () => { state.range = label; renderChart(); } }, label)))),
      sliced.length >= 2
        ? lineChart(series, { format: v => fmtEur(v).replace(/,\d\d$/, '') })
        : h('p', { class: 'muted' }, workerConfigured
          ? 'Nog geen koershistorie. Klik op “Koersen verversen”.'
          : 'De grafiek verschijnt zodra de Worker koersen ophaalt.'),
      sliced.length >= 2 && h('p', { class: 'small' }, 'Jouw resultaat in deze periode: ',
        h('strong', { class: signClass(pr.result) }, `${fmtSignedEur(pr.result)} (${fmtPct(pr.pct)})`), benchLine,
        h('span', { class: 'muted' }, ' — gecorrigeerd voor stortingen.')),
      excluded.length > 0 && h('p', { class: 'muted small' }, `${excluded.length} instrument(en) zonder koershistorie tellen niet mee in de grafiek.`),
    );
  };
  renderChart();

  // ---- spreiding
  const allocCard = h('section', { class: 'card' });
  const renderAlloc = () => {
    const rows = allocation(items, state.dim);
    const unknown = rows.find(r => r.label === 'Onbekend');
    mount(allocCard,
      h('div', { class: 'card-head' },
        h('h2', {}, 'Spreiding'),
        h('div', { class: 'seg' }, [['sectors', 'Sector'], ['regions', 'Regio'], ['currencies', 'Valuta']].map(([k, l]) =>
          h('button', { class: state.dim === k ? 'active' : '', onclick: () => { state.dim = k; renderAlloc(); } }, l)))),
      barList(rows, fmtEur),
      unknown && h('p', { class: 'muted small' }, `${(unknown.pct * 100).toFixed(0)}% onbekend: vul het ETF-profiel in op de positiepagina.`),
    );
  };
  renderAlloc();

  // ---- vaste kleur per positie: alfabetisch op naam (kleur volgt de positie, niet de grootte)
  const held = items.filter(i => i.kind !== 'cash');
  const colorOf = new Map([...held].sort((a, b) => a.name.localeCompare(b.name))
    .map((it, k) => [it.id, k < 8 ? `var(--c${k + 1})` : 'var(--c-other)']));

  // ---- koersverloop per positie (procentueel)
  const firstBuy = new Map();
  for (const t of txs) {
    const d = localDay(t.executed_at);
    if (!firstBuy.has(t.instrument_id) || d < firstBuy.get(t.instrument_id)) firstBuy.set(t.instrument_id, d);
  }
  const perfCard = h('section', { class: 'card' });
  const renderPerf = () => {
    const withPrices = held.filter(i => prices.get(i.id)?.length).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    const lastDate = withPrices.map(i => prices.get(i.id).at(-1).date).sort().at(-1);
    let from;
    if (state.perfRange === 'Alles' || !lastDate) {
      from = [...firstBuy.values()].sort()[0] ?? withPrices.map(i => prices.get(i.id)[0].date).sort()[0] ?? '0000';
    } else {
      const def = RANGES.find(r => r[0] === state.perfRange)[1];
      const last = new Date(lastDate);
      from = def === 'ytd' ? `${last.getFullYear()}-01-01` : new Date(last - def * 86400e3).toISOString().slice(0, 10);
    }
    const { dates, series } = relativeSeries(prices, withPrices.map(i => ({ id: i.id, start: firstBuy.get(i.id) })), from);
    const lines = series.map(s => {
      const it = withPrices.find(i => i.id === s.id);
      return {
        label: shortName(it.name), color: colorOf.get(it.id), hidden: state.hiddenLines.has(it.id),
        points: dates.map((date, k) => ({ date, value: s.values[k] })),
      };
    });
    mount(perfCard,
      h('div', { class: 'card-head' },
        h('h2', {}, 'Koers per positie'),
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Periode' }, RANGES.map(([label]) =>
          h('button', { class: state.perfRange === label ? 'active' : '', 'aria-pressed': String(state.perfRange === label), onclick: () => { state.perfRange = label; renderPerf(); } }, label)))),
      lines.length
        ? lineChart(lines, {
            height: 300, zeroLine: true,
            format: v => `${v > 0 ? '+' : ''}${(+v).toLocaleString('nl-NL', { maximumFractionDigits: 1 })}%`,
            onToggle: k => {
              const id = withPrices[k].id;
              state.hiddenLines.has(id) ? state.hiddenLines.delete(id) : state.hiddenLines.add(id);
              renderPerf();
            },
          })
        : h('p', { class: 'muted' }, 'Nog geen koershistorie. Klik op “Koersen verversen”.'),
      h('p', { class: 'muted small' }, state.perfRange === 'Alles'
        ? 'Procentuele koersverandering sinds je eerste aankoop per positie (0% = koers op die dag). Klik op een naam om een lijn aan of uit te zetten.'
        : 'Procentuele koersverandering sinds het begin van de gekozen periode. Klik op een naam om een lijn aan of uit te zetten.'),
    );
  };
  renderPerf();

  // ---- verdeling (donut)
  const slices = [...items].filter(i => i.value > 0)
    .sort((a, b) => (a.kind === 'cash') - (b.kind === 'cash') || b.value - a.value)
    .map(i => ({ label: i.kind === 'cash' ? 'Cash' : shortName(i.name), value: i.value, color: i.kind === 'cash' ? 'var(--c-cash)' : colorOf.get(i.id) }));
  const donutCard = h('section', { class: 'card' },
    h('h2', {}, 'Verdeling'),
    slices.length ? donutChart(slices, { format: v => fmtEur(v).replace(/,\d\d$/, ''), centerLabel: 'totaal' }) : h('p', { class: 'muted' }, 'Geen waarden bekend.'));

  const warns = warnings(items, settings);
  const exposure = companyExposure(items).filter(c => c.via.length > 1 || c.pct > 0.03).slice(0, 8);

  mount(root,
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Dashboard'),
        h('p', { class: 'muted small' }, lastUpdate ? `Koersen van ${fmtDateTime(lastUpdate)}` : 'Nog geen koersen')),
      h('div', { class: 'actions' }, refreshBtn)),
    noSymbol.length > 0 && workerConfigured && h('div', { class: 'warn small' },
      `${noSymbol.length} positie(s) nog zonder ticker. “Koersen verversen” zoekt ze automatisch op.`),
    h('div', { class: 'stats' },
      stat('Totale waarde', fmtEur(total)),
      stat('Rendement', fmtSignedEur(totalGain), signClass(totalGain), `${fmtPct(totalCost ? totalGain / totalCost : null)} op ${fmtEur(totalCost)} inleg`),
      stat('Vandaag', fmtSignedEur(today), signClass(today), fmtPct(total - today ? today / (total - today) : null)),
    ),
    chartCard,
    perfCard,
    h('div', { class: 'grid-2' }, donutCard, allocCard),
    h('div', {},
      h('section', { class: 'card' },
        h('h2', {}, 'Signalen'),
        warns.length
          ? h('ul', { class: 'signals' }, warns.map(w => h('li', { class: w.level }, w.text)))
          : h('p', { class: 'muted' }, 'Geen opvallende concentratie of overlap gevonden', items.some(i => i.profile) ? '.' : ' (vul ETF-profielen in voor een betere analyse).'),
        exposure.length > 0 && [
          h('h3', {}, 'Grootste bedrijven via je fondsen'),
          h('ul', { class: 'exposure' }, exposure.map(c => h('li', {},
            h('span', {}, c.name), h('span', { class: 'muted' }, `${pct1(c.pct)} · ${fmtEur(c.value)}`)))),
        ],
        h('p', { class: 'muted small' }, 'Ter informatie, geen advies.'),
      ),
    ),
    positionsTable(items, total),
  );
}

function positionsTable(items, total) {
  const rows = [...items].sort((a, b) => (a.kind === 'cash') - (b.kind === 'cash') || (b.value ?? 0) - (a.value ?? 0));
  return h('section', {},
    h('div', { class: 'card-head' }, h('h2', {}, 'Posities'), h('a', { href: '#/posities' }, 'Beheren →')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Naam'), h('th', { class: 'num hide-sm' }, 'Gewicht'), h('th', { class: 'num' }, 'Vandaag'),
        h('th', { class: 'num' }, 'Waarde'), h('th', { class: 'num' }, 'Rendement'))),
      h('tbody', {}, rows.map(r => h('tr', {},
        h('td', {}, h('a', { href: `#/positie/${r.id}` }, r.name), h('div', { class: 'sub' }, r.symbol ?? '')),
        h('td', { class: 'num hide-sm' }, total ? pct1((r.value ?? 0) / total) : '–'),
        h('td', { class: `num ${signClass(r.chg)}` }, r.kind === 'cash' ? '' : fmtPct(r.chg)),
        h('td', { class: 'num' }, fmtEur(r.value)),
        h('td', { class: `num ${signClass(r.gain)}` }, r.gain == null ? '' : [fmtSignedEur(r.gain), h('div', { class: 'sub' }, fmtPct(r.cost ? r.gain / r.cost : null))]),
      ))))));
}

function sliceRange(points, range) {
  const def = RANGES.find(r => r[0] === range)?.[1];
  if (!def || !points.length) return points;
  const last = new Date(points.at(-1).date);
  const from = def === 'ytd' ? `${last.getFullYear()}-01-01` : new Date(last - def * 86400e3).toISOString().slice(0, 10);
  const i = points.findIndex(p => p.date >= from);
  // één punt ervoor als startwaarde
  return points.slice(Math.max(0, i - 1));
}

function stat(label, value, cls = '', sub = null) {
  return h('div', { class: 'stat' },
    h('div', { class: 'label' }, label),
    h('div', { class: `value ${cls}` }, value),
    sub && h('div', { class: `sub ${cls}` }, sub));
}
