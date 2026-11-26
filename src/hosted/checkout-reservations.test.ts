import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import {
  CheckoutCoordinator,
  type CheckoutProvider,
} from './checkout-coordinator';
import {
  CheckoutConflict,
  CheckoutReservations,
} from './checkout-reservations';

const domain = 'checkout-fixture.example';
const provider = 'test-escrow';
const price = { currency: 'USD', amount: '2400' };
const currentTime = Date.now();
let mf: Miniflare;
let db: D1Database;
let store: CheckoutReservations;
let workspace: string, seller: string, listing: string, revision: string;

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      d1Databases: { DB: 'checkout-fixture' },
    }),
  );
  db = (await mf.getD1Database('DB')) as unknown as D1Database;
  for (const name of [
    '0001_control',
    '0003_lifecycle',
    '0007_sales_hostnames',
    '0008_sales_domain_controls',
    '0022_public_domain_directory',
    '0028_checkout_reservations',
  ])
    await db.exec(
      readFileSync('hosted/migrations/' + name + '.sql', 'utf8')
        .replace(/^--.*$/gm, '')
        .replace(/\n/g, ' '),
    );
  store = new CheckoutReservations(db);
}, 30_000);
afterAll(async () => mf?.dispose());
beforeEach(async () => {
  workspace = crypto.randomUUID();
  seller = crypto.randomUUID();
  listing = crypto.randomUUID();
  revision = crypto.randomUUID();
  await db.exec(
    'DELETE FROM sales_domain_controls; DELETE FROM checkout_domain_holds; DELETE FROM checkout_observations; DELETE FROM checkout_reservations; DELETE FROM public_domain_routes; DELETE FROM users; DELETE FROM workspaces;',
  );
  await db.batch([
    db
      .prepare("INSERT INTO workspaces(id,label) VALUES(?,'Fixture')")
      .bind(workspace),
    db
      .prepare(
        "INSERT INTO users(id,email,workspace_id,password_hash,created_at) VALUES(?,'fixture@example.invalid',?,'fixture',?)",
      )
      .bind(seller, workspace, currentTime),
    db
      .prepare(
        "INSERT INTO public_domain_routes(domain,workspace_id,listing_id,generation,revision,state,updated_at) VALUES(?,?,?,1,?,'active',?)",
      )
      .bind(domain, workspace, listing, revision, currentTime),
  ]);
});
const approve = () => ({
  domain,
  workspace,
  seller,
  listing,
  revision,
  case: crypto.randomUUID(),
  approval: crypto.randomUUID(),
  provider,
  price,
  expiresAt: currentTime + 60_000,
});
const open = async () => {
  const row = await store.reserve(approve(), currentTime);
  await store.beginCreation(row.id, currentTime);
  return store.attachSession(row.id, provider, 'fixture-session', currentTime);
};
const observation = (
  type: 'payment' | 'transfer' | 'cancel-final' | 'refund-final',
) => ({
  type,
  price,
  provider,
  eventId: crypto.randomUUID(),
  session: 'fixture-session',
  reference: 'evidence-' + type,
});

