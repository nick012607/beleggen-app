import { listEditions, getEdition, latestEdition } from '../db.js';
import { generateEdition, workerConfigured } from '../api.js';
import { h, mount, toast, fmtPct } from '../ui.js';

const longDate = d => new Date(`${d}T12:00:00`).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortDate = d => new Date(`${d}T12:00:00`).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' });
const pctNum = n => (n == null ? '–' : fmtPct(n / 100));
const sign = n => (n == null || n === 0 ? '' : n > 0 ? 'pos' : 'neg');

/** Alleen http(s)-links tonen; inhoud komt van Claude en wordt als tekst behandeld. */
function safeUrl(u) {
  try { const x = new URL(u); return ['http:', 'https:'].includes(x.protocol) ? x.href : null; } catch { return null; }
}
function sourcesList(sources) {
  const items = (sources ?? []).map(s => ({ ...s, url: safeUrl(s.url) })).filter(s => s.url);
  if (!items.length) return null;
  return h('p', { class: 'sources' }, 'Bronnen: ', items.map((s, i) => [
    i ? ' · ' : '', h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.title || new URL(s.url).hostname),
  ]));
}

const CERTAINTY = { duidelijk: ['Oorzaak duidelijk', 'c-clear'], waarschijnlijk: ['Oorzaak waarschijnlijk', 'c-likely'], onduidelijk: ['Oorzaak onduidelijk', 'c-unclear'] };
const EFFECT = { ondersteunt: 'ondersteunt je koopreden', 'zet onder druk': 'zet je koopreden onder druk', gemengd: 'gemengd effect op je koopreden' };
const AGENDA_KIND = { cijfers: 'Cijfers', dividend: 'Dividend', rente: 'Rente', overig: 'Agenda' };

export async function krantView(root, id = null) {
  mount(root, h('p', { class: 'muted' }, 'Laden…'));
  const [edition, archive] = await Promise.all([id ? getEdition(id) : latestEdition(), listEditions()]);

  const makeBtn = h('button', { class: 'primary', disabled: !workerConfigured, onclick: onMake }, 'Maak nu een editie');
  async function onMake() {
    if (!confirm('Nu een editie laten schrijven? Dat duurt 1 à 3 minuten en kost ongeveer $0,15–0,30 aan Claude-gebruik.')) return;
    makeBtn.disabled = true; makeBtn.textContent = 'Claude schrijft… (1–3 min)';
    try {
      const r = await generateEdition('daily');
      toast(`Editie klaar (kosten $${r.cost_usd.toFixed(3).replace('.', ',')}${r.attempt > 1 ? ', na een tweede poging' : ''})`);
      location.hash = `#/krant/${r.edition_id}`;
      if (location.hash === `#/krant/${r.edition_id}`) krantView(root, r.edition_id);
    } catch (e) {
      toast(`Mislukt: ${e.message}`, 'error');
      makeBtn.disabled = false; makeBtn.textContent = 'Maak nu een editie';
    }
  }

  const archiveCard = h('section', { class: 'card archive' },
    h('h2', {}, 'Archief'),
    archive.length
      ? h('ul', {}, archive.map(a => h('li', { class: a.id === edition?.id ? 'current' : '' },
          a.status === 'ready'
            ? h('a', { href: `#/krant/${a.id}` }, shortDate(a.edition_date), a.kind === 'weekly' ? ' · weekeditie' : '')
            : h('span', { class: 'muted', title: a.error ?? '' }, shortDate(a.edition_date), a.status === 'failed' ? ' · mislukt' : ' · bezig'))))
      : h('p', { class: 'muted' }, 'Nog geen edities.'));

  const head = h('div', { class: 'page-head' }, h('h1', {}, 'Krant'), h('div', { class: 'actions' }, makeBtn));

  if (!edition || edition.status !== 'ready' || !edition.content) {
    mount(root, head,
      h('div', { class: 'card empty' },
        h('p', {}, edition?.status === 'failed' ? `De editie van ${longDate(edition.edition_date)} is mislukt: ${edition.error}` : 'Er is nog geen krant.'),
        h('p', { class: 'muted' }, 'Elke werkdag rond 07:00 verschijnt er automatisch een nieuwe editie, op zondag een weekeditie. Je kunt er ook nu een laten maken.')),
      archiveCard);
    return;
  }

  mount(root, head, newspaper(edition), archiveCard);
}

