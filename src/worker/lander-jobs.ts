import { z } from 'zod';
import { revisedCertificatePlan } from './lander-certificate-review';
import { toUnicode } from '../shared/domain-name';
import { canonicalDomain } from '../shared/publication';
import { emptySale } from '../shared/hosted-sales';
import { SalesError } from '../shared/sales-review';
import { SalesStore, type SaleObserver } from './sales-store';
import {
  canonicalJson,
  landerPlanSchema,
  dnsSnapshotSchema,
  hostingPlanSchema,
  landerDnsProgress,
  type LanderHostingPlan,
  type LanderJobView,
  type LanderSelection,
  type DnsSnapshot,
} from '../shared/lander-connection';
import { LanderDnsError } from '../core/services/lander-cloudflare';
import {
  discoverLanderZone,
  landerDnsProvider,
} from '../core/services/lander-dns-provider';
import {
  observeDnsChange,
  planLanderDns,
  isLanderWebChange,
} from '../core/services/lander-dns-plan';

const payloadSchema = z
  .object({
    domain: z.string(),
    snapshot: dnsSnapshotSchema.optional(),
    preparationHosts: z.array(hostingPlanSchema).length(2).optional(),
    plan: landerPlanSchema.optional(),
    write: z
      .object({
        index: z.number().int(),
        state: z.enum(['intent', 'verified']),
        record: z.record(z.string(), z.unknown()).nullable().optional(),
      })
      .optional(),
    restoreIndex: z.number().int().optional(),
    restoreIntent: z.number().int().optional(),
  })
  .strict();
