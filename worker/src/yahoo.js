// Yahoo Finance (onofficieel): koershistorie en ISIN -> ticker.
// Alles achter deze module, zodat een andere koersbron later alleen hier iets verandert.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const EXCHANGE_PREFERENCE = ['.DE', '.AS', '.PA', '.MI', '.BR', '.F', '.SG'];

async function yget(ctx, url) {
  ctx.budget.use();
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok && res.status !== 404) throw new Error(`Yahoo ${res.status} voor ${url}`);
  return res.json();
}

/**
 * Dagkoersen. from/to: Date. Geeft { symbol, currency, price, priceTime, closes: [{date, close}] }.
 * Valuta 'GBp' (pence) wordt omgerekend naar GBP.
 */
export async function fetchChart(ctx, symbol, from, to = new Date()) {
  const p1 = Math.floor(from.getTime() / 1000);
  const p2 = Math.floor(to.getTime() / 1000) + 86400;
  const data = await yget(ctx, `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d`);
  const r = data?.chart?.result?.[0];
  if (!r) return null;
  const meta = r.meta;
  let factor = 1;
  let currency = meta.currency;
  if (currency === 'GBp' || currency === 'GBX') { factor = 0.01; currency = 'GBP'; }
  const ts = r.timestamp ?? [];
  const close = r.indicators?.quote?.[0]?.close ?? [];
  const tz = meta.exchangeTimezoneName || 'Europe/Amsterdam';
  const closes = [];
  ts.forEach((t, i) => {
    if (close[i] == null) return;
    closes.push({ date: localDate(t, tz), close: round(close[i] * factor, 6) });
  });
  return {
    symbol: meta.symbol,
    currency,
    exchange: meta.exchangeName,
    price: meta.regularMarketPrice != null ? round(meta.regularMarketPrice * factor, 6) : closes.at(-1)?.close ?? null,
    priceTime: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
    closes: dedupeByDate(closes),
  };
}

async function search(ctx, q) {
  const data = await yget(ctx, `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=20&newsCount=0`);
  return (data?.quotes ?? []).filter(x => x.symbol);
}

/**
 * Zoekt de beste euronotering voor een ISIN.
 * refPrice (optioneel, EUR): bekende koers; kandidaten die meer dan 15% afwijken vallen af
 * (voorkomt verwisseling van share classes, bv. uitkerend vs. accumulerend).
 * Geeft { symbol, currency, price, hasHistory, candidates: [...] } of null.
 */
export async function resolveIsin(ctx, isin, refPrice = null) {
  const byIsin = await search(ctx, isin);
  const named = byIsin.find(q => q.longname && !q.symbol.endsWith('.SG'));
  let pool = byIsin;
  if (named) {
    const byName = await search(ctx, named.longname);
    pool = [...byIsin, ...byName.filter(q => q.longname === named.longname)];
  }
  const symbols = [...new Set(pool.map(q => q.symbol))];
  if (!symbols.includes(`${isin}.SG`)) symbols.push(`${isin}.SG`);

  // Volgorde: voorkeursbeurzen eerst; niet-euro-beurzen (.L, .SW) laten we weg.
  const rank = s => {
    const i = EXCHANGE_PREFERENCE.findIndex(suf => s.endsWith(suf));
    return i === -1 ? 99 : i;
  };
  const ordered = symbols.filter(s => rank(s) < 99).sort((a, b) => rank(a) - rank(b)).slice(0, 5);

  const since = new Date(Date.now() - 40 * 86400e3);
  const candidates = [];
  for (const s of ordered) {
    if (ctx.budget.left() < 3) break;
    const c = await fetchChart(ctx, s, since).catch(() => null);
    if (!c || c.currency !== 'EUR' || c.price == null) continue;
    const deviation = refPrice ? Math.abs(c.price - refPrice) / refPrice : null;
    candidates.push({ symbol: s, currency: c.currency, exchange: c.exchange, price: c.price, hasHistory: c.closes.length >= 5, deviation });
    // Eerste goede kandidaat met historie op voorkeursbeurs is genoeg
    if (c.closes.length >= 5 && (deviation == null || deviation < 0.15)) break;
  }
  const ok = candidates.filter(c => c.deviation == null || c.deviation < 0.15);
  const best = ok.find(c => c.hasHistory) ?? ok[0] ?? null;
  return best ? { ...best, name: named?.longname ?? null, candidates } : { symbol: null, candidates, name: named?.longname ?? null };
}

function localDate(unixSeconds, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(unixSeconds * 1000));
}
function dedupeByDate(rows) {
  const m = new Map();
  for (const r of rows) m.set(r.date, r);
  return [...m.values()];
}
const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
