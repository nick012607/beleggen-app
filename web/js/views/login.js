import { supabase } from '../supabase.js';
import { h, mount, toast } from '../ui.js';

/** Inlogscherm. error: melding die blijft staan (bv. verlopen link). */
export function loginView(root, error = null) {
  let email = '';

  const emailInput = h('input', { id: 'email', type: 'email', required: true, autocomplete: 'email', placeholder: 'jij@voorbeeld.nl' });
  const emailForm = h('form', { class: 'card stack', onsubmit: sendLink },
    h('h1', {}, 'Inloggen'),
    error && h('div', { class: 'warn', role: 'alert' }, error),
    h('p', { class: 'muted' }, 'Je ontvangt een inloglink en een code per e-mail. Er is geen wachtwoord.'),
    h('label', { for: 'email' }, 'E-mailadres'),
    emailInput,
    h('button', { type: 'submit', class: 'primary' }, 'Stuur inloglink'),
    h('button', { type: 'button', class: 'link', onclick: () => {
      if (!emailInput.reportValidity()) return;
      email = emailInput.value.trim();
      showCode(false);
    } }, 'Ik heb al een code'),
  );
  mount(root, h('section', { class: 'auth' }, emailForm));

  async function sendLink(e) {
    e.preventDefault();
    const btn = emailForm.querySelector('button[type=submit]');
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
          ? 'Te veel mails verstuurd (Supabase staat er maar een paar per uur toe). Gebruik de laatst ontvangen link of code, of probeer het over een uur opnieuw.'
          : `Versturen mislukt: ${error.message}`, 'error');
      return;
    }
    showCode(true);
  }

  function showCode(justSent) {
    const codeForm = h('form', { class: 'stack', onsubmit: verifyCode },
      h('label', { for: 'code' }, justSent ? 'Of voer de code uit de e-mail in' : 'Code uit de e-mail'),
      h('input', { id: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9]{6,10}', placeholder: '123456', required: true }),
      h('button', { type: 'submit', class: justSent ? '' : 'primary' }, 'Inloggen met code'),
    );
    mount(root, h('section', { class: 'auth' }, h('div', { class: 'card stack' },
      h('h1', {}, justSent ? 'Check je mail' : 'Code invoeren'),
      justSent && h('p', {}, 'We hebben een inloglink gestuurd naar ', h('strong', {}, email), '.'),
      !justSent && h('p', { class: 'muted' }, 'Voor ', h('strong', {}, email), '. Gebruik de code uit de laatst ontvangen mail.'),
      codeForm,
      h('button', { class: 'link', onclick: () => loginView(root) }, 'Terug'),
    )));
    root.querySelector('#code').focus();
  }

  async function verifyCode(e) {
    e.preventDefault();
    const token = e.target.querySelector('#code').value.trim();
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (error) toast(`Code ongeldig of verlopen: ${error.message}`, 'error');
  }
}
