import { parseDegiroCsv } from '../degiro.js';
import { planTransactionsImport, planPortfolioImport } from '../importer.js';
import { loadImportState, applyImport } from '../db.js';
import { h, mount, toast, fmtEur, fmtMoney, fmtNum, fmtDate } from '../ui.js';

const STATUS = {
  new: ['Nieuw', 'badge-new'],
  changed: ['Gewijzigd', 'badge-changed'],
  unchanged: ['Ongewijzigd', 'badge-muted'],
  duplicate: ['Al geïmporteerd', 'badge-muted'],
  duplicate_in_file: ['Dubbel in bestand', 'badge-muted'],
};
const badge = s => h('span', { class: `badge ${STATUS[s][1]}` }, STATUS[s][0]);

export function importView(root) {
  const input = h('input', { type: 'file', accept: '.csv,text/csv', hidden: true, onchange: () => input.files[0] && handle(input.files[0]) });
  const drop = h('label', { class: 'dropzone', tabindex: 0 },
    input,
    h('strong', {}, 'Sleep je DEGIRO-CSV hierheen'),
    h('span', { class: 'muted' }, 'of klik om een bestand te kiezen'),
  );
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => e.dataTransfer.files[0] && handle(e.dataTransfer.files[0]));
  drop.addEventListener('keydown', e => (e.key === 'Enter' || e.key === ' ') && input.click());

  const preview = h('div', { id: 'preview' });

  mount(root,
    h('div', { class: 'page-head' }, h('div', {}, h('a', { href: '#/', class: 'back' }, '← Posities'), h('h1', {}, 'CSV importeren'))),
    h('div', { class: 'card stack' },
      drop,
      h('details', { class: 'help' },
        h('summary', {}, 'Welke bestanden?'),
        h('ul', {},
          h('li', {}, h('strong', {}, 'Transacties'), ' (DEGIRO → Activiteit → Transacties → Exporteren, CSV): voegt nieuwe transacties toe zonder dubbelingen en berekent aantal en aankoopwaarde.'),
          h('li', {}, h('strong', {}, 'Portefeuille'), ' (DEGIRO → Portefeuille → Exporteren, CSV): vervangt je posities en werkt de koersen bij. Posities die niet in het bestand staan, worden verwijderd.'),
          h('li', {}, 'Tip: importeer eerst je transacties (vanaf je eerste aankoop), daarna de portefeuille.'),
        )),
    ),
    preview,
  );

  async function handle(file) {
    mount(preview, h('p', { class: 'muted' }, `“${file.name}” lezen…`));
    try {
      const text = await readText(file);
      const parsed = parseDegiroCsv(text);
      if (!parsed.kind) {
        mount(preview, h('div', { class: 'card warn' }, h('h2', {}, 'Niet herkend'), h('ul', {}, parsed.warnings.map(w => h('li', {}, w)))));
        return;
      }
      const state = await loadImportState();
      const plan = parsed.kind === 'transactions' ? planTransactionsImport(parsed, state) : planPortfolioImport(parsed, state);
      renderPlan(file.name, parsed, plan);
    } catch (err) {
      mount(preview, h('div', { class: 'card warn' }, `Fout bij lezen: ${err.message}`));
    } finally {
      input.value = '';
    }
  }

  function renderPlan(fileName, parsed, plan) {
    const nothingToDo = plan.kind === 'transactions'
      ? plan.summary.new === 0
      : plan.rows.length === 0;

    const confirmBtn = h('button', { class: 'primary', disabled: nothingToDo, onclick: async () => {
      confirmBtn.disabled = true; confirmBtn.textContent = 'Importeren…';
      try {
        const res = await applyImport(plan.payload);
        toast(plan.kind === 'transactions'
          ? `${res.transactions_inserted} transactie(s) toegevoegd, ${res.positions_set} positie(s) bijgewerkt`
          : `${res.positions_set} positie(s) opgeslagen${res.positions_removed ? `, ${res.positions_removed} verwijderd` : ''}`);
        location.hash = '#/';
      } catch (err) {
        toast(`Importeren mislukt, er is niets opgeslagen: ${err.message}`, 'error');
        confirmBtn.disabled = false; confirmBtn.textContent = 'Opnieuw proberen';
      }
    } }, nothingToDo ? 'Niets nieuws om te importeren' : 'Import bevestigen');

    const meta = `Scheidingsteken “${parsed.delimiter === '\t' ? 'tab' : parsed.delimiter}”, decimaalteken “${parsed.decimal}”`;
    const s = plan.summary;
    const chips = plan.kind === 'transactions'
      ? [chip(`${s.new} nieuw`, 'badge-new'), chip(`${s.duplicate} al bekend`, 'badge-muted'), chip(`${s.positionsAffected} positie(s) geraakt`, '')]
      : [chip(`${s.new} nieuw`, 'badge-new'), chip(`${s.changed} gewijzigd`, 'badge-changed'), chip(`${s.unchanged} ongewijzigd`, 'badge-muted'),
         s.removed ? chip(`${s.removed} verwijderd`, 'badge-removed') : null, chip(`Totaal ${fmtEur(s.totalValueEur)}`, '')];

    mount(preview,
      h('div', { class: 'card stack' },
        h('h2', {}, plan.kind === 'transactions' ? 'Transacties-export' : 'Portefeuille-export', h('span', { class: 'muted small' }, ` · ${fileName}`)),
        h('p', { class: 'muted small' }, meta),
        h('div', { class: 'chips' }, chips),
        plan.warnings.length > 0 && h('div', { class: 'warn' }, h('strong', {}, 'Let op'), h('ul', {}, plan.warnings.map(w => h('li', {}, w)))),
        plan.kind === 'transactions' ? transactionsTables(plan) : portfolioTables(plan),
        h('div', { class: 'form-actions' }, confirmBtn, h('button', { onclick: () => mount(preview) }, 'Annuleren')),
      ),
    );
  }
}

