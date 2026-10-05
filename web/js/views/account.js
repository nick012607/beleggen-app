import { supabase } from '../supabase.js';
import { h, mount, toast } from '../ui.js';

export async function accountView(root) {
  const { data: { user } } = await supabase.auth.getUser();

  const pw1 = h('input', { id: 'pw1', type: 'password', required: true, minlength: 8, autocomplete: 'new-password' });
  const pw2 = h('input', { id: 'pw2', type: 'password', required: true, minlength: 8, autocomplete: 'new-password' });
  const btn = h('button', { type: 'submit', class: 'primary' }, 'Wachtwoord opslaan');

  const form = h('form', { class: 'card stack', onsubmit: async e => {
    e.preventDefault();
    if (pw1.value !== pw2.value) return toast('De wachtwoorden zijn niet gelijk.', 'error');
    btn.disabled = true;
    const { error } = await supabase.auth.updateUser({ password: pw1.value });
    btn.disabled = false;
    if (error) return toast(`Opslaan mislukt: ${error.message}`, 'error');
    pw1.value = pw2.value = '';
    toast('Wachtwoord ingesteld. Je kunt nu inloggen met e-mail en wachtwoord.');
  } },
    h('h2', {}, 'Wachtwoord'),
    h('p', { class: 'muted small' }, 'Hiermee log je in zonder mail, ook in de app op je iPhone-beginscherm. Laat je iPhone het wachtwoord bewaren, dan is inloggen één tik met Face ID.'),
    // verborgen gebruikersnaam, zodat de wachtwoordkluis weet bij welk account dit hoort
    h('input', { type: 'email', autocomplete: 'username', value: user?.email ?? '', hidden: true, readonly: true }),
    h('label', { for: 'pw1' }, 'Nieuw wachtwoord (min. 8 tekens)'), pw1,
    h('label', { for: 'pw2' }, 'Herhaal wachtwoord'), pw2,
    h('div', {}, btn),
  );

  mount(root,
    h('div', { class: 'page-head' }, h('h1', {}, 'Account')),
    h('div', { class: 'card' }, h('p', {}, 'Ingelogd als ', h('strong', {}, user?.email ?? '–'))),
    form,
    h('button', { class: 'danger', onclick: () => supabase.auth.signOut() }, 'Uitloggen'),
  );
}