interface Item {
  job_id: string;
  ordinal: number;
  domain_hash: string;
  listing_id: string | null;
  state: string;
  sealed: string;
  digest: string | null;
  generation: string;
  lease: string | null;
  lease_until: number;
  due_at: number;
  reason: string | null;
}
interface Job {
  id: string;
  selection_hash: string;
  state: string;
  total: number;
  digest: string | null;
  expires_at: number;
}
export class LanderJobs {
  constructor(
    readonly store: SalesStore,
    readonly observe: SaleObserver,
    readonly fetcher: typeof fetch = fetch,
    readonly allowedDnsProviders: ReadonlyArray<DnsSnapshot['provider']> = [
      'cloudflare',
    ],
    readonly qualificationFixture?: { domain: string; accountId: string },
  ) {}
  private dnsAllowed(
    snapshot: Pick<DnsSnapshot, 'provider' | 'domain' | 'accountId'>,
  ) {
    const fixture = this.qualificationFixture;
    return (
      this.allowedDnsProviders.includes(snapshot.provider) ||
      (!!fixture &&
        snapshot.provider === 'dynadot' &&
        snapshot.domain === fixture.domain &&
        snapshot.accountId === fixture.accountId)
    );
  }
  private providersFor(domain: string) {
    return this.qualificationFixture?.domain === domain
      ? [...new Set([...this.allowedDnsProviders, 'dynadot' as const])]
      : this.allowedDnsProviders;
  }
  async create(
    selection: LanderSelection,
    id: string,
    inventory: () => Promise<string[]>,
  ) {
    const selectionHash = await this.store.hash(
      'lander-selection',
      canonicalJson(selection),
    );
    const existing = await this.store.db
      .prepare('SELECT selection_hash FROM lander_jobs WHERE id=?')
      .bind(id)
      .first<{ selection_hash: string }>();
    if (existing) {
      if (existing.selection_hash !== selectionHash)
        throw new SalesError(
          'REQUEST_CHANGED',
          'This request key belongs to another selection.',
          409,
        );
      return this.get(id);
    }
    let domains: string[] = [];
    if (selection.kind === 'domains') {
      const authorized = new Set(await inventory());
      domains = [...new Set(selection.domains.map(canonicalDomain))].sort();
      if (domains.some((d) => !authorized.has(d)))
        throw new SalesError(
          'NOT_IN_INVENTORY',
          'Select domains from the current portfolio.',
          403,
        );
    } else if (selection.kind === 'listings') {
      for (const id of [...new Set(selection.ids)])
        domains.push((await this.store.get(id)).draft.domain);
    } else {
      // Resolve every server page once. The resulting immutable rows, never a
      // live filter or browser page, are the authority for this job.
      let cursor: string | null = '';
      const query = selection.q.toLowerCase();
      const matching = (await inventory()).filter(
        (d) => d.includes(query) || toUnicode(d).toLowerCase().includes(query),
      );
      do {
        const page = await this.store.list(cursor, 100, {
          ...selection,
          domains: matching,
        });
        domains.push(...page.items.map((i) => i.draft.domain));
        cursor = page.cursor;
        if (domains.length > 20000)
          throw new SalesError(
            'SELECTION_LIMIT',
            'The explicit manifest limit is 20,000 names. Narrow the selection; nothing was queued.',
          );
      } while (cursor !== null);
    }
    domains = [...new Set(domains)].sort();
    if (!domains.length || domains.length > 20000)
      throw new SalesError(
        'SELECTION_LIMIT',
        'Select 1–20,000 distinct names. Nothing was queued.',
      );
    const now = Date.now();
    // Building is not executable. A failed freeze cannot admit a partial set.
    await this.store.db
      .prepare(
        "INSERT INTO lander_jobs(id,selection_hash,state,total,expires_at,created_at,updated_at) VALUES(?,?,'building',?,?,?,?)",
      )
      .bind(id, selectionHash, domains.length, now + 3600000, now, now)
      .run();
    for (let start = 0; start < domains.length; start += 50) {
      const writes: D1PreparedStatement[] = [];
      for (const [offset, domain] of domains
        .slice(start, start + 50)
        .entries()) {
        const ordinal = start + offset,
          hash = await this.store.hash('domain', domain),
          generation = crypto.randomUUID();
        writes.push(
          this.store.db
            .prepare(
              "INSERT INTO lander_items(job_id,ordinal,domain_hash,state,sealed,generation) VALUES(?,?,?,'preparing',?,?)",
            )
            .bind(
              id,
              ordinal,
              hash,
              await this.store.seal({ domain }),
              generation,
            ),
        );
      }
      await this.store.db.batch(writes);
    }
    const count = await this.store.db
      .prepare('SELECT count(*) AS n FROM lander_items WHERE job_id=?')
      .bind(id)
      .first<{ n: number }>();
    if (count?.n !== domains.length)
      throw new SalesError(
        'MANIFEST_INCOMPLETE',
        'The exact selection was not frozen. Nothing is executable.',
        409,
      );
    await this.store.db
      .prepare(
        "UPDATE lander_jobs SET state='preparing' WHERE id=? AND state='building'",
      )
      .bind(id)
      .run();
    return this.get(id);
  }
  async job(id: string) {
    const r = await this.store.db
      .prepare('SELECT * FROM lander_jobs WHERE id=?')
      .bind(id)
      .first<Job>();
    if (!r) throw new SalesError('MISSING', 'Connection job not found.', 404);
    return r;
  }
  async get(id: string, cursor = -1): Promise<LanderJobView> {
    const j = await this.job(id),
      counts = await this.store.db
        .prepare(
          'SELECT state,count(*) AS count FROM lander_items WHERE job_id=? GROUP BY state',
        )
        .bind(id)
        .all<{ state: string; count: number }>();
    const rows = await this.store.db
      .prepare(
        'SELECT * FROM lander_items WHERE job_id=? AND ordinal>? ORDER BY ordinal LIMIT 101',
      )
      .bind(id, cursor)
      .all<Item>();
    const items = await Promise.all(
      rows.results.slice(0, 100).map(async (r) => {
        const p = await this.store.open(r.sealed, payloadSchema);
        return {
          ordinal: r.ordinal,
          domain: p.domain,
          state: r.state,
          reason: r.reason,
          ...(p.plan
            ? {
                publication: p.plan.publication,
                publishes: !!p.plan.publicationReview,
                changes: p.plan.changes,
                dnsProgress: landerDnsProgress(
                  p.plan.changes.length,
                  p.write,
                  p.restoreIndex,
                ),
                hosts: p.plan.hosts.map((h) => ({
                  hostname: h.hostname,
                  epoch: h.epoch,
                })),
              }
            : {}),
        };
      }),
    );
    return {
      id,
      state: j.state,
      digest: j.digest,
      total: j.total,
      counts: counts.results,
      expiresAt: j.expires_at,
      items,
      cursor: rows.results.length > 100 ? rows.results[99].ordinal : null,
    };
  }
  async work() {
    const r = await this.store.db
      .prepare(
        "SELECT i.*,j.state AS job_state FROM lander_items i JOIN lander_jobs j ON j.id=i.job_id WHERE ((j.state='preparing' AND i.state='preparing') OR (j.state IN ('running','restoring') AND i.state NOT IN ('held','live','cancelled','restored','conflict'))) AND i.due_at<=? AND i.lease_until<=? ORDER BY i.due_at,j.created_at,i.ordinal LIMIT 1",
      )
      .bind(Date.now(), Date.now())
      .first<Item & { job_state: string }>();
    if (!r) return null;
    const p = await this.store.open(r.sealed, payloadSchema);
    let listing = r.listing_id;
    if (!listing) {
      const saved = await this.store.db
        .prepare('SELECT id FROM sale_drafts WHERE domain_hash=?')
        .bind(r.domain_hash)
        .first<{ id: string }>();
      if (saved) listing = saved.id;
      else {
        const draft = emptySale(p.domain, 'unreviewed');
        draft.priceSource = null;
        await this.store.save(draft, null);
        listing = draft.id;
      }
      await this.store.db
        .prepare(
          'UPDATE lander_items SET listing_id=? WHERE job_id=? AND ordinal=? AND generation=?',
        )
        .bind(listing, r.job_id, r.ordinal, r.generation)
        .run();
    }
    if (r.state === 'preparing' && !p.snapshot) {
      try {
        const saved = await this.store.get(listing),
          observation = await this.observe(saved.draft);
        if (
          !observation.available ||
          observation.transactionState ||
          observation.controlExpiresAt <= Date.now() ||
          ['sold', 'sale-pending', 'control-lost'].includes(saved.availability)
        )
          throw new SalesError(
            'CONTROL_UNCERTAIN',
            observation.reason ??
              'Refresh exact domain ownership before preparing hosting.',
            409,
          );
        p.snapshot = await discoverLanderZone(
          p.domain,
          this.fetcher,
          this.providersFor(p.domain),
        );
        await this.store.db
          .prepare(
            "UPDATE lander_items SET sealed=? WHERE job_id=? AND ordinal=? AND generation=? AND state='preparing'",
          )
          .bind(await this.store.seal(p), r.job_id, r.ordinal, r.generation)
          .run();
      } catch (error) {
        await this.store.db
          .prepare(
            "UPDATE lander_items SET state='held',reason=? WHERE job_id=? AND ordinal=? AND generation=? AND state='preparing'",
          )
          .bind(
            error instanceof SalesError || error instanceof LanderDnsError
              ? error.message
              : 'The DNS account or provider could not be qualified.',
            r.job_id,
            r.ordinal,
            r.generation,
          )
          .run();
        await this.finalize(r.job_id);
        return null;
      }
    }
    const snapshot = p.plan?.snapshot ?? p.snapshot;
    if (r.job_state !== 'restoring' && snapshot && !this.dnsAllowed(snapshot)) {
      await this.store.db
        .prepare(
          "UPDATE lander_items SET state='held',reason=? WHERE job_id=? AND ordinal=? AND generation=? AND lease_until<=?",
        )
        .bind(
          'This DNS provider is not qualified for automatic connections on this portfolio.',
          r.job_id,
          r.ordinal,
          r.generation,
          Date.now(),
        )
        .run();
      await this.finalize(r.job_id);
      return null;
    }
    return {
      job: r.job_id,
      ordinal: r.ordinal,
      generation: r.generation,
      domain: p.domain,
      listing,
      state: r.state,
      hosts: p.plan?.hosts ?? p.preparationHosts ?? null,
      publication: p.plan?.publication ?? null,
    };
  }
  async finalize(id: string) {
    const j = await this.job(id);
    if (j.state === 'preparing') {
      const pending = await this.store.db
        .prepare(
          "SELECT 1 FROM lander_items WHERE job_id=? AND state='preparing' LIMIT 1",
        )
        .bind(id)
        .first();
      if (pending) return;
      // Parent binds every internal item, including holds and the exact count.
      const digest = await this.manifestDigest(j);
      await this.store.db
        .prepare(
          "UPDATE lander_jobs SET state='awaiting-review',digest=?,expires_at=?,updated_at=? WHERE id=? AND state='preparing'",
        )
        .bind(digest, Date.now() + 900000, Date.now(), id)
        .run();
    } else if (['running', 'restoring'].includes(j.state)) {
      const pending = await this.store.db
        .prepare(
          "SELECT 1 FROM lander_items WHERE job_id=? AND state NOT IN ('held','live','cancelled','restored','conflict') LIMIT 1",
        )
        .bind(id)
        .first();
      if (!pending)
        await this.store.db
          .prepare(
            "UPDATE lander_jobs SET state='finished',updated_at=? WHERE id=? AND state IN ('running','restoring')",
          )
          .bind(Date.now(), id)
          .run();
    }
  }
  async manifestDigest(j: Job) {
    const parts: string[] = [];
    let cursor = -1;
    for (;;) {
      const rows = await this.store.db
        .prepare(
          'SELECT ordinal,digest,domain_hash FROM lander_items WHERE job_id=? AND ordinal>? ORDER BY ordinal LIMIT 100',
        )
        .bind(j.id, cursor)
        .all<{ ordinal: number; digest: string | null; domain_hash: string }>();
      if (!rows.results.length) break;
      parts.push(...rows.results.map((r) => canonicalJson(r)));
      cursor = rows.results.at(-1)!.ordinal;
    }
    if (parts.length !== j.total)
      throw new SalesError(
        'MANIFEST_CHANGED',
        'The exact manifest count changed.',
        409,
      );
    return this.store.hash(
      'lander-manifest',
      canonicalJson([j.id, j.total, parts]),
    );
  }
  async approve(id: string, digest: string) {
    const j = await this.job(id);
    if (j.digest !== digest)
      throw new SalesError(
        'MANIFEST_CHANGED',
        'Review the complete exact manifest again.',
        409,
      );
    if ((await this.manifestDigest(j)) !== digest)
      throw new SalesError(
        'MANIFEST_CHANGED',
        'The complete parent manifest changed.',
        409,
      );
    if (['running', 'finished'].includes(j.state)) return this.get(id);
    if (j.state !== 'awaiting-review' || j.expires_at <= Date.now())
      throw new SalesError(
        'REVIEW_EXPIRED',
        'This confirmation expired. Prepare a fresh selection.',
        409,
      );
    // Each internal batch is signed into the parent digest at freeze time and
    // revalidated immediately before it can write.
    await this.store.atomic([
      ...this.store.guard(
        "EXISTS(SELECT 1 FROM lander_jobs WHERE id=? AND digest=? AND state='awaiting-review' AND expires_at>?)",
        [id, digest, Date.now()],
      ),
      this.store.db
        .prepare(
          "UPDATE lander_items SET state='queued' WHERE job_id=? AND state='ready'",
        )
        .bind(id),
      this.store.db
        .prepare(
          "UPDATE lander_jobs SET state='running',updated_at=? WHERE id=?",
        )
        .bind(Date.now(), id),
    ]);
    await this.finalize(id);
    return this.get(id);
  }
  async cancel(id: string) {
    await this.job(id);
    await this.store.db.batch([
      this.store.db
        .prepare(
          "UPDATE lander_jobs SET state='cancelled',updated_at=? WHERE id=? AND state!='finished'",
        )
        .bind(Date.now(), id),
      this.store.db
        .prepare(
          "UPDATE lander_items SET state='cancelled',reason='Cancelled. Submitted writes may still need reconciliation; use restore to inspect them.' WHERE job_id=? AND state NOT IN ('live','restored','conflict')",
        )
        .bind(id),
    ]);
    return this.get(id);
  }
  async restore(id: string) {
    const job = await this.job(id);
    if (job.state === 'restoring') return this.get(id);
    if (
      ![
        'finished',
        'cancelled',
        'running',
        'preparing',
        'awaiting-review',
      ].includes(job.state)
    )
      throw new SalesError(
        'RECOVERY_STATE',
        'Cancel incomplete selection preparation before starting recovery.',
        409,
      );
    // Keep generations and locks: unknown writes must reconcile before cutback.
    await this.store.db.batch([
      this.store.db
        .prepare(
          "UPDATE lander_jobs SET state='restoring',updated_at=? WHERE id=? AND state IN ('finished','cancelled','running','preparing','awaiting-review')",
        )
        .bind(Date.now(), id),
      this.store.db
        .prepare(
          "UPDATE lander_items SET state=CASE WHEN digest IS NULL AND listing_id IS NULL THEN 'restored' WHEN digest IS NULL THEN 'cleanup' ELSE 'restore' END,due_at=0 WHERE job_id=?",
        )
        .bind(id),
    ]);
    await this.finalize(id);
    return this.get(id);
  }
  async step(
    ref: { job: string; ordinal: number; generation: string },
    hosts?: LanderHostingPlan[],
    hostingState?: string,
  ) {
    const lease = crypto.randomUUID(),
      now = Date.now();
    const r = await this.store.db
      .prepare(
        "UPDATE lander_items SET lease=?,lease_until=? WHERE job_id=? AND ordinal=? AND generation=? AND lease_until<=? AND state NOT IN ('held','ready','live','cancelled','restored','conflict') AND EXISTS(SELECT 1 FROM lander_jobs j WHERE j.id=job_id AND j.state IN ('preparing','running','restoring')) RETURNING *",
      )
      .bind(lease, now + 120000, ref.job, ref.ordinal, ref.generation, now)
      .first<Item>();
    if (!r) return;
    const p = await this.store.open(r.sealed, payloadSchema),
      j = await this.job(r.job_id);
    const save = async (
      state: string,
      reason: string | null = null,
      due = 0,
    ) => {
      await this.store.db
        .prepare(
          'UPDATE lander_items SET state=?,sealed=?,reason=?,due_at=?,lease=NULL,lease_until=0 WHERE job_id=? AND ordinal=? AND generation=? AND lease=? AND lease_until>?',
        )
        .bind(
          state,
          await this.store.seal(p),
          reason,
          due,
          r.job_id,
          r.ordinal,
          r.generation,
          lease,
          Date.now(),
        )
        .run();
    };
    const fence = async () => {
      if (
        !(await this.store.db
          .prepare(
            "SELECT 1 FROM lander_items i JOIN lander_jobs j ON j.id=i.job_id JOIN lander_domain_locks l ON l.domain_hash=i.domain_hash AND l.job_id=i.job_id AND l.ordinal=i.ordinal AND l.generation=i.generation WHERE i.job_id=? AND i.ordinal=? AND i.generation=? AND i.lease=? AND i.lease_until>? AND j.state IN ('preparing','running','restoring')",
          )
          .bind(r.job_id, r.ordinal, r.generation, lease, Date.now())
          .first())
      )
        throw new SalesError(
          'STALE_GENERATION',
          'Connection generation or approval changed.',
          409,
        );
    };
    try {
      // A retained lock serializes review, execution and recovery for a domain.
      await this.store.db
        .prepare(
          'INSERT INTO lander_domain_locks(domain_hash,job_id,ordinal,generation) VALUES(?,?,?,?) ON CONFLICT DO NOTHING',
        )
        .bind(r.domain_hash, r.job_id, r.ordinal, r.generation)
        .run();
      await fence();
      if (r.state === 'cleanup') {
        if (p.plan || p.write)
          throw new SalesError(
            'RECOVERY_CHANGED',
            'An executable connection needs DNS restoration before cleanup.',
            409,
          );
        if (hostingState === 'detached') {
          await save(
            'restored',
            'Preparation cleaned up. No connection DNS writes were admitted.',
          );
          await this.store.db
            .prepare(
              'DELETE FROM lander_domain_locks WHERE domain_hash=? AND job_id=? AND ordinal=? AND generation=?',
            )
            .bind(r.domain_hash, r.job_id, r.ordinal, r.generation)
            .run();
        } else
          await save(
            'cleanup',
            'Finishing preparation cleanup before releasing the domain.',
            Date.now() + 120000,
          );
        return;
      }
      if (r.state === 'restored-dns') {
        if (hostingState === 'detached') {
          await save('restored');
          await this.store.db
            .prepare(
              'DELETE FROM lander_domain_locks WHERE domain_hash=? AND job_id=? AND ordinal=? AND generation=?',
            )
            .bind(r.domain_hash, r.job_id, r.ordinal, r.generation)
            .run();
        } else
          await save(
            'restored-dns',
            'Previous DNS is restored; finishing hostname cleanup.',
            Date.now() + 120000,
          );
        return;
      }
      if (j.state === 'preparing') {
        if (p.snapshot && !this.dnsAllowed(p.snapshot))
          throw new SalesError(
            'DNS_PROVIDER_UNQUALIFIED',
            'This DNS provider is not qualified for automatic connections on this portfolio.',
            409,
          );
        if (!hosts)
          throw new SalesError(
            'HOSTING_UNQUALIFIED',
            hostingState ??
              'Root and www hosting are not qualified for this controlled rollout.',
            409,
          );
        p.preparationHosts = hosts;
        const saved = await this.store.get(r.listing_id!),
          o = await this.observe(saved.draft);
        if (
          !o.available ||
          o.transactionState ||
          ['sold', 'sale-pending', 'control-lost'].includes(saved.availability)
        )
          throw new SalesError(
            'CONTROL_UNCERTAIN',
            o.reason ?? 'Refresh current domain ownership before connecting.',
            409,
          );
        if (!p.snapshot)
          throw new SalesError(
            'DNS_AUTHORITY',
            'Provider preflight is required before hosting preparation.',
            409,
          );
        const snapshot = await landerDnsProvider(
            p.snapshot,
            this.fetcher,
          ).snapshot(p.domain, p.snapshot.zoneId),
          changes = planLanderDns(snapshot, hosts, r.generation);
        let publication = saved.published,
          review: string | null = null;
        if (!publication) {
          if (saved.draft.includeInShop)
            throw new SalesError(
              'SHOP_REVIEW',
              'This draft includes shop publication. Review that control separately before connecting.',
              409,
            );
          const v = await this.store.prepare(
            [{ id: saved.draft.id, revision: saved.revision }],
            this.observe,
          );
          publication = v.items[0].after;
          review = v.id;
        }
        p.plan = landerPlanSchema.parse({
          domain: p.domain,
          listing: saved.draft.id,
          revision: saved.revision,
          operationalRevision: saved.operationalRevision,
          publicationReview: review,
          publication,
          snapshot,
          changes,
          hosts,
          expiresAt: Date.now() + 900000,
        });
        delete p.snapshot;
        delete p.preparationHosts;
        const digest = await this.store.hash(
          'lander-item',
          canonicalJson(p.plan),
        );
        await this.store.db
          .prepare(
            'UPDATE lander_items SET digest=? WHERE job_id=? AND ordinal=? AND lease=?',
          )
          .bind(digest, r.job_id, r.ordinal, lease)
          .run();
        await save('ready');
      } else {
        const plan = p.plan;
        if (
          !plan ||
          r.digest !==
            (await this.store.hash('lander-item', canonicalJson(plan))) ||
          j.digest !== (await this.manifestDigest(j))
        )
          throw new SalesError(
            'MANIFEST_CHANGED',
            'The approved parent or internal batch changed.',
            409,
          );
        const saved = await this.store.get(plan.listing),
          o = await this.observe(saved.draft);
        if (
          !o.available ||
          o.transactionState ||
          o.controlExpiresAt <= Date.now()
        )
          throw new SalesError(
            'CONTROL_LOST',
            'Current ownership is unavailable. No new DNS writes are allowed.',
            409,
          );
        if (
          j.state !== 'restoring' &&
          (saved.revision !== plan.revision ||
            (saved.published &&
              saved.published.revision !== plan.publication.revision))
        )
          throw new SalesError(
            'PUBLICATION_CHANGED',
            'The listing or public terms changed. Review a fresh connection.',
            409,
          );
        const provider = landerDnsProvider(plan.snapshot, this.fetcher, fence);
        if (j.state !== 'restoring' && !this.dnsAllowed(plan.snapshot))
          throw new SalesError(
            'DNS_PROVIDER_UNQUALIFIED',
            'This DNS provider is not qualified for new DNS writes on this portfolio.',
            409,
          );
        // Re-validate authority, account, complete records and routing on every
        // external step. Credentials never travel in the durable payload.
        const current = await provider.snapshot(
          plan.domain,
          plan.snapshot.zoneId,
        );
        if (current.providerAccountId !== plan.snapshot.providerAccountId)
          throw new SalesError(
            'DNS_ACCOUNT_CHANGED',
            'The saved DNS account identity changed.',
            409,
          );
        if (j.state === 'running' && hostingState === 'certificate-review') {
          if (!hosts || p.write?.state === 'intent')
            throw new SalesError(
              'CERTIFICATE_REVIEW',
              'Reconcile submitted DNS before updating this review.',
              409,
            );
          const through = p.write?.index ?? -1;
          for (let previous = 0; previous <= through; previous++)
            if (
              observeDnsChange(current.records, plan.changes[previous])
                .state !== 'after'
            )
              throw new SalesError(
                'DNS_CONFLICT',
                'Previously verified DNS changed. Later edits were preserved.',
                409,
              );
          const revisedPlan = revisedCertificatePlan(
            plan,
            hosts,
            r.generation,
            through,
          );
          const digest = await this.store.hash(
            'lander-item',
            canonicalJson(revisedPlan),
          );
          await fence();
          await this.store.atomic([
            ...this.store.guard(
              "EXISTS(SELECT 1 FROM lander_jobs WHERE id=? AND state='running' AND digest=?) AND EXISTS(SELECT 1 FROM lander_items WHERE job_id=? AND ordinal=? AND generation=? AND lease=? AND lease_until>?)",
              [
                r.job_id,
                j.digest,
                r.job_id,
                r.ordinal,
                r.generation,
                lease,
                Date.now(),
              ],
            ),
            this.store.db
              .prepare(
                "UPDATE lander_items SET state='ready',sealed=?,digest=?,reason=?,due_at=0,lease=NULL,lease_until=0 WHERE job_id=? AND ordinal=? AND generation=? AND lease=?",
              )
              .bind(
                await this.store.seal({ ...p, plan: revisedPlan }),
                digest,
                'Certificate validation changed. Review the updated DNS records before continuing.',
                r.job_id,
                r.ordinal,
                r.generation,
                lease,
              ),
            this.store.db
              .prepare(
                "UPDATE lander_jobs SET state='preparing',digest=NULL,updated_at=? WHERE id=? AND state='running'",
              )
              .bind(Date.now(), r.job_id),
          ]);
          return;
        }
        if (j.state === 'restoring') {
          if (p.write?.state === 'intent') {
            const submitted = observeDnsChange(
              current.records,
              plan.changes[p.write.index],
            );
            if (submitted.state !== 'after') {
              await save(
                submitted.state === 'conflict' ? 'conflict' : 'held',
                submitted.state === 'conflict'
                  ? 'A submitted DNS write conflicts with current records. Later edits were preserved.'
                  : 'A submitted DNS write is still unobserved. Restore is held because that write may arrive later; reconcile the provider outcome before cutback.',
              );
              return;
            }
            p.write = {
              index: p.write.index,
              state: 'verified',
              record: submitted.record,
            };
          }
          // Only submitted forward steps belong to this recovery. Later
          // delete/create pairs still describe the untouched original routing.
          const submittedThrough = p.write?.index ?? -1;
          let index = Math.min(
            p.restoreIndex ?? submittedThrough,
            submittedThrough,
          );
          if (index < 0) {
            await save('restored-dns');
            return;
          }
          const change = plan.changes[index],
            seen = observeDnsChange(current.records, change);
          if (seen.state === 'conflict') {
            await save(
              'conflict',
              'Newer DNS edits conflict with restore. They were preserved.',
            );
            return;
          }
          if (seen.state === 'after') {
            // One reverse operation per scheduled step. Unknown reverse writes
            // are reconciled from the same immutable before/after pair.
            if (p.restoreIntent === index) {
              await save(
                'held',
                'A submitted restore has an unknown outcome. It was not replayed. Check the provider before retrying.',
              );
              return;
            }
            p.restoreIntent = index;
            await this.store.db
              .prepare(
                'UPDATE lander_items SET sealed=? WHERE job_id=? AND ordinal=? AND lease=? AND lease_until>?',
              )
              .bind(
                await this.store.seal(p),
                r.job_id,
                r.ordinal,
                lease,
                Date.now(),
              )
              .run();
            await fence();
            await provider.write(current, {
              before: seen.record,
              after: change.before,
            });
            const verified = observeDnsChange(
              (await provider.snapshot(plan.domain, current.zoneId)).records,
              change,
            );
            if (verified.state !== 'before')
              throw new LanderDnsError(
                'DNS_RESTORE_UNKNOWN',
                'Restore requires reconciliation.',
                true,
              );
          }
          delete p.restoreIntent;
          p.restoreIndex = --index;
          await save(
            index < 0 ? 'restored-dns' : 'restore',
            null,
            Date.now() + 1000,
          );
          return;
        }
        if (plan.publicationReview && !saved.published) {
          await fence();
          // Durable approval leases only this exact parent-bound review.
          // Publication still rechecks the projection, source and CAS guards.
          await this.store.db
            .prepare(
              'UPDATE sales_reviews SET expires_at=? WHERE id=? AND consumed_at IS NULL',
            )
            .bind(Date.now() + 120000, plan.publicationReview)
            .run();
          await this.store.publish(plan.publicationReview, this.observe);
        } else if (saved.availability !== 'available')
          throw new SalesError(
            'PUBLICATION_PAUSED',
            'This page is paused or withdrawn. Review again.',
            409,
          );
        let index = p.write?.index ?? 0;
        if (p.write?.state === 'verified') index++;
        for (let previous = 0; previous < index; previous++)
          if (
            observeDnsChange(current.records, plan.changes[previous]).state !==
            'after'
          ) {
            await save(
              'conflict',
              'A previously verified DNS record changed. Later edits were preserved.',
            );
            return;
          }
        if (index < plan.changes.length) {
          const change = plan.changes[index],
            seen = observeDnsChange(current.records, change);
          if (
            isLanderWebChange(change) &&
            !['tls-ready', 'live'].includes(hostingState ?? '')
          ) {
            await save(
              'pending-tls',
              'Preparing HTTPS before changing web routing.',
              Date.now() + 120000,
            );
            return;
          }
          if (isLanderWebChange(change))
            planLanderDns(current, plan.hosts, r.generation);
          if (seen.state === 'conflict') {
            await save(
              'conflict',
              'DNS changed after confirmation. Later edits were preserved.',
            );
            return;
          }
          if (seen.state === 'before') {
            if (p.write?.index === index && p.write.state === 'intent') {
              await save(
                'held',
                'A submitted DNS write has an unknown outcome. It was not replayed. Reconcile or restore after checking the provider.',
              );
              return;
            }
            p.write = { index, state: 'intent' };
            // Persist intent before submission, retaining the finite claim.
            await this.store.db
              .prepare(
                'UPDATE lander_items SET sealed=? WHERE job_id=? AND ordinal=? AND lease=? AND lease_until>?',
              )
              .bind(
                await this.store.seal(p),
                r.job_id,
                r.ordinal,
                lease,
                Date.now(),
              )
              .run();
            await fence();
            await provider.write(current, change);
          }
          const checked = observeDnsChange(
            (await provider.snapshot(plan.domain, current.zoneId)).records,
            change,
          );
          if (checked.state !== 'after')
            throw new LanderDnsError(
              'DNS_UNKNOWN',
              'The DNS write could not be verified.',
              true,
            );
          p.write = { index, state: 'verified', record: checked.record };
          await save('dns', null, Date.now() + 1000);
        } else
          await save(
            hostingState === 'live' ? 'live' : 'hosting',
            hostingState === 'live'
              ? null
              : 'Waiting for DNS, certificates and the exact public page.',
            Date.now() + 120000,
          );
      }
    } catch (error) {
      const uncertain = error instanceof LanderDnsError && error.uncertain;
      const retry =
        error instanceof LanderDnsError &&
        ['DNS_UNAVAILABLE', 'DNS_RATE_LIMIT'].includes(error.code);
      await save(
        uncertain ? 'reconciling' : retry ? r.state : 'held',
        error instanceof SalesError || error instanceof LanderDnsError
          ? error.message
          : 'Connection could not be qualified. Check provider permissions, publication and hosting configuration.',
        retry || uncertain ? Date.now() + 120000 : 0,
      );
    } finally {
      await this.store.db
        .prepare(
          'UPDATE lander_items SET lease=NULL,lease_until=0 WHERE job_id=? AND ordinal=? AND lease=?',
        )
        .bind(r.job_id, r.ordinal, lease)
        .run();
      await this.finalize(r.job_id);
    }
  }
  async due() {
    const r = await this.store.db
      .prepare(
        "SELECT min(max(i.due_at,i.lease_until)) AS due FROM lander_items i JOIN lander_jobs j ON j.id=i.job_id WHERE (j.state='preparing' AND i.state='preparing') OR (j.state IN ('running','restoring') AND i.state NOT IN ('held','live','cancelled','restored','conflict'))",
      )
      .first<{ due: number | null }>();
    return r?.due ?? null;
  }
}
