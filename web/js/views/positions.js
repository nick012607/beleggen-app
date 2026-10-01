import { listPositions } from '../db.js';
import { h, mount, fmtEur, fmtMoney, fmtNum, fmtPct, fmtSignedEur, fmtDateTime, signClass, KIND_LABELS } from '../ui.js';

export async function positionsView(root) {
  mount(root, h('p', { class: 'muted' }, 'Laden…'));
  const rows = (await listPositions()).map(p => {
    const value = p.last_value_eur == null ? null : +p.last_value_eur;
    const cost = p.cost_basis_eur == null ? null : +p.cost_basis_eur;
    const gain = value != null && cost != null && p.instrument.kind !== 'cash' ? value - cost : null;
    return { ...p, value, cost, gain, gainPct: gain != null && cost ? gain / cost : null };
  });
  rows.sort((a, b) => (a.instrument.kind === 'cash') - (b.instrument.kind === 'cash') || (b.value ?? 0) - (a.value ?? 0));

  const head = h('div', { class: 'page-head' },
    h('h1', {}, 'Posities'),
    h('div', { class: 'actions' },
      h('a', { class: 'button', href: '#/import' }, 'CSV importeren'),
      h('a', { class: 'button primary', href: '#/positie/nieuw' }, '+ Positie'),
    ),
  );

  if (!rows.length) {
    mount(root, head, h('div', { class: 'card empty' },
      h('p', {}, 'Nog geen posities.'),
      h('p', { class: 'muted' }, 'Sleep je DEGIRO-export (Transacties en/of Portefeuille) in de app, of voeg een positie handmatig toe.'),
      h('a', { class: 'button primary', href: '#/import' }, 'CSV importeren'),
    ));
    return;
  }

  const invested = rows.filter(r => r.instrument.kind !== 'cash');
  const totalValue = rows.reduce((s, r) => s + (r.value ?? 0), 0);
  const withBoth = invested.filter(r => r.gain != null);
  const totalCost = withBoth.reduce((s, r) => s + r.cost, 0);
  const totalGain = withBoth.reduce((s, r) => s + r.gain, 0);
  const missingCost = invested.length - withBoth.length;
  const latest = rows.map(r => r.last_price_at).filter(Boolean).sort().at(-1);

  const summary = h('div', { class: 'stats' },
    stat('Totale waarde', fmtEur(totalValue)),
    stat('Inleg', fmtEur(totalCost)),
    stat('Rendement', fmtSignedEur(totalGain), signClass(totalGain), fmtPct(totalCost ? totalGain / totalCost : null)),
  );

  const table = h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
    h('thead', {}, h('tr', {},
      h('th', {}, 'Naam'), h('th', { class: 'num hide-sm' }, 'Aantal'), h('th', { class: 'num hide-sm' }, 'Gem. aankoop'),
      h('th', { class: 'num hide-sm' }, 'Koers'), h('th', { class: 'num' }, 'Waarde'), h('th', { class: 'num' }, 'Rendement'),
    )),
    h('tbody', {}, rows.map(r => h('tr', {},
      h('td', {},
        h('a', { href: `#/positie/${r.instrument.id}` }, r.instrument.name),
        h('div', { class: 'sub' }, [KIND_LABELS[r.instrument.kind], r.instrument.symbol || displayIsin(r.instrument.isin)].filter(Boolean).join(' · ')),
      ),
      h('td', { class: 'num hide-sm' }, r.instrument.kind === 'cash' ? '' : fmtNum(r.quantity)),
      h('td', { class: 'num hide-sm' }, r.instrument.kind === 'cash' ? '' : fmtMoney(r.avg_price, r.instrument.currency)),
      h('td', { class: 'num hide-sm' }, r.instrument.kind === 'cash' ? '' : fmtMoney(r.last_price, r.instrument.currency)),
      h('td', { class: 'num' }, fmtEur(r.value)),
      h('td', { class: `num ${signClass(r.gain)}` },
        r.gain == null ? (r.instrument.kind === 'cash' ? '' : h('span', { class: 'muted', title: 'Aankoopwaarde of waarde onbekend' }, '?')) : [
          fmtSignedEur(r.gain), h('div', { class: 'sub' }, fmtPct(r.gainPct)),
        ]),
    ))),
  ));

  mount(root, head, summary, table,
    h('p', { class: 'muted small' },
      `Koersen volgens laatste import of invoer${latest ? ` (${fmtDateTime(latest)})` : ''}. Live koersen volgen in fase 2.`,
      missingCost ? ` ${missingCost} positie(s) zonder aankoopwaarde tellen niet mee in het rendement.` : ''),
  );
}

/** Synthetische sleutels (CASH-EUR, MANUAL-…) niet tonen. */
const displayIsin = isin => (/^(CASH|MANUAL)-/.test(isin) ? null : isin.replace(/^SYM-/, ''));

function stat(label, value, cls = '', sub = null) {
  return h('div', { class: 'stat' },
    h('div', { class: 'label' }, label),
    h('div', { class: `value ${cls}` }, value),
    sub && h('div', { class: `sub ${cls}` }, sub));
}
