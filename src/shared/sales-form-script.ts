/** Fetch preserves the Origin signal under no-referrer; capabilities never enter analytics. */
export const salesFormScript = `document.addEventListener('input',event=>{const field=event.target;if(field instanceof HTMLInputElement||field instanceof HTMLTextAreaElement){if(['name','email','message','amount'].includes(field.name)){const key=field.form?.querySelector('input[name=idempotencyKey]');if(key)key.value=crypto.randomUUID();}}});document.addEventListener('submit',async event=>{
  const form=event.target;
  if(!(form instanceof HTMLFormElement)||form.method.toLowerCase()!=='post')return;
  event.preventDefault();
  if(form.dataset.sending)return;
  form.dataset.sending='true';
  const submitter=event.submitter;
  const body=new FormData(form,submitter instanceof HTMLElement?submitter:undefined);
  const buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
  try{
    const response=await fetch(form.action,{method:'POST',body,credentials:'omit',mode:'cors',referrerPolicy:'no-referrer'});
    const html=await response.text();
    const page=new DOMParser().parseFromString(html,'text/html');
    if(response.status===409&&page.querySelector('[data-sales-revision-conflict]')){const main=document.querySelector('main');if(main){main.replaceChildren(...page.querySelector('main').childNodes);const widget=main.querySelector('.cf-turnstile');if(widget&&window.turnstile){widget.id='sales-challenge-'+crypto.randomUUID();window.turnstile.render('#'+widget.id,{sitekey:widget.dataset.sitekey,action:'sales-inquiry'});}main.querySelector('[role=alert]')?.scrollIntoView();}return;}
    if(!response.ok){
      let alert=form.querySelector('[role=alert]');if(!alert){alert=document.createElement('p');alert.setAttribute('role','alert');alert.className='error';form.prepend(alert);}
      alert.textContent=page.querySelector('[role=alert]')?.textContent||page.querySelector('main')?.textContent||page.body.textContent?.slice(0,300)||'Please check your message and try again.';
      window.turnstile?.reset();
    }else{
      document.title=page.title;
      const main=document.querySelector('main');if(main)main.replaceChildren(...page.querySelector('main').childNodes);
      if(response.redirected&&new URL(response.url).origin===location.origin)history.replaceState(null,'',response.url);
      document.querySelector('h1')?.scrollIntoView();
    }
  }catch{
    let alert=form.querySelector('[role=alert]');if(!alert){alert=document.createElement('p');alert.setAttribute('role','alert');form.prepend(alert);}
    alert.textContent='Connection interrupted. Your message is still here. Retry to recover the same receipt.';
    window.turnstile?.reset();
  }finally{delete form.dataset.sending;buttons.forEach(b=>b.disabled=false);}
});`;

// This fingerprints a public asset for cache invalidation; it is not a security token.
const assetHash = (seed: number) =>
  Array.from(salesFormScript)
    .reduce(
      (hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0,
      seed,
    )
    .toString(16)
    .padStart(8, '0');
export const salesFormScriptPath =
  '/sales-public-' + assetHash(2166136261) + assetHash(2246822519) + '.js';
