import { readFileSync, readdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Accounts } from './accounts';
import { readCheckoutCase } from './checkout-case-reader';
import {
  checkoutRoutes,
  reconcileStagingCheckout,
  stagingBuyerCheckout,
} from './checkout-routes';
import { CheckoutReservations } from './checkout-reservations';
import { CheckoutSimulatorProvider } from './checkout-simulator-provider';
import { SalesInquiryStore } from '../worker/sales-inquiry-store';
import { SalesStore, readPublicSale } from '../worker/sales-store';
import { emptySale } from '../shared/hosted-sales';
import { PublicDomainDirectory } from './public-domain-directory';

const origin = 'https://domains-checkout-qa-abcdef01.fixture.workers.dev';
const workspace = crypto.randomUUID();
const seller = crypto.randomUUID();
const key = 'synthetic-gateway-for-checkout'.repeat(3);
const simulatorKey = 'synthetic-escrow-for-checkout'.repeat(3);
const price = { amount: '2400.05', currency: 'USD' };
const domain = 'checkout-fixture.example';
let mf: Miniflare;
let control: D1Database;
let db: D1Database;
let simulator: Fetcher;

beforeAll(async () => {
  const script = (
    await build({
      entryPoints: ['src/hosted/checkout-simulator-worker.ts'],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
    })
  ).outputFiles[0].text;
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script,
      cf: false,
      compatibilityDate: '2026-10-08',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: {
        CONTROL: 'checkout-flow-control',
        TENANT: 'checkout-flow-tenant',
      },
      durableObjects: {
        CHECKOUT_SIMULATOR_LEDGER: {
          className: 'CheckoutSimulatorLedger',
          useSQLite: true,
        },
      },
      bindings: { CHECKOUT_SIMULATOR_KEY: simulatorKey },
    }),
  );
  control = (await mf.getD1Database('CONTROL')) as unknown as D1Database;
  db = (await mf.getD1Database('TENANT')) as unknown as D1Database;
  simulator = (await mf.getWorker()) as unknown as Fetcher;
  for (const [target, directory] of [
    [control, 'hosted/migrations'],
    [db, 'migrations'],
  ] as const)
    for (const file of readdirSync(directory)
      .filter((file) => file.endsWith('.sql'))
      .sort())
      await target.exec(
        readFileSync(directory + '/' + file, 'utf8')
          .replace(/^--.*$/gm, '')
          .replace(/\n/g, ' '),
      );
}, 30000);
afterAll(async () => mf?.dispose());

