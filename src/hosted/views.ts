import { landingContent, landingStyles } from './landing';
import { brandFontPath } from './brand-font';
import { softwareCredit } from './attribution';

export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

const e = escapeHtml;

export function page(
  title: string,
  content: string,
  canonical?: string,
): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)} · domains.domains</title>${canonical ? `<link rel="canonical" href="${e(canonical)}"><meta property="og:url" content="${e(canonical)}"><meta name="description" content="Manage your domains across registrars in one portfolio. Track renewals, publish a curated collection and connect your AI assistant. Hosted, open-source DomBot.">` : ''}<style>
  @font-face{font-family:Archivo;font-style:normal;font-weight:400 800;font-display:swap;src:url("${brandFontPath}") format("woff2")}
  :root{color-scheme:light;--ink:#21342a;--muted:#57665d;--line:#dce3db;--paper:#f7f9f5;--green:#31613b}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 Archivo,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header,main,footer{max-width:1100px;margin:auto;padding:24px 28px}header{display:flex;justify-content:space-between;border-bottom:1px solid var(--line);gap:20px}a{color:var(--green);text-decoration:none}a:hover{text-decoration:underline}.brand{display:inline-flex;align-items:center;gap:0}.brand-dot{color:var(--green)}.brand{font-size:27px;letter-spacing:-1.65px;font-weight:700;color:var(--ink);min-height:44px}h1{font-size:clamp(38px,7vw,76px);line-height:1.05;letter-spacing:-.045em;margin:24px 0;max-width:850px}p{max-width:660px;color:var(--muted)}.hero{padding:64px 0}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.16em;color:var(--green)}.lead{font-size:21px}.button,button{display:inline-block;background:var(--green);color:#fff;padding:12px 22px;border:0;border-radius:7px;font:inherit;cursor:pointer}.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:32px;border-top:1px solid var(--line);padding:30px 0}.steps span{font-size:12px;color:var(--green)}h2{font-size:22px;letter-spacing:-.03em}form{max-width:440px;margin:40px auto 80px}form h1,.account h1{font-size:38px}.account{max-width:560px;margin:40px auto 64px}.account form{margin:28px 0;max-width:none}.session-actions{border-top:1px solid var(--line);padding-top:24px}.notice{padding:12px;border:1px solid var(--line);border-radius:6px;background:#edf3e9}input,button{min-height:44px}header{flex-wrap:wrap}main{overflow-wrap:anywhere}label{display:block;margin:18px 0;font-size:14px;font-weight:600}input{display:block;width:100%;padding:12px;margin-top:6px;border:1px solid var(--line);border-radius:6px;font:inherit;background:#fff;color:var(--ink)}input:focus-visible,a:focus-visible,button:focus-visible{outline:3px solid #7ac28d;outline-offset:3px}.error{padding:12px;border:1px solid #be6f60;border-radius:6px;color:#7c3123}.note{font-size:13px}footer{border-top:1px solid var(--line);font-size:13px;color:var(--muted)}@media(max-width:600px){.hero{padding:36px 0}.steps{grid-template-columns:1fr;gap:10px}header,main,footer{padding-left:20px;padding-right:20px}}
  ${canonical ? landingStyles : ''}
  .legal{max-width:740px;margin:40px auto 80px}.legal h1{font-size:48px}.legal p{max-width:none}.check{display:flex;align-items:flex-start;gap:10px}.check input{width:18px;min-height:18px;flex-shrink:0;margin-top:4px}.site-footer{display:flex;align-items:flex-start;flex-wrap:wrap;gap:20px 36px}.site-footer .software-credit{flex:1 1 440px;max-width:720px;margin:0;font-size:12px;line-height:1.7}.site-footer nav{display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center;font-size:12px}.site-footer a{color:var(--green)}.collection-link{margin:0 32px 28px;font-size:13px}@media(max-width:600px){.site-footer{gap:18px}.collection-link{margin-left:22px;margin-right:22px}}
  </style></head><body${canonical ? ' class="landing-page"' : ''}><header><a class="brand" href="/" aria-label="domains.domains">domains<span class="brand-dot">.</span>domains</a>${canonical ? '<nav class="landing-nav" aria-label="Main navigation"><a class="nav-feature" href="#overview">How it works</a><a class="nav-signin" href="/login">Sign in ↗</a></nav>' : '<a href="/app">Your portfolio ↗</a>'}</header><main>${content}</main><footer class="site-footer">${softwareCredit}<nav aria-label="Footer"><a href="/source">SaaS source · AGPL</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="mailto:domains@domains.domains">Support</a></nav></footer></body></html>`;
}
export const home = (hasPortfolio = false, registrationOpen = false) =>
  page(
    'Domain portfolio management',
    landingContent(hasPortfolio, registrationOpen),
    'https://domains.domains/',
  );

export function accountForm(
  kind: 'login' | 'join',
  error = '',
  code = '',
  next = '/app',
  options: { email?: string; notice?: string } = {},
): string {
  return page(
    kind === 'join' ? 'Create your account' : 'Welcome back',
    `<form action="/session/${kind}" method="post"><span class="eyebrow">${kind === 'join' ? 'Create your sign-in' : 'domains.domains'}</span><h1>${kind === 'join' ? 'Make it yours.' : 'Welcome back.'}</h1><p>${kind === 'join' ? 'Use the email address on your invitation. Your free portfolio starts private. No subscription fee or credit card required. Registrar charges are separate.' : 'Sign in to your domain portfolio.'}</p>${options.notice ? `<p role="status" class="notice">${e(options.notice)}</p>` : ''}${error ? `<p role="alert" class="error">${e(error)}</p>` : ''}<input type="hidden" name="next" value="${e(next)}">${kind === 'join' ? `<input type="hidden" name="code" value="${e(code)}">` : ''}<label>Email<input type="email" name="email" autocomplete="username" autocapitalize="none" spellcheck="false" value="${e(options.email ?? '')}" required maxlength="254"></label><label>Password<input type="password" name="password" autocomplete="${kind === 'join' ? 'new-password' : 'current-password'}" required minlength="12" maxlength="256"></label><button type="submit">${kind === 'join' ? 'Create account' : 'Sign in'}</button><p class="note"><a href="/recover">Forgot your password?</a></p><p class="note">Free early access. Need access help? <a href="mailto:domains@domains.domains?subject=Account%20recovery">Contact support for account recovery</a>. Never email your password, API keys, or backup.</p></form>`,
  );
}

export function accountSecurity(
  user: {
    email: string;
    label: string;
  },
  error = '',
): string {
  return page(
    'Account security',
    `<section class="account"><span class="eyebrow">Your sign-in</span><h1>Account security</h1><p>Signed in as <strong>${e(user.email)}</strong><br>Portfolio: <strong>${e(user.label)}</strong></p><p><a href="/app">Back to your portfolio →</a></p><form action="/account/password" method="post"><h2>Change your password</h2><p class="note" id="password-help">Use at least 12 characters. Changing your password signs out every browser session, including this one.</p>${error ? `<p role="alert" class="error">${e(error)}</p>` : ''}<label>Current password<input name="oldPassword" type="password" autocomplete="current-password" required maxlength="256"></label><label>New password<input name="newPassword" type="password" autocomplete="new-password" aria-describedby="password-help" required minlength="12" maxlength="256"></label><button type="submit">Change password</button></form><section class="session-actions" aria-labelledby="sessions-heading"><h2 id="sessions-heading">Browser sessions</h2><p>Sign out here when using a shared device. Sign out all browsers if you no longer trust a device; you will need to sign in again here too.</p><form action="/session/logout" method="post"><button type="submit">Sign out this browser</button></form><form action="/account/sessions/logout" method="post"><button type="submit">Sign out all browsers</button></form><p class="note">Paired AI assistants stay connected. Review or revoke their access separately in your portfolio’s MCP settings.</p></section><p><a href="/account/close">Close your account</a></p><p class="note">Need access help? <a href="mailto:domains@domains.domains?subject=Account%20recovery">Contact support for account recovery</a>. Never email your password, API keys, or backup.</p></section>`,
  );
}

export function recoveryForm(code: string, error = ''): string {
  if (!/^[a-f0-9]{64}$/.test(code))
    return page(
      'Account recovery',
      `<h1>Recover your account.</h1>${error ? `<p class="error" role="alert">${e(error)}</p>` : ''}<p>Contact support from your established contact channel. After verifying your identity, the operator will issue a recovery link that expires in 15 minutes. A link can be used once.</p><p><a class="button" href="mailto:domains@domains.domains?subject=Account%20recovery">Contact support</a></p><p>Email: domains@domains.domains</p><p>Never send your password, API keys, or backup.</p><p><a href="/login">Back to sign in</a></p>`,
    );
  return page(
    'Set a new password',
    `<form action="/recover" method="post"><h1>Set a new password.</h1>${error ? `<p class="error" role="alert">${e(error)}</p>` : ''}<p>This link can be used once. Updating your password signs out every browser session. Paired agents are managed separately in MCP settings.</p><input type="hidden" name="code" value="${e(code)}"><label>New password<input name="password" type="password" autocomplete="new-password" required minlength="12" maxlength="256"></label><label>Confirm new password<input name="confirm" type="password" autocomplete="new-password" required minlength="12" maxlength="256"></label><button type="submit">Update password</button></form>`,
  );
}
