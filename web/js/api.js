// Aanroepen naar de Cloudflare Worker (koersen; later de krant). Altijd met het Supabase-token.
import { supabase } from './supabase.js';
import { WORKER_URL } from './config.js';

export const workerConfigured = Boolean(WORKER_URL);

async function call(path, options = {}) {
  if (!workerConfigured) throw new Error('De Worker is nog niet gekoppeld (WORKER_URL in config.js).');
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(WORKER_URL.replace(/\/$/, '') + path, {
    ...options,
    headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Worker gaf fout ${res.status}`);
  return body;
}

export const refreshPrices = () => call('/api/prices/refresh', { method: 'POST' });
export const resolveIsin = (isin, refPrice) => call(`/api/resolve?isin=${encodeURIComponent(isin)}${refPrice ? `&ref=${refPrice}` : ''}`);
export const quote = symbol => call(`/api/quote?symbol=${encodeURIComponent(symbol)}`);
