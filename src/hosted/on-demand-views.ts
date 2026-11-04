import {
  CONNECTION_RESULT_HEADER,
  CONNECTION_RESULT_CONTRACT,
} from '../shared/connection-contract';
import { registrars, type RegistrarName } from '@aoxborrow/registrar-client';
import { escapeHtml as e, page } from './views';
import { REGISTRAR_HELP } from '../shared/registrar-help';
import { MARKET_CREDENTIAL_FIELDS } from '../shared/market-credentials';
import type { MarketId } from '../shared/markets';

export const onboardingScriptPath = '/auth/portfolio-start.js';
export const onboardingScript = `
for(const form of document.querySelectorAll('[data-first-market]')){form.addEventListener('submit',async event=>{event.preventDefault();if(!form.reportValidity())return;const button=form.querySelector('button'),status=form.querySelector('[role=status]');button.disabled=true;status.textContent='Preparing your portfolio and connecting marketplace…';try{const credentials=Object.fromEntries(new FormData(form));const response=await fetch(form.action,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({args:[form.dataset.market,credentials]})});const result=await response.json();if(!response.ok)throw Error(result.error||'Connection could not complete. Please retry.');location.assign(form.dataset.base+'/#/settings?tab=markets');}catch(error){status.textContent=error.message;button.disabled=false;}});}
const form=document.querySelector('[data-first-registrar]');
if(form){
 const select=form.querySelector('select[name=registrar]'),status=form.querySelector('[role=status]'),button=form.querySelector('button[type=submit]');
 const update=()=>{for(const group of form.querySelectorAll('fieldset[data-registrar]')){const active=group.dataset.registrar===select.value;group.hidden=!active;group.disabled=!active;}};
 select.addEventListener('change',update);update();button.disabled=false;
 form.addEventListener('submit',async event=>{event.preventDefault();if(!form.reportValidity())return;button.disabled=true;status.textContent='Preparing your private portfolio and connecting your registrar…';
  const fields=new FormData(form),creds={};for(const [name,value]of fields){if(name.startsWith(select.value+'.'))creds[name.slice(select.value.length+1)]=value;}
  try{const response=await fetch(form.action,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','${CONNECTION_RESULT_HEADER}':'${CONNECTION_RESULT_CONTRACT}'},body:JSON.stringify({args:[select.value,creds]})});const result=await response.json();if(!response.ok)throw Error(result.error||'Connection could not complete. Please retry.');if(result.result?.success!==true){const failure=result.result;throw Object.assign(Error(failure?.message||'Connection could not complete. Please retry.'),{status:failure?.status});}location.assign(form.dataset.base+'/');}
  catch(error){status.textContent=select.value==='dynadot'&&(error.status===401||/401.*Unauthorized/i.test(error.message))?'Dynadot has not accepted this key yet. New keys may take a few minutes to activate. Wait a little, then retry. Your entries are still here.':error.message;button.disabled=false;}
 });
}`;

export function validFirstConnection(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const args = Reflect.get(value, 'args');
  if (
    !Array.isArray(args) ||
    args.length < 2 ||
    args.length > 4 ||
    typeof args[0] !== 'string' ||
    !Object.hasOwn(registrars, args[0])
  )
    return false;
  if (
    (args[2] !== undefined &&
      (typeof args[2] !== 'string' || args[2].length > 120)) ||
    (args[3] !== undefined && typeof args[3] !== 'boolean')
  )
    return false;
  const provider = registrars[args[0] as RegistrarName],
    creds = args[1];
  if (
    !creds ||
    typeof creds !== 'object' ||
    Array.isArray(creds) ||
    Object.values(creds).some((v) => typeof v !== 'string' || v.length > 4096)
  )
    return false;
  return provider.configFields.every(
    (field) =>
      !field.required ||
      (typeof creds[field.name] === 'string' &&
        creds[field.name].trim().length > 0),
  );
}

