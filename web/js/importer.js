// Importlogica (puur, zonder database): vergelijkt een geparste CSV met de huidige gegevens,
// bouwt een preview en de payload voor de Supabase-functie apply_import.

const EPS = 1e-9;
const round = (n, d = 2) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

/** Database-transactie (snake_case) -> intern formaat. */
export function fromDbTransaction(t) {
  return {
    isin: t.isin ?? t.instruments?.isin,
    executedAt: t.executed_at, quantity: +t.quantity, price: +t.price,
    total: t.total_eur == null ? null : +t.total_eur,
    valueEur: t.value_eur == null ? null : +t.value_eur,
    fees: +(t.fees_eur ?? 0), autofxFee: +(t.autofx_fee_eur ?? 0),
    currency: t.currency, dedupKey: t.dedup_key,
  };
}

/**
 * Berekent posities uit transacties volgens de gemiddelde-kostprijsmethode.
 * Koop: kosten erbij (incl. transactiekosten). Verkoop: kosten nemen naar rato af.
 * Geeft Map isin -> { quantity, avgPrice, costBasisEur, lastPrice, currency }.
 */
export function derivePositions(transactions) {
  const sorted = [...transactions].sort((a, b) => a.executedAt.localeCompare(b.executedAt));
  const out = new Map();
  for (const t of sorted) {
    const p = out.get(t.isin) ?? { quantity: 0, costLocal: 0, costBasisEur: 0, lastPrice: null, currency: t.currency };
    if (t.quantity > 0) {
      const cost = t.total != null
        ? Math.abs(t.total)
        : Math.abs(t.valueEur ?? t.quantity * t.price) + Math.abs(t.fees ?? 0) + Math.abs(t.autofxFee ?? 0);
      p.costBasisEur += cost;
      p.costLocal += t.quantity * t.price;
    } else if (t.quantity < 0 && p.quantity > EPS) {
      const ratio = Math.max(0, (p.quantity + t.quantity) / p.quantity);
      p.costBasisEur *= ratio;
      p.costLocal *= ratio;
    }
    p.quantity += t.quantity;
    if (Math.abs(p.quantity) < EPS) { p.quantity = 0; p.costBasisEur = 0; p.costLocal = 0; }
    p.lastPrice = t.price;
    p.currency = t.currency;
    out.set(t.isin, p);
  }
  for (const p of out.values()) {
    p.avgPrice = p.quantity > EPS ? round(p.costLocal / p.quantity, 4) : null;
    p.costBasisEur = round(p.costBasisEur);
    delete p.costLocal;
  }
  return out;
}

function instrumentsPayload(rows) {
  const byIsin = new Map();
  for (const r of rows) {
    const prev = byIsin.get(r.isin);
    // langste (niet-afgekapte) naam wint
    if (!prev || (prev.name.endsWith('...') && !r.name.endsWith('...')) || r.name.length > prev.name.length) {
      byIsin.set(r.isin, { isin: r.isin, name: r.name, exchange: r.exchange ?? prev?.exchange ?? null, currency: r.currency, kind: r.kind });
    }
  }
  return [...byIsin.values()];
}

/**
 * Transactie-import: voegt nieuwe transacties toe (zonder dubbelingen) en herberekent
 * aantal en aankoopwaarde van de geraakte posities uit álle transacties.
 *
 * existing = { positions: [{isin, name, quantity, avg_price, cost_basis_eur, last_price, last_value_eur, last_price_at}],
 *              transactions: [db-rijen met isin] }
 */