function newspaper(ed) {
  const c = ed.content;
  const meta = c.meta ?? {};
  const weekly = ed.kind === 'weekly';

  const moves = (meta.positions ?? []).filter(p => p.day_change_pct != null || p.week_change_pct != null);
  const movesTable = moves.length > 0 && h('table', { class: 'moves' },
    h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', { class: 'num' }, weekly ? 'Week' : 'Dag'), h('th', { class: 'num hide-sm' }, weekly ? 'Dag' : 'Week'), h('th', { class: 'num hide-sm' }, 'Gewicht'))),
    h('tbody', {},
      moves.map(p => {
        const main = weekly ? p.week_change_pct : p.day_change_pct;
        const other = weekly ? p.day_change_pct : p.week_change_pct;
        return h('tr', {}, h('td', {}, p.name), h('td', { class: `num ${sign(main)}` }, pctNum(main)),
          h('td', { class: `num hide-sm ${sign(other)}` }, pctNum(other)), h('td', { class: 'num hide-sm' }, `${String(p.weight_pct ?? '–').replace('.', ',')}%`));
      }),
      meta.benchmark && h('tr', { class: 'bench' }, h('td', {}, `Markt: MSCI World (${meta.benchmark.symbol})`),
        h('td', { class: `num ${sign(weekly ? meta.benchmark.week_change_pct : meta.benchmark.day_change_pct)}` }, pctNum(weekly ? meta.benchmark.week_change_pct : meta.benchmark.day_change_pct)),
        h('td', { class: 'num hide-sm' }, pctNum(weekly ? meta.benchmark.day_change_pct : meta.benchmark.week_change_pct)), h('td', { class: 'hide-sm' }, ''))));

  const section = (title, ...children) => children.flat().filter(Boolean).length ? h('section', { class: 'paper-section' }, h('h2', { class: 'kicker' }, title), ...children) : null;

  return h('article', { class: 'paper' },
    h('header', { class: 'masthead' },
      h('div', { class: 'paper-name' }, weekly ? 'De Beleggingskrant · Weekeditie' : 'De Beleggingskrant'),
      h('div', { class: 'paper-date' }, longDate(ed.edition_date))),

    h('section', { class: 'lead' },
      h('h1', {}, c.headline?.title ?? ''),
      h('p', { class: 'lede' }, c.headline?.summary ?? ''),
      sourcesList(c.headline?.sources)),

    section('Bewegingen',
      movesTable,
      h('div', { class: 'columns' }, (c.movements ?? []).map(m => h('div', { class: 'story' },
        h('h3', {}, m.title),
        h('p', { class: 'byline' }, m.instrument, ' · ', h('span', { class: `certainty ${CERTAINTY[m.cause_certainty]?.[1] ?? ''}` }, CERTAINTY[m.cause_certainty]?.[0] ?? m.cause_certainty)),
        h('p', {}, m.what_happened),
        h('p', {}, h('strong', {}, 'Waarschijnlijke reden: '), m.likely_cause),
        h('p', { class: 'context' }, m.context),
        sourcesList(m.sources))))),

    section('Thema’s', (c.themes ?? []).map(t => h('div', { class: 'story compact' },
      h('h3', {}, t.theme), h('p', {}, t.summary), sourcesList(t.sources)))),

    h('div', { class: 'paper-grid' },
      section('Agenda', (c.agenda ?? []).length > 0 && h('ul', { class: 'agenda' }, [...c.agenda].sort((a, b) => a.date.localeCompare(b.date)).map(a => h('li', {},
        h('span', { class: 'date' }, shortDate(a.date)), h('span', { class: `tag tag-${a.kind}` }, AGENDA_KIND[a.kind] ?? a.kind),
        h('div', {}, h('strong', {}, a.title), h('div', { class: 'muted small' }, a.relevance)))))),
      section('Watchlist', (c.watchlist ?? []).map(w => h('div', { class: 'story compact' },
        h('h3', {}, w.instrument), h('p', {}, w.note), sourcesList(w.sources))))),

    section('Dagboek-check', (c.journal_checks ?? []).map(j => h('div', { class: `story compact journal-${(j.effect ?? '').replace(/\s/g, '-')}` },
      h('h3', {}, j.instrument, h('span', { class: 'effect' }, ` — ${EFFECT[j.effect] ?? j.effect}`)),
      h('p', { class: 'muted small' }, 'Jouw reden: ', j.reason),
      h('p', {}, j.news), sourcesList(j.sources)))),

    h('footer', { class: 'paper-foot' },
      'Geschreven door Claude (', meta.model ?? '?', ') met web search · kosten $', (meta.cost_usd ?? 0).toFixed(3).replace(".", ","),
      ' · Dit is informatie, geen koop- of verkoopadvies. Controleer belangrijke zaken altijd zelf via de bronnen.'),
  );
}