/** The gateway renders this page without allocating or dispatching a tenant. */
export function portfolioStart(id: string, error = '', managedIp = '') {
  const base = '/w/' + id;
  const marketForms = Object.entries(MARKET_CREDENTIAL_FIELDS)
    .map(
      ([market, fields]) =>
        `<form method="post" action="${base}/api/connectMarketAccount" data-first-market data-market="${market}" data-base="${base}"><h2>Connect ${e(market === 'afternic' ? 'Afternic' : market === 'atom' ? 'Atom' : 'Sedo')}</h2>${fields.map((field) => `<label>${e(field.label)}<input name="${e(field.name)}" type="${field.type === 'password' ? 'password' : 'text'}" autocomplete="off" maxlength="4096" ${field.required ? 'required' : ''}></label>`).join('')}<button type="submit">Connect marketplace</button><p role="status" aria-live="polite"></p></form>`,
    )
    .join('');
  const catalog = Object.entries(registrars).map(([name, Provider]) => ({
    name,
    Provider,
    help: REGISTRAR_HELP[name as RegistrarName],
  }));
  return page(
    'Start your portfolio',
    `<style>.onboarding select{font:inherit;width:100%;padding:12px;border:1px solid var(--line);border-radius:6px;background:white;color:var(--ink)}.onboarding fieldset{border:0;padding:0;margin:0;min-width:0}.onboarding fieldset[hidden]{display:none}</style><section class="account onboarding"><span class="eyebrow">Your private portfolio</span><h1>Add your first domains.</h1><p>Connect a registrar to bring in your domains and renewal dates, or import your own list.</p>${error ? `<p class="error" role="alert">${e(error)}</p>` : ''}<form action="${base}/api/connectRegistrarAccount" data-first-registrar data-base="${base}" method="post"><h2>Connect your first registrar</h2><label>Registrar<select name="registrar">${catalog.map(({ name, Provider }) => `<option value="${e(name)}">${e(Provider.displayName)}</option>`).join('')}</select></label>${catalog.map(({ name, Provider, help }) => `<fieldset data-registrar="${e(name)}" ${name !== catalog[0].name ? 'hidden disabled' : ''}><p>${e(help.summary)}</p>${help.hostedNotice ? `<p class="notice">${e(help.hostedNotice)}</p>` : ''}${help.links.map((link) => `<p><a target="_blank" rel="noopener noreferrer" href="${e(link.url)}">${e(link.label)} ↗</a></p>`).join('')}${name === 'namecheap' && managedIp ? `<p class="notice">Allowlist ${e(managedIp)} in your Namecheap API settings before connecting.</p>` : ''}${Provider.configFields.map((field) => `<label>${e(field.label)}<input name="${e(name + '.' + field.name)}" type="${field.type === 'password' ? 'password' : 'text'}" autocomplete="off" spellcheck="false" maxlength="4096" value="${name === 'namecheap' && field.name === 'clientIp' ? e(managedIp) : ''}" ${field.required ? 'required' : ''}></label>`).join('')}</fieldset>`).join('')}<button type="submit" disabled>Connect registrar</button><p role="status" aria-live="polite"></p><noscript><p>Enable JavaScript to connect your registrar.</p></noscript><p class="note">Your API credentials stay out of your sign-in records. They are saved in your private portfolio only after the connection succeeds.</p></form><p><a href="${base}/import">Import a domain list</a></p><p class="note">Review your CSV or pasted list before saving. Imported domains stay private.</p><details><summary>Connect a marketplace instead</summary><p>Use your existing marketplace account to bring in its listings and sales.</p>${marketForms}</details><p><a href="/account">Account settings</a></p></section>`,
  ).replace(
    '</head>',
    `<script type="module" src="${onboardingScriptPath}"></script></head>`,
  );
}

export function validFirstMarketConnection(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const args = Reflect.get(value, 'args');
  if (
    !Array.isArray(args) ||
    args.length < 2 ||
    args.length > 3 ||
    typeof args[0] !== 'string' ||
    !Object.hasOwn(MARKET_CREDENTIAL_FIELDS, args[0])
  )
    return false;
  if (
    args[2] !== undefined &&
    (typeof args[2] !== 'string' || args[2].length > 100)
  )
    return false;
  const fields = MARKET_CREDENTIAL_FIELDS[args[0] as MarketId],
    creds = args[1];
  if (
    !creds ||
    typeof creds !== 'object' ||
    Array.isArray(creds) ||
    Object.values(creds).some((v) => typeof v !== 'string' || v.length > 4096)
  )
    return false;
  return fields.every(
    (field) =>
      !field.required ||
      (typeof creds[field.name] === 'string' &&
        creds[field.name].trim().length > 0),
  );
}
