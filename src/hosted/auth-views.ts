import { page, escapeHtml as e } from './views';
import { legalVersion } from './legal';
export const withAuthScript = (html: string) =>
  html.replace(
    '</head>',
    '<style>button[data-passkey="login"]{background:transparent;color:var(--green);border:1px solid var(--line)}</style><script type="module" src="/auth/browser.js"></script></head>',
  );
const legal = (required = false) =>
  `<input type="hidden" name="legalVersion" value="${legalVersion}"><label class="check"><input type="checkbox" name="accept" value="yes"${required ? ' required' : ''}><span>If you’re creating an account, I agree to the <a href="/terms" target="_blank" rel="noopener">Terms</a> and acknowledge the <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>.</span></label>`;
export const emailStart = (next = '/app', notice = '') =>
  withAuthScript(
    page(
      'Sign in or create an account',
      `<form action="/auth/email/request" method="post"><span class="eyebrow">Your domain portfolio</span><h1>Continue with email.</h1><p>One email address for your portfolio. We’ll send a sign-in link and a six-digit code. No password or Google account needed.</p>${notice ? `<p class="notice" role="status">${e(notice)}</p>` : ''}<input type="hidden" name="next" value="${e(next)}"><label>Email<input name="email" type="email" autocomplete="email" autocapitalize="none" spellcheck="false" required maxlength="254"></label><button type="submit">Email me a sign-in link</button><p class="note">New here? Your account is created after you verify your email and accept the Terms, subject to early-access capacity.</p><p><button type="button" data-passkey="login">Use a passkey</button></p><p id="auth-status" role="status" aria-live="polite"></p><p><a href="/login/password?next=${encodeURIComponent(next)}">Use an existing password</a></p></form>`,
    ),
  );
export const emailCode = (id: string, error = '', code = '') =>
  page(
    'Check your email',
    `<form action="/auth/email/confirm" method="post"><h1>Check your email.</h1>${error ? `<p class="error" role="alert">${e(error)}</p>` : ''}<p>If your address can sign in or register, you’ll receive a link and a six-digit code. Open the link, or enter the code here. Check your spam folder too.</p><input type="hidden" name="id" value="${e(id)}"><label>Six-digit code<input name="code" value="${e(code)}" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" minlength="6" required></label>${legal(!!error)}<button type="submit">Continue</button><p class="note">Expires in 10 minutes. A new request replaces your previous link and code. Delivery may take a few minutes.</p><p><a href="/login">Request a new link</a> · <a href="/login/password">Use an existing password</a></p></form>`,
  );
export const emailConfirm = (
  id: string,
  token: string,
  email: string,
  isNew: boolean,
  error = '',
) =>
  page(
    'Confirm your sign-in',
    `<form action="/auth/email/confirm" method="post"><h1>${isNew ? 'Create your account.' : 'Continue to your portfolio.'}</h1>${error ? `<p class="error" role="alert">${e(error)}</p>` : ''}<p>Continue as <strong>${e(email)}</strong>. Only continue if this is your email address.</p><input type="hidden" name="id" value="${e(id)}"><input type="hidden" name="token" value="${e(token)}">${isNew ? legal(true) : ''}<button type="submit">${isNew ? 'Create account' : 'Continue'}</button><p class="note">This link can be used once. Opening this page does not sign you in.</p><p><a href="/login">Use another email</a></p></form>`,
  );
export const authUnavailable = () =>
  page(
    'Sign-in link unavailable',
    '<h1>This link or code is unavailable.</h1><p>It may have expired, been replaced, or already been used. New accounts also require acceptance of the Terms and available early-access capacity. A confirmation email must be completed in the browser that requested it.</p><p><a href="/login">Request a new link</a></p>',
  );
export const reauthPage = (next: string, hasPasskeys: boolean, email: string) =>
  withAuthScript(
    page(
      'Confirm it’s you',
      `<section class="account"><h1>Confirm it’s you.</h1><p>Before changing sign-in methods, connecting registrar accounts, viewing API keys or exporting a backup, confirm your identity again. Confirmation lasts five minutes.</p><input id="auth-next" type="hidden" value="${e(next)}">${hasPasskeys ? '<button type="button" data-passkey="reauth">Confirm with a passkey</button><p class="note">Use one of your existing passkeys. Email and password cannot replace this check. Keep a backup passkey on another trusted device.</p>' : `<form action="/auth/email/request" method="post"><input type="hidden" name="intent" value="reauth"><input type="hidden" name="next" value="${e(next)}"><p>We’ll send a confirmation link and code to ${e(email)}.</p><button type="submit">Send confirmation email</button></form><form action="/auth/password/confirm" method="post"><input type="hidden" name="next" value="${e(next)}"><label>Existing password (if you have one)<input name="password" type="password" autocomplete="current-password" maxlength="256" required></label><button type="submit">Confirm with password</button></form>`}<p id="auth-status" role="status" aria-live="polite"></p><p><a href="/app">Back to your portfolio</a></p></section>`,
    ),
  );
export const passkeyPanel = (keys: { id: string; created_at: number }[]) =>
  `<section class="session-actions"><h2>Passkeys</h2><p>Sign in using your device’s fingerprint, face, PIN or security key. Your private key stays with your authenticator. Add a backup passkey on another trusted device before relying on passkeys for sensitive actions.</p>${keys.length ? keys.map((k, i) => `<div><p>Passkey ${i + 1} · added ${e(new Date(k.created_at).toISOString().slice(0, 10))}</p><button type="button" data-remove-passkey="${e(k.id)}">Remove passkey ${i + 1}</button></div>`).join('') : '<p>No passkeys added yet.</p>'}<p><button type="button" data-passkey="register">Add a passkey</button></p><p id="auth-status" role="status" aria-live="polite"></p><p><a href="/account/reauth?next=%2Faccount">Confirm your identity</a></p></section>`;

export const authRetry = (message: string, seconds: number, next = '/app') =>
  page(
    'Please try again later',
    `<section class="account"><h1>Please try again later.</h1><p role="alert">${e(message)}</p><p>Try again after ${e(new Date(Date.now() + seconds * 1000).toISOString().replace('T', ' ').slice(0, 19))} UTC (about ${Math.ceil(seconds / 60)} minutes).</p><p><a href="/login?next=${encodeURIComponent(next)}">Back to email sign-in</a> · <a href="/login/password?next=${encodeURIComponent(next)}">Use an existing password</a></p><p><a href="mailto:domains@domains.domains">Contact support</a> if you need help. Existing passkeys are available from sign-in.</p></section>`,
  );
