import { parseCsv, detectDelimiter, detectDecimalSeparator, parseNumber, parseDate, amsterdamToIso } from '../js/csv.js';
import { parseDegiroCsv } from '../js/degiro.js';
import { derivePositions, planTransactionsImport, planPortfolioImport } from '../js/importer.js';
import * as F from './fixtures.js';

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, error: e.message }); }
}
function eq(actual, expected, msg = '') {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg} verwacht ${b}, kreeg ${a}`);
}
const close = (a, b, msg = '') => { if (Math.abs(a - b) > 1e-6) throw new Error(`${msg} verwacht ${b}, kreeg ${a}`); };

// ---- csv.js ----
test('scheidingsteken komma', () => eq(detectDelimiter('a,b,"c;d"\n'), ','));
test('scheidingsteken puntkomma', () => eq(detectDelimiter('a;b;c\n1,5;2;3'), ';'));
test('aanhalingstekens en "" escape', () => eq(parseCsv('a,"b,""x""",c\r\n1,2,3\r\n\r\n'), [['a', 'b,"x"', 'c'], ['1', '2', '3']]));
test('BOM wordt genegeerd', () => eq(parseCsv('﻿a,b\n1,2')[0][0], 'a'));
test('decimaalteken NL', () => eq(detectDecimalSeparator(['462,80', '-1106,48', '3']), ','));
test('decimaalteken EN', () => eq(detectDecimalSeparator(['462.80', '1,234.50']), '.'));
test('getallen NL', () => { eq(parseNumber('1.234,56', ','), 1234.56); eq(parseNumber('-83,76', ','), -83.76); eq(parseNumber('', ','), null); });
test('getallen EN', () => { eq(parseNumber('1,234.56', '.'), 1234.56); eq(parseNumber('-0.97', '.'), -0.97); });
test('datums', () => { eq(parseDate('14-09-2026'), { y: 2026, m: 9, d: 14 }); eq(parseDate('2026-09-14'), { y: 2026, m: 9, d: 14 }); eq(parseDate('31/12/2025'), { y: 2025, m: 12, d: 31 }); eq(parseDate('x'), null); });
test('Amsterdam-tijd zomer (UTC+2)', () => eq(amsterdamToIso({ y: 2026, m: 9, d: 14 }, { h: 9, min: 0 }), '2026-09-14T07:00:00.000Z'));
test('Amsterdam-tijd winter (UTC+1)', () => eq(amsterdamToIso({ y: 2026, m: 1, d: 14 }, { h: 9, min: 0 }), '2026-01-14T08:00:00.000Z'));

// ---- degiro.js ----
test('portefeuille NL: soort, rijen, cash en valutakolom', () => {
  const p = parseDegiroCsv(F.PORTFOLIO_NL);
  eq(p.kind, 'portfolio'); eq(p.warnings, []); eq(p.rows.length, 4);
  const cash = p.rows[0];
  eq([cash.isin, cash.kind, cash.valueEur], ['CASH-EUR', 'cash', 10.5]);
  const nq = p.rows[1];
  eq([nq.isin, nq.quantity, nq.close, nq.currency, nq.localValue, nq.valueEur, nq.kind], ['IE00BFZXGZ54', 2, 400, 'EUR', 800, 800, 'etf']);
  const aapl = p.rows[3];
  eq([aapl.currency, aapl.localValue, aapl.valueEur, aapl.kind], ['USD', 600, 552, 'stock']);
});
test('transacties NL: velden, valuta, tijd en dedup-sleutel', () => {
  const p = parseDegiroCsv(F.TRANSACTIONS_NL);
  eq(p.kind, 'transactions'); eq(p.warnings, []); eq(p.rows.length, 3);
  const t = p.rows[1];
  eq([t.isin, t.quantity, t.price, t.currency, t.valueEur, t.fees, t.total, t.exchange, t.venue, t.orderId],
     ['IE00BFMXXD54', 6, 100, 'EUR', -600, -1, -601, 'TDG', 'XGAT', 'aaaa-1111']);
  eq(t.executedAt, '2026-05-01T08:15:00.000Z');
});
test('transacties EN: punt-decimaal, duizendtal, AutoFX, verkoop', () => {
  const p = parseDegiroCsv(F.TRANSACTIONS_EN);
  eq(p.kind, 'transactions'); eq(p.decimal, '.'); eq(p.warnings, []);
  const [buy, sell, big] = p.rows;
  eq([buy.currency, buy.valueEur, buy.autofxFee, buy.total, buy.fxRate], ['USD', -920, -2.3, -923.3, 1.087]);
  eq(sell.quantity, -2);
  eq([big.price, big.localValue, big.total], [1234.5, -1234.5, -1139.58]);
});
test('puntkomma-bestand met duizendtallen', () => {
  const p = parseDegiroCsv(F.PORTFOLIO_SEMICOLON);
  eq(p.kind, 'portfolio'); eq(p.rows[0].valueEur, 1000); eq(p.rows[0].quantity, 10);
});
test('onbekend formaat geeft waarschuwing', () => {
  const p = parseDegiroCsv('foo,bar\n1,2');
  eq(p.kind, null); if (!p.warnings.length) throw new Error('geen waarschuwing');
});

// ---- importer.js ----
const empty = { positions: [], transactions: [] };
const asDb = rows => rows.map(r => ({
  isin: r.isin, executed_at: r.executedAt, quantity: r.quantity, price: r.price, total_eur: r.total,
  value_eur: r.valueEur, fees_eur: r.fees, autofx_fee_eur: r.autofxFee, currency: r.currency, dedup_key: r.dedupKey,
}));

test('gemiddelde kostprijs incl. kosten', () => {
  const d = derivePositions(parseDegiroCsv(F.TRANSACTIONS_NL).rows).get('IE00BFMXXD54');
  eq(d.quantity, 10); close(d.costBasisEur, 1042); close(d.avgPrice, 104);
});
test('verkoop verlaagt aankoopwaarde naar rato', () => {
  const d = derivePositions(parseDegiroCsv(F.TRANSACTIONS_EN).rows).get('US0378331005');
  eq(d.quantity, 3); close(d.costBasisEur, 553.98); close(d.avgPrice, 200);
});
test('transactie-import: alles nieuw, posities berekend', () => {
  const plan = planTransactionsImport(parseDegiroCsv(F.TRANSACTIONS_NL), empty);
  eq(plan.summary, { total: 3, new: 3, duplicate: 0, positionsAffected: 2 });
  const sp = plan.payload.p_positions.find(p => p.isin === 'IE00BFMXXD54');
  eq([sp.quantity, sp.cost_basis_eur, sp.avg_price, sp.last_price, sp.last_value_eur], [10, 1042, 104, 110, 1100]);
  eq(plan.payload.p_instruments.find(i => i.isin === 'IE00BFZXGZ54').name, 'INVESCO EQQQ NASDAQ-100 UCITS ETF ACC');
});
test('transactie-import: tweede keer zelfde bestand = alles dubbel', () => {
  const parsed = parseDegiroCsv(F.TRANSACTIONS_NL);
  const plan = planTransactionsImport(parsed, { positions: [], transactions: asDb(parsed.rows) });
  eq(plan.summary.new, 0); eq(plan.summary.duplicate, 3); eq(plan.payload.p_transactions.length, 0); eq(plan.payload.p_positions.length, 0);
});
test('deeluitvoeringen met zelfde Order ID zijn géén dubbeling', () => {
  const plan = planTransactionsImport(parseDegiroCsv(F.TRANSACTIONS_PARTIAL_FILL), empty);
  eq(plan.summary.new, 2);
});
test('dubbele regel binnen één bestand wordt overgeslagen', () => {
  const line = F.TRANSACTIONS_NL.trim().split('\n')[1];
  const plan = planTransactionsImport(parseDegiroCsv(F.TRANSACTIONS_NL + line + '\n'), empty);
  eq(plan.summary.new, 3); eq(plan.rows.at(-1).status, 'duplicate_in_file');
});
test('portefeuille-import: aankoopwaarde uit transacties, cash, ontbrekende kostprijs', () => {
  const txs = asDb(parseDegiroCsv(F.TRANSACTIONS_NL).rows);
  const plan = planPortfolioImport(parseDegiroCsv(F.PORTFOLIO_NL), { positions: [], transactions: txs }, '2026-10-01T06:00:00.000Z');
  eq(plan.summary.new, 4); eq(plan.summary.totalValueEur, 2362.5);
  const sp = plan.payload.p_positions.find(p => p.isin === 'IE00BFMXXD54');
  eq([sp.quantity, sp.cost_basis_eur, sp.last_price, sp.last_value_eur, sp.source], [10, 1042, 100, 1000, 'portfolio_csv']);
  eq(plan.payload.p_positions.find(p => p.isin === 'CASH-EUR').cost_basis_eur, 10.5);
  eq(plan.payload.p_positions.find(p => p.isin === 'US0378331005').cost_basis_eur, null);
  if (!plan.warnings.some(w => w.startsWith('APPLE INC'))) throw new Error('waarschuwing voor Apple ontbreekt');
  // portefeuille levert afgekapte naam; apply_import in de database behoudt dan de volledige naam
  eq(plan.payload.p_instruments.find(i => i.isin === 'IE00BFZXGZ54').name, 'INVESCO EQQQ NASDAQ-100 UCITS ET...');
});
test('portefeuille-import: verdwenen positie wordt verwijderd, gewijzigd aantal gemarkeerd', () => {
  const existing = {
    transactions: [],
    positions: [
      { isin: 'IE00BFMXXD54', name: 'S&P', quantity: 8, avg_price: 99, cost_basis_eur: 800 },
      { isin: 'NL0000000001', name: 'Oud aandeel', quantity: 5 },
    ],
  };
  const plan = planPortfolioImport(parseDegiroCsv(F.PORTFOLIO_SEMICOLON), existing);
  eq(plan.rows[0].status, 'changed'); eq(plan.payload.p_remove_isins, ['NL0000000001']);
  eq(plan.payload.p_positions[0].cost_basis_eur, 800);
});

// ---- optioneel: echte exports uit web/tests/local/ (staat in .gitignore) ----
async function localFiles() {
  for (const file of ['Portfolio.csv', 'Transactions.csv']) {
    let text;
    try {
      const res = await fetch(`./local/${file}`, { cache: 'no-store' });
      if (!res.ok) continue;
      text = await res.text();
    } catch { continue; }
    test(`echt bestand ${file} wordt zonder fouten gelezen`, () => {
      const p = parseDegiroCsv(text);
      if (!p.kind) throw new Error(p.warnings.join(' '));
      if (p.warnings.length) throw new Error(p.warnings.join(' | '));
      window.__local = window.__local || {};
      window.__local[file] = p;
    });
  }
  if (window.__local?.['Portfolio.csv'] && window.__local?.['Transactions.csv']) {
    test('echte transacties verklaren de echte portefeuille', () => {
      const tx = window.__local['Transactions.csv'];
      const derived = derivePositions(tx.rows);
      const mismatch = window.__local['Portfolio.csv'].rows
        .filter(r => r.kind !== 'cash')
        .filter(r => derived.get(r.isin)?.quantity !== r.quantity)
        .map(r => `${r.name}: ${derived.get(r.isin)?.quantity} vs ${r.quantity}`);
      if (mismatch.length) throw new Error(mismatch.join('; '));
    });
  }
}

await localFiles();

const list = document.getElementById('results');
for (const r of results) {
  const li = document.createElement('li');
  li.className = r.ok ? 'ok' : 'fail';
  li.textContent = `${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : ' — ' + r.error}`;
  list.append(li);
}
const failed = results.filter(r => !r.ok).length;
document.getElementById('summary').textContent =
  `${results.length - failed} van ${results.length} geslaagd${failed ? ` — ${failed} mislukt` : ''}`;
document.body.dataset.status = failed ? 'fail' : 'ok';
window.__testResults = results;
