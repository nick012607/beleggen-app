import { supabase, configured } from './supabase.js';
import { setUser, ensureSettings } from './db.js';
import { h, mount } from './ui.js';
import { loginView } from './views/login.js';
import { positionsView } from './views/positions.js';
import { dashboardView } from './views/dashboard.js';
import { watchlistView } from './views/watchlist.js';
import { positionView } from './views/position.js';
import { importView } from './views/import.js';
import { settingsView } from './views/settings.js';
import { krantView } from './views/krant.js';

const main = document.getElementById('main');
const nav = document.getElementById('nav');

const routes = [
  [/^#\/?$/, root => dashboardView(root)],
  [/^#\/krant$/, root => krantView(root)],
  [/^#\/krant\/([0-9a-f-]{36})$/, (root, m) => krantView(root, m[1])],
  [/^#\/posities$/, root => positionsView(root)],
  [/^#\/watchlist$/, root => watchlistView(root)],
  [/^#\/import$/, root => importView(root)],
  [/^#\/(instellingen|account)$/, root => settingsView(root)],
  [/^#\/positie\/nieuw$/, root => positionView(root, null)],
  [/^#\/positie\/([0-9a-f-]{36})$/, (root, m) => positionView(root, m[1])],
];

let session = null;
let authError = null;

function explainAuthError(code, message) {
  if (code === 'otp_expired' || /expired|invalid/i.test(message ?? '')) {
    return 'Deze inloglink is verlopen of al gebruikt. Hotmail/Outlook opent links soms automatisch om ze te scannen. Vraag een nieuwe link aan, of gebruik de code uit de mail.';
  }
  return `Inloggen mislukt: ${message}`;
}

async function render() {
  if (!session) {
    nav.replaceChildren();
    loginView(main, authError);
    authError = null;
    return;
  }
  const hash = location.hash || '#/';
  for (const link of nav.querySelectorAll('a')) link.classList.toggle('active', hash === link.getAttribute('href') || Boolean(link.dataset.match && hash.startsWith(link.dataset.match)));
  const route = routes.find(([re]) => re.test(hash));
  if (!route) { location.hash = '#/'; return; }
  try {
    await route[1](main, hash.match(route[0]));
  } catch (err) {
    console.error(err);
    mount(main, h('div', { class: 'card warn' }, h('h2', {}, 'Er ging iets mis'), h('p', {}, err.message)));
  }
  main.focus({ preventScroll: true });
}

function renderNav() {
  mount(nav,
    h('a', { href: '#/krant', dataset: { match: '#/krant' } }, 'Krant'),
    h('a', { href: '#/' }, 'Dashboard'),
    h('a', { href: '#/posities', dataset: { match: '#/positie' } }, 'Posities'),
    h('a', { href: '#/watchlist' }, 'Watchlist'),
    h('a', { href: '#/import' }, 'Importeren'),
    h('span', { class: 'spacer' }),
    h('a', { href: '#/instellingen', title: session.user.email, dataset: { match: '#/account' } }, 'Instellingen'),
  );
}

async function init() {
  if (!configured) {
    mount(main, h('div', { class: 'card warn stack' },
      h('h1', {}, 'Nog niet gekoppeld'),
      h('p', {}, 'Vul de Supabase-URL en de anon key in ', h('code', {}, 'web/js/config.js'), ' in.')));
    return;
  }

  // 1. Link uit onze eigen e-mailtemplate: ?token_hash=...&type=...
  //    Pas hier (met JavaScript) wordt de link verbruikt, zodat linkscanners van
  //    Hotmail/Outlook hem niet ongeldig maken door hem vooraf te openen.
  const query = new URLSearchParams(location.search);
  if (query.get('token_hash')) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: query.get('token_hash'),
      type: query.get('type') || 'email',
    });
    if (error) authError = explainAuthError(error.code, error.message);
    history.replaceState(null, '', location.pathname + '#/');
  }

  // 2. Standaardlink van Supabase: #access_token=... of #error=...
  if (/access_token|error_description/.test(location.hash)) {
    const hp = new URLSearchParams(location.hash.slice(1));
    if (hp.get('error_description')) authError = explainAuthError(hp.get('error_code'), hp.get('error_description'));
  }

  const { data } = await supabase.auth.getSession();
  await setSession(data.session);
  if (/access_token|error/.test(location.hash)) history.replaceState(null, '', location.pathname + '#/');

  supabase.auth.onAuthStateChange((_event, s) => {
    // Alleen opnieuw tekenen bij in- of uitloggen, niet bij elke tokenverversing.
    // setTimeout: geen Supabase-aanroepen binnen deze callback (kan anders vastlopen).
    if (Boolean(s) !== Boolean(session)) setTimeout(() => setSession(s).then(render), 0);
    else session = s;
  });

  window.addEventListener('hashchange', render);
  render();
}

async function setSession(s) {
  session = s;
  if (s) {
    setUser(s.user.id);
    renderNav();
    try { await ensureSettings(); } catch (e) { console.warn('Instellingen aanmaken mislukt', e); }
  }
}

init();
