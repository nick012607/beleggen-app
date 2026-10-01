// Alle databasetoegang op één plek. RLS beperkt alles tot de ingelogde gebruiker.
import { supabase } from './supabase.js';

let userId = null;
export const setUser = id => (userId = id);

function check({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
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
