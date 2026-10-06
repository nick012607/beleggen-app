// De dagelijkse krant: compacte samenvatting bouwen, één Claude-aanroep, opslaan en kosten loggen.
import { runClaude, costUsd, MODEL } from './claude.js';
import { companyNews } from './finnhub.js';

const DAY = 86400e3;
const amsDate = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const r1 = n => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);
const r2 = n => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);

// ---------------------------------------------------------------------------
// Vaste systeemprompt. Bevat bewust GEEN datum of andere wisselende inhoud,
// zodat hij (met de tools) gecachet kan worden.
// ---------------------------------------------------------------------------
export const SYSTEM_PROMPT = `Je bent de redacteur van een persoonlijke ochtendkrant over één beleggingsportefeuille. Je schrijft in helder, rustig Nederlands voor een particuliere belegger die geïnformeerd wil blijven.

Je krijgt een compacte samenvatting in JSON: posities met koersbewegingen, thema's en belangrijkste onderliggende bedrijven per ETF, koopredenen uit het beleggingsdagboek, de watchlist en recente nieuwskoppen. Gebruik web search (beperkt aantal zoekopdrachten) om de belangrijkste bewegingen en thema's te duiden. Zoek gericht: eerst naar de grootste of meest opvallende bewegingen, daarna thema's. Verspil geen zoekopdrachten aan dingen die al duidelijk in de samenvatting staan.

Harde regels:
1. Geef nooit koop-, verkoop- of houdadvies, ook niet impliciet ("goed instapmoment", "tijd om winst te nemen"). Je informeert en duidt alleen.
2. Verzin geen oorzaken. Noem een oorzaak alleen als een bron die ondersteunt. Is de oorzaak niet te vinden of twijfelachtig, zeg dan eerlijk dat die onduidelijk is (cause_certainty "onduidelijk").
3. Elke bewering over nieuws heeft minstens één bron (titel + URL) uit je zoekresultaten of uit de aangeleverde nieuwskoppen. Verzin geen URL's.
4. Bij ETF's gaat het verhaal over de onderliggende bedrijven of het thema (bijvoorbeeld uraniumprijs, chipbedrijven), niet alleen over de ETF-koers.
5. Plaats bewegingen in context: vergelijk met de markt (benchmark) en, waar zinvol, met de sector of het thema.
6. Gebruik de cijfers uit de samenvatting; reken niet zelf nieuwe koersen uit en noem geen koersen die je niet kent.
7. Dagboek-check: meld alleen een punt als het nieuws de opgeschreven koopreden echt raakt (ondersteunt of onder druk zet). Formuleer feitelijk, zonder advies.
8. Agenda: alleen gebeurtenissen voor vandaag en de komende 7 dagen die de posities of thema's raken (kwartaalcijfers van grote onderliggende bedrijven, dividenddatums, rentebesluiten van ECB en Fed). Alleen opnemen als je de datum uit een bron hebt.
9. Wees beknopt: kop max. 12 woorden, samenvattingen 2-4 zinnen, artikelen 80-150 woorden. Liever minder artikelen dan opvulling. Rustige dag? Zeg dat gewoon.

Lever het resultaat uitsluitend af door de tool publish_edition aan te roepen. Schrijf daarbuiten geen tekst.`;

// Weekeditie: zelfde regels, andere opdracht (wordt in de user-content meegegeven)
const WEEKLY_TASK = 'Dit is de WEEKEDITIE (zondag). Blik terug op de afgelopen week: beste en slechtste presteerders, rendement tegenover de benchmark (gebruik de weekcijfers uit de samenvatting), en de belangrijkste thema\'s. Kijk kort vooruit naar de agenda van de komende week. De artikelen mogen iets langer zijn (tot 200 woorden).';
const DAILY_TASK = 'Dit is de DAGEDITIE. Schrijf over wat er sinds de vorige handelsdag gebeurde en waarom.';

const source = {
  type: 'object', additionalProperties: false, required: ['title', 'url'],
  properties: { title: { type: 'string' }, url: { type: 'string' } },
};
const sources = { type: 'array', items: source };

