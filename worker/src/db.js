// Minimale Supabase-client (PostgREST + Auth) op basis van fetch, met de service key.
// De service key omzeilt RLS; filter daarom ALTIJD expliciet op user_id.

export function createDb(env, ctx) {
  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  // Nieuwe sleutels (sb_secret_...) zijn geen JWT: alleen als apikey meesturen.
  const authHeaders = key.startsWith('eyJ') ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key };

  async function rest(method, path, body, prefer) {
    ctx.budget.use();
    const res = await fetch(`${base}/rest/v1/${path}`, {
      method,
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
        ...(prefer ? { Prefer: prefer } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Supabase ${method} ${path.split('?')[0]}: ${res.status} ${await res.text()}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  return {
    get: path => rest('GET', path),
    insert: (table, rows, prefer = 'return=representation') => rest('POST', table, rows, prefer),
    upsert: (table, rows, onConflict) =>
      rest('POST', `${table}?on_conflict=${onConflict}`, rows, 'resolution=merge-duplicates,return=minimal'),
    patch: (path, body) => rest('PATCH', path, body, 'return=minimal'),

    /** Controleert het access token van de ingelogde gebruiker; geeft de gebruiker of null. */
    async userFromToken(token) {
      if (!token) return null;
      ctx.budget.use();
      const res = await fetch(`${base}/auth/v1/user`, {
        headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY || key, Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      return res.json();
    },
  };
}
