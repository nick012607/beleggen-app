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

// ---- fase 3: voorbeeldeditie (TESTDATA, geen echte nieuwsfeiten) ----
export async function generateEdition(kind = 'daily') {
  const s = S();
  const id = crypto.randomUUID();
  const src = [{ title: 'Voorbeeldbron', url: 'https://example.com/artikel' }];
  s.editions = s.editions.filter(e => !(e.edition_date === '2026-10-06' && e.kind === kind));
  s.editions.push({
    id, edition_date: '2026-10-06', kind, status: 'ready', created_at: new Date().toISOString(),
    content: {
      headline: { title: 'TESTEDITIE: Uranium-ETF daalt, brede markt licht hoger', summary: 'Dit is voorbeeldtekst om de opmaak te testen. In de echte editie schrijft Claude hier het belangrijkste verhaal van de dag, met bronnen.', sources: src },
      movements: [
        { instrument: 'VANECK URANIUM AND NUCLEAR TECHNOLOGIES UCITS ETF', title: 'Voorbeeld: uraniumaandelen lager', what_happened: 'Voorbeeldtekst: de ETF daalde 2,6%.', likely_cause: 'Voorbeeldtekst over een mogelijke oorzaak.', cause_certainty: 'waarschijnlijk', context: 'Voorbeeld: de brede markt steeg 0,4%.', sources: src },
        { instrument: 'VANGUARD S&P 500 UCITS ETF USD ACC', title: 'Voorbeeld: grootste positie stabiel', what_happened: 'Voorbeeldtekst.', likely_cause: 'Geen duidelijke oorzaak gevonden.', cause_certainty: 'onduidelijk', context: 'In lijn met de markt.', sources: [] },
      ],
      themes: [{ theme: 'Quantum computing', summary: 'Voorbeeldtekst voor een thema-update.', sources: src }],
      agenda: [{ date: '2026-10-08', title: 'Voorbeeld: rentebesluit', kind: 'rente', relevance: 'Raakt de hele portefeuille.' }, { date: '2026-10-07', title: 'Voorbeeld: kwartaalcijfers', kind: 'cijfers', relevance: 'Grote positie in de S&P 500.' }],
      watchlist: [{ instrument: 'SHELL PLC', note: 'Voorbeeld: koers boven je grens van € 40.', sources: [] }],
      journal_checks: [{ instrument: 'VANGUARD S&P 500 UCITS ETF USD ACC', reason: 'Brede basis', news: 'Voorbeeldtekst.', effect: 'ondersteunt', sources: [{ title: 'Ongeldige link', url: 'javascript:alert(1)' }] }],
      meta: { model: 'claude-sonnet-5-5', cost_usd: 0.1734, kind, benchmark: { symbol: 'IWDA.AS', day_change_pct: 0.39, week_change_pct: 1.56 },
        positions: [{ name: 'VANGUARD S&P 500 UCITS ETF USD ACC', weight_pct: 46.9, day_change_pct: 0.6, week_change_pct: 1.9 }, { name: 'VANECK URANIUM AND NUCLEAR TECHNOLOGIES UCITS ETF', weight_pct: 9.5, day_change_pct: -2.56, week_change_pct: -6.9 }] },
    },
  });
  s.usage.unshift({ run_at: new Date().toISOString(), note: `handmatig ${kind}`, success: true, attempt: 1, input_tokens: 24000, cache_read_tokens: 1500, cache_write_tokens: 0, output_tokens: 4200, web_search_requests: 6, cost_usd: 0.1734 });
  return { edition_id: id, cost_usd: 0.1734, attempt: 1 };
}
export async function suggestEtfProfile() {
  return { cost_usd: 0.05, profile: { theme: 'TEST: S&P 500', holdings: [{ name: 'NVIDIA', ticker: 'NVDA', weight_pct: 7 }], sectors: { Technologie: 33 }, regions: { 'Noord-Amerika': 100 }, currencies: { USD: 100 }, source_url: 'https://example.com/factsheet' } };
}