export const PUBLISH_TOOL = {
  name: 'publish_edition',
  description: 'Publiceer de krant. Roep dit precies één keer aan, als laatste stap, met alle onderdelen.',
  strict: true,
  input_schema: {
    type: 'object', additionalProperties: false,
    required: ['headline', 'movements', 'themes', 'agenda', 'watchlist', 'journal_checks'],
    properties: {
      headline: {
        type: 'object', additionalProperties: false, required: ['title', 'summary', 'sources'],
        properties: { title: { type: 'string' }, summary: { type: 'string' }, sources },
      },
      movements: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['instrument', 'title', 'what_happened', 'likely_cause', 'cause_certainty', 'context', 'sources'],
          properties: {
            instrument: { type: 'string', description: 'Naam zoals in de samenvatting' },
            title: { type: 'string' },
            what_happened: { type: 'string' },
            likely_cause: { type: 'string' },
            cause_certainty: { type: 'string', enum: ['duidelijk', 'waarschijnlijk', 'onduidelijk'] },
            context: { type: 'string', description: 'Tegenover markt en sector/thema' },
            sources,
          },
        },
      },
      themes: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['theme', 'summary', 'sources'],
          properties: { theme: { type: 'string' }, summary: { type: 'string' }, sources },
        },
      },
      agenda: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['date', 'title', 'kind', 'relevance'],
          properties: {
            date: { type: 'string', description: 'JJJJ-MM-DD' },
            title: { type: 'string' },
            kind: { type: 'string', enum: ['cijfers', 'dividend', 'rente', 'overig'] },
            relevance: { type: 'string', description: 'Welke positie of welk thema dit raakt' },
          },
        },
      },
      watchlist: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['instrument', 'note', 'sources'],
          properties: { instrument: { type: 'string' }, note: { type: 'string' }, sources },
        },
      },
      journal_checks: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['instrument', 'reason', 'news', 'effect', 'sources'],
          properties: {
            instrument: { type: 'string' },
            reason: { type: 'string', description: 'De koopreden, kort samengevat' },
            news: { type: 'string', description: 'Wat er in het nieuws gebeurde' },
            effect: { type: 'string', enum: ['ondersteunt', 'zet onder druk', 'gemengd'] },
            sources,
          },
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Samenvatting van de data (compact!)
// ---------------------------------------------------------------------------
export async function buildContext(env, ctx, db, userId, kind) {
  const today = new Date();
  const [settings] = await db.get(`settings?user_id=eq.${userId}&select=*`);
  const instruments = await db.get(
    `instruments?user_id=eq.${userId}&select=id,isin,name,symbol,kind,currency,` +
    `positions(quantity,cost_basis_eur,last_value_eur),watchlist(alert_above,alert_below),` +
    `etf_profiles(theme,holdings),journal_entries(body,created_at)`);
  const since = amsDate(new Date(today - (kind === 'weekly' ? 12 : 10) * DAY));
  const prices = await db.get(`prices?user_id=eq.${userId}&date=gte.${since}&select=instrument_id,date,close,close_eur&order=date.asc`);
  const byIns = new Map();
  for (const p of prices) { if (!byIns.has(p.instrument_id)) byIns.set(p.instrument_id, []); byIns.get(p.instrument_id).push(p); }
  const chg = (rows, back) => (rows && rows.length > back ? (rows.at(-1).close_eur / rows.at(-1 - back).close_eur - 1) * 100 : null);

  const held = instruments.filter(i => i.positions?.length && i.kind !== 'cash');
  const total = instruments.reduce((s, i) => s + (+i.positions?.[0]?.last_value_eur || 0), 0);
  const bench = instruments.find(i => i.symbol && i.symbol === settings?.benchmark_symbol);
  const threshold = +settings?.move_threshold_pct || 2;
  const largePct = +settings?.large_position_pct || 15;

  const positions = held.map(i => {
    const p = i.positions[0];
    const rows = byIns.get(i.id);
    const value = +p.last_value_eur || 0;
    const prof = i.etf_profiles?.[0] ?? (Array.isArray(i.etf_profiles) ? null : i.etf_profiles);
    const journal = [...(i.journal_entries ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const day = chg(rows, 1);
    const weight = total ? (value / total) * 100 : 0;
    return {
      name: i.name, symbol: i.symbol, type: i.kind,
      weight_pct: r1(weight),
      day_change_pct: r2(day),
      week_change_pct: r2(chg(rows, 5)),
      total_return_pct: p.cost_basis_eur ? r1((value / +p.cost_basis_eur - 1) * 100) : null,
      last_close_date: rows?.at(-1)?.date ?? null,
      notable: (day != null && Math.abs(day) >= threshold) || weight >= largePct,
      theme: prof?.theme ?? null,
      top_holdings: (prof?.holdings ?? []).slice(0, 6).map(h => h.ticker ? `${h.name} (${h.ticker})` : h.name),
      buy_reason: journal ? journal.body.slice(0, 400) : null,
    };
  }).sort((a, b) => b.weight_pct - a.weight_pct);

  const watch = instruments.filter(i => i.watchlist?.length).map(i => {
    const rows = byIns.get(i.id);
    const w = i.watchlist[0];
    const last = rows?.at(-1)?.close ?? null;
    return {
      name: i.name, symbol: i.symbol, last_close: last, day_change_pct: r2(chg(rows, 1)),
      limit_below: w.alert_below, limit_above: w.alert_above,
      crossed: last != null && ((w.alert_above != null && last >= +w.alert_above) || (w.alert_below != null && last <= +w.alert_below)),
    };
  });

  // Nieuws: grootste Amerikaanse onderliggende posities (gewogen naar portefeuille)
  const exposure = new Map();
  for (const i of held) {
    const prof = i.etf_profiles?.[0] ?? i.etf_profiles;
    const v = +i.positions[0].last_value_eur || 0;
    for (const h of prof?.holdings ?? []) {
      if (h.ticker && /^[A-Z]{1,5}$/.test(h.ticker)) exposure.set(h.ticker, (exposure.get(h.ticker) ?? 0) + v * (+h.weight_pct || 0));
    }
  }
  const newsTickers = [...exposure].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => t);
  const news = await companyNews(env, ctx, newsTickers, kind === 'weekly' ? 7 : 3, 3);

  return {
    data: {
      date: amsDate(today),
      weekday: new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', weekday: 'long' }).format(today),
      edition: kind === 'weekly' ? 'weekeditie' : 'dageditie',
      notable_move_threshold_pct: threshold,
      portfolio_value_eur: Math.round(total),
      benchmark: bench ? { name: 'MSCI World', symbol: bench.symbol, day_change_pct: r2(chg(byIns.get(bench.id), 1)), week_change_pct: r2(chg(byIns.get(bench.id), 5)) } : null,
      positions,
      watchlist: watch,
      news_headlines: news,
    },
    snapshot: positions.map(p => ({ name: p.name, symbol: p.symbol, weight_pct: p.weight_pct, day_change_pct: p.day_change_pct, week_change_pct: p.week_change_pct })),
    benchmark: bench ? { symbol: bench.symbol, day_change_pct: r2(chg(byIns.get(bench.id), 1)), week_change_pct: r2(chg(byIns.get(bench.id), 5)) } : null,
    settings,
  };
}

// ---------------------------------------------------------------------------
// Editie maken: budgetcontrole, max. 1 herhaling, kosten loggen, opslaan
// ---------------------------------------------------------------------------
export async function generateEdition(env, ctx, db, userId, { kind = 'daily', trigger = 'cron' } = {}) {
  const now = new Date();
  const editionDate = amsDate(now);

  // Budget: maandtotaal tot nu toe
  const monthStart = `${editionDate.slice(0, 7)}-01T00:00:00Z`;
  const runs = await db.get(`usage_log?user_id=eq.${userId}&run_at=gte.${monthStart}&select=cost_usd,run_at,note`);
  const spent = runs.reduce((s, r) => s + (+r.cost_usd || 0), 0);
  const [settings] = await db.get(`settings?user_id=eq.${userId}&select=monthly_budget_usd`);
  const budget = +settings?.monthly_budget_usd || 8;
  if (spent >= budget) throw new Error(`Maandbudget bereikt ($${spent.toFixed(2)} van $${budget}). Geen nieuwe editie.`);
  if (trigger === 'manual') {
    const todayManual = runs.filter(r => r.note?.startsWith('handmatig') && amsDate(new Date(r.run_at)) === editionDate).length;
    if (todayManual >= 3) throw new Error('Maximaal 3 handmatige edities per dag (kostenbeveiliging).');
  }

  const context = await buildContext(env, ctx, db, userId, kind);
  if (!context.data.positions.length) throw new Error('Geen posities om over te schrijven.');

  const userContent =
    `${kind === 'weekly' ? WEEKLY_TASK : DAILY_TASK}\n\nSamenvatting (JSON):\n${JSON.stringify(context.data)}`;

  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { input, usage, model } = await runClaude(env, ctx, {
        system: SYSTEM_PROMPT, userContent, tool: PUBLISH_TOOL,
        maxSearches: kind === 'weekly' ? 10 : 6,
      });
      const cost = costUsd(model, usage);
      const content = {
        ...input,
        meta: {
          generated_at: new Date().toISOString(), model, cost_usd: Math.round(cost * 10000) / 10000,
          positions: context.snapshot, benchmark: context.benchmark, kind,
        },
      };
      const [edition] = await db.insert('editions?on_conflict=user_id,edition_date,kind', [{
        user_id: userId, edition_date: editionDate, kind, status: 'ready', content, error: null,
      }], 'resolution=merge-duplicates,return=representation');
      await logUsage(db, userId, edition?.id, model, usage, attempt, true, `${trigger === 'manual' ? 'handmatig' : 'automatisch'} ${kind === 'weekly' ? 'weekeditie' : 'dageditie'}`);
      return { edition_id: edition?.id, cost_usd: content.meta.cost_usd, attempt };
    } catch (e) {
      lastError = e;
      await logUsage(db, userId, null, e.model ?? MODEL, e.usage, attempt, false,
        `${trigger === 'manual' ? 'handmatig' : 'automatisch'} ${kind === 'weekly' ? 'weekeditie' : 'dageditie'}: ${String(e.message).slice(0, 200)}`).catch(() => {});
    }
  }
  await db.insert('editions?on_conflict=user_id,edition_date,kind', [{
    user_id: userId, edition_date: editionDate, kind, status: 'failed', content: null, error: String(lastError?.message).slice(0, 500),
  }], 'resolution=merge-duplicates,return=minimal').catch(() => {});
  throw lastError;
}

async function logUsage(db, userId, editionId, model, usage, attempt, success, note) {
  const u = usage ?? { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, web_search_requests: 0 };
  await db.insert('usage_log', [{
    user_id: userId, edition_id: editionId ?? null, model,
    input_tokens: u.input_tokens, output_tokens: u.output_tokens,
    cache_read_tokens: u.cache_read_tokens, cache_write_tokens: u.cache_write_tokens,
    web_search_requests: u.web_search_requests,
    cost_usd: Math.round(costUsd(model, u) * 10000) / 10000,
    attempt, success, note,
  }], 'return=minimal');
}
