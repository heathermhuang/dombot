import {
  publishedSaleSchema,
  salePriceLabel,
  type PublishedSale,
} from './sales';
import { salesFormScriptPath } from './sales-form-script';
import { brandFontPath } from './brand-font';
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
): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${withForms ? `<script src="${salesFormScriptPath}" defer></script>` : ''}<title>${salesEscape(title)} · domains.domains</title><style>@font-face{font-family:Archivo;src:url('${brandFontPath}') format('woff2');font-display:swap}*{box-sizing:border-box}body{margin:0;background:#f7f8f4;color:#172e25;font-family:Archivo,Arial,sans-serif;font-size:16px;line-height:1.6}header,main,footer{max-width:1160px;margin:auto;padding:28px 32px}header{border-bottom:1px solid #d5ddd3}.wordmark{font-size:22px;font-weight:700;letter-spacing:-.8px}.layout{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:48px;padding:48px 0}h1{font-size:clamp(30px,4.2vw,56px);line-height:1.08;letter-spacing:-2px;overflow-wrap:anywhere;margin:20px 0}h2{font-size:24px;margin-top:0}.eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#516b5d}.panel{padding:28px;border:1px solid #cbd6cd;background:#fff;border-radius:10px}.price{margin:8px 0 24px;font-size:28px;font-weight:600;font-variant-numeric:tabular-nums}label{display:block;font-size:14px;margin:18px 0 6px}input,textarea,select,button{font:inherit;max-width:100%}input,textarea,select{display:block;width:100%;padding:12px;border:1px solid #a2b1a7;border-radius:4px;background:#fff}textarea{min-height:130px}button:disabled{opacity:.6;cursor:wait}.flow,.conversation{max-width:720px;margin:40px auto}.flow h1,.conversation h1{font-size:clamp(28px,4vw,40px);letter-spacing:-1px}.flow .panel{padding:32px}.flow ol{padding-left:22px}.flow li{margin:10px 0}.receipt{font-size:12px;color:#54675c;overflow-wrap:anywhere}.conversation .message{padding:18px 22px;border:1px solid #cbd6cd;background:#fff;margin:16px 0 24px}.conversation .message p{margin:0}.message-meta{font-size:13px;color:#54675c;margin-bottom:8px}.conversation form{border-top:1px solid #cbd6cd;padding-top:8px}.email-hint{font-size:13px;color:#54675c;margin:6px 0}.domain-title{font-size:clamp(28px,3.2vw,48px);line-height:1.15;text-wrap:balance}.description{max-width:52ch}.contact-fields{display:grid;grid-template-columns:1fr 1fr;gap:16px}.contact-fields label{margin-top:8px}button,.cta{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:12px 20px;margin-top:18px;border:0;border-radius:4px;background:#234f3d;color:#fff;text-decoration:none;cursor:pointer}.secondary{background:#e7ece5;color:#234f3d}.note,footer{font-size:13px;color:#54675c}.error{padding:14px;background:#fff0e9;border:1px solid #d2a997}.hp{position:absolute;left:-10000px}a{color:#22533c}a:focus-visible,button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:3px solid #a07615;outline-offset:3px}.steps{border-top:1px solid #d5ddd3;padding:24px 0;display:grid;grid-template-columns:repeat(3,1fr);gap:24px}.ledger{width:100%;border-collapse:collapse}.ledger td,.ledger th{padding:16px 8px;border-bottom:1px solid #d5ddd3;text-align:left;overflow-wrap:anywhere}.message{border:1px solid #b7cbbb;padding:8px 20px;white-space:pre-wrap;overflow-wrap:anywhere}.shop-search{margin:20px 0}.shop-search-row{display:flex;gap:12px;align-items:center}.shop-search-row button{margin:0;flex-shrink:0}.shop-filters{margin-top:12px}.shop-filters summary{min-height:44px;cursor:pointer;color:#22533c;display:list-item;padding:10px 0}.shop-filter-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0 16px}.shop-results{font-size:14px}.shop-mobile-mode{display:none}summary:focus-visible{outline:3px solid #a07615;outline-offset:3px}@media(max-width:700px){.shop-filter-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.shop-mobile-mode{display:block;font-size:13px;color:#54675c}.shop-search-row{gap:8px}.shop-search-row button{padding:12px}header,main,footer{padding:20px}.layout{grid-template-columns:minmax(0,1fr);gap:24px;padding:32px 0}.panel{padding:20px}.steps{grid-template-columns:1fr;gap:4px}.contact-fields{grid-template-columns:1fr;gap:0}.ledger th:nth-child(3),.ledger td:nth-child(3){display:none}h1{letter-spacing:-1px}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}</style></head><body><header><span class="wordmark">domains.domains</span></header><main>${withForms ? '<noscript><p>JavaScript is required to complete the security check and submit forms.</p></noscript>' : ''}${content}</main><footer>Powered by domains.domains · Payment and transfer happen with your selected provider.</footer></body></html>`;
}
export function renderSalesLander(
  value: PublishedSale,
  base: string,
  sitekey: string | null,
  options: {
    privacyUrl?: string;
    preview?: boolean;
    error?: string;
    fields?: Record<string, string>;
    inquiryPath?: string;
    revisionConflict?: boolean;
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
      ? `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=salesChallengeReady" defer></script><form method="post" action="${e(options.inquiryPath ?? `${base}/d/${s.domain}/inquiries`)}"><input type="hidden" name="observedRevision" value="${e(s.revision)}"><input type="hidden" name="idempotencyKey" value="${crypto.randomUUID()}"><div class="contact-fields"><div><label for="name">Name</label><input id="name" name="name" value="${e(fields.name)}" maxlength="100" autocomplete="name" required></div><div><label for="email">Email</label><input aria-describedby="email-hint" id="email" name="email" value="${e(fields.email)}" type="email" maxlength="254" autocomplete="email" required></div></div><p class="email-hint" id="email-hint">Use an address where you can receive our confirmation email.</p>${s.mode === 'offer' ? `<label for="offer">Your offer (${e(offerCurrency)})</label><input id="offer" name="amount" value="${e(fields.amount)}" inputmode="numeric" pattern="[1-9][0-9]{0,11}"><input type="hidden" name="currency" value="${e(offerCurrency)}">${s.publicMinimumOffer ? `<p class="note">Offers start at ${e(salePriceLabel(s.publicMinimumOffer))}. You can still ask a question.</p>` : ''}` : ''}<label for="message">Message${s.mode === 'offer' ? ' (optional with an offer)' : ''}</label><textarea placeholder="What would you like to know about this domain?" id="message" name="message" maxlength="4000" ${s.mode === 'offer' ? '' : 'required'}>${e(fields.message)}</textarea><div class="hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div><div class="cf-turnstile" data-sitekey="${e(sitekey)}" data-action="sales-inquiry"></div><p class="note" data-challenge-status role="status">Complete the security check to send.</p>${s.mode === 'offer' ? '<button data-challenge-submit disabled name="intent" value="offer">Send offer</button> ' : ''}${question ? `<button data-challenge-submit disabled name="intent" value="question"${s.mode === 'offer' ? ' class="secondary"' : ''}>${s.mode === 'offer' ? 'Ask a question' : 'Send inquiry'}</button>` : ''}<p class="note">Next: confirm your email, then continue the conversation. Sending an inquiry does not commit you to a purchase. <a href="${e(options.privacyUrl ?? 'https://domains.domains/privacy')}" rel="noreferrer">Privacy Policy</a>.</p></form>`
      : `<p class="note">${options.preview ? 'Preview only. Inquiry submission is disabled here.' : 'Direct inquiries are temporarily unavailable.'}</p>`;
  return salesPage(
    s.domain,
    `${options.preview ? '<p class="error">Private preview · Saved draft · Domain setup is separate</p>' : ''}<div class="layout"><section><span class="eyebrow">Domain inquiries</span><h1 class="domain-title">${e(s.displayName).replaceAll('.', '.<wbr>')}</h1>${s.displayName !== s.domain ? `<p class="note">${e(s.domain)}</p>` : ''}<p class="description">${e(s.description)}</p>${s.sellerDisplayName ? `<p class="note">Contact ${e(s.sellerDisplayName)}</p>` : ''}</section><section class="panel" aria-label="Domain inquiry">${options.error ? `<p role="alert" ${options.revisionConflict ? 'data-sales-revision-conflict="true"' : ''} class="error">${e(options.error)}</p>` : ''}<h2>${s.mode === 'offer' ? 'Make an offer' : s.mode === 'inquiry' ? 'Get in touch' : 'Your next step'}</h2><p class="price">${e(salePriceLabel(s.publicPrice))}</p>${destination && ['buy-now', 'external'].includes(s.mode) ? `<a class="cta" href="${e(destination)}" rel="noreferrer noopener">Continue to ${e(s.destination!.provider)}</a><p class="note">Payment and transfer handled by ${e(s.destination!.provider)}. Terms and any additional charges are shown there. ${s.destination!.check === 'manual' ? 'Owner-provided link; availability is checked by the provider.' : ''}</p>` : ''}${question || s.mode === 'offer' ? (['buy-now', 'external'].includes(s.mode) ? `<details><summary style="min-height:44px;padding:12px 0;cursor:pointer">Ask a question</summary>${form}</details>` : form) : ''}</section></div><div class="steps"><p><strong>1. Send your inquiry</strong><br>Tell us what you would like to know.</p><p><strong>2. Confirm your email</strong><br>Open the confirmation email to start the conversation.</p><p><strong>3. Continue by email</strong><br>Reply from your inbox. Your messages stay in the conversation.</p></div>`,
    !options.preview,
  );
}
