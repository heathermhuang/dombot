const e = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

export function page(title: string, content: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)} · domains.domains</title><style>
  :root{color-scheme:light;--ink:#21342a;--muted:#57665d;--line:#dce3db;--paper:#f7f9f5;--green:#31613b}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header,main,footer{max-width:1100px;margin:auto;padding:24px 28px}header{display:flex;justify-content:space-between;border-bottom:1px solid var(--line);gap:20px}a{color:var(--green);text-decoration:none}a:hover{text-decoration:underline}.brand{font-size:24px;letter-spacing:-1px;font-weight:750;color:var(--ink)}h1{font-size:clamp(38px,7vw,76px);line-height:1.05;letter-spacing:-.045em;margin:24px 0;max-width:850px}p{max-width:660px;color:var(--muted)}.hero{padding:64px 0}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.16em;color:var(--green)}.lead{font-size:21px}.button,button{display:inline-block;background:var(--green);color:#fff;padding:12px 22px;border:0;border-radius:7px;font:inherit;cursor:pointer}.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:32px;border-top:1px solid var(--line);padding:30px 0}.steps span{font-size:12px;color:var(--green)}h2{font-size:22px;letter-spacing:-.03em}form{max-width:440px;margin:40px auto 80px}form h1{font-size:38px}label{display:block;margin:18px 0;font-size:14px;font-weight:600}input{display:block;width:100%;padding:12px;margin-top:6px;border:1px solid var(--line);border-radius:6px;font:inherit;background:#fff;color:var(--ink)}input:focus-visible,a:focus-visible,button:focus-visible{outline:3px solid #7ac28d;outline-offset:3px}.error{padding:12px;border:1px solid #be6f60;border-radius:6px;color:#7c3123}.note{font-size:13px}footer{border-top:1px solid var(--line);font-size:13px;color:var(--muted)}@media(max-width:600px){.hero{padding:36px 0}.steps{grid-template-columns:1fr;gap:10px}header,main,footer{padding-left:20px;padding-right:20px}}
  </style></head><body><header><a class="brand" href="/">domains.domains</a><a href="/app">Your workspace ↗</a></header><main>${content}</main><footer>Open-source software, managed workspaces. Built on DomBot. <a href="https://github.com/heathermhuang/dombot/tree/codex/hosted-foundation">Source code</a>. · Invite-only staging</footer></body></html>`;
}
export const home = () =>
  page(
    'Your entire portfolio. Finally together.',
    `<section class="hero"><span class="eyebrow">For domainers, by a domainer</span><h1>Your entire portfolio.<br>Finally together.</h1><p class="lead">All your registrars. Every account. One clear view of what you own, what renews next, and what it costs to keep.</p><p>Manage your domains from the web or connect your preferred AI assistant. Your workspace, credentials, and public collection stay under your control.</p><a class="button" href="/login">Sign in to staging</a><p class="note">Have an invitation? Open your private invite link to create an account.</p></section><section class="steps"><div><span>01 / CONNECT</span><h2>Bring every account</h2><p>Keep your registrars. Bring the scattered pieces of your portfolio together.</p></div><div><span>02 / UNDERSTAND</span><h2>See the whole picture</h2><p>Track inventory, expiration dates, and renewal estimates with their sources.</p></div><div><span>03 / MANAGE</span><h2>Act with confidence</h2><p>Manage domains, authorize agent access, and publish only the names you choose.</p></div></section>`,
  );

export function accountForm(
  kind: 'login' | 'join',
  error = '',
  code = '',
  next = '/app',
): string {
  return page(
    kind === 'join' ? 'Create your workspace account' : 'Welcome back',
    `<form action="/session/${kind}" method="post"><span class="eyebrow">Private workspace</span><h1>${kind === 'join' ? 'Make it yours.' : 'Welcome back.'}</h1><p>${kind === 'join' ? 'Use the email address on your invitation. Your reserved workspace starts private.' : 'Sign in to your domain portfolio.'}</p>${error ? `<p role="alert" class="error">${e(error)}</p>` : ''}<input type="hidden" name="next" value="${e(next)}">${kind === 'join' ? `<input type="hidden" name="code" value="${e(code)}">` : ''}<label>Email<input type="email" name="email" autocomplete="email" required maxlength="254"></label><label>Password<input type="password" name="password" autocomplete="${kind === 'join' ? 'new-password' : 'current-password'}" required minlength="12" maxlength="256"></label><button type="submit">${kind === 'join' ? 'Create account & open workspace' : 'Sign in'}</button><p class="note">Invite-only staging. Account recovery is handled by the operator during this pilot.</p></form>`,
  );
}
