import { supabase } from '../supabase.js';
import { h, mount, toast } from '../ui.js';

/**
 * Inlogscherm: e-mail + wachtwoord (werkt ook in de iPhone-app op het beginscherm),
 * met de magic link als reserve. error: melding die blijft staan (bv. verlopen link).
 */
export function loginView(root, error = null) {
  const emailInput = h('input', { id: 'email', name: 'email', type: 'email', required: true, autocomplete: 'username', placeholder: 'jij@voorbeeld.nl' });
  const pwInput = h('input', { id: 'password', name: 'password', type: 'password', required: true, autocomplete: 'current-password' });
  const submit = h('button', { type: 'submit', class: 'primary' }, 'Inloggen');

  const form = h('form', { class: 'card stack', onsubmit: signIn },
    h('h1', {}, 'Inloggen'),
    error && h('div', { class: 'warn', role: 'alert' }, error),
    h('label', { for: 'email' }, 'E-mailadres'), emailInput,
    h('label', { for: 'password' }, 'Wachtwoord'), pwInput,
    submit,
    h('button', { type: 'button', class: 'link', onclick: () => magicLinkView(root, emailInput.value.trim()) },
      'Nog geen wachtwoord of vergeten? Log in via e-mail'),
  );
  mount(root, h('section', { class: 'auth' }, form));

  async function signIn(e) {
    e.preventDefault();
    submit.disabled = true; submit.textContent = 'Inloggen…';
    const { error } = await supabase.auth.signInWithPassword({ email: emailInput.value.trim(), password: pwInput.value });
    submit.disabled = false; submit.textContent = 'Inloggen';
    if (error) {
      toast(/invalid login credentials/i.test(error.message)
        ? 'E-mail of wachtwoord klopt niet. Nog geen wachtwoord ingesteld? Log dan in via e-mail en stel het in onder Account.'
        : `Inloggen mislukt: ${error.message}`, 'error');
    }
  }
}

/** Reserve: inloggen met een link (of code) per e-mail. */
function magicLinkView(root, prefill = '') {
  let email = prefill;
  const emailInput = h('input', { id: 'email', type: 'email', required: true, autocomplete: 'email', value: prefill, placeholder: 'jij@voorbeeld.nl' });
  const form = h('form', { class: 'card stack', onsubmit: sendLink },
    h('h1', {}, 'Inloggen via e-mail'),
    h('p', { class: 'muted' }, 'Je ontvangt een inloglink. Op iPhone opent die in Safari: stel daar onder Account een wachtwoord in, dan kun je ook in de app op je beginscherm inloggen.'),
    h('label', { for: 'email' }, 'E-mailadres'), emailInput,
    h('button', { type: 'submit', class: 'primary' }, 'Stuur inloglink'),
    h('button', { type: 'button', class: 'link', onclick: () => { email = emailInput.value.trim(); if (emailInput.reportValidity()) showCode(false); } }, 'Ik heb een code'),
    h('button', { type: 'button', class: 'link', onclick: () => loginView(root) }, '← Terug naar inloggen met wachtwoord'),
  );
  mount(root, h('section', { class: 'auth' }, form));

  async function sendLink(e) {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    email = emailInput.value.trim();
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
          ? 'Te veel mails verstuurd (Supabase staat er maar een paar per uur toe). Probeer het over een uur opnieuw.'
          : `Versturen mislukt: ${error.message}`, 'error');
      return;
    }
    showCode(true);
  }

  function showCode(justSent) {
    const codeForm = h('form', { class: 'stack', onsubmit: verifyCode },
      h('label', { for: 'code' }, justSent ? 'Staat er een code in de mail? Vul hem hier in' : 'Code uit de e-mail'),
      h('input', { id: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9]{6,10}', placeholder: '123456', required: true }),
      h('button', { type: 'submit' }, 'Inloggen met code'),
    );
    mount(root, h('section', { class: 'auth' }, h('div', { class: 'card stack' },
      h('h1', {}, justSent ? 'Check je mail' : 'Code invoeren'),
      justSent && h('p', {}, 'We hebben een inloglink gestuurd naar ', h('strong', {}, email), '.'),
      codeForm,
      h('button', { class: 'link', onclick: () => loginView(root) }, '← Terug'),
    )));
  }

  async function verifyCode(e) {
    e.preventDefault();
    const token = e.target.querySelector('#code').value.trim();
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (error) toast(`Code ongeldig of verlopen: ${error.message}`, 'error');
  }
}
