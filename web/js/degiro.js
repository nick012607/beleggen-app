// Parser voor DEGIRO-exports (Portefeuille en Transacties), Nederlands of Engels.
// Herkent kolommen via synoniemen en koppelt naamloze kolommen (valuta/bedrag) aan hun buurman.

import { parseCsv, detectDelimiter, detectDecimalSeparator, parseNumber, parseDate, parseTime, amsterdamToIso } from './csv.js';

// exact: kop moet precies overeenkomen; prefix: kop begint hiermee.
const FIELDS = {
  product:    { exact: ['product', 'productnaam', 'naam', 'name'], prefix: ['product'] },
  isin:       { exact: ['isin', 'symbool/isin', 'symbol/isin', 'symbool', 'symbol'], prefix: ['symbool/isin', 'symbol/isin'] },
  quantity:   { exact: ['aantal', 'quantity', 'qty', 'number', 'hoeveelheid'], prefix: [] },
  close:      { exact: ['slotkoers', 'closing', 'closing price', 'close', 'laatste koers', 'last price'], prefix: ['slotkoers', 'closing'] },
  price:      { exact: ['koers', 'price', 'prijs'], prefix: [] },
  localValue: { exact: ['lokale waarde', 'local value'], prefix: ['lokale waarde', 'local value'] },
  valueEur:   { exact: ['waarde in eur', 'waarde eur', 'value in eur', 'value eur', 'waarde', 'value'], prefix: ['waarde in eur', 'value in eur'] },
  date:       { exact: ['datum', 'date'], prefix: [] },
  time:       { exact: ['tijd', 'time'], prefix: [] },
  exchange:   { exact: ['beurs', 'exchange', 'reference exchange', 'referentiebeurs'], prefix: [] },
  venue:      { exact: ['uitvoeringsplaats', 'venue', 'execution venue'], prefix: [] },
  fxRate:     { exact: ['wisselkoers', 'exchange rate', 'fx rate'], prefix: [] },
  autofx:     { exact: [], prefix: ['autofx'] },
  fees:       { exact: [], prefix: ['transactiekosten', 'transaction and/or third', 'transaction costs', 'transaction fees', 'kosten'] },
  total:      { exact: ['totaal', 'total'], prefix: ['totaal', 'total'] },
  orderId:    { exact: ['order id', 'order-id', 'orderid'], prefix: ['order id', 'order-id'] },
};

// Velden waarbij DEGIRO een tweede, naamloze kolom gebruikt voor valuta of bedrag.
const PAIRED = ['price', 'close', 'localValue', 'valueEur', 'total'];

const CURRENCY_RE = /^[A-Z]{3}$/;
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

export const norm = s => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Koppelt kolomkoppen aan velden. Geeft { field: { index, currencyIndex? } }. */
export function mapColumns(header, sampleRows) {
  const h = header.map(norm);
  const candidates = [];
  h.forEach((name, col) => {
    if (!name) return;
    for (const [field, syn] of Object.entries(FIELDS)) {
      let score = 0;
      if (syn.exact.includes(name) || syn.prefix.includes(name)) score = 3;
      else if (syn.prefix.some(p => name.startsWith(p))) score = 2;
      if (score) candidates.push({ field, col, score });
    }
  });
  candidates.sort((a, b) => b.score - a.score || a.col - b.col);

  const map = {};
  const usedCols = new Set();
  for (const c of candidates) {
    if (map[c.field] || usedCols.has(c.col)) continue;
    map[c.field] = { index: c.col };
    usedCols.add(c.col);
  }

  // Naamloze buurkolom: welke van de twee bevat valutacodes?
  const isCurrencyCol = col => {
    const vals = sampleRows.map(r => (r[col] ?? '').trim()).filter(Boolean);
    return vals.length > 0 && vals.filter(v => CURRENCY_RE.test(v)).length / vals.length >= 0.8;
  };
  for (const field of PAIRED) {
    const m = map[field];
    if (!m) continue;
    const next = m.index + 1;
    if (next < h.length && h[next] === '' && !usedCols.has(next)) {
      if (isCurrencyCol(m.index) && !isCurrencyCol(next)) {
        map[field] = { index: next, currencyIndex: m.index };
      } else if (isCurrencyCol(next)) {
        map[field] = { index: m.index, currencyIndex: next };
      }
      usedCols.add(next);
    }
  }
  return map;
}

export function detectKind(map) {
  if (map.date && (map.price || map.total) && map.quantity) return 'transactions';
  if (map.product && map.quantity && (map.close || map.valueEur || map.localValue)) return 'portfolio';
  return null;
}

export function guessInstrumentKind(name) {
  if (/\b(ETF|UCITS|ETC|ETN|ETP)\b/i.test(name)) return 'etf';
  if (/\b(fund|fonds)\b/i.test(name)) return 'fund';
  return 'stock';
}

