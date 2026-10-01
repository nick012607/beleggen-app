import { listWatchlist, listPrices, addToWatchlist, updateWatch, deleteWatch } from '../db.js';
import { resolveIsin, quote, refreshPrices, workerConfigured } from '../api.js';
import { dayChange } from '../analytics.js';
import { guessInstrumentKind } from '../degiro.js';
import { h, mount, toast, inputNumber, fmtMoney, fmtPct, fmtDate, signClass } from '../ui.js';

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

export async function watchlistView(root) {
  mount(root, h('p', { class: 'muted' }, 'Laden…'));
  const [items, prices] = await Promise.all([listWatchlist(), listPrices()]);

  const input = h('input', { placeholder: 'ISIN (bv. IE00B4L5Y983) of ticker (bv. ASML.AS)', required: true, autocapitalize: 'characters' });
  const addBtn = h('button', { type: 'submit', class: 'primary', disabled: !workerConfigured }, 'Toevoegen');
  const form = h('form', { class: 'add-row', onsubmit: onAdd }, input, addBtn);

  async function onAdd(e) {
    e.preventDefault();
    const q = input.value.trim().toUpperCase();
    addBtn.disabled = true; addBtn.textContent = 'Zoeken…';
    try {
      let entry;
      if (ISIN_RE.test(q)) {
        const r = await resolveIsin(q);
        if (!r.symbol) throw new Error('Geen euronotering gevonden voor deze ISIN. Probeer de ticker.');
        entry = { isin: q, symbol: r.symbol, name: r.name || q, currency: r.currency };
      } else {
        const r = await quote(q);
        entry = { isin: `SYM-${r.symbol}`, symbol: r.symbol, name: r.name || r.symbol, currency: r.currency };
      }
      await addToWatchlist({ ...entry, kind: guessInstrumentKind(entry.name) });
      toast(`${entry.name} toegevoegd (${entry.symbol}). Koersen ophalen…`);
      await refreshPrices().catch(err => toast(`Koersen ophalen mislukt: ${err.message}`, 'error'));
      watchlistView(root);
    } catch (err) {
      toast(err.message, 'error');
      addBtn.disabled = false; addBtn.textContent = 'Toevoegen';
    }
  }

  const rows = items.map(w => {
    const ps = prices.get(w.instrument_id) ?? [];
    const last = ps.at(-1);
    const price = last ? +last.close : null;
    const above = w.alert_above != null && price != null && price >= +w.alert_above;
    const below = w.alert_below != null && price != null && price <= +w.alert_below;
    const ccy = last?.currency || w.instrument.currency;

    const limitInput = (field, label) => h('input', {
      class: 'limit', inputmode: 'decimal', 'aria-label': label, placeholder: label,
      value: w[field] == null ? '' : String(w[field]).replace('.', ','),
      onchange: async e => {
        const v = inputNumber(e.target.value);
        if (Number.isNaN(v)) return toast('Ongeldig getal', 'error');
        try { await updateWatch(w.id, { [field]: v, last_alert_at: null }); toast('Grens opgeslagen'); }
        catch (err) { toast(err.message, 'error'); }
      },
    });

    return h('tr', { class: above || below ? 'alert' : '' },
      h('td', {}, w.instrument.name, h('div', { class: 'sub' }, w.instrument.symbol ?? '–')),
      h('td', { class: 'num' }, fmtMoney(price, ccy), h('div', { class: 'sub' }, last ? fmtDate(last.date) : 'nog geen koers')),
      h('td', { class: `num ${signClass(dayChange(ps))}` }, fmtPct(dayChange(ps))),
      h('td', { class: 'limits' }, limitInput('alert_below', 'onder'), limitInput('alert_above', 'boven'),
        (above || below) && h('span', { class: 'badge badge-changed' }, above ? 'boven grens' : 'onder grens')),
      h('td', {}, h('button', { class: 'link danger', onclick: async () => {
        if (!confirm(`${w.instrument.name} van je watchlist halen?`)) return;
        try { await deleteWatch(w.id); watchlistView(root); } catch (err) { toast(err.message, 'error'); }
      } }, 'Verwijderen')),
    );
  });

  mount(root,
    h('div', { class: 'page-head' }, h('h1', {}, 'Watchlist')),
    h('div', { class: 'card stack' },
      form,
      h('p', { class: 'muted small' }, workerConfigured
        ? 'Stel per regel een koersgrens in (in de valuta van de notering). Je krijgt een signaal als de koers erdoorheen gaat; pushmeldingen volgen in fase 4.'
        : 'Toevoegen kan zodra de Worker gekoppeld is.')),
    items.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Naam'), h('th', { class: 'num' }, 'Koers'), h('th', { class: 'num' }, 'Vandaag'), h('th', {}, 'Grenzen'), h('th', {}, ''))),
          h('tbody', {}, rows)))
      : h('p', { class: 'muted' }, 'Je watchlist is nog leeg.'),
  );
}
