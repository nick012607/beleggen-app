// ETF-profiel laten voorstellen door Claude (één keer per ETF, daarna handmatig aan te passen).
import { runClaude, costUsd } from './claude.js';

const SYSTEM = `Je stelt een feitelijk profiel op van een beursgenoteerd fonds (ETF) voor een persoonlijke beleggingsapp. Gebruik web search om de actuele factsheet of fondspagina van de uitgever te vinden (bijvoorbeeld iShares, Vanguard, VanEck, Xtrackers, Invesco, of justETF). Neem alleen cijfers over die je in een bron ziet; laat iets weg als je het niet kunt vinden. Gewichten in procenten van het fonds. Sectoren en regio's in het Nederlands (bijvoorbeeld "Technologie", "Noord-Amerika"). Valuta als ISO-code van de onderliggende waarden (bijvoorbeeld USD). Lever het resultaat uitsluitend af via de tool publish_profile.`;

const pctList = {
  type: 'array',
  items: {
    type: 'object', additionalProperties: false, required: ['label', 'pct'],
    properties: { label: { type: 'string' }, pct: { type: 'number' } },
  },
};

const TOOL = {
  name: 'publish_profile',
  description: 'Lever het ETF-profiel af. Precies één keer aanroepen.',
  strict: true,
  input_schema: {
    type: 'object', additionalProperties: false,
    required: ['theme', 'holdings', 'sectors', 'regions', 'currencies', 'source_url'],
    properties: {
      theme: { type: 'string', description: 'Korte omschrijving van het thema of de index, in het Nederlands' },
      holdings: {
        type: 'array', description: 'Top 10 posities',
        items: {
          type: 'object', additionalProperties: false, required: ['name', 'ticker', 'weight_pct'],
          properties: { name: { type: 'string' }, ticker: { type: 'string' }, weight_pct: { type: 'number' } },
        },
      },
      sectors: pctList,
      regions: pctList,
      currencies: pctList,
      source_url: { type: 'string' },
    },
  },
};

const toMap = list => Object.fromEntries((list ?? []).filter(x => x.label && x.pct > 0).map(x => [x.label, Math.round(x.pct * 10) / 10]));

export async function suggestProfile(env, ctx, db, userId, instrumentId) {
  const [ins] = await db.get(`instruments?id=eq.${instrumentId}&user_id=eq.${userId}&select=id,isin,name,symbol,kind`);
  if (!ins) throw new Error('Instrument niet gevonden');

  const { input, usage, model } = await runClaude(env, ctx, {
    system: SYSTEM,
    userContent: `Fonds: ${ins.name}\nISIN: ${ins.isin}\nTicker: ${ins.symbol ?? 'onbekend'}`,
    tool: TOOL, maxSearches: 3, effort: 'low', maxTokens: 8000,
  });
  const cost = costUsd(model, usage);
  await db.insert('usage_log', [{
    user_id: userId, model, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens,
    cache_read_tokens: usage.cache_read_tokens, cache_write_tokens: usage.cache_write_tokens,
    web_search_requests: usage.web_search_requests, cost_usd: Math.round(cost * 10000) / 10000,
    attempt: 1, success: true, note: `etf-profiel ${ins.name}`.slice(0, 200),
  }], 'return=minimal');

  const profile = {
    theme: input.theme,
    holdings: (input.holdings ?? []).slice(0, 10).map(h => ({ name: h.name, ticker: h.ticker || null, weight_pct: Math.round(h.weight_pct * 100) / 100 })),
    sectors: toMap(input.sectors), regions: toMap(input.regions), currencies: toMap(input.currencies),
    source_url: input.source_url,
  };
  return { profile, cost_usd: Math.round(cost * 10000) / 10000 };
}
