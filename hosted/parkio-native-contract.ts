export interface ParkioNativeSnapshot {
  kind:
    | 'credentials'
    | 'verification'
    | 'candidate'
    | 'challenge'
    | 'waiting'
    | 'unqualified';
  origin: string;
  path: string;
  rejected: boolean;
  active: boolean;
  orders: string | null;
  activeOrders: string | null;
  nativeAttemptId: string | null;
}

/** Constant browser code. Never returns input values, cookies, page text or credentials. */
export const parkioNativeSnapshot = `(() => {
  const origin=location.origin,path=location.pathname;
  let nativeAttemptId=null;try{nativeAttemptId=sessionStorage.getItem('domains-native-attempt');}catch{}
  const result={origin,path,rejected:false,active:false,orders:null,activeOrders:null,nativeAttemptId};
  if(location.href==='about:blank')return {...result,kind:'waiting'};
  if(origin!=='https://park.io')return {...result,kind:'unqualified'};
  if(globalThis.__domainsNativeLoginPending)return {...result,kind:'waiting'};
  if(document.readyState!=='complete')return {...result,kind:'waiting'};
  const visible=e=>!!e&&!!e.getClientRects().length&&!e.disabled;
  if([...document.querySelectorAll('iframe[src*="captcha"],iframe[src*="challenges.cloudflare"],.g-recaptcha,.h-captcha')].some(visible))return {...result,kind:'challenge'};
  const forms=[...document.forms].filter(f=>{const u=new URL(f.action||location.href);return u.origin===origin&&f.method.toLowerCase()==='post'});
  const login=forms.filter(f=>new URL(f.action).pathname==='/users/login'&&visible(f.querySelector('input[name="username"]'))&&visible(f.querySelector('input[name="password"][type="password"]')));
  result.rejected=[...document.querySelectorAll('.error-message,.alert-error,.alert-danger,#flashMessage,.message.error')].some(e=>visible(e)&&(e.textContent||'').trim().length>0);
  if(login.length===1&&path==='/users/login'){
    if(result.rejected){try{sessionStorage.removeItem('domains-native-attempt');}catch{}result.nativeAttemptId=null;}
    return {...result,kind:'credentials'};
  }
  const verification=forms.filter(f=>/^\\/users\\/(?:login|authy|verify|verify_authy)\\/?$/.test(new URL(f.action).pathname)).flatMap(f=>[...f.querySelectorAll('input')].filter(e=>visible(e)&&['text','tel','number'].includes(e.type)&&/^(?:code|token|otp|authy_token|authy-token|verification_code)$/i.test(e.name)));
  if(verification.length===1)return {...result,kind:'verification'};
  const links=[...document.querySelectorAll('a[href]')];
  const label=e=>(e.textContent||'').trim().replace(/\\s+/g,' ');
  result.orders=links.find(e=>/^orders(?:\\s*\\(?\\d+\\)?)?$/i.test(label(e)))?.href||null;
  const active=links.filter(e=>/^active(?: orders)?(?:\\s*\\(?\\d+\\)?)?$/i.test(label(e)));
  const activeHrefs=[...new Set(active.map(e=>e.href))];
  result.activeOrders=activeHrefs.length===1?activeHrefs[0]:null;
  result.active=/\\/orders(?:\\/index)?\\/active\\/?$/.test(path)||active.some(e=>e.matches('.active,.selected,[aria-current="page"]')||e.closest('li.active,li.selected,.tab.active'))||[...document.querySelectorAll('h1,h2')].some(e=>/^active orders$/i.test(label(e)));
  if(!document.querySelector('input[type="password"]')&&(/^\\/orders(?:\\/|$)/.test(path)||result.orders))return {...result,kind:'candidate'};
  return {...result,kind:'unqualified'};
})()`;

/** Uses the original provider form, retaining its CSRF fields and submission behavior. */
export const parkioNativeLogin = `function(username,password,attemptId) {
  if(location.origin!=='https://park.io'||location.pathname!=='/users/login')return {ok:false};
  if(typeof username!=='string'||!username||username.length>254||typeof password!=='string'||!password||password.length>1024)return {ok:false};
  const visible=e=>!!e&&!!e.getClientRects().length&&!e.disabled;
  const forms=[...document.forms].filter(f=>{const u=new URL(f.action||location.href);return u.origin===location.origin&&u.pathname==='/users/login'&&!u.search&&f.method.toLowerCase()==='post'&&visible(f.querySelector('input[name="username"]'))&&visible(f.querySelector('input[name="password"][type="password"]'))});
  if(forms.length!==1)return {ok:false};
  const form=forms[0],u=form.querySelectorAll('input[name="username"]'),p=form.querySelectorAll('input[name="password"][type="password"]');
  if(u.length!==1||p.length!==1)return {ok:false};
  for(const [field,value] of [[u[0],username],[p[0],password]]){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));}
  const submit=form.querySelector('input[type="submit"][name="signin"],button[type="submit"]');
  if(typeof attemptId==='string'&&/^[a-f0-9-]{36}$/.test(attemptId))sessionStorage.setItem('domains-native-attempt',attemptId);
  globalThis.__domainsNativeLoginPending=true;
  if(submit)form.requestSubmit(submit);else form.requestSubmit();
  return {ok:true};
}`;

export const parkioNativeVerification = `function(code) {
  if(location.origin!=='https://park.io'||typeof code!=='string'||!/^\\d{4,10}$/.test(code))return {ok:false};
  const visible=e=>!!e&&!!e.getClientRects().length&&!e.disabled;
  const forms=[...document.forms].filter(f=>{const u=new URL(f.action||location.href);return u.origin===location.origin&&/^\\/users\\/(?:login|authy|verify|verify_authy)\\/?$/.test(u.pathname)&&!u.search&&f.method.toLowerCase()==='post'});
  const fields=forms.flatMap(f=>[...f.querySelectorAll('input')].filter(e=>visible(e)&&['text','tel','number'].includes(e.type)&&/^(?:code|token|otp|authy_token|authy-token|verification_code)$/i.test(e.name)).map(e=>({form:f,field:e})));
  if(fields.length!==1)return {ok:false};
  const {form,field}=fields[0];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,code);field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));globalThis.__domainsNativeLoginPending=true;form.requestSubmit();return {ok:true};
}`;

/** Only observed read-only Orders navigation; never an arbitrary page action. */
export function parkioOrdersPage(value: string): string {
  const url = new URL(value);
  if (
    url.origin !== 'https://park.io' ||
    url.username ||
    url.password ||
    url.hash ||
    !/^\/orders(?:\/(?:index|active)){0,2}\/?$/.test(url.pathname) ||
    [...url.searchParams].some(
      ([key, val]) =>
        !['status', 'filter', 'type', 'page', 'active'].includes(key) ||
        !/^[-a-zA-Z0-9_]{1,40}$/.test(val),
    ) ||
    url.href.length > 512
  )
    throw new Error('Active Orders navigation is not qualified');
  return url.href;
}