it('grants one active reservation for a canonical domain and recovers identical lost approvals', async () => {
  const requests = [approve(), { ...approve(), domain: domain.toUpperCase() }];
  const results = await Promise.allSettled(
    requests.map((request) => store.reserve(request, currentTime)),
  );
  expect(
    results.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(1);
  const winner = results.find((result) => result.status === 'fulfilled')!.value;
  expect(
    (
      await store.reserve(
        requests.find((request) => request.approval === winner.approval_id)!,
        currentTime,
      )
    ).id,
  ).toBe(winner.id);
  await expect(
    store.reserve(
      {
        ...requests.find((request) => request.approval === winner.approval_id)!,
        price: { ...price, amount: '2500' },
      },
      currentTime,
    ),
  ).rejects.toThrow(CheckoutConflict);
  await expect(
    store.reserve({ ...approve(), seller: crypto.randomUUID() }, currentTime),
  ).rejects.toThrow(CheckoutConflict);
  expect((await store.requestCancellation(winner.id)).reservation.state).toBe(
    'released',
  );
  expect((await store.reserve(approve(), currentTime)).state).toBe('held');
});

it('reclaims an expired unused approval while retaining an uncertain creation', async () => {
  const initial = approve();
  const old = await store.reserve(initial, currentTime);
  const nextAt = initial.expiresAt;
  const next = await store.reserve(
    { ...approve(), expiresAt: nextAt + 60_000 },
    nextAt,
  );
  expect((await store.get(old.id))?.state).toBe('released');
  expect(next.state).toBe('held');
  await store.beginCreation(next.id, nextAt);

  await expect(
    store.reserve(
      { ...approve(), expiresAt: next.expires_at + 60_000 },
      next.expires_at,
    ),
  ).rejects.toThrow(CheckoutConflict);
  expect((await store.get(next.id))?.state).toBe('creating');
});

it('rejects stale approval and prevents another session when withdrawal races provider creation', async () => {
  const approved = approve();
  const row = await store.reserve(approved, currentTime);
  await db
    .prepare(
      'UPDATE public_domain_routes SET revision=?,generation=2 WHERE domain=?',
    )
    .bind(crypto.randomUUID(), domain)
    .run();
  await expect(store.beginCreation(row.id, currentTime)).rejects.toThrow(
    CheckoutConflict,
  );
  await store.requestCancellation(row.id);
  await expect(store.reserve(approve(), currentTime)).rejects.toThrow(
    CheckoutConflict,
  );
  await db
    .prepare('UPDATE public_domain_routes SET revision=? WHERE domain=?')
    .bind(revision, domain)
    .run();
  const next = await store.reserve(approve(), currentTime);
  const [first, retry] = await Promise.all([
    store.beginCreation(next.id, currentTime),
    store.beginCreation(next.id, currentTime),
  ]);
  expect(first.idempotencyKey).toBe(retry.idempotencyKey);
  await db
    .prepare("UPDATE public_domain_routes SET state='tombstone' WHERE domain=?")
    .bind(domain)
    .run();
  expect(
    (
      await store.attachSession(
        next.id,
        provider,
        'fixture-session',
        currentTime,
      )
    ).state,
  ).toBe('canceling');
  await expect(store.beginCreation(next.id, currentTime)).rejects.toThrow(
    CheckoutConflict,
  );
});

it('holds through a late payment and applies exact authoritative cancellation or transfer facts once', async () => {
  const row = await open();
  const [cancel, replay] = await Promise.all([
    store.requestCancellation(row.id),
    store.requestCancellation(row.id),
  ]);
  expect(cancel.idempotencyKey).toBe(replay.idempotencyKey);
  await expect(store.reserve(approve(), currentTime + 120_000)).rejects.toThrow(
    CheckoutConflict,
  );
  const payment = observation('payment');
  const a = await store.observe(row.id, payment);
  const b = await store.observe(row.id, payment);
  expect(a).toEqual(b);
  expect(a?.state).toBe('paid');
  await expect(
    store.observe(row.id, { ...payment, reference: 'different' }),
  ).rejects.toThrow(CheckoutConflict);
  await expect(
    store.observe(row.id, {
      ...observation('transfer'),
      price: { ...price, amount: '2500' },
    }),
  ).rejects.toThrow(CheckoutConflict);
  expect(
    (await store.observe(row.id, observation('cancel-final')))?.state,
  ).toBe('paid');
  expect((await store.observe(row.id, observation('transfer')))?.state).toBe(
    'transferred',
  );
  expect(
    (await store.observe(row.id, observation('refund-final')))?.state,
  ).toBe('transferred');
});

it('records verified transfer before the payment event and waits for both', async () => {
  const row = await open();
  const transfer = observation('transfer');
  expect((await store.observe(row.id, transfer))?.state).toBe('open');
  expect((await store.observe(row.id, observation('payment')))?.state).toBe(
    'transferred',
  );
  expect((await store.observe(row.id, transfer))?.transfer_reference).toBe(
    transfer.reference,
  );
});

it('only releases an issued session on final provider proof', async () => {
  const row = await open();
  await store.requestCancellation(row.id);
  expect((await store.get(row.id))?.state).toBe('canceling');
  await expect(store.reserve(approve(), currentTime)).rejects.toThrow(
    CheckoutConflict,
  );
  const cancel = observation('cancel-final');
  expect((await store.observe(row.id, cancel))?.release_reference).toBe(
    cancel.reference,
  );
  expect((await store.observe(row.id, cancel))?.state).toBe('released');
  expect((await store.reserve(approve(), currentTime)).state).toBe('held');
});

it('reconciles an authoritative refund before a delayed payment callback', async () => {
  const row = await open();
  await store.requestCancellation(row.id);
  const refund = observation('refund-final');
  expect((await store.observe(row.id, refund))?.state).toBe('canceling');
  expect((await store.observe(row.id, observation('payment')))?.state).toBe(
    'released',
  );
  expect((await store.observe(row.id, refund))?.release_reference).toBe(
    refund.reference,
  );
});

it('reconciles a lost creation response and requires authenticated canonical provider observations', async () => {
  let remote: Awaited<ReturnType<CheckoutProvider['find']>> = null;
  let current = true;
  const adapter: CheckoutProvider = {
    id: provider,
    authenticateCallback: async (request) =>
      request.headers.get('x-fixture-signed') === 'validated'
        ? (remote?.merchantReference ?? null)
        : null,
    find: async (reference) =>
      remote?.merchantReference === reference ? remote : null,
    create: vi.fn(async (reservation, key) => {
      expect(key).toBe('checkout:create:' + reservation.id);
      remote = {
        merchantReference: reservation.id,
        session: 'fixture-session',
        price,
        url: 'https://checkout.example.test/session',
        observations: [],
      };
      throw Error('Synthetic lost creation response');
    }),
    cancel: vi.fn(async (_session, key) => {
      expect(key).toBe('checkout:cancel:' + remote?.merchantReference);
    }),
  };
  const coordinator = new CheckoutCoordinator(
    store,
    adapter,
    async () => current,
  );
  const row = await coordinator.approve({
    ...approve(),
    expiresAt: Date.now() + 300_000,
  });
  await expect(coordinator.open(row.id)).rejects.toThrow(
    'Synthetic lost creation response',
  );
  const recovered = await coordinator.open(row.id);
  expect(recovered.checkoutUrl).toBe('https://checkout.example.test/session');
  expect(adapter.create).toHaveBeenCalledTimes(1);
  current = false;
  expect((await coordinator.open(row.id)).checkoutUrl).toBeNull();
  expect(adapter.cancel).toHaveBeenCalledTimes(1);
  expect((await store.get(row.id))?.state).toBe('canceling');

  const remoteSession = await adapter.find(row.id);
  remoteSession!.observations.push(
    observation('transfer'),
    observation('payment'),
  );
  const unsigned = new Request('https://checkout.example.test/callback', {
    method: 'POST',
  });
  expect(await coordinator.callback(unsigned)).toBeNull();
  expect((await store.get(row.id))?.state).toBe('canceling');
  const signed = new Request(unsigned.url, {
    method: 'POST',
    headers: { 'x-fixture-signed': 'validated' },
  });
  expect((await coordinator.callback(signed))?.state).toBe('transferred');
  expect((await coordinator.callback(signed))?.state).toBe('transferred');
});

it('retains the hold when a provider snapshot reports late payment and cancellation in reverse order', async () => {
  const row = await open();
  await store.requestCancellation(row.id);
  const adapter: CheckoutProvider = {
    id: provider,
    authenticateCallback: async () => row.id,
    find: async () => ({
      merchantReference: row.id,
      session: 'fixture-session',
      price,
      url: null,
      observations: [observation('cancel-final'), observation('payment')],
    }),
    create: vi.fn(),
    cancel: vi.fn(),
  };
  const coordinator = new CheckoutCoordinator(store, adapter, async () => true);
  const request = new Request('https://checkout.example.test/callback', {
    method: 'POST',
  });
  expect((await coordinator.callback(request))?.state).toBe('paid');
  await expect(store.reserve(approve(), currentTime)).rejects.toThrow(
    CheckoutConflict,
  );
});

it('blocks a new handoff when a provider contradicts a previous final release', async () => {
  const row = await open();
  await store.requestCancellation(row.id);
  await store.observe(row.id, observation('cancel-final'));
  const replacement = await store.reserve(approve(), currentTime);
  await store.beginCreation(replacement.id, currentTime);
  await store.attachSession(
    replacement.id,
    provider,
    'replacement-session',
    currentTime,
  );
  expect(
    await store.handoff(replacement.id, 'replacement-session', currentTime),
  ).toMatchObject({
    id: replacement.id,
  });
  const adapter: CheckoutProvider = {
    id: provider,
    authenticateCallback: async () => row.id,
    find: async () => ({
      merchantReference: row.id,
      session: 'fixture-session',
      price,
      url: null,
      observations: [observation('payment')],
    }),
    create: vi.fn(),
    cancel: vi.fn(),
  };
  const coordinator = new CheckoutCoordinator(store, adapter, async () => true);
  await expect(
    coordinator.callback(new Request('https://checkout.example.test/callback')),
  ).rejects.toThrow('Provider reports activity after final release');
  expect(
    await store.handoff(replacement.id, 'replacement-session', currentTime),
  ).toBeNull();
  expect((await store.get(replacement.id))?.state).toBe('canceling');
  await store.observe(replacement.id, {
    ...observation('cancel-final'),
    session: 'replacement-session',
  });
  await expect(store.reserve(approve(), currentTime)).rejects.toThrow(
    CheckoutConflict,
  );
});

it('holds the domain when an already attached callback observes payment after release', async () => {
  const row = await open();
  await store.requestCancellation(row.id);
  const attached = await store.attachSession(
    row.id,
    provider,
    'fixture-session',
  );
  expect(attached.state).toBe('canceling');

  await store.observe(row.id, observation('cancel-final'));
  const payment = observation('payment');
  await expect(store.observe(row.id, payment)).rejects.toThrow(
    'Provider reports activity after final release',
  );
  expect(
    await db
      .prepare(
        'SELECT reservation_id FROM checkout_observations WHERE event_id=?',
      )
      .bind(payment.eventId)
      .first(),
  ).toEqual({ reservation_id: row.id });
  await expect(store.reserve(approve(), currentTime)).rejects.toThrow(
    CheckoutConflict,
  );
});

it('blocks new approvals and existing handoffs after control loss', async () => {
  const row = await open();
  await db
    .prepare(
      `INSERT INTO sales_domain_controls(workspace_id,listing_id,domain,epoch,revision,proof,status,updated_at)
    VALUES(?,?,?,1,?,'fixture','lost',?)`,
    )
    .bind(workspace, listing, domain, revision, currentTime)
    .run();

  expect(
    await store.handoff(row.id, 'fixture-session', currentTime),
  ).toBeNull();
  await store.requestCancellation(row.id);
  await store.observe(row.id, observation('cancel-final'));
  await expect(store.reserve(approve(), currentTime)).rejects.toThrow(
    CheckoutConflict,
  );
});