export function planTransactionsImport(parsed, existing) {
  const knownKeys = new Set(existing.transactions.map(t => t.dedup_key));
  const seen = new Set();
  const rows = parsed.rows.map(r => {
    let status = 'new';
    if (knownKeys.has(r.dedupKey)) status = 'duplicate';
    else if (seen.has(r.dedupKey)) status = 'duplicate_in_file';
    seen.add(r.dedupKey);
    return { ...r, status };
  });
  const newRows = rows.filter(r => r.status === 'new');

  const all = [...existing.transactions.map(fromDbTransaction), ...newRows];
  const derived = derivePositions(all);
  const before = new Map(existing.positions.map(p => [p.isin, p]));
  const affected = [...new Set(newRows.map(r => r.isin))];

  const positions = [];
  const remove = [];
  const changes = [];
  for (const isin of affected) {
    const d = derived.get(isin);
    const b = before.get(isin);
    const name = newRows.find(r => r.isin === isin)?.name ?? b?.name ?? isin;
    changes.push({
      isin, name,
      before: b ? { quantity: +b.quantity, costBasisEur: b.cost_basis_eur == null ? null : +b.cost_basis_eur } : null,
      after: { quantity: d.quantity, costBasisEur: d.costBasisEur },
    });
    if (d.quantity <= EPS) { if (b) remove.push(isin); continue; }
    const lastPrice = b?.last_price != null ? +b.last_price : d.lastPrice;
    positions.push({
      isin, quantity: d.quantity, avg_price: d.avgPrice, cost_basis_eur: d.costBasisEur,
      last_price: lastPrice,
      last_value_eur: b?.last_value_eur != null && +b.quantity === d.quantity
        ? +b.last_value_eur
        : (d.currency === 'EUR' ? round(d.quantity * lastPrice) : null),
      last_price_at: b?.last_price_at ?? newRows.filter(r => r.isin === isin).map(r => r.executedAt).sort().at(-1),
      source: 'transactions',
    });
  }

  return {
    kind: 'transactions',
    rows,
    changes,
    warnings: [...parsed.warnings],
    summary: {
      total: rows.length,
      new: newRows.length,
      duplicate: rows.length - newRows.length,
      positionsAffected: affected.length,
    },
    payload: {
      p_instruments: instrumentsPayload(newRows),
      p_transactions: newRows.map(r => ({
        isin: r.isin, executed_at: r.executedAt, quantity: r.quantity, price: r.price, currency: r.currency,
        local_value: r.localValue, value_eur: r.valueEur, fx_rate: r.fxRate, autofx_fee_eur: r.autofxFee,
        fees_eur: r.fees, total_eur: r.total, exchange: r.exchange, venue: r.venue, order_id: r.orderId,
        dedup_key: r.dedupKey,
      })),
      p_positions: positions,
      p_remove_isins: remove,
    },
  };
}

/**
 * Portefeuille-import: vervangt de posities door de inhoud van het bestand.
 * Aankoopwaarde komt uit de transacties (als die het aantal verklaren) of blijft wat er al stond.
 */
export function planPortfolioImport(parsed, existing, now = new Date().toISOString()) {
  const derived = derivePositions(existing.transactions.map(fromDbTransaction));
  const before = new Map(existing.positions.map(p => [p.isin, p]));
  const warnings = [...parsed.warnings];

  const byIsin = new Map();
  for (const r of parsed.rows) {
    if (byIsin.has(r.isin)) warnings.push(`${r.name} staat meerdere keren in het bestand; de laatste regel wordt gebruikt.`);
    byIsin.set(r.isin, r);
  }

  const rows = [];
  const positions = [];
  for (const r of byIsin.values()) {
    const b = before.get(r.isin);
    const d = derived.get(r.isin);
    let avg = null, cost = null;
    if (r.kind === 'cash') {
      avg = 1; cost = r.valueEur;
    } else if (d && Math.abs(d.quantity - r.quantity) < EPS) {
      avg = d.avgPrice; cost = d.costBasisEur;
    } else {
      if (d) warnings.push(`${r.name}: volgens je transacties ${d.quantity} stuks, volgens de portefeuille ${r.quantity}. Mogelijk ontbreken transacties; aankoopwaarde ${b?.cost_basis_eur != null ? 'blijft zoals hij was' : 'is onbekend (vul hem handmatig in)'}.`);
      else if (!b || b.cost_basis_eur == null) warnings.push(`${r.name}: geen aankoopwaarde bekend. Importeer ook je transacties of vul hem handmatig in.`);
      avg = b?.avg_price ?? null; cost = b?.cost_basis_eur ?? null;
    }

    let status = 'new';
    if (b) status = Math.abs(+b.quantity - r.quantity) < EPS ? 'unchanged' : 'changed';
    rows.push({ ...r, status, before: b ? { quantity: +b.quantity } : null, costBasisEur: cost });

    positions.push({
      isin: r.isin, quantity: r.quantity, avg_price: avg, cost_basis_eur: cost,
      last_price: r.close, last_value_eur: r.valueEur, last_price_at: now, source: 'portfolio_csv',
    });
  }

  const removed = existing.positions.filter(p => !byIsin.has(p.isin));

  return {
    kind: 'portfolio',
    rows,
    removed: removed.map(p => ({ isin: p.isin, name: p.name, quantity: +p.quantity })),
    warnings,
    summary: {
      total: rows.length,
      new: rows.filter(r => r.status === 'new').length,
      changed: rows.filter(r => r.status === 'changed').length,
      unchanged: rows.filter(r => r.status === 'unchanged').length,
      removed: removed.length,
      totalValueEur: round(rows.reduce((s, r) => s + (r.valueEur ?? 0), 0)),
    },
    payload: {
      p_instruments: instrumentsPayload(parsed.rows),
      p_transactions: [],
      p_positions: positions,
      p_remove_isins: removed.map(p => p.isin),
    },
  };
}
