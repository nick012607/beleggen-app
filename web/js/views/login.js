import { supabase } from '../supabase.js';
import { h, mount, toast } from '../ui.js';

export function loginView(root) {
  let email = '';

  const emailForm = h('form', { class: 'card stack', onsubmit: sendLink },
    h('h1', {}, 'Inloggen'),
    h('p', { class: 'muted' }, 'Je ontvangt een inloglink per e-mail. Er is geen wachtwoord.'),
    h('label', { for: 'email' }, 'E-mailadres'),
    h('input', { id: 'email', type: 'email', required: true, autocomplete: 'email', placeholder: 'jij@voorbeeld.nl' }),
    h('button', { type: 'submit', class: 'primary' }, 'Stuur inloglink'),
  );
  mount(root, h('section', { class: 'auth' }, emailForm));

  async function sendLink(e) {
    e.preventDefault();
    const btn = emailForm.querySelector('button');
    email = emailForm.querySelector('#email').value.trim();
    btn.disabled = true; btn.textContent = 'Versturen…';
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname },
    });
    btn.disabled = false; btn.textContent = 'Stuur inloglink';
    if (error) {
      toast(/signups not allowed|not found/i.test(error.message)
        ? 'Dit e-mailadres heeft geen toegang.'
        : /rate limit/i.test(error.message)
          ? 'Te veel mails verstuurd (Supabase staat er maar een paar per uur toe). Gebruik de laatst ontvangen link of probeer het over een uur opnieuw.'
          : `Versturen mislukt: ${error.message}`, 'error');
      return;
    }
    showSent();
  }

  function showSent() {
    const codeForm = h('form', { class: 'stack', onsubmit: verifyCode },
      h('label', { for: 'code' }, 'Of voer de code uit de e-mail in'),
      h('input', { id: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9]{6,10}', placeholder: '123456', required: true }),
      h('button', { type: 'submit' }, 'Inloggen met code'),
    );
    mount(root, h('section', { class: 'auth' }, h('div', { class: 'card stack' },
      h('h1', {}, 'Check je mail'),
      h('p', {}, 'We hebben een inloglink gestuurd naar ', h('strong', {}, email), '. Open de link op dit apparaat.'),
      h('p', { class: 'muted small' }, 'Op iPhone met de app op je beginscherm: gebruik de code, want de link opent in Safari.'),
      codeForm,
      h('button', { class: 'link', onclick: () => loginView(root) }, 'Ander e-mailadres'),
    )));
  }

  async function verifyCode(e) {
    e.preventDefault();
    const token = e.target.querySelector('#code').value.trim();
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (error) toast(`Code ongeldig of verlopen: ${error.message}`, 'error');
  }
}
