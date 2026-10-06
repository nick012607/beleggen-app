import { supabase } from '../supabase.js';
import { getSettings, updateSettings, listUsage } from '../db.js';
import { h, mount, toast, inputNumber, fmtDateTime } from '../ui.js';

const usd = n => `$${(+n || 0).toFixed(2).replace('.', ',')}`;

export async function settingsView(root) {
  mount(root, h('p', { class: 'muted' }, 'Laden…'));
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const [{ data: { user } }, settings, usage] = await Promise.all([supabase.auth.getUser(), getSettings(), listUsage(monthStart)]);

  const spent = usage.reduce((s, u) => s + (+u.cost_usd || 0), 0);
  const budget = +settings.monthly_budget_usd || 8;
  const pct = Math.min(1, spent / budget);

  // ---- kosten
  const costCard = h('section', { class: 'card' },
    h('h2', {}, `Claude-kosten ${now.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' })}`),
    h('div', { class: 'stat-inline' }, h('span', { class: 'big' }, usd(spent)), h('span', { class: 'muted' }, ` van ${usd(budget)} budget`)),
    h('div', { class: `bar${pct >= 0.9 ? ' over' : ''}` }, h('i', { style: `width:${(pct * 100).toFixed(1)}%` })),
    h('p', { class: 'muted small' }, 'Bij het bereiken van het budget maakt de Worker geen nieuwe edities meer tot de volgende maand. Zet voor extra zekerheid ook een limiet in de Anthropic Console.'),
    usage.length > 0 && h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Moment'), h('th', {}, 'Wat'), h('th', { class: 'num hide-sm' }, 'Tokens in/uit'), h('th', { class: 'num hide-sm' }, 'Zoekopdr.'), h('th', { class: 'num' }, 'Kosten'))),
      h('tbody', {}, usage.map(u => h('tr', { class: u.success ? '' : 'dim' },
        h('td', {}, fmtDateTime(u.run_at)),
        h('td', {}, u.note ?? '', u.success ? '' : ' (mislukt)', u.attempt > 1 ? ` · poging ${u.attempt}` : ''),
        h('td', { class: 'num hide-sm' }, `${((u.input_tokens + u.cache_read_tokens + u.cache_write_tokens) / 1000).toFixed(1)}k / ${(u.output_tokens / 1000).toFixed(1)}k`),
        h('td', { class: 'num hide-sm' }, u.web_search_requests),
        h('td', { class: 'num' }, usd(u.cost_usd))))))),
  );

  // ---- krant-instellingen
  const num = (name, label, value, hint) => h('div', { class: 'field' },
    h('label', { for: `s-${name}` }, label),
    h('input', { id: `s-${name}`, name, inputmode: 'decimal', value: String(value ?? '').replace('.', ',') }),
    hint && h('small', { class: 'muted' }, hint));
  const prefs = h('form', { class: 'card grid-form', onsubmit: async e => {
    e.preventDefault();
    const f = e.target.elements;
    const fields = {};
    for (const n of ['move_threshold_pct', 'large_position_pct', 'concentration_pct', 'monthly_budget_usd']) {
      const v = inputNumber(f[n].value);
      if (v == null || Number.isNaN(v) || v <= 0) return toast(`Ongeldige waarde bij ${f[n].labels[0].textContent}`, 'error');
      fields[n] = v;
    }
    fields.benchmark_symbol = f.benchmark_symbol.value.trim().toUpperCase() || 'IWDA.AS';
    try { await updateSettings(fields); toast('Instellingen opgeslagen'); } catch (err) { toast(err.message, 'error'); }
  } },
    h('h2', { class: 'full' }, 'Krant en signalen'),
    num('move_threshold_pct', 'Opvallende beweging vanaf (%)', settings.move_threshold_pct, 'Bewegingen groter dan dit krijgen een artikel'),
    num('large_position_pct', 'Grote positie vanaf (% gewicht)', settings.large_position_pct, 'Grote posities krijgen altijd aandacht'),
    num('concentration_pct', 'Signaal concentratie vanaf (%)', settings.concentration_pct),
    num('monthly_budget_usd', 'Maandbudget Claude ($)', settings.monthly_budget_usd),
    h('div', { class: 'field' }, h('label', { for: 's-benchmark_symbol' }, 'Benchmark (Yahoo-ticker)'),
      h('input', { id: 's-benchmark_symbol', name: 'benchmark_symbol', value: settings.benchmark_symbol ?? 'IWDA.AS' }),
      h('small', { class: 'muted' }, 'Standaard IWDA.AS (MSCI World)')),
    h('div', { class: 'form-actions' }, h('button', { type: 'submit', class: 'primary' }, 'Opslaan')),
  );

  // ---- wachtwoord
  const pw1 = h('input', { id: 'pw1', type: 'password', required: true, minlength: 8, autocomplete: 'new-password' });
  const pw2 = h('input', { id: 'pw2', type: 'password', required: true, minlength: 8, autocomplete: 'new-password' });
  const pwForm = h('form', { class: 'card stack', onsubmit: async e => {
    e.preventDefault();
    if (pw1.value !== pw2.value) return toast('De wachtwoorden zijn niet gelijk.', 'error');
    const { error } = await supabase.auth.updateUser({ password: pw1.value });
    if (error) return toast(`Opslaan mislukt: ${error.message}`, 'error');
    pw1.value = pw2.value = '';
    toast('Wachtwoord ingesteld.');
  } },
    h('h2', {}, 'Account'),
    h('p', {}, 'Ingelogd als ', h('strong', {}, user?.email ?? '–')),
    h('input', { type: 'email', autocomplete: 'username', value: user?.email ?? '', hidden: true, readonly: true }),
    h('label', { for: 'pw1' }, 'Nieuw wachtwoord (min. 8 tekens)'), pw1,
    h('label', { for: 'pw2' }, 'Herhaal wachtwoord'), pw2,
    h('div', { class: 'form-actions' },
      h('button', { type: 'submit' }, 'Wachtwoord opslaan'),
      h('button', { type: 'button', class: 'danger', onclick: () => supabase.auth.signOut() }, 'Uitloggen')),
  );

  mount(root, h('div', { class: 'page-head' }, h('h1', {}, 'Instellingen')), costCard, prefs, pwForm);
}
