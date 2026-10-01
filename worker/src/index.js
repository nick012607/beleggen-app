// Cloudflare Worker: koersen (fase 2), later ook de dagelijkse krant (fase 3).
import { createDb } from './db.js';
import { refreshUser } from './prices.js';
import { resolveIsin, fetchChart } from './yahoo.js';

// Workers Free staat 50 externe aanroepen per uitvoering toe; we houden marge.
function makeCtx(limit = 45) {
  let used = 0;
  return {
    budget: {
      use() { if (++used > limit) throw new Error('Limiet externe aanroepen bereikt'); },
      left: () => limit - used,
    },
  };
}

function cors(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  return allowed.includes(origin)
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      }
    : { Vary: 'Origin' };
}

const json = (data, status, headers) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });

export default {
  async fetch(req, env) {
    const headers = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const url = new URL(req.url);

    try {
      if (url.pathname === '/api/health') return json({ ok: true }, 200, headers);

      const ctx = makeCtx();
      const db = createDb(env, ctx);
      const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      const user = await db.userFromToken(token);
      if (!user?.id) return json({ error: 'Niet ingelogd' }, 401, headers);

      if (url.pathname === '/api/prices/refresh' && req.method === 'POST') {
        return json(await refreshUser(ctx, db, user.id, { resolveLimit: 8 }), 200, headers);
      }
      if (url.pathname === '/api/resolve' && req.method === 'GET') {
        const isin = (url.searchParams.get('isin') || '').toUpperCase();
        if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin)) return json({ error: 'Ongeldige ISIN' }, 400, headers);
        const ref = Number(url.searchParams.get('ref')) || null;
        return json(await resolveIsin(ctx, isin, ref), 200, headers);
      }
      if (url.pathname === '/api/quote' && req.method === 'GET') {
        const symbol = (url.searchParams.get('symbol') || '').trim();
        if (!/^[\w.\-^=]{1,20}$/.test(symbol)) return json({ error: 'Ongeldige ticker' }, 400, headers);
        const c = await fetchChart(ctx, symbol, new Date(Date.now() - 40 * 86400e3));
        if (!c) return json({ error: 'Ticker niet gevonden' }, 404, headers);
        return json({ symbol: c.symbol, name: c.name, currency: c.currency, exchange: c.exchange, price: c.price, priceTime: c.priceTime, hasHistory: c.closes.length >= 5 }, 200, headers);
      }
      return json({ error: 'Niet gevonden' }, 404, headers);
    } catch (e) {
      console.error(e);
      return json({ error: e.message }, 500, headers);
    }
  },

  // Cron: koersen na sluiting van de Europese beurzen bijwerken
  async scheduled(event, env, execCtx) {
    execCtx.waitUntil((async () => {
      const ctx = makeCtx();
      const db = createDb(env, ctx);
      const users = await db.get('settings?select=user_id');
      for (const { user_id } of users) {
        try {
          const s = await refreshUser(ctx, db, user_id, { resolveLimit: 8 });
          console.log('koersen', user_id, JSON.stringify(s));
        } catch (e) {
          console.error('koersen mislukt', user_id, e.message);
        }
      }
    })());
  },
};