const chip = (text, cls) => h('span', { class: `badge ${cls}` }, text);

function transactionsTables(plan) {
  return [
    plan.changes.length > 0 && h('h3', {}, 'Effect op posities'),
    plan.changes.length > 0 && h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Product'), h('th', { class: 'num' }, 'Aantal'), h('th', { class: 'num' }, 'Aankoopwaarde'))),
      h('tbody', {}, plan.changes.map(c => h('tr', {},
        h('td', {}, c.name),
        h('td', { class: 'num' }, arrow(c.before?.quantity, c.after.quantity, fmtNum)),
        h('td', { class: 'num' }, arrow(c.before?.costBasisEur, c.after.costBasisEur, fmtEur)),
      ))))),
    h('h3', {}, 'Transacties'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Datum'), h('th', {}, 'Product'), h('th', { class: 'num' }, 'Aantal'),
        h('th', { class: 'num' }, 'Koers'), h('th', { class: 'num' }, 'Totaal EUR'), h('th', {}, 'Status'))),
      h('tbody', {}, plan.rows.map(r => h('tr', { class: r.status === 'new' ? '' : 'dim' },
        h('td', {}, fmtDate(r.executedAt)),
        h('td', {}, r.name),
        h('td', { class: 'num' }, fmtNum(r.quantity)),
        h('td', { class: 'num' }, fmtMoney(r.price, r.currency)),
        h('td', { class: 'num' }, fmtEur(r.total)),
        h('td', {}, badge(r.status)),
      ))))),
  ];
}

function portfolioTables(plan) {
  return [
    h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Product'), h('th', { class: 'num' }, 'Aantal'), h('th', { class: 'num' }, 'Koers'),
        h('th', { class: 'num' }, 'Waarde EUR'), h('th', { class: 'num' }, 'Aankoopwaarde'), h('th', {}, 'Status'))),
      h('tbody', {}, plan.rows.map(r => h('tr', {},
        h('td', {}, r.name, h('div', { class: 'sub' }, r.isin.startsWith('CASH-') ? '' : r.isin)),
        h('td', { class: 'num' }, r.kind === 'cash' ? '' : arrow(r.before?.quantity, r.quantity, fmtNum)),
        h('td', { class: 'num' }, r.kind === 'cash' ? '' : fmtMoney(r.close, r.currency)),
        h('td', { class: 'num' }, fmtEur(r.valueEur)),
        h('td', { class: 'num' }, r.kind === 'cash' ? '' : (r.costBasisEur == null ? h('span', { class: 'muted' }, 'onbekend') : fmtEur(r.costBasisEur))),
        h('td', {}, badge(r.status)),
      ))))),
    plan.removed.length > 0 && [
      h('h3', {}, 'Wordt verwijderd (niet in bestand)'),
      h('ul', { class: 'removed' }, plan.removed.map(p => h('li', {}, `${p.name} (${fmtNum(p.quantity)} stuks)`))),
    ],
  ];
}

function arrow(before, after, fmt) {
  if (before == null || before === after) return fmt(after);
  return h('span', {}, h('span', { class: 'muted' }, fmt(before)), ' → ', fmt(after));
}

/** Leest als UTF-8; valt terug op Windows-1252 als het geen geldige UTF-8 is (oudere Excel-exports). */
async function readText(file) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return new TextDecoder('windows-1252').decode(buf); }
}
