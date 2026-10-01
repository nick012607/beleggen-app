import { supabase, configured } from './supabase.js';
import { setUser, ensureSettings } from './db.js';
import { h, mount, toast } from './ui.js';
import { loginView } from './views/login.js';
import { positionsView } from './views/positions.js';
import { positionView } from './views/position.js';
import { importView } from './views/import.js';

const main = document.getElementById('main');
const nav = document.getElementById('nav');

const routes = [
  [/^#\/?$/, root => positionsView(root)],
  [/^#\/import$/, root => importView(root)],
  [/^#\/positie\/nieuw$/, root => positionView(root, null)],
  [/^#\/positie\/([0-9a-f-]{36})$/, (root, m) => positionView(root, m[1])],
];

let session = null;

async function render() {
  if (!session) {
    nav.replaceChildren();
    loginView(main);
    return;
  }
  const hash = location.hash || '#/';
  for (const link of nav.querySelectorAll('a')) link.classList.toggle('active', hash === link.getAttribute('href') || (link.dataset.match && hash.startsWith(link.dataset.match)));
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
    h('a', { href: '#/', dataset: { match: '#/positie' } }, 'Posities'),
    h('a', { href: '#/import' }, 'Importeren'),
    h('span', { class: 'spacer' }),
    h('span', { class: 'user muted small' }, session.user.email),
    h('button', { class: 'link', onclick: async () => { await supabase.auth.signOut(); } }, 'Uitloggen'),
  );
}

async function init() {
  if (!configured) {
    mount(main, h('div', { class: 'card warn stack' },
      h('h1', {}, 'Nog niet gekoppeld'),
      h('p', {}, 'Vul de Supabase-URL en de anon key in ', h('code', {}, 'web/js/config.js'), ' in.')));
    return;
  }

  const { data } = await supabase.auth.getSession();
  await setSession(data.session);

  // Tokens uit de magic link (#access_token=...) uit de adresbalk halen
  if (/access_token|error_description/.test(location.hash)) {
    const err = new URLSearchParams(location.hash.slice(1)).get('error_description');
    if (err) toast(`Inloggen mislukt: ${err}`, 'error');
    history.replaceState(null, '', location.pathname + '#/');
  }

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
