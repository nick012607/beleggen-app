import { getInstrument, getEtfProfile, saveEtfProfile, savePosition, deletePosition, addJournal, updateJournal, deleteJournal } from '../db.js';
import { quote, workerConfigured } from '../api.js';
import { h, mount, toast, inputNumber, fmtNum, fmtMoney, fmtEur, fmtDate, fmtDateTime, KIND_LABELS } from '../ui.js';

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

/** Tickerveld met controleknop (vraagt de koers op via de Worker). */
function tickerField(symbol) {
  const input = h('input', { id: 'f-symbol', name: 'symbol', value: symbol ?? '', placeholder: 'bv. VUAA.DE', autocapitalize: 'characters' });
  const result = h('small', { class: 'muted' }, symbol ? '' : 'Leeg laten: wordt automatisch gezocht bij “Koersen verversen”.');
  const check = h('button', { type: 'button', disabled: !workerConfigured, onclick: async () => {
    const s = input.value.trim();
    if (!s) return;
    result.textContent = 'Controleren…';
    try {
      const q = await quote(s);
      result.textContent = `${q.name ?? q.symbol} · ${q.exchange} · ${fmtMoney(q.price, q.currency)}${q.hasHistory ? '' : ' · let op: geen historie'}`;
    } catch (e) { result.textContent = `Niet gevonden: ${e.message}`; }
  } }, 'Controleer');
  return h('div', { class: 'field' },
    h('label', { for: 'f-symbol' }, 'Ticker bij koersbron (Yahoo)'),
    h('div', { class: 'inline' }, input, check),
    result);
}

// ---- ETF-profiel: tekstformaat zodat bewerken simpel blijft ----
const pctLines = obj => Object.entries(obj ?? {}).map(([k, v]) => `${k}: ${String(v).replace('.', ',')}`).join('\n');
const holdingLines = arr => (arr ?? []).map(x => [x.name, x.ticker ?? '', String(x.weight_pct ?? '').replace('.', ',')].join('; ')).join('\n');

function parsePctLines(text, label) {
  const out = {};
  for (const [n, line] of text.split('\n').entries()) {
    if (!line.trim()) continue;
    const m = line.match(/^(.+?)[:;]\s*([\d.,]+)\s*%?\s*$/);
    if (!m) throw new Error(`${label}, regel ${n + 1}: gebruik “Naam: percentage”`);
    out[m[1].trim()] = inputNumber(m[2]);
  }
  return out;
}
function parseHoldings(text) {
  return text.split('\n').filter(l => l.trim()).map((line, n) => {
    const [name, ticker, w] = line.split(';').map(s => s?.trim());
    const weight = inputNumber(w);
    if (!name || weight == null || Number.isNaN(weight)) throw new Error(`Holdings, regel ${n + 1}: gebruik “Naam; Ticker; Gewicht”`);
    return { name, ticker: ticker || null, weight_pct: weight };
  });
}

function etfProfileSection(instrumentId, profile, reload) {
  const ta = (name, value, rows, placeholder) => h('textarea', { name, rows, placeholder }, value);
  const form = h('form', { class: 'stack', onsubmit: async e => {
    e.preventDefault();
    const f = form.elements;
    try {
      await saveEtfProfile(instrumentId, {
        theme: f.theme.value.trim() || null,
        holdings: parseHoldings(f.holdings.value),
        sectors: parsePctLines(f.sectors.value, 'Sectoren'),
        regions: parsePctLines(f.regions.value, 'Regio’s'),
        currencies: parsePctLines(f.currencies.value, 'Valuta'),
        source: 'manual',
      });
      toast('ETF-profiel opgeslagen');
      reload();
    } catch (err) { toast(err.message, 'error'); }
  } },
    h('div', { class: 'field' }, h('label', {}, 'Thema'), h('input', { name: 'theme', value: profile?.theme ?? '', placeholder: 'bv. Uranium en kernenergie' })),
    h('div', { class: 'field' }, h('label', {}, 'Belangrijkste onderliggende bedrijven'),
      ta('holdings', holdingLines(profile?.holdings), 6, 'NVIDIA; NVDA; 7,5\nApple; AAPL; 6,8'),
      h('small', { class: 'muted' }, 'Per regel: Naam; Ticker; Gewicht in %')),
    h('div', { class: 'grid-3' },
      h('div', { class: 'field' }, h('label', {}, 'Sectoren (%)'), ta('sectors', pctLines(profile?.sectors), 6, 'Technologie: 32\nFinancieel: 13')),
      h('div', { class: 'field' }, h('label', {}, 'Regio’s (%)'), ta('regions', pctLines(profile?.regions), 6, 'Noord-Amerika: 100')),
      h('div', { class: 'field' }, h('label', {}, 'Valuta onderliggend (%)'), ta('currencies', pctLines(profile?.currencies), 6, 'USD: 100'))),
    h('div', { class: 'form-actions' }, h('button', { type: 'submit', class: 'primary' }, 'Profiel opslaan')),
  );
  return h('section', { class: 'card' },
    h('h2', {}, 'ETF-profiel'),
    h('p', { class: 'muted small' },
      profile ? `Bron: ${profile.source === 'claude' ? 'voorgesteld door Claude, daarna te bewerken' : 'handmatig'} · bijgewerkt ${fmtDate(profile.updated_at)}. ` : '',
      'Gebruikt voor spreiding, overlap en de krant. Claude kan dit straks één keer voorstellen.'),
    form);
}

