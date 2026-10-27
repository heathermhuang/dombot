import { page, escapeHtml as e } from './views';
import { legalVersion } from './legal';
export const withAuthScript = (html: string) =>
  html.replace(
    '</head>',
    '<style>button[data-passkey="login"]{background:transparent;color:var(--green);border:1px solid var(--line)}</style><script type="module" src="/auth/browser.js"></script></head>',
  );
const legal = (required = false) =>
  `<input type="hidden" name="legalVersion" value="${legalVersion}"><label class="check"><input type="checkbox" name="accept" value="yes"${required ? ' required' : ''}><span>I agree to the <a href="/terms" target="_blank" rel="noopener">Terms</a> and acknowledge the <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>.</span></label>`;
export const emailStart = (next = '/app', notice = '') =>
  withAuthScript(
    page(
      'Sign in or create an account',
      `<form action="/auth/email/request" method="post"><span class="eyebrow">Your domain portfolio</span><h1>Continue with email.</h1><p>One email address for your portfolio. We’ll send a sign-in link and a six-digit code. No password or Google account needed.</p>${notice ? `<p class="notice" role="status">${e(notice)}</p>` : ''}<input type="hidden" name="next" value="${e(next)}"><label>Email<input name="email" type="email" autocomplete="email" autocapitalize="none" spellcheck="false" required maxlength="254"></label><button type="submit">Email me a sign-in link</button><p class="note">New here? Your account is created after you verify your email and accept the Terms, subject to early-access capacity.</p><p><button type="button" data-passkey="login">Use a passkey</button></p><p id="auth-status" role="status" aria-live="polite"></p><details><summary>Other sign-in options</summary><p><a href="/login/password?next=${encodeURIComponent(next)}">Sign in with a password you previously set</a></p></details></form>`,
    ),
  );
export const emailCode = (id: string, error = '') =>
  page(
    'Check your email',
    `<form action="/auth/email/confirm" method="post"><h1>Check your email.</h1>${error ? `<p class="error" role="alert">${e(error)}</p>` : ''}<p>Open the sign-in email, or enter its six-digit code below. If your address is eligible, the email will arrive shortly. Check Spam if it is missing.</p><input type="hidden" name="id" value="${e(id)}"><label>Six-digit code<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="12" minlength="6" required></label><button type="submit">Continue</button><p class="note">Expires in 10 minutes. A new request replaces your previous link and code. Delivery may take a few minutes.</p><p><a href="/login">Request a new link</a></p></form>`,
  );
export const emailConfirm = (
  id: string,
  token: string,
  email: string,
  isNew: boolean,
  error = '',
  proofKind: 'token' | 'code' = 'token',
) =>
  page(
    'Confirm your sign-in',
    `<form action="/auth/email/confirm" method="post"><h1>${isNew ? 'Create your account.' : 'Continue to your portfolio.'}</h1>${error ? `<p class="error" role="alert">${e(error)}</p>` : ''}${isNew && proofKind === 'code' ? '<p class="notice" role="status">Email confirmed. Review the Terms below to finish creating your account.</p>' : ''}<p>Continue as <strong>${e(email)}</strong>. Only continue if this is your email address.</p><input type="hidden" name="id" value="${e(id)}"><input type="hidden" name="${proofKind}" value="${e(token)}">${isNew ? legal(true) : ''}<button type="submit">${isNew ? 'Create account' : 'Continue'}</button><p class="note">This confirmation can be used once. Your account opens after you continue.</p><p><a href="/login">Use another email</a></p></form>`,
  );
export const authUnavailable = () =>
  page(
    'Sign-in link unavailable',
    '<h1>Request a new sign-in link.</h1><p>This link or code is unavailable. It may have expired, been replaced or already been used.</p><p><a class="button" href="/login">Request a new link</a></p><details><summary>Account and browser requirements</summary><p>New accounts require acceptance of the Terms and available early-access capacity.</p><p>You can open ordinary sign-in links in another browser. For a sensitive account change, return to the browser where you are signed in.</p></details>',
  );
