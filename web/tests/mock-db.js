// In-memory vervanging van js/db.js. applyImport bootst de SQL-functie apply_import na.
const S = (window.__mockDb = { instruments: [], positions: [], transactions: [], journal: [], prices: [], profiles: [], watchlist: [], editions: [], usage: [], settings: { move_threshold_pct: 2, large_position_pct: 15, monthly_budget_usd: 8,  concentration_pct: 25, benchmark_symbol: 'IWDA.AS' } });
const uuid = () => crypto.randomUUID();
const byIsin = isin => S.instruments.find(i => i.isin === isin);

export const setUser = () => {};
export const ensureSettings = async () => {};

export async function listPositions() {
  return S.positions.map(p => ({ ...p, instrument: S.instruments.find(i => i.id === p.instrument_id) }));
}

export async function loadImportState() {
  return {
    positions: S.positions.map(p => { const i = S.instruments.find(x => x.id === p.instrument_id); return { ...p, isin: i.isin, name: i.name }; }),
    transactions: S.transactions.map(t => ({ ...t, isin: S.instruments.find(i => i.id === t.instrument_id).isin })),
  };
}

export async function applyImport({ p_instruments, p_transactions, p_positions, p_remove_isins }) {
  for (const i of p_instruments) {
    const ex = byIsin(i.isin);
    if (!ex) S.instruments.push({ id: uuid(), symbol: null, ...i });
    else {
      if (!(i.name.endsWith('...') && ex.name.length >= i.name.length - 3)) ex.name = i.name;
      ex.exchange = i.exchange ?? ex.exchange; ex.currency = i.currency;
      if (ex.kind === 'other') ex.kind = i.kind;
    }
  }
  let inserted = 0;
  for (const t of p_transactions) {
    if (S.transactions.some(x => x.dedup_key === t.dedup_key)) continue;
    const { isin, ...rest } = t;
    S.transactions.push({ id: uuid(), instrument_id: byIsin(isin).id, ...rest });
    inserted++;
  }
  const before = S.positions.length;
  S.positions = S.positions.filter(p => !p_remove_isins.includes(S.instruments.find(i => i.id === p.instrument_id).isin));
  const removed = before - S.positions.length;
  for (const p of p_positions) {
    const { isin, ...rest } = p;
    const id = byIsin(isin).id;
    const ex = S.positions.find(x => x.instrument_id === id);
    if (ex) Object.assign(ex, rest); else S.positions.push({ id: uuid(), instrument_id: id, ...rest });
  }
  return { transactions_inserted: inserted, positions_set: p_positions.length, positions_removed: removed };
}

export async function getInstrument(id) {
  return {
    instrument: S.instruments.find(i => i.id === id),
    position: S.positions.find(p => p.instrument_id === id) ?? null,
    journal: S.journal.filter(j => j.instrument_id === id).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    transactions: S.transactions.filter(t => t.instrument_id === id).sort((a, b) => b.executed_at.localeCompare(a.executed_at)),
  };
}

export async function savePosition(instrument, position) {
  let ins;
  if (instrument.id) { ins = S.instruments.find(i => i.id === instrument.id); Object.assign(ins, instrument); }
  else {
    if (byIsin(instrument.isin)) throw new Error('duplicate key value violates unique constraint');
    ins = { ...instrument, id: uuid() }; S.instruments.push(ins);
  }
  const ex = S.positions.find(p => p.instrument_id === ins.id);
  if (ex) Object.assign(ex, position, { source: 'manual' });
  else S.positions.push({ id: uuid(), instrument_id: ins.id, ...position, source: 'manual' });
  return ins.id;
}

export async function deletePosition(instrumentId) { S.positions = S.positions.filter(p => p.instrument_id !== instrumentId); }
export async function addJournal(instrument_id, body) {
  const now = new Date().toISOString();
  S.journal.push({ id: uuid(), instrument_id, body, created_at: now, updated_at: now });
}
export async function updateJournal(id, body) { Object.assign(S.journal.find(j => j.id === id), { body, updated_at: new Date().toISOString() }); }
export async function deleteJournal(id) { S.journal = S.journal.filter(j => j.id !== id); }

// ---- fase 2 ----
export async function getSettings() { return S.settings; }
export async function listInstruments() { return S.instruments; }
export async function listTransactions() {
  return [...S.transactions].sort((a, b) => a.executed_at.localeCompare(b.executed_at));
}
export async function listPrices() {
  const m = new Map();
  for (const p of [...S.prices].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!m.has(p.instrument_id)) m.set(p.instrument_id, []);
    m.get(p.instrument_id).push(p);
  }
  return m;
}
export async function listEtfProfiles() { return S.profiles; }
export async function getEtfProfile(id) { return S.profiles.find(p => p.instrument_id === id) ?? null; }
export async function saveEtfProfile(instrument_id, fields) {
  S.profiles = S.profiles.filter(p => p.instrument_id !== instrument_id);
  S.profiles.push({ instrument_id, ...fields, updated_at: new Date().toISOString() });
}
export async function listWatchlist() {
  return S.watchlist.map(w => ({ ...w, instrument: S.instruments.find(i => i.id === w.instrument_id) }));
}
export async function addToWatchlist({ isin, name, symbol, currency, kind }) {
  let ins = byIsin(isin) ?? S.instruments.find(i => symbol && i.symbol === symbol);
  if (!ins) { ins = { id: uuid(), isin, name, symbol, currency, kind }; S.instruments.push(ins); }
  if (!S.watchlist.some(w => w.instrument_id === ins.id)) S.watchlist.push({ id: uuid(), instrument_id: ins.id, created_at: new Date().toISOString() });
  return ins;
}
export async function updateWatch(id, fields) { Object.assign(S.watchlist.find(w => w.id === id), fields); }
export async function deleteWatch(id) { S.watchlist = S.watchlist.filter(w => w.id !== id); }

// ---- fase 3 ----
export async function listEditions() { return [...S.editions].sort((a, b) => b.edition_date.localeCompare(a.edition_date)); }
export async function getEdition(id) { return S.editions.find(e => e.id === id) ?? null; }
export async function latestEdition() { return (await listEditions()).find(e => e.status === 'ready') ?? null; }
export async function listUsage() { return S.usage; }
export async function updateSettings(fields) { Object.assign(S.settings, fields); }
