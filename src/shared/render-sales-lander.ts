import { inquiryRoleLabels } from './inquiry-identity';
import { publicDomainPath } from './public-publishing-links';
import {
  publishedSaleSchema,
  salePriceLabel,
  type PublishedSale,
} from './hosted-sales';
import { salesFormScriptPath } from './sales-form-script';
import { publicPageStyles } from './public-page-style';
import { validateSalesDestination } from './sales-provider';

export const salesEscape = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
export const salesHeaders = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self' https://challenges.cloudflare.com; style-src 'unsafe-inline'; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};
export function salesPage(
  title: string,
  content: string,
  withForms = true,
  canonicalUrl?: string,
): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${canonicalUrl ? `<link rel="canonical" href="${salesEscape(canonicalUrl)}">` : ''}${withForms ? `<script src="${salesFormScriptPath}" defer></script>` : ''}<title>${salesEscape(title)} · domains.domains</title><style>${publicPageStyles}
.layout{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(340px,.95fr);gap:clamp(40px,6vw,88px);align-items:start;padding:64px 0 56px}.domain-intro{padding:14px 0}.domain-title{font-size:clamp(38px,5.5vw,68px);line-height:1.08;letter-spacing:-.055em;margin:0 0 28px;text-wrap:balance}.domain-intro .eyebrow{margin-bottom:24px}.description{font-size:17px;line-height:1.75;max-width:48ch;white-space:pre-line;margin:0 0 24px;color:var(--muted)}.contact-name{padding-top:24px;border-top:1px solid var(--line);max-width:48ch;font-size:13px;color:var(--muted)}.panel{padding:32px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:0 12px 40px rgb(24 53 41 / .04)}.inquiry-heading{border-bottom:1px solid var(--line);margin-bottom:26px;padding-bottom:24px}.inquiry-heading .eyebrow{margin-bottom:8px}.price{font-size:clamp(27px,3vw,36px);line-height:1.2;font-weight:600;letter-spacing:-.035em;font-variant-numeric:tabular-nums;margin:0}.panel h2{font-size:21px;margin:0 0 20px}.panel .note{line-height:1.65}.contact-fields{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}.contact-fields label{margin-top:0}label{display:block;font-size:13px;font-weight:500;margin:20px 0 8px}input,textarea,select{display:block;width:100%;min-height:46px}textarea{min-height:132px;resize:vertical}.buyer-context{border-top:1px solid var(--line);margin-top:24px;padding-top:18px}.buyer-context p{font-size:13px;margin:6px 0 14px;color:var(--muted)}.field-optional{float:right;font-weight:400;font-size:12px;color:var(--muted)}.inquiry-disclosure{border-top:1px solid var(--line);padding-top:14px}.email-hint{font-size:12px;color:var(--muted);line-height:1.6;margin:10px 0 20px}.panel form>button{width:100%;margin:12px 0 0}.panel form>button.secondary{margin-top:10px}.secondary{background:var(--subtle);color:var(--ink);border-color:var(--line)}.cf-turnstile{margin-top:20px;max-width:100%;min-width:0}.cf-turnstile iframe{max-width:100%}[data-challenge-status]{margin:12px 0 0}.flow,.conversation{max-width:720px;margin:56px auto}.flow h1,.conversation h1{font-size:clamp(30px,4vw,44px);margin:12px 0 28px}.flow .panel{padding:32px}.flow ol{padding-left:22px}.flow li{margin:12px 0;color:var(--muted)}.receipt{font-size:12px;color:var(--muted);overflow-wrap:anywhere}.conversation .message{padding:22px 24px;background:var(--surface);border:1px solid var(--line);border-radius:10px;margin:16px 0;white-space:pre-wrap;overflow-wrap:anywhere}.message p{margin:0}.message-meta{font-size:12px;color:var(--muted);margin-bottom:10px}.conversation form{border-top:1px solid var(--line);margin-top:32px;padding-top:8px}.conversation form button,.flow button,.flow .cta{margin-top:18px}.note{line-height:1.65}.error{padding:14px 16px;background:#fff0e6;color:#6c3820;border:1px solid #dfc0a9;border-radius:7px;font-size:14px}.hp{position:absolute;left:-10000px}.steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:32px;border-top:1px solid var(--line);padding:28px 0}.steps p{font-size:13px;line-height:1.75;color:var(--muted);margin:0}.steps strong{display:inline-block;color:var(--ink);font-weight:600;margin-bottom:6px}.published-backlinks{display:flex;gap:12px 24px;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:24px;font-size:13px}.published-backlinks a{min-height:44px;display:inline-flex;align-items:center}.ledger{width:100%;border-collapse:collapse;margin-top:24px}.ledger td,.ledger th{padding:20px 12px;border-bottom:1px solid var(--line);text-align:left;overflow-wrap:anywhere}.ledger th{font-size:12px;color:var(--muted);font-weight:500}.ledger td:first-child a{font-weight:600;text-decoration:none}.shop-search{margin:28px 0}.shop-search-row{display:flex;gap:12px;align-items:center}.shop-search-row button{margin:0;flex-shrink:0}.shop-filters{margin-top:16px}.shop-filters summary,summary{min-height:44px;cursor:pointer;padding:10px 0;font-size:14px;color:var(--accent)}.shop-filter-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0 16px}.shop-results{font-size:13px;color:var(--muted)}.shop-mobile-mode{display:none}
@media(max-width:1100px){.buyer-context .contact-fields{grid-template-columns:minmax(0,1fr);gap:0}.buyer-context .contact-fields label{margin-top:20px}}
@media(max-width:760px){.layout{grid-template-columns:minmax(0,1fr);gap:28px;padding:36px 0}.domain-intro{padding:0}.domain-title{font-size:clamp(35px,7.8vw,52px);margin-bottom:20px}.domain-intro .eyebrow{margin-bottom:16px}.description{font-size:16px;margin-bottom:16px}.contact-name{padding-top:16px;margin-bottom:0}.panel{padding:24px}.steps{grid-template-columns:1fr;gap:22px;padding-block:26px}.steps p{max-width:55ch}.shop-filter-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.shop-mobile-mode{display:block;font-size:12px}.ledger th:nth-child(3),.ledger td:nth-child(3){display:none}.flow,.conversation{margin:36px auto}.flow .panel{padding:24px}}
@media(max-width:420px){.panel{padding:22px 18px}.contact-fields{grid-template-columns:minmax(0,1fr);gap:18px}.inquiry-heading{padding-bottom:20px;margin-bottom:22px}.domain-title{font-size:clamp(31px,8vw,38px)}.shop-search-row{gap:8px}.shop-search-row button{padding-inline:14px}}
@media(prefers-color-scheme:dark){.panel{box-shadow:none}.error{background:#452c20;color:#f5d9c2;border-color:#77523b}}
</style></head><body><a class="skip-link" href="#main-content">Skip to content</a><header class="public-header">${withForms ? '<a class="wordmark" href="https://domains.domains" rel="noreferrer">domains.domains</a>' : '<span class="wordmark">domains.domains</span>'}<span class="header-context">Domain inquiries</span></header><main id="main-content" tabindex="-1">${withForms ? '<noscript><p>JavaScript is required to complete the security check and submit forms.</p></noscript>' : ''}${content}</main><footer class="public-footer"><p>Payment and transfer happen with your selected provider.</p><p class="attribution">Published with domains.domains · <a href="https://domains.domains/source" rel="noreferrer">Source · AGPL</a><br>domains.domains is a hosted, multi-tenant version of <a href="https://github.com/aoxborrow/dombot" rel="noreferrer">aoxborrow/dombot</a>.</p></footer></body></html>`;
}
export function renderSalesLander(
  value: PublishedSale,
  base: string,
  sitekey: string | null,
  options: {
    privacyUrl?: string;
    backlinks?: { label: string; url: string }[];
    preview?: boolean;
    error?: string;
    fields?: Record<string, string>;
    inquiryPath?: string;
    providerPath?: string;
    revisionConflict?: boolean;
    canonicalUrl?: string;
  } = {},
): string {
  const s = publishedSaleSchema.parse(value),
    e = salesEscape,
    fields = options.fields ?? {};
  const destination = s.destination
    ? validateSalesDestination(
        s.destination.provider,
        s.destination.url,
        s.domain,
      )
    : null;
  const offerCurrency =
    s.publicPrice?.currency ?? s.publicMinimumOffer?.currency ?? 'USD';
  const question = s.allowQuestions || s.mode === 'inquiry';
  const form =
    sitekey && !options.preview
      ? `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=salesChallengeReady" defer></script><form method="post" action="${e(options.inquiryPath ?? `${publicDomainPath(base, s.domain)}/inquiries`)}"><input type="hidden" name="observedRevision" value="${e(s.revision)}"><input type="hidden" name="idempotencyKey" value="${crypto.randomUUID()}"><div class="contact-fields"><div><label for="name">Full name</label><input id="name" name="name" value="${e(fields.name)}" maxlength="100" autocomplete="name" required></div><div><label for="email">Email</label><input aria-describedby="email-hint" id="email" name="email" value="${e(fields.email)}" type="email" maxlength="254" autocomplete="email" required></div></div><p class="email-hint" id="email-hint">Use an address where you can receive our confirmation email.</p><section class="buyer-context" aria-label="About you"><strong>Help the owner get to know you</strong><p>A profile or company website gives your inquiry useful context.</p><label for="profileUrl">LinkedIn or professional profile <span class="field-optional">Optional</span></label><input id="profileUrl" name="profileUrl" value="${e(fields.profileUrl)}" type="url" maxlength="500" placeholder="https://www.linkedin.com/in/…" autocomplete="url"><div class="contact-fields"><div><label for="company">Company or organization <span class="field-optional">Optional</span></label><input id="company" name="company" value="${e(fields.company)}" maxlength="150" autocomplete="organization"></div><div><label for="companyWebsite">Company website <span class="field-optional">Optional</span></label><input id="companyWebsite" name="companyWebsite" value="${e(fields.companyWebsite)}" type="url" maxlength="500" placeholder="https://…"></div></div><label for="inquiryRole">I’m inquiring <span class="field-optional">Optional</span></label><select id="inquiryRole" name="inquiryRole"><option value="">Select an option</option>${Object.entries(
          inquiryRoleLabels,
        )
          .map(
            ([value, label]) =>
              `<option value="${value}"${fields.inquiryRole === value ? ' selected' : ''}>${e(label)}</option>`,
          )
          .join(
            '',
          )}</select></section>${s.mode === 'offer' ? `<label for="offer">Your offer (${e(offerCurrency)})</label><input id="offer" name="amount" value="${e(fields.amount)}" inputmode="decimal" pattern="[0-9]+([.][0-9]+)?"><input type="hidden" name="currency" value="${e(offerCurrency)}">${s.publicMinimumOffer ? `<p class="note">Offers start at ${e(salePriceLabel(s.publicMinimumOffer))}. You can still ask a question.</p>` : ''}` : ''}<label for="message">Message${s.mode === 'offer' ? ' (optional with an offer)' : ''}</label><textarea placeholder="What would you like to know about this domain?" id="message" name="message" maxlength="4000" ${s.mode === 'offer' ? '' : 'required'}>${e(fields.message)}</textarea><div class="hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div><div class="cf-turnstile" data-sitekey="${e(sitekey)}" data-action="sales-inquiry"></div><p class="note" data-challenge-status role="status">Complete the security check to send.</p>${s.mode === 'offer' ? '<button data-challenge-submit disabled name="intent" value="offer">Send offer</button> ' : ''}${question ? `<button data-challenge-submit disabled name="intent" value="question"${s.mode === 'offer' ? ' class="secondary"' : ''}>${s.mode === 'offer' ? 'Ask a question' : 'Send inquiry'}</button>` : ''}<p class="note inquiry-disclosure">Next: confirm your email, then continue the conversation. Your contact and profile details, IP address, browser and approximate IP location are recorded and shared privately with the domain owner. Email confirmation does not verify identity. Sending an inquiry does not commit you to a purchase. <a href="${e(options.privacyUrl ?? 'https://domains.domains/privacy')}" rel="noreferrer">Privacy Policy</a>.</p></form>`
      : `<p class="note">${options.preview ? 'Preview only. Inquiry submission is disabled here.' : 'Direct inquiries are temporarily unavailable.'}</p>`;
  const nextSteps = ['buy-now', 'external'].includes(s.mode)
    ? `<p><strong>1. Continue to the provider</strong><br>Check the domain and current terms there.</p><p><strong>2. Review provider terms</strong><br>The provider handles payment and any additional charges.</p><p><strong>3. Follow the transfer instructions</strong><br>The provider explains the next steps.</p>`
    : `<p><strong>1. ${s.mode === 'offer' ? 'Send your offer or question' : 'Send your inquiry'}</strong><br>Tell the domain owner what you have in mind.</p><p><strong>2. Confirm your email</strong><br>Open the confirmation email to start the conversation.</p><p><strong>3. Continue by email</strong><br>Reply from your inbox. Your messages stay in the conversation.</p>`;
  return salesPage(
    s.domain,
    `${options.preview ? '<p class="error">Private preview · Saved draft · Domain setup is separate</p>' : ''}<div class="layout"><section class="domain-intro"><span class="eyebrow">Domain inquiries</span><h1 class="domain-title">${e(s.displayName).replaceAll('.', '.<wbr>')}</h1>${s.displayName !== s.domain ? `<p class="note">${e(s.domain)}</p>` : ''}<p class="description">${e(s.description)}</p>${s.sellerDisplayName ? `<p class="contact-name">Contact ${e(s.sellerDisplayName)}</p>` : ''}</section><section class="panel" aria-label="Domain inquiry">${options.error ? `<p role="alert" ${options.revisionConflict ? 'data-sales-revision-conflict="true"' : ''} class="error">${e(options.error)}</p>` : ''}<div class="inquiry-heading"><p class="eyebrow">${s.publicPrice ? (s.providerIntent === 'offer' ? 'Asking price' : 'Listed price') : 'Start a conversation'}</p><p class="price">${e(salePriceLabel(s.publicPrice))}</p></div><h2>${s.mode === 'offer' ? 'Make an offer' : s.mode === 'inquiry' ? 'Get in touch' : 'Your next step'}</h2>${destination && ['buy-now', 'external'].includes(s.mode) ? `<a class="cta" href="${e(options.preview ? destination : (options.providerPath ?? `${publicDomainPath(base, s.domain)}/provider`))}" rel="noreferrer noopener">${s.providerIntent === 'buy' ? 'Buy through' : s.providerIntent === 'offer' ? 'Make an offer at' : s.providerIntent === 'view' ? 'View on' : 'Continue to'} ${e(s.destination!.provider)}</a><p class="note">Payment and transfer handled by ${e(s.destination!.provider)}. Terms and any additional charges are shown there. ${s.destination!.check === 'manual' ? 'Owner-provided link; availability is checked by the provider.' : ''}</p>` : ''}${question || s.mode === 'offer' ? (['buy-now', 'external'].includes(s.mode) ? `<details><summary style="min-height:44px;padding:12px 0;cursor:pointer">Ask a question</summary>${form}</details>` : form) : ''}</section></div><div class="steps">${nextSteps}</div>${options.backlinks?.length && !options.preview ? `<nav class="published-backlinks" aria-label="Published owner and collections">${options.backlinks.map((l) => `<a href="${e(l.url)}">${e(l.label)}</a>`).join('')}</nav>` : ''}`,
    !options.preview,
    options.preview ? undefined : options.canonicalUrl,
  );
}
