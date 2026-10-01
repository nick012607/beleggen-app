// Nep-Worker: gebruikt echte Yahoo-koersen uit tests/local/prices.json (lokaal, niet in git).
export const workerConfigured = true;
const S = () => window.__mockDb;
let fixture;
const load = async () => (fixture ??= await (await fetch('/tests/local/prices.json')).json());

export async function refreshPrices() {
  const fx = await load();
  const s = S();
  let bench = s.instruments.find(i => i.isin === 'IE00B4L5Y983');
  if (!bench) { bench = { id: crypto.randomUUID(), isin: 'IE00B4L5Y983', name: 'Benchmark (IWDA.AS)', symbol: 'IWDA.AS', currency: 'EUR', kind: 'etf' }; s.instruments.push(bench); }
  const resolved = [];
  let updated = 0;
  for (const ins of s.instruments) {
    const f = fx[ins.isin];
    if (!f) continue;
    if (!ins.symbol) { ins.symbol = f.symbol; resolved.push({ name: ins.name, symbol: f.symbol }); }
    s.prices = s.prices.filter(p => p.instrument_id !== ins.id);
    for (const c of f.closes) s.prices.push({ instrument_id: ins.id, date: c.date, close: c.close, close_eur: c.close, currency: f.currency });
    const pos = s.positions.find(p => p.instrument_id === ins.id);
    if (pos) Object.assign(pos, { last_price: f.price, last_value_eur: Math.round(pos.quantity * f.price * 100) / 100, last_price_at: f.priceTime });
    updated++;
  }
  return { resolved, unresolved: [], updated, errors: [], alerts: [] };
}
export async function resolveIsin(isin) {
  const f = (await load())[isin];
  return f ? { symbol: f.symbol, name: `Instrument ${f.symbol}`, currency: 'EUR', price: f.price } : { symbol: null };
}
export async function quote(symbol) {
  const f = Object.values(await load()).find(x => x.symbol === symbol);
  if (!f) throw new Error('Ticker niet gevonden');
  return { symbol, name: `Instrument ${symbol}`, currency: 'EUR', exchange: 'GER', price: f.price, hasHistory: true };
}