it('binds two verified buyer cases to one seller approval winner and recovers a single signed provider session', async () => {
  const tenantEnv = {
    DB: db,
    DOMBOT_WORKSPACE_ID: workspace,
    DOMBOT_GATEWAY_SECRET: key,
    DOMBOT_SECRET: btoa('x'.repeat(32)),
  } as Env;
  const tenant = await SalesStore.from(tenantEnv);
  const inbox = new SalesInquiryStore(tenant, origin + '/w/' + workspace);
  const draft = {
    ...emptySale(domain, 'fixture'),
    mode: 'offer' as const,
    priceSource: { kind: 'override' as const, price, reason: 'Fixture price' },
  };
  const draftRevision = await tenant.save(draft, null);
  const observe = () => ({
    available: true,
    reason: null,
    price: null,
    ownershipFingerprint: 'fixture-only',
    controlExpiresAt: Date.now() + 3600000,
  });
  const review = await tenant.prepare(
    [{ id: draft.id, revision: draftRevision }],
    observe,
  );
  await tenant.publish(review.id, observe);
  const snapshot = (await readPublicSale(db, domain))!;
  const receipt = await Promise.all(
    [0, 1].map((n) =>
      inbox.intake(
        {
          idempotencyKey: crypto.randomUUID(),
          observedRevision: snapshot.revision,
          name: 'Synthetic buyer',
          email: 'buyer-' + n + '@fixture.invalid',
          offer: price,
          message: 'Synthetic checkout fixture',
          website: '',
          turnstileToken: 'fixture',
        },
        snapshot,
      ),
    ),
  );
  const grants = await inbox.lease();
  const thread = new Map<string, string>();
  for (const item of grants) {
    const grant = await inbox.confirm(
      new URL(item.mail.url).pathname.split('/').at(-1)!,
    );
    expect(grant).toBeTruthy();
    thread.set(item.leadId, grant!);
  }
  const accounts = new Accounts(control, 'synthetic-pepper'.repeat(3));
  const email = 'seller@fixture.invalid';
  await control.batch([
    control
      .prepare('INSERT INTO workspaces(id,label) VALUES(?,?)')
      .bind(workspace, 'Checkout QA'),
    control
      .prepare(
        'INSERT INTO users(id,email,workspace_id,password_hash,created_at) VALUES(?,?,?,?,?)',
      )
      .bind(seller, email, workspace, 'fixture-password-hash', Date.now()),
  ]);
  const directory = new PublicDomainDirectory(control);
  const current = await directory.reserve(workspace, {
    domain,
    listing: draft.id,
    revision: snapshot.revision,
  });
  await directory.settle(current, snapshot.revision);
  const token = await accounts.newSession({
    id: seller,
    email,
    workspace_id: workspace,
    label: 'Checkout QA',
    credentialHash: 'fixture-password-hash',
  });
  const env = {
    CONTROL_DB: control,
    CHECKOUT_STAGING_WORKSPACE: workspace,
    CHECKOUT_SIMULATOR: simulator,
    CHECKOUT_SIMULATOR_KEY: simulatorKey,
    CANONICAL_ORIGIN: origin,
    PUBLIC_REGISTRATION_ENABLED: 'false',
    WORKSPACES: JSON.stringify([
      { id: workspace, label: 'Checkout QA', binding: 'WORKSPACE_0' },
    ]),
    GATEWAY_KEYS: JSON.stringify({ [workspace]: key }),
    WORKSPACE_0: {
      fetch: (request: Request) => readCheckoutCase(request, tenantEnv),
    },
  } as unknown as HostedEnv;
  const app = checkoutRoutes((request) =>
    accounts.session(request.headers.get('X-Fixture-Owner') ?? undefined),
  );
  const post = (
    path: string,
    body: BodyInit,
    signedIn = false,
    custom: Record<string, string> = {},
    bindings = env,
  ) =>
    app.request(
      origin + '/checkout/staging/' + path,
      {
        method: 'POST',
        body,
        headers: {
          Origin: origin,
          'Content-Type':
            typeof body === 'string'
              ? 'application/json'
              : 'application/x-www-form-urlencoded',
          ...(signedIn ? { 'X-Fixture-Owner': token! } : {}),
          ...custom,
        },
      },
      bindings,
    );
  const approval = receipt.map((item) => ({
    approval: crypto.randomUUID(),
    caseId: item.id,
    domain,
    listing: draft.id,
    revision: snapshot.revision,
    price,
    expiresAt: Date.now() + 60000,
  }));
  const approve = (
    quote: (typeof approval)[number],
    signedIn = true,
    bindings = env,
  ) => post('approve', JSON.stringify(quote), signedIn, {}, bindings);
  expect((await approve(approval[0], false)).status).toBe(404);
  expect(
    (
      await approve(approval[0], true, {
        ...env,
        CANONICAL_ORIGIN: 'https://domains.domains',
      })
    ).status,
  ).toBe(404);
  expect(
    (await approve({ ...approval[0], price: { ...price, amount: '2400.06' } }))
      .status,
  ).toBe(409);
  const decisions = await Promise.all(approval.map((quote) => approve(quote)));
  expect(decisions.map((response) => response.status).sort()).toEqual([
    200, 409,
  ]);
  const winner = decisions.findIndex((response) => response.status === 200);
  const held = await decisions[winner].json<{ id: string }>();
  const rows = new CheckoutReservations(control);
  const provider = new CheckoutSimulatorProvider(
    simulator,
    simulatorKey,
    origin,
  );
  const sim = (path: string, options?: RequestInit) =>
    simulator.fetch('https://checkout-simulator.invalid/' + path, options);
  const handoff = (grant: string) =>
    post('buyer', new URLSearchParams({ id: held.id, thread: grant }));
  try {
    expect(
      await control
        .prepare(
          "SELECT count(*) AS n FROM checkout_reservations WHERE domain=? AND state!='released'",
        )
        .bind(domain)
        .first('n'),
    ).toBe(1);
    expect(await (await approve(approval[winner])).json()).toMatchObject({
      id: held.id,
    });
    expect(
      await stagingBuyerCheckout(
        env,
        workspace,
        thread.get(approval[winner].caseId)!,
      ),
    ).toContain('Open staging checkout');
    expect(
      await stagingBuyerCheckout(
        env,
        workspace,
        thread.get(approval[1 - winner].caseId)!,
      ),
    ).toBe('');
    expect(
      (await handoff(thread.get(approval[1 - winner].caseId)!)).status,
    ).toBe(404);
    expect(
      (
        await sim('qualification/faults/' + held.id, {
          method: 'PUT',
          body: JSON.stringify({ loseCreationResponse: true }),
        })
      ).status,
    ).toBe(204);
    const grant = thread.get(approval[winner].caseId)!;
    expect((await handoff(grant)).status).toBe(503);
    const original = await provider.find(held.id);
    expect(original?.session).toBeTruthy();
    const handoffs = await Promise.all([handoff(grant), handoff(grant)]);
    expect(handoffs.map((result) => result.status)).toEqual([303, 303]);
    expect(
      new Set(handoffs.map((result) => result.headers.get('location'))),
    ).toEqual(new Set([original!.url]));
    expect((await rows.get(held.id))?.provider_session).toBe(original?.session);
    const publishObservation = async (type: 'transfer' | 'payment') => {
      const response = await sim('qualification/events/' + held.id, {
        method: 'POST',
        body: JSON.stringify({
          eventId: crypto.randomUUID(),
          type,
          reference: 'simulated-proof:' + type,
        }),
      });
      expect(response.ok).toBe(true);
      return response.json<{ body: string; signature: string }>();
    };
    const callback = (event: { body: string; signature: string }) =>
      post('callback', event.body, false, {
        'X-Checkout-Signature': event.signature,
      });
    const transfer = await publishObservation('transfer');
    expect(
      (await callback({ ...transfer, body: transfer.body + ' ' })).status,
    ).toBe(403);
    expect((await callback(transfer)).status).toBe(204);
    expect(await rows.get(held.id)).toMatchObject({
      state: 'open',
      payment_reference: null,
      transfer_reference: 'simulated-proof:transfer',
    });
    const payment = await publishObservation('payment');
    expect((await callback(payment)).status).toBe(204);
    expect((await callback(transfer)).status).toBe(204);
    expect(await rows.get(held.id)).toMatchObject({
      state: 'transferred',
      payment_reference: 'simulated-proof:payment',
      transfer_reference: 'simulated-proof:transfer',
    });
    expect(
      await control
        .prepare(
          'SELECT count(*) AS n FROM checkout_observations WHERE reservation_id=?',
        )
        .bind(held.id)
        .first('n'),
    ).toBe(2);
    await reconcileStagingCheckout(env);
    expect((await handoff(grant)).status).toBe(409);
  } finally {
    await sim('qualification/events/' + held.id, { method: 'DELETE' });
    expect(await provider.find(held.id)).toBeNull();
    await control.batch([
      control
        .prepare('DELETE FROM checkout_observations WHERE reservation_id=?')
        .bind(held.id),
      control
        .prepare('DELETE FROM checkout_reservations WHERE id=?')
        .bind(held.id),
    ]);
    expect(await rows.get(held.id)).toBeNull();
  }
}, 30000);
