// Finnhub: nieuwskoppen per Amerikaans aandeel (gratis plan). Alleen koppen + bron + link, geen artikelen.

export async function companyNews(env, ctx, tickers, days = 3, perTicker = 3) {
  if (!env.FINNHUB_API_KEY || !tickers.length) return [];
  const to = new Date();
  const from = new Date(to - days * 86400e3);
  const d = x => x.toISOString().slice(0, 10);
  const out = [];
  for (const t of tickers) {
    if (ctx.budget.left() < 8) break;
    ctx.budget.use();
    try {
      const res = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(t)}&from=${d(from)}&to=${d(to)}&token=${env.FINNHUB_API_KEY}`);
      if (!res.ok) continue;
      const items = await res.json();
      for (const n of (Array.isArray(items) ? items : []).slice(0, perTicker)) {
        out.push({
          ticker: t,
          headline: String(n.headline ?? '').slice(0, 180),
          source: n.source,
          url: n.url,
          date: n.datetime ? new Date(n.datetime * 1000).toISOString().slice(0, 10) : null,
        });
      }
    } catch { /* nieuws is aanvullend; fouten negeren */ }
  }
  return out;
}
