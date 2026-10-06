// Alle databasetoegang op één plek. RLS beperkt alles tot de ingelogde gebruiker.
import { supabase } from './supabase.js';

let userId = null;
export const setUser = id => (userId = id);

function check({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

/** Haalt alle rijen op in blokken van 1000 (Supabase geeft standaard max. 1000 per verzoek). */
async function fetchAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = check(await build().range(from, from + 999));
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

export async function getSettings() {
  return check(await supabase.from('settings').select('*').maybeSingle()) ?? {};
}

/** Alle dagkoersen, gegroepeerd per instrument (oplopend op datum). */
export async function listPrices() {
  const rows = await fetchAll(() => supabase.from('prices').select('instrument_id,date,close,close_eur,currency')
    .order('instrument_id').order('date'));
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.instrument_id)) map.set(r.instrument_id, []);
    map.get(r.instrument_id).push(r);
  }
  return map;
}

export async function listTransactions() {
  return fetchAll(() => supabase.from('transactions').select('instrument_id,executed_at,quantity,price,total_eur').order('executed_at'));
}

export async function listInstruments() {
  return check(await supabase.from('instruments').select('*'));
}

export async function listEtfProfiles() {
  return check(await supabase.from('etf_profiles').select('*'));
}

export async function getEtfProfile(instrumentId) {
  return check(await supabase.from('etf_profiles').select('*').eq('instrument_id', instrumentId).maybeSingle());
}

export async function saveEtfProfile(instrumentId, fields) {
  check(await supabase.from('etf_profiles').upsert(
    { ...fields, instrument_id: instrumentId, user_id: userId }, { onConflict: 'instrument_id' }));
}

export async function listWatchlist() {
  return check(await supabase.from('watchlist').select('*, instrument:instruments(*)').order('created_at'));
}

/** Voegt een instrument (indien nodig) en een watchlist-regel toe. */
export async function addToWatchlist({ isin, name, symbol, currency, kind }) {
  // Bestaand instrument hergebruiken (zelfde ISIN, of zelfde ticker bij invoer via ticker)
  let ins = check(await supabase.from('instruments').select('*').eq('isin', isin).maybeSingle())
    ?? (symbol ? check(await supabase.from('instruments').select('*').eq('symbol', symbol).limit(1)).at(0) : null);
  if (!ins) {
    ins = check(await supabase.from('instruments').insert({ isin, name, symbol, currency, kind, user_id: userId }).select().single());
  } else if (!ins.symbol && symbol) {
    check(await supabase.from('instruments').update({ symbol }).eq('id', ins.id));
  }
  check(await supabase.from('watchlist').upsert({ instrument_id: ins.id, user_id: userId }, { onConflict: 'user_id,instrument_id', ignoreDuplicates: true }));
  return ins;
}

export async function updateWatch(id, fields) {
  check(await supabase.from('watchlist').update(fields).eq('id', id));
}

export async function deleteWatch(id) {
  check(await supabase.from('watchlist').delete().eq('id', id));
}

// ---- krant en kosten (fase 3) ----
export async function listEditions() {
  return check(await supabase.from('editions').select('id,edition_date,kind,status,error,created_at')
    .order('edition_date', { ascending: false }).order('kind').limit(120));
}

export async function getEdition(id) {
  return check(await supabase.from('editions').select('*').eq('id', id).maybeSingle());
}

export async function latestEdition() {
  return check(await supabase.from('editions').select('*').eq('status', 'ready')
    .order('edition_date', { ascending: false }).order('created_at', { ascending: false }).limit(1)).at(0) ?? null;
}

/** Kostenlog vanaf een datum (ISO). */
export async function listUsage(fromIso) {
  return check(await supabase.from('usage_log').select('*').gte('run_at', fromIso).order('run_at', { ascending: false }));
}

export async function updateSettings(fields) {
  check(await supabase.from('settings').update(fields).eq('user_id', userId));
}

export async function ensureSettings() {
  check(await supabase.from('settings').upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true }));
}

/** Posities met instrumentgegevens. */
export async function listPositions() {
  return check(await supabase.from('positions').select('*, instrument:instruments(*)'));
}

/** Huidige stand voor de importvergelijking (posities en transacties met ISIN). */
export async function loadImportState() {
  const [positions, transactions] = await Promise.all([
    supabase.from('positions').select('*, instrument:instruments(isin, name)').then(check),
    supabase.from('transactions').select('*, instrument:instruments(isin)').then(check),
  ]);
  return {
    positions: positions.map(p => ({ ...p, isin: p.instrument.isin, name: p.instrument.name })),
    transactions: transactions.map(t => ({ ...t, isin: t.instrument.isin })),
  };
}

export async function applyImport(payload) {
  return check(await supabase.rpc('apply_import', payload));
}

/** Instrument met positie, dagboek en transacties. */
export async function getInstrument(id) {
  const [instrument, position, journal, transactions] = await Promise.all([
    supabase.from('instruments').select('*').eq('id', id).single().then(check),
    supabase.from('positions').select('*').eq('instrument_id', id).maybeSingle().then(check),
    supabase.from('journal_entries').select('*').eq('instrument_id', id).order('created_at', { ascending: false }).then(check),
    supabase.from('transactions').select('*').eq('instrument_id', id).order('executed_at', { ascending: false }).then(check),
  ]);
  return { instrument, position, journal, transactions };
}

/**
 * Handmatig opslaan. instrument: {id?, isin, name, symbol, currency, kind}; position: {quantity, ...}.
 * Geeft het instrument-id terug.
 */
export async function savePosition(instrument, position) {
  const { id, ...fields } = instrument;
  let saved;
  if (id) {
    // Andere ticker = andere notering: oude koershistorie weg, de Worker vult opnieuw aan
    const before = check(await supabase.from('instruments').select('symbol').eq('id', id).single());
    if ((before.symbol || null) !== (fields.symbol || null)) {
      check(await supabase.from('prices').delete().eq('instrument_id', id));
    }
    saved = check(await supabase.from('instruments').update(fields).eq('id', id).select().single());
  } else {
    saved = check(await supabase.from('instruments')
      .upsert({ ...fields, user_id: userId }, { onConflict: 'user_id,isin' }).select().single());
  }
  check(await supabase.from('positions').upsert(
    { ...position, instrument_id: saved.id, user_id: userId, source: 'manual' },
    { onConflict: 'user_id,instrument_id' },
  ));
  return saved.id;
}

/** Verwijdert de positie; het instrument (met dagboek en transacties) blijft bestaan. */
export async function deletePosition(instrumentId) {
  check(await supabase.from('positions').delete().eq('instrument_id', instrumentId));
}

export async function addJournal(instrumentId, body) {
  check(await supabase.from('journal_entries').insert({ instrument_id: instrumentId, body, user_id: userId }));
}
export async function updateJournal(id, body) {
  check(await supabase.from('journal_entries').update({ body }).eq('id', id));
}
export async function deleteJournal(id) {
  check(await supabase.from('journal_entries').delete().eq('id', id));
}