/** Detail- en bewerkpagina. id = null voor een nieuwe positie. */
export async function positionView(root, id) {
  mount(root, h('p', { class: 'muted' }, 'Laden…'));
  const data = id
    ? { ...(await getInstrument(id)), profile: await getEtfProfile(id) }
    : { instrument: { currency: 'EUR', kind: 'etf' }, position: null, journal: [], transactions: [], profile: null };
  const { instrument: ins, position: pos } = data;
  const isNew = !id;

  const field = (label, name, value, attrs = {}) => h('div', { class: 'field' },
    h('label', { for: `f-${name}` }, label),
    h('input', { id: `f-${name}`, name, value: value ?? '', ...attrs }),
    attrs.hint && h('small', { class: 'muted' }, attrs.hint));

  const numberField = (label, name, value, hint) =>
    field(label, name, value == null ? '' : String(value).replace('.', ','), { inputmode: 'decimal', hint });

  const form = h('form', { class: 'card grid-form', onsubmit: onSave },
    field('Naam', 'name', ins.name, { required: true }),
    field('ISIN', 'isin', ins.isin?.startsWith('MANUAL-') ? '' : ins.isin, { placeholder: 'bv. IE00BFMXXD54', hint: isNew ? 'Optioneel' : null, autocapitalize: 'characters' }),
    tickerField(ins.symbol),
    h('div', { class: 'field' },
      h('label', { for: 'f-kind' }, 'Soort'),
      h('select', { id: 'f-kind', name: 'kind' },
        Object.entries(KIND_LABELS).map(([k, v]) => h('option', { value: k, selected: ins.kind === k }, v)))),
    field('Valuta', 'currency', ins.currency, { maxlength: 3, required: true, autocapitalize: 'characters' }),
    numberField('Aantal', 'quantity', pos?.quantity),
    numberField('Gem. aankoopkoers', 'avg_price', pos?.avg_price, 'In noteringsvaluta, excl. kosten'),
    numberField('Aankoopwaarde (EUR)', 'cost_basis_eur', pos?.cost_basis_eur, 'Totaal betaald incl. kosten'),
    numberField('Laatste koers', 'last_price', pos?.last_price),
    numberField('Huidige waarde (EUR)', 'last_value_eur', pos?.last_value_eur, 'Bij EUR automatisch aantal × koers'),
    h('div', { class: 'form-actions' },
      h('button', { type: 'submit', class: 'primary' }, isNew ? 'Positie toevoegen' : 'Opslaan'),
      !isNew && pos && h('button', { type: 'button', class: 'danger', onclick: onDelete }, 'Positie verwijderen'),
    ),
  );

  // EUR: waarde automatisch bijwerken
  form.addEventListener('input', e => {
    if (!['quantity', 'last_price', 'currency'].includes(e.target.name)) return;
    const f = form.elements;
    if (f.currency.value.trim().toUpperCase() !== 'EUR') return;
    const q = inputNumber(f.quantity.value), p = inputNumber(f.last_price.value);
    if (Number.isFinite(q) && Number.isFinite(p)) {
      f.last_value_eur.value = String(Math.round(q * p * 100) / 100).replace('.', ',');
    }
  });

  async function onSave(e) {
    e.preventDefault();
    const f = form.elements;
    const nums = {};
    for (const n of ['quantity', 'avg_price', 'cost_basis_eur', 'last_price', 'last_value_eur']) {
      nums[n] = inputNumber(f[n].value);
      if (Number.isNaN(nums[n])) return toast(`Ongeldig getal bij "${f[n].labels[0].textContent}"`, 'error');
    }
    if (nums.quantity == null) return toast('Vul een aantal in.', 'error');
    let isin = f.isin.value.trim().toUpperCase();
    if (isin && !ISIN_RE.test(isin) && !isin.startsWith('CASH-') && !isin.startsWith('SYM-')) {
      return toast('Dit lijkt geen geldige ISIN (2 letters + 10 tekens).', 'error');
    }
    if (!isin) isin = ins.isin?.startsWith('MANUAL-') ? ins.isin : `MANUAL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    const priceChanged = pos == null || nums.last_price !== (pos.last_price == null ? null : +pos.last_price)
      || nums.last_value_eur !== (pos.last_value_eur == null ? null : +pos.last_value_eur);
    try {
      const newId = await savePosition(
        { id: ins.id, isin, name: f.name.value.trim(), symbol: f.symbol.value.trim() || null,
          kind: f.kind.value, currency: f.currency.value.trim().toUpperCase() },
        { ...nums, last_price_at: priceChanged ? new Date().toISOString() : pos?.last_price_at },
      );
      toast('Opgeslagen');
      if (isNew) location.hash = `#/positie/${newId}`;
      else positionView(root, id);
    } catch (err) {
      toast(/duplicate key/i.test(err.message) ? 'Er bestaat al een instrument met deze ISIN.' : `Opslaan mislukt: ${err.message}`, 'error');
    }
  }

  async function onDelete() {
    if (!confirm(`Positie "${ins.name}" verwijderen? Dagboek en transacties blijven bewaard.`)) return;
    try {
      await deletePosition(id);
      toast('Positie verwijderd');
      location.hash = '#/posities';
    } catch (err) { toast(`Verwijderen mislukt: ${err.message}`, 'error'); }
  }

  const sections = [
    h('div', { class: 'page-head' },
      h('div', {}, h('a', { href: '#/posities', class: 'back' }, '← Posities'), h('h1', {}, isNew ? 'Nieuwe positie' : ins.name)),
    ),
    form,
  ];
  if (!isNew) {
    if (['etf', 'fund'].includes(ins.kind)) sections.push(etfProfileSection(id, data.profile, () => positionView(root, id)));
    sections.push(journalSection(id, data.journal, () => positionView(root, id)));
    if (data.transactions.length) sections.push(transactionsSection(data.transactions, ins.currency));
  }
  mount(root, ...sections);
}

