// Preserve the exact previous public asset while tenant coordinators drain
// their old release during rollout. Source: 937472d09a6fbfecda30d13481c5ac20aa158a7c.
/** Fetch preserves the Origin signal under no-referrer; capabilities never enter analytics. */
export const legacySalesFormScript = `const narrowChallenge=window.matchMedia('(max-width:380px)');
window.salesChallengeState=(form,ready)=>{form?.querySelectorAll('[data-challenge-submit]').forEach(button=>button.disabled=!ready);const status=form?.querySelector('[data-challenge-status]');if(status)status.textContent=ready?'Ready to send.':'Complete the security check to send.';};
window.salesChallengeReady=()=>{if(!window.turnstile)return;document.querySelectorAll('.cf-turnstile').forEach(widget=>{if(widget.dataset.widgetId)return;const form=widget.closest('form');window.salesChallengeState(form,false);widget.dataset.widgetId=window.turnstile.render(widget,{sitekey:widget.dataset.sitekey,action:'sales-inquiry',size:narrowChallenge.matches?'compact':'flexible',callback:()=>window.salesChallengeState(form,true),'expired-callback':()=>window.salesChallengeState(form,false),'error-callback':()=>window.salesChallengeState(form,false)});});};
narrowChallenge.addEventListener('change',()=>{if(!window.turnstile)return;document.querySelectorAll('.cf-turnstile').forEach(widget=>{window.salesChallengeState(widget.closest('form'),false);if(widget.dataset.widgetId)window.turnstile.remove(widget.dataset.widgetId);delete widget.dataset.widgetId;});window.salesChallengeReady();});
document.addEventListener('input',event=>{const field=event.target;if(field instanceof HTMLInputElement||field instanceof HTMLTextAreaElement){if(['name','email','message','amount'].includes(field.name)){const key=field.form?.querySelector('input[name=idempotencyKey]');if(key)key.value=crypto.randomUUID();}}});document.addEventListener('submit',async event=>{
  const form=event.target;
  if(!(form instanceof HTMLFormElement)||form.method.toLowerCase()!=='post')return;
  event.preventDefault();
  if(form.dataset.sending)return;
  form.dataset.sending='true';
  const submitter=event.submitter;
  const body=new FormData(form,submitter instanceof HTMLElement?submitter:undefined);
  const buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
  const progress=document.createElement('p');progress.setAttribute('role','status');progress.className='note';progress.textContent=submitter?.textContent?.includes('Confirm')?'Confirming your email…':'Sending your message…';form.append(progress);
  try{
    const response=await fetch(form.action,{method:'POST',body,credentials:'omit',mode:'cors',referrerPolicy:'no-referrer'});
    const html=await response.text();
    const page=new DOMParser().parseFromString(html,'text/html');
    if(response.status===409&&page.querySelector('[data-sales-revision-conflict]')){const main=document.querySelector('main');if(main){main.replaceChildren(...page.querySelector('main').childNodes);window.salesChallengeReady();main.querySelector('[role=alert]')?.scrollIntoView();}return;}
    if(!response.ok){
      let alert=form.querySelector('[role=alert]');if(!alert){alert=document.createElement('p');alert.setAttribute('role','alert');alert.className='error';form.prepend(alert);}
      alert.textContent=page.querySelector('[role=alert]')?.textContent||page.querySelector('main')?.textContent||page.body.textContent?.slice(0,300)||'Please check your message and try again.';
      window.salesChallengeState(form,false);window.turnstile?.reset();
    }else{
      document.title=page.title;
      const main=document.querySelector('main');if(main)main.replaceChildren(...page.querySelector('main').childNodes);
      if(response.redirected&&new URL(response.url).origin===location.origin)history.replaceState(null,'',response.url);
      const heading=document.querySelector('h1');if(heading){heading.tabIndex=-1;heading.focus();heading.scrollIntoView();}
    }
  }catch{
    let alert=form.querySelector('[role=alert]');if(!alert){alert=document.createElement('p');alert.setAttribute('role','alert');form.prepend(alert);}
    alert.textContent='Connection interrupted. Your message is still here. Retry to recover the same receipt.';
    window.salesChallengeState(form,false);window.turnstile?.reset();
  }finally{progress.remove();delete form.dataset.sending;buttons.forEach(b=>b.disabled=b.hasAttribute('data-challenge-submit')&&!form.querySelector('input[name="cf-turnstile-response"]')?.value);}
});`;

// This fingerprints a public asset for cache invalidation; it is not a security token.
const assetHash = (seed: number) =>
  Array.from(legacySalesFormScript)
    .reduce(
      (hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0,
      seed,
    )
    .toString(16)
    .padStart(8, '0');
export const legacySalesFormScriptPath =
  '/sales-public-' + assetHash(2166136261) + assetHash(2246822519) + '.js';
