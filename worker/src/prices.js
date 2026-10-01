// Koersen verversen voor één gebruiker: tickers koppelen, historie aanvullen, posities en watchlist bijwerken.
import { fetchChart, resolveIsin } from './yahoo.js';
import { loadFx } from './fx.js';

// Bekende ISIN's van benchmarktickers (zodat een eigen positie in dezelfde ETF niet dubbel wordt aangemaakt)
const BENCHMARK_ISINS = { 'IWDA.AS': 'IE00B4L5Y983', 'EUNL.DE': 'IE00B4L5Y983', 'VWCE.DE': 'IE00BK5BQT80' };
const DAY = 86400e3;
const iso = d => d.toISOString().slice(0, 10);

export async function refreshUser(ctx, db, userId, { resolveLimit = 3 } = {}) {
  const summary = { resolved: [], unresolved: [], updated: 0, errors: [], alerts: [] };
  const today = new Date();

  const [settings] = await db.get(`settings?user_id=eq.${userId}&select=benchmark_symbol`);
  let instruments = await db.get(
    `instruments?user_id=eq.${userId}&select=id,isin,name,symbol,currency,kind,` +
    `positions(id,quantity,last_price),watchlist(id,alert_above,alert_below,last_alert_at)`);

  // Benchmark als instrument zorgen dat hij bestaat
  const benchSymbol = settings?.benchmark_symbol;
  if (benchSymbol && !instruments.some(i => i.symbol === benchSymbol)) {
    const isin = BENCHMARK_ISINS[benchSymbol] ?? `SYM-${benchSymbol}`;
    const existing = instruments.find(i => i.isin === isin);
    if (existing) {
      await db.patch(`instruments?id=eq.${existing.id}&user_id=eq.${userId}`, { symbol: benchSymbol });
      existing.symbol = benchSymbol;
    } else {
      const [created] = await db.insert('instruments', [{
        user_id: userId, isin, symbol: benchSymbol, currency: 'EUR', kind: 'etf', name: `Benchmark (${benchSymbol})`,
      }]);
      instruments.push({ ...created, positions: [], watchlist: [] });
    }
  }

  const tracked = instruments.filter(i =>
    (i.kind !== 'cash' && i.positions.length) || i.watchlist.length || i.symbol === benchSymbol);

  // 1. Tickers koppelen voor instrumenten zonder symbool
  for (const ins of tracked.filter(i => !i.symbol)) {
    if (summary.resolved.length >= resolveLimit || ctx.budget.left() < 15 || ins.isin.startsWith('MANUAL-')) {
      summary.unresolved.push(ins.name);
      continue;
    }
    const ref = ins.currency === 'EUR' && ins.positions[0]?.last_price ? +ins.positions[0].last_price : null;
    const isin = ins.isin.startsWith('SYM-') ? ins.isin.slice(4) : ins.isin;
    try {
      const r = await resolveIsin(ctx, isin, ref);
      if (r?.symbol) {
        await db.patch(`instruments?id=eq.${ins.id}&user_id=eq.${userId}`, { symbol: r.symbol });
        ins.symbol = r.symbol;
        summary.resolved.push({ name: ins.name, symbol: r.symbol, hasHistory: r.hasHistory });
      } else summary.unresolved.push(ins.name);
    } catch (e) {
      summary.errors.push(`${ins.name}: ${e.message}`);
    }
  }

  const withSymbol = tracked.filter(i => i.symbol);
  if (!withSymbol.length) return summary;

  // 2. Hoe ver terug? Vanaf de eerste transactie (min. 1 jaar), max. 5 jaar.
  const [firstTx] = await db.get(`transactions?user_id=eq.${userId}&select=executed_at&order=executed_at.asc&limit=1`);
  const oneYear = new Date(today - 365 * DAY);
  let backfillFrom = firstTx ? new Date(new Date(firstTx.executed_at) - 7 * DAY) : oneYear;
  if (backfillFrom > oneYear) backfillFrom = oneYear;
  if (backfillFrom < new Date(today - 5 * 365 * DAY)) backfillFrom = new Date(today - 5 * 365 * DAY);

  const recent = await db.get(`prices?user_id=eq.${userId}&date=gte.${iso(new Date(today - 10 * DAY))}&select=instrument_id`);
  const upToDate = new Set(recent.map(r => r.instrument_id));

  // 3. Koersen ophalen
  const charts = [];
  for (const ins of withSymbol) {
    if (ctx.budget.left() < 5) { summary.errors.push(`${ins.name}: overgeslagen (limiet aanroepen per run)`); continue; }
    const from = upToDate.has(ins.id) ? new Date(today - 14 * DAY) : backfillFrom;
    try {
      const c = await fetchChart(ctx, ins.symbol, from, today);
      if (!c || c.price == null) summary.errors.push(`${ins.name}: geen koers gevonden voor ${ins.symbol}`);
      else charts.push({ ins, c });
    } catch (e) {
      summary.errors.push(`${ins.name}: ${e.message}`);
    }
  }
  if (!charts.length) return summary;

  // 4. Omrekenen naar euro en opslaan
  const fx = await loadFx(ctx, charts.map(x => x.c.currency), backfillFrom);
  const priceRows = [];
  const positionRows = [];
  for (const { ins, c } of charts) {
    for (const { date, close } of c.closes) {
      priceRows.push({ user_id: userId, instrument_id: ins.id, date, close, currency: c.currency, close_eur: round(close / fx(c.currency, date), 6) });
    }
    const priceEur = c.price / fx(c.currency, iso(today));
    const pos = ins.positions[0];
    if (pos && ins.kind !== 'cash') {
      positionRows.push({
        id: pos.id, user_id: userId, instrument_id: ins.id, quantity: pos.quantity,
        last_price: c.price, last_value_eur: round(+pos.quantity * priceEur, 2), last_price_at: c.priceTime ?? today.toISOString(),
      });
    }
    // Watchlist-grenzen (in de valuta van de notering)
    const w = ins.watchlist[0];
    if (w) {
      const above = w.alert_above != null && c.price >= +w.alert_above;
      const below = w.alert_below != null && c.price <= +w.alert_below;
      const recentlyAlerted = w.last_alert_at && today - new Date(w.last_alert_at) < 20 * 3600e3;
      if ((above || below) && !recentlyAlerted) {
        summary.alerts.push({ name: ins.name, price: c.price, currency: c.currency, above, below, limit: above ? +w.alert_above : +w.alert_below });
        await db.patch(`watchlist?id=eq.${w.id}&user_id=eq.${userId}`, { last_alert_at: today.toISOString() });
      }
    }
  }
  if (priceRows.length) await db.upsert('prices', priceRows, 'instrument_id,date');
  if (positionRows.length) await db.upsert('positions', positionRows, 'id');
  summary.updated = charts.length;
  return summary;
}

const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