function journalSection(instrumentId, entries, reload) {
  const textarea = h('textarea', { rows: 3, placeholder: 'Waarom kocht ik dit? Wat moet er gebeuren om mijn mening te veranderen?' });
  const addForm = h('form', { class: 'stack', onsubmit: async e => {
    e.preventDefault();
    const body = textarea.value.trim();
    if (!body) return;
    try { await addJournal(instrumentId, body); toast('Notitie toegevoegd'); reload(); }
    catch (err) { toast(`Opslaan mislukt: ${err.message}`, 'error'); }
  } }, textarea, h('div', {}, h('button', { type: 'submit', class: 'primary' }, 'Notitie toevoegen')));

  return h('section', { class: 'card' },
    h('h2', {}, 'Beleggingsdagboek'),
    h('p', { class: 'muted small' }, 'De dagelijkse krant gebruikt dit om te signaleren wanneer het nieuws je koopreden raakt.'),
    addForm,
    h('ul', { class: 'journal' }, entries.map(entry => journalItem(entry, reload))),
  );
}

function journalItem(entry, reload) {
  const li = h('li', {});
  const show = () => li.replaceChildren(
    h('div', { class: 'meta' }, fmtDateTime(entry.created_at),
      entry.updated_at && entry.updated_at.slice(0, 16) !== entry.created_at.slice(0, 16) ? ' (bewerkt)' : ''),
    h('p', { class: 'body' }, entry.body),
    h('div', { class: 'row-actions' },
      h('button', { class: 'link', onclick: edit }, 'Bewerken'),
      h('button', { class: 'link danger', onclick: remove }, 'Verwijderen')),
  );
  const edit = () => {
    const ta = h('textarea', { rows: 4 }, entry.body);
    li.replaceChildren(ta, h('div', { class: 'row-actions' },
      h('button', { class: 'primary', onclick: async () => {
        try { await updateJournal(entry.id, ta.value.trim()); toast('Notitie bijgewerkt'); reload(); }
        catch (err) { toast(`Opslaan mislukt: ${err.message}`, 'error'); }
      } }, 'Opslaan'),
      h('button', { onclick: show }, 'Annuleren')));
    ta.focus();
  };
  const remove = async () => {
    if (!confirm('Deze notitie verwijderen?')) return;
    try { await deleteJournal(entry.id); reload(); }
    catch (err) { toast(`Verwijderen mislukt: ${err.message}`, 'error'); }
  };
  show();
  return li;
}

function transactionsSection(txs, currency) {
  return h('section', { class: 'card' },
    h('h2', {}, 'Transacties'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Datum'), h('th', { class: 'num' }, 'Aantal'),
        h('th', { class: 'num' }, 'Koers'), h('th', { class: 'num' }, 'Kosten'), h('th', { class: 'num' }, 'Totaal'))),
      h('tbody', {}, txs.map(t => h('tr', {},
        h('td', {}, fmtDate(t.executed_at)),
        h('td', { class: 'num' }, fmtNum(t.quantity)),
        h('td', { class: 'num' }, fmtMoney(t.price, t.currency || currency)),
        h('td', { class: 'num' }, fmtEur(Math.abs(+t.fees_eur || 0) + Math.abs(+t.autofx_fee_eur || 0))),
        h('td', { class: 'num' }, fmtEur(t.total_eur)),
      ))),
    )),
  );
}