/**
 * Hoofdingang: tekst van een CSV -> { kind, rows, warnings, delimiter, decimal, columns }.
 * rows zijn genormaliseerde objecten (zie normalizePortfolioRow / normalizeTransactionRow).
 */
export function parseDegiroCsv(text) {
  const delimiter = detectDelimiter(text);
  const all = parseCsv(text, delimiter);
  if (all.length < 2) return { kind: null, rows: [], warnings: ['Het bestand bevat geen gegevensregels.'], delimiter };

  const [header, ...data] = all;
  const columns = mapColumns(header, data.slice(0, 50));
  const kind = detectKind(columns);
  if (!kind) {
    return {
      kind: null, rows: [], delimiter, columns,
      warnings: [`Onbekend formaat. Herkende kolommen: ${Object.keys(columns).join(', ') || 'geen'}. Verwacht een DEGIRO Portefeuille- of Transacties-export.`],
    };
  }

  const numericCols = ['quantity', 'price', 'close', 'localValue', 'valueEur', 'fxRate', 'autofx', 'fees', 'total']
    .filter(f => columns[f]).map(f => columns[f].index);
  const decimal = detectDecimalSeparator(data.flatMap(r => numericCols.map(i => r[i])));

  const warnings = [];
  const rows = [];
  data.forEach((r, i) => {
    const line = i + 2;
    const get = f => (columns[f] ? (r[columns[f].index] ?? '').trim() : '');
    const cur = f => (columns[f]?.currencyIndex != null ? (r[columns[f].currencyIndex] ?? '').trim().toUpperCase() : '');
    const num = f => parseNumber(get(f), decimal);
    try {
      const row = kind === 'portfolio'
        ? normalizePortfolioRow(get, cur, num)
        : normalizeTransactionRow(get, cur, num);
      if (row) rows.push({ ...row, line });
    } catch (e) {
      warnings.push(`Regel ${line}: ${e.message}`);
    }
  });

  return { kind, rows, warnings, delimiter, decimal, columns };
}

function identify(get) {
  const name = get('product');
  const rawId = get('isin').toUpperCase();
  if (ISIN_RE.test(rawId)) return { name, isin: rawId };
  if (rawId) return { name, isin: `SYM-${rawId}`, symbol: rawId };
  return { name, isin: '' };
}

function normalizePortfolioRow(get, cur, num) {
  const { name, isin, symbol } = identify(get);
  if (!name && !isin) return null;
  const currency = cur('localValue') || cur('close') || cur('valueEur') || 'EUR';

  if (!isin && /cash|geldmarkt|money market/i.test(name)) {
    const ccy = (name.match(/\(([A-Z]{3})\)/) || [])[1] || currency;
    const amount = num('valueEur') ?? num('localValue') ?? 0;
    return {
      isin: `CASH-${ccy}`, name: `Cash (${ccy})`, kind: 'cash', currency: ccy,
      quantity: num('localValue') ?? amount, close: 1, localValue: num('localValue') ?? amount, valueEur: amount,
    };
  }
  if (!isin) throw new Error(`geen ISIN gevonden voor "${name}"`);

  const quantity = num('quantity');
  if (quantity == null) throw new Error(`geen aantal voor "${name}"`);
  return {
    isin, symbol, name, kind: guessInstrumentKind(name), currency,
    quantity, close: num('close'), localValue: num('localValue'), valueEur: num('valueEur'),
  };
}

function normalizeTransactionRow(get, cur, num) {
  const { name, isin, symbol } = identify(get);
  if (!isin) throw new Error(`geen ISIN gevonden voor "${name}"`);
  const date = parseDate(get('date'));
  if (!date) throw new Error(`onleesbare datum "${get('date')}"`);
  const executedAt = amsterdamToIso(date, parseTime(get('time')));

  const quantity = num('quantity');
  const price = num('price');
  if (quantity == null || price == null) throw new Error(`aantal of koers ontbreekt voor "${name}"`);

  const currency = cur('price') || cur('localValue') || 'EUR';
  const valueEur = num('valueEur');
  const fees = num('fees') ?? 0;
  const autofx = num('autofx') ?? 0;
  const total = num('total') ?? (valueEur != null ? valueEur + fees + autofx : null);
  const orderId = get('orderId') || null;

  return {
    isin, symbol, name, kind: guessInstrumentKind(name), currency,
    executedAt, quantity, price,
    localValue: num('localValue'), valueEur, fxRate: num('fxRate'),
    autofxFee: autofx, fees, total,
    exchange: get('exchange') || null, venue: get('venue') || null, orderId,
    dedupKey: orderId
      ? [orderId, executedAt, quantity, price].join('|')
      : [isin, executedAt, quantity, price, total].join('|'),
  };
}
