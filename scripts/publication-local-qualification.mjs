// Local-only synthetic integration harness. Never uses remote DBs or registrar APIs.
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dombot-sales-qa-'));
const root = process.cwd();
const fixtureEntry = `
export { aesGcmCipher, EncryptedDocStore } from '${root}/src/core/storage/encrypted';
export { D1DocStore } from '${root}/src/worker/storage/d1-doc-store';
export { deriveEncryptionKey } from '${root}/src/worker/keys';
export { SalesStore } from '${root}/src/worker/sales-store';
export { SalesInquiryStore } from '${root}/src/worker/sales-inquiry-store';
export { sourcePriceFingerprint } from '${root}/src/core/publication/sales';
export { PublicationStore } from '${root}/src/worker/publication-store';
export { emptyOwnerSite, convertOwnerSiteV3, selectedSite } from '${root}/src/shared/owner-site';
export { emptySale } from '${root}/src/shared/sales';
`;
await build({
  stdin: { contents: fixtureEntry, resolveDir: root, loader: 'ts' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: path.join(temp, 'fixture.mjs'),
  logLevel: 'silent',
});
const fixture = await import(path.join(temp, 'fixture.mjs'));
const script = (
  await build({
    stdin: {
      contents: `import worker from '${root}/node_modules/@domains-domains/dombot-engine/engine.mjs';import{SalesStore}from'${root}/src/worker/sales-store';import{SalesInquiryStore}from'${root}/src/worker/sales-inquiry-store';import{renderSalesEmail}from'${root}/src/shared/sales-email';import{salesEscape}from'${root}/src/shared/render-sales-lander';import{signGatewayRequest}from'${root}/src/shared/gateway-proof';import{salesPublicPath}from'${root}/src/shared/sales-admission';export default {async fetch(r,e,c){
        if(new URL(r.url).pathname==='/__qa/mail'){const store=await SalesStore.from(e);const rows=await e.DB.prepare('SELECT id,kind,sealed,lead_id,message_id FROM sales_outbox ORDER BY updated_at DESC LIMIT 20').all();const links=[];for(const row of rows.results){const mail=JSON.parse(await store.cipher.open(row.sealed));if(new URL(r.url).searchParams.get('view')===row.id){const inbox=new SalesInquiryStore(store,e.DOMBOT_SALES_ORIGIN);const content=renderSalesEmail({...mail,context:await inbox.emailContext(row.lead_id,row.message_id)},row.kind);return new Response(content.html,{headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store'}});}links.push('<p>'+salesEscape(row.kind)+' · <a href="'+salesEscape(mail.url.replace('https://fixture.example',new URL(r.url).origin))+'">Open simulated mail link</a> · <a href="?view='+row.id+'">Preview complete email</a></p>');}return new Response('<!doctype html><html><body><h1>Local synthetic mail log</h1><p>No email was sent. These are local fixture capabilities.</p>'+links.join('')+'</body></html>',{headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});}
        const url=new URL(r.url);const prefix='/w/'+e.DOMBOT_WORKSPACE_ID;if(url.pathname.startsWith(prefix+'/'))url.pathname=url.pathname.slice(prefix.length);const headers=new Headers(r.headers);headers.set('cf-connecting-ip','127.0.0.1');const request=new Request(url,{method:r.method,headers,body:['GET','HEAD'].includes(r.method)?undefined:r.body});const publicRequest=salesPublicPath(url.pathname,r.method);request.headers.set('x-dombot-gateway-proof',await signGatewayRequest(e.DOMBOT_GATEWAY_SECRET,e.DOMBOT_WORKSPACE_ID,publicRequest?null:'local-synthetic-owner',request,publicRequest?{purpose:'sales-public',host:url.hostname,listing:null,epoch:0}:(url.pathname.startsWith('/sales/')||url.pathname.startsWith('/publishing/change-sets'))?{purpose:'sales-owner',recipientVerified:true}:undefined));return worker.fetch(request,e,c);
      },scheduled:worker.scheduled};`,
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    external: ['cloudflare:*'],
    logLevel: 'silent',
  })
).outputFiles[0].text;
const rootKey = new Uint8Array(32).fill(19);
const base = 'http://127.0.0.1:8795';
const mf = new Miniflare(
  convertV4MiniflareOptions({
    port: 8795,
    host: '127.0.0.1',
    cf: false,
    workers: [
      {
        name: 'sales-local-qa',
        modules: true,
        script,
        compatibilityDate: '2026-10-08',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: ['DB'],
        bindings: {
          DOMBOT_AUTH: 'gateway',
          DOMBOT_GATEWAY_SECRET: 'local-qualification-only-gateway-key-local',
          DOMBOT_WORKSPACE_ID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          DOMBOT_PUBLIC_BASE_PATH: '/w/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          DOMBOT_SECRET: btoa(String.fromCharCode(...rootKey)),
          DOMBOT_SALES_V1: 'true',
          DOMBOT_OWNER_SITE_V2: 'true',
          DOMBOT_OWNER_SITE_V3: 'true',
          DOMBOT_COMPOSITE_PUBLISH: 'true',
          SALES_INQUIRIES_ENABLED: 'true',
          SALES_PRIVACY_REVIEWED: 'true',
          SALES_MAIL_ENABLED: 'true',
          DOMBOT_SALES_ORIGIN:
            'https://fixture.example/w/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          SALES_TURNSTILE_SITEKEY: '1x00000000000000000000AA',
          SALES_TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
        },
        serviceBindings: {
          ASSETS: async (request) => {
            const url = new URL(request.url);
            const file = url.pathname.startsWith('/assets/')
              ? path.join(
                  root,
                  'node_modules/@domains-domains/dombot-engine/web',
                  path.basename(path.dirname(url.pathname)),
                  path.basename(url.pathname),
                )
              : path.join(
                  root,
                  'node_modules/@domains-domains/dombot-engine/web/index.html',
                );
            try {
              return new Response(await fs.readFile(file), {
                headers: {
                  'Content-Type': file.endsWith('.js')
                    ? 'text/javascript'
                    : file.endsWith('.css')
                      ? 'text/css'
                      : 'text/html',
                },
              });
            } catch {
              return new Response('Not found', { status: 404 });
            }
          },
        },
        outboundService: async (request) =>
          new URL(request.url).hostname === 'challenges.cloudflare.com'
            ? Response.json({
                success: true,
                hostname: '127.0.0.1',
                action: 'sales-inquiry',
              })
            : new Response('Local fixture denies external provider requests', {
                status: 503,
              }),
      },
    ],
  }),
);
const db = await mf.getD1Database('DB');
for (const file of (await fs.readdir('migrations')).sort())
  await db.exec(
    (await fs.readFile('migrations/' + file, 'utf8'))
      .replace(/^--.*$/gm, '')
      .replace(/\n/g, ' '),
  );
const store = new fixture.EncryptedDocStore(
  new fixture.D1DocStore(db),
  await fixture.aesGcmCipher(await fixture.deriveEncryptionKey(rootKey)),
);
const now = Date.now();
const accountId = '11111111-2222-4333-8444-555555555555';
await store.put('registrar-accounts', accountId, {
  id: accountId,
  registrar: 'dynadot',
  label: 'Sample QA registrar',
});
await store.put('registrar-credentials', accountId, {
  apiKey: 'SAMPLE-NONFUNCTIONAL-KEY',
  apiSecret: 'SAMPLE-NONFUNCTIONAL-SECRET',
});
const names = [
  'canopy.example',
  'ledger.example',
  'parcel.example',
  'private.example',
  ...(process.argv.includes('--large')
    ? Array.from(
        { length: 1000 },
        (_, i) => 'sample' + String(i).padStart(3, '0') + '.example',
      )
    : []),
];
await store.put('registrar-domains', accountId, {
  fetchedAt: now,
  data: {
    lastSyncedAt: now,
    lastError: null,
    domains: names.map((domainName) => ({
      domainName,
      registrar: 'dynadot',
      accountId,
      notes: 'SAMPLE_PRIVATE_NOTE',
      renewal: 15,
    })),
  },
});
await store.put('settings', 'autoSyncIntervalMinutes', 0);
await store.put('settings', 'autoFetchRenewalPrices', false);
const price = {
  amount: '14800',
  currency: 'USD',
  updatedAt: now,
  floor: '8000',
};
await store.put('domain-list-prices', 'canopy.example', price);
const sales = await fixture.SalesStore.from({
  DB: db,
  DOMBOT_SECRET: btoa(String.fromCharCode(...rootKey)),
});
for (const domain of names.filter((name) =>
  ['canopy.example', 'ledger.example', 'parcel.example'].includes(name),
)) {
  const draft = {
    ...fixture.emptySale(
      domain,
      fixture.sourcePriceFingerprint(
        domain === 'canopy.example' ? price : null,
      ),
    ),
    description:
      'Sample data for local sales qualification. No domain, message, payment or DNS changes are real.',
    sellerDisplayName: 'Sample owner',
    mode: domain === 'ledger.example' ? 'offer' : 'inquiry',
  };
  const revision = await sales.save(draft, null);
  if (domain === 'canopy.example') {
    const observe = () => ({
      price,
      ownershipFingerprint: 'fixture-control',
      controlExpiresAt: now + 86400_000,
      available: true,
      reason: null,
    });
    const review = await sales.prepare([{ id: draft.id, revision }], observe);
    await sales.publish(review.id, observe);
  }
}
const profile = fixture.emptyOwnerSite();
profile.profile.name = 'Sample publishing owner';
profile.profile.intro =
  'Local synthetic qualification. No customer holdings or messages.';
profile.collections = [
  {
    id: 'selected',
    slug: 'selected',
    title: 'Sample selection',
    intro: 'Only exact reviewed names appear.',
    domainIds: [],
  },
];
const publication = new fixture.PublicationStore(
  db,
  await fixture.aesGcmCipher(await fixture.deriveEncryptionKey(rootKey)),
);
await publication.save(profile, null);
console.log(
  JSON.stringify({
    localOnly: true,
    sampleData: true,
    url: base + '/w/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/#/public-page',
    network:
      'Provider requests denied; Turnstile response is a local fixture; no mail transport',
  }),
);
process.on('SIGINT', async () => {
  await mf.dispose();
  process.exit(0);
});
await new Promise(() => {});