export const reauthPage = (
  next: string,
  hasPasskeys: boolean,
  email: string,
  hasPassword = false,
) =>
  withAuthScript(
    page(
      'Confirm it’s you',
      `<section class="account"><h1>Confirm it’s you.</h1><p>Before changing sign-in methods, viewing saved API keys or exporting a backup, confirm your identity again. Confirmation lasts five minutes.</p><input id="auth-next" type="hidden" value="${e(next)}">${hasPasskeys ? '<button type="button" data-passkey="reauth">Confirm with a passkey</button><p class="note">Use one of your existing passkeys. Email and password cannot replace this check. Keep a backup passkey on another trusted device.</p>' : `<form action="/auth/email/request" method="post"><input type="hidden" name="intent" value="reauth"><input type="hidden" name="next" value="${e(next)}"><p>We’ll send a confirmation link and code to ${e(email)}.</p><button type="submit">Send confirmation email</button></form>${hasPassword ? `<form action="/auth/password/confirm" method="post"><input type="hidden" name="next" value="${e(next)}"><label>Password<input name="password" type="password" autocomplete="current-password" maxlength="256" required></label><button type="submit">Confirm with password</button></form>` : ''}`}<p id="auth-status" role="status" aria-live="polite"></p><p><a href="/app">Back to your portfolio</a></p></section>`,
    ),
  );
export const passkeyPanel = (
  keys: {
    id: string;
    name?: string;
    created_at: number;
    last_used_at?: number | null;
    reference?: string;
    authenticator?: string;
  }[],
) =>
  `<section class="session-actions"><h2>Passkeys</h2><p>Your private key stays with your authenticator. Keep a backup passkey on another trusted device. References stay the same when this list changes; authenticator type may include synced passkeys and does not identify a particular device.</p>${
    keys.length
      ? keys
          .map((k) => {
            const reference = k.reference ?? k.id.slice(-12);
            const name = k.name || `Passkey ${reference}`;
            const identity = k.name ? `${name} (reference ${reference})` : name;
            return `<div class="passkey-row"><h3>${e(name)}</h3><p>Reference ${e(reference)} · ${e(k.authenticator ?? 'Authenticator')}<br>Added <time datetime="${e(new Date(k.created_at).toISOString())}">${e(new Date(k.created_at).toISOString().slice(0, 10))}</time> · ${k.last_used_at ? `Last used <time datetime="${e(new Date(k.last_used_at).toISOString())}">${e(new Date(k.last_used_at).toISOString().slice(0, 16).replace('T', ' '))} UTC</time>` : 'Not used yet'}</p><form method="post" action="/auth/passkeys/rename" class="passkey-name-form" data-rename-passkey="${e(k.id)}"><input type="hidden" name="id" value="${e(k.id)}"><label for="passkey-name-${e(reference)}">Name for ${e(identity)}<input id="passkey-name-${e(reference)}" name="name" value="${e(k.name ?? '')}" maxlength="80" required autocomplete="off" placeholder="e.g. Laptop or backup security key"></label><button type="submit" aria-label="Save name for ${e(identity)}">Save name</button><p class="note" role="status" data-name-status hidden></p></form><button type="button" data-remove-passkey="${e(k.id)}" data-passkey-name="${e(identity)}">Remove ${e(identity)}</button></div>`;
          })
          .join('')
      : '<p>No passkeys added yet.</p>'
  }<p><button type="button" data-passkey="register">Add a passkey</button></p><p id="auth-status" role="status" aria-live="polite"></p><p><a href="/account/reauth?next=%2Faccount">Confirm your identity</a></p></section>`;

export const authRetry = (message: string, seconds: number, next = '/app') =>
  withAuthScript(
    page(
      'Please try again later',
      `<section class="account"><h1>Please try again later.</h1><p role="alert">${e(message)}</p>${seconds > 0 ? `<p>Try again in about <strong>${Math.ceil(seconds / 60)} ${Math.ceil(seconds / 60) === 1 ? 'minute' : 'minutes'}</strong>.</p><p class="note">Available after <time data-local-time datetime="${e(new Date(Date.now() + seconds * 1000).toISOString())}">${e(new Date(Date.now() + seconds * 1000).toUTCString())}</time>.</p>` : '<p>The email allowance needs attention from support before more messages can be sent. Existing passwords and passkeys still work.</p>'}<p><a href="/login?next=${encodeURIComponent(next)}">Back to email sign-in</a> · <a href="/login/password?next=${encodeURIComponent(next)}">Use an existing password</a></p><p><a href="mailto:domains@domains.domains">Contact support</a> if you need help. Existing passkeys are available from sign-in.</p></section>`,
    ),
  );
