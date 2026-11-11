import { z } from 'zod';
import { LanderDynadot } from '../core/services/lander-dynadot';
import { LanderDnsError } from '../core/services/lander-cloudflare';
import { canonicalJson, type DnsSnapshot } from '../shared/lander-connection';
import {
  dynadotDnsSetupScope,
  type DynadotDnsSetupScope,
} from '../shared/dynadot-dns-setup';
import { registrarHostsDns } from '../shared/market-verification';
import { resolveNameservers } from '../core/dns';
import { landerRecoverySchema } from './lander-backup';
import { SalesStore } from './sales-store';

const oldNameservers = ['a.dns.park.io', 'b.dns.park.io'];
const normalize = (s: string) => s.toLowerCase().replace(/\.$/, '');
const nameserverSchema = z.object({
  nameserver_list: z.array(z.object({ server_name: z.string() })).default([]),
});
const nsList = (v: unknown, allowEmpty = false) => {
  const list = nameserverSchema
    .parse(v)
    .nameserver_list.map((n) => normalize(n.server_name))
    .sort();
  if (!list.length && !allowEmpty)
    throw Error('The registrar did not report the current delegation.');
  return list;
};
const sha = async (s: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
function scope(env: Env) {
  const s = dynadotDnsSetupScope(
    env.DYNDNS_SETUP_FIXTURE,
    env.DOMBOT_WORKSPACE_ID ?? '',
  );
  if (!s) throw Error('This one-domain DNS setup is not enabled.');
  return s;
}
const desired = {
  dns_main_list: [{ record_type: 'aname', record_value1: 'park.io' }],
  dns_sub_list: [
    { sub_host: 'www', record_type: 'cname', record_value1: 'park.io' },
  ],
  ttl: 300,
  add_dns_to_current_setting: true,
};
/** Explicit, time-bounded, owner-confirmed registrar DNS initialization. This
 * is not part of automatic lander jobs and never accepts caller-selected DNS. */
export class DynadotDnsSetup {
  constructor(
    readonly env: Env,
    readonly fetcher: typeof fetch = fetch,
  ) {}
  private async confirmNoPublicDs(domain: string) {
    const r = await this.fetcher(
      'https://cloudflare-dns.com/dns-query?name=' +
        encodeURIComponent(domain) +
        '&type=DS',
      {
        headers: { Accept: 'application/dns-json' },
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!r.ok) throw Error('Public DNSSEC evidence is unavailable.');
    const reader = r.body?.getReader(),
      decoder = new TextDecoder();
    let text = '',
      bytes = 0;
    try {
      if (reader)
        for (;;) {
          const c = await reader.read();
          if (c.done) break;
          bytes += c.value.length;
          if (bytes > 65536) throw Error('Oversized DNSSEC evidence.');
          text += decoder.decode(c.value, { stream: true });
        }
      text += decoder.decode();
      const value = z
        .object({
          Status: z.literal(0),
          Answer: z
            .array(z.object({ type: z.number() }))
            .max(256)
            .optional(),
        })
        .parse(JSON.parse(text));
      if (value.Answer?.some((a) => a.type === 43))
        throw Error('DNSSEC delegation needs a separate migration review.');
    } catch (e) {
      await reader?.cancel().catch(() => {});
      throw e;
    }
  }
  /** Fixed-scope, read-only protocol diagnostics. Never returns credentials or
   * record contents, and never creates a receipt, lock or provider mutation. */
  async inspect() {
    const s = scope(this.env);
    const api = new LanderDynadot(s.accountId, this.fetcher);
    const result: Record<string, unknown> = { domain: s.domain };
    for (const suffix of ['/records', '/nameservers', '/dnssec']) {
      try {
        const raw = await api.call(s.domain, suffix);
        const value = z.record(z.string(), z.unknown()).parse(raw);
        if (suffix === '/records') {
          const glue = z.record(z.string(), z.unknown()).parse(value.glue_info);
          result.records = {
            mode: typeof glue.glue_type === 'string' ? glue.glue_type : null,
            fields: Object.keys(glue).sort(),
            mainCount: Array.isArray(glue.dns_main_list)
              ? glue.dns_main_list.length
              : null,
            subCount: Array.isArray(glue.dns_sub_list)
              ? glue.dns_sub_list.length
              : null,
            forwarding:
              glue.email_forward_type === undefined
                ? 'absent'
                : glue.email_forward_type === 'MTYPE_NONE'
                  ? 'none'
                  : 'other',
          };
        } else if (suffix === '/nameservers') {
          result.nameservers = nsList(value, true);
        } else {
          result.dnssec = {
            fields: Object.keys(value).sort(),
            count: Array.isArray(value.dnssec_info_list)
              ? value.dnssec_info_list.length
              : null,
          };
        }
      } catch (error) {
        result[suffix.slice(1)] = {
          error: error instanceof LanderDnsError ? error.code : 'DNS_REPLY',
        };
      }
    }
    try {
      const store = await SalesStore.from(this.env);
      const { payload } = await this.prepare(
        api,
        s,
        await sha(api.credentials().apiKey!),
      );
      await store.seal(payload);
      result.preflight = { ready: true };
    } catch (error) {
      result.preflight = {
        ready: false,
        code:
          error instanceof LanderDnsError
            ? error.code
            : error instanceof z.ZodError
              ? 'DNS_SHAPE'
              : error instanceof Error &&
                  error.message === 'Public DNSSEC evidence is unavailable.'
                ? 'DNS_PUBLIC_DS'
                : 'DNS_PREFLIGHT',
      };
    }
    return result;
  }
  async view() {
    const s = scope(this.env),
      store = await SalesStore.from(this.env),
      hash = await store.hash('domain', s.domain);
    const receipt = await store.db
      .prepare('SELECT sealed FROM lander_recovery_archive WHERE id=?')
      .bind('dns-setup:' + s.requestId)
      .first<{ sealed: string }>();
    const lock = await store.db
      .prepare('SELECT job_id FROM lander_domain_locks WHERE domain_hash=?')
      .bind(hash)
      .first<{ job_id: string }>();
    const requestId: string | null = receipt ? s.requestId : null;
    if (lock && lock.job_id !== s.requestId)
      throw Error('An existing DNS operation owns this domain.');
    return {
      scope: s,
      domain: s.domain,
      previousNameservers: oldNameservers,
      requestId: s.requestId,
      reconciliation: !!requestId || !!lock,
    };
  }
  private async prepare(
    api: LanderDynadot,
    s: DynadotDnsSetupScope,
    credentialIdentity: string,
  ) {
    const raw = z
      .object({
        glue_info: z
          .object({
            glue_type: z.literal('NAME_SERVERS'),
            dns_main_list: z.array(z.unknown()).optional(),
            dns_sub_list: z.array(z.unknown()).optional(),
            email_forward_type: z.string().optional(),
            email_alias_list: z.array(z.unknown()).optional(),
          })
          .passthrough(),
      })
      .parse(await api.call(s.domain, '/records'));
    const previousNs = nsList(await api.call(s.domain, '/nameservers'));
    const dnssec = z
      .object({
        dnssec_info_list: z.array(z.record(z.string(), z.unknown())).optional(),
      })
      .passthrough()
      .parse(await api.call(s.domain, '/dnssec'));
    if (
      canonicalJson(previousNs) !== canonicalJson(oldNameservers) ||
      raw.glue_info.dns_main_list?.length ||
      raw.glue_info.dns_sub_list?.length ||
      dnssec.dnssec_info_list?.length ||
      raw.glue_info.email_alias_list?.length ||
      (raw.glue_info.email_forward_type &&
        raw.glue_info.email_forward_type !== 'MTYPE_NONE')
    )
      throw Error(
        'Current delegation, DNSSEC or provider services require a separate migration review.',
      );
    await this.confirmNoPublicDs(s.domain);
    const snapshot: DnsSnapshot = {
      provider: 'dynadot',
      accountId: s.accountId,
      providerAccountId: credentialIdentity,
      zoneId: await api.zoneId(s.domain),
      domain: s.domain,
      observedAt: Date.now(),
      nameservers: previousNs,
      records: [],
      dnssec,
      settings: {
        kind: 'dynadot-dns-initialization',
        phase: 'intent',
        registrarConfiguration: raw.glue_info,
        desired,
        declaredUnused: true,
        authoritativeZoneBackup:
          'The Park.io zone remains at the original nameservers; this is its registrar delegation configuration.',
      },
    };
    const payload = landerRecoverySchema.shape.payload.parse({
      domain: s.domain,
      snapshot,
    });
    if (new TextEncoder().encode(JSON.stringify(payload)).length > 500000)
      throw Error(
        'The complete registrar configuration exceeds its recovery limit.',
      );
    return { raw, previousNs, dnssec, payload };
  }
  async initialize(
    requestId: string,
    unused: boolean,
    expectedScope?: DynadotDnsSetupScope,
  ) {
    z.string().uuid().parse(requestId);
    if (unused !== true)
      throw Error(
        'Confirm that this unused domain has no email or custom DNS services.',
      );
    const s = scope(this.env),
      store = await SalesStore.from(this.env),
      domainHash = await store.hash('domain', s.domain),
      id = 'dns-setup:' + requestId;
    if (requestId !== s.requestId)
      throw Error('This request is outside the configured one-domain setup.');
    if (expectedScope && canonicalJson(expectedScope) !== canonicalJson(s))
      throw Error('Gateway and portfolio DNS setup scopes differ.');
    const fence = async () => {
      if (
        canonicalJson(scope(this.env)) !== canonicalJson(s) ||
        !credentialIdentity ||
        (await sha(api.credentials().apiKey!)) !== credentialIdentity
      )
        throw Error('DNS setup scope or credential changed.');
      const lock = await store.db
        .prepare(
          'SELECT 1 FROM lander_domain_locks WHERE domain_hash=? AND job_id=? AND ordinal=0 AND generation=?',
        )
        .bind(domainHash, requestId, requestId)
        .first();
      if (!lock) throw Error('DNS setup authority changed.');
    };
    const api = new LanderDynadot(s.accountId, this.fetcher, fence);
    const credentialIdentity = await sha(api.credentials().apiKey!);
    const retained = await store.db
      .prepare('SELECT sealed FROM lander_recovery_archive WHERE id=?')
      .bind(id)
      .first<{ sealed: string }>();
    if (retained) {
      const payload = await store.open(
        retained.sealed,
        landerRecoverySchema.shape.payload,
      );
      if (
        payload.domain !== s.domain ||
        payload.snapshot?.accountId !== s.accountId ||
        payload.snapshot.settings.kind !== 'dynadot-dns-initialization'
      )
        throw Error('DNS receipt belongs to a different setup.');
      return this.reconcile(store, api, s, requestId, retained.sealed, payload);
    }
    const { raw, previousNs, dnssec, payload } = await this.prepare(
      api,
      s,
      credentialIdentity,
    );
    const sealed = await store.seal(payload);
    const lock = await store.db
      .prepare(
        'INSERT INTO lander_domain_locks(domain_hash,job_id,ordinal,generation) VALUES(?,?,0,?) ON CONFLICT DO NOTHING RETURNING job_id',
      )
      .bind(domainHash, requestId, requestId)
      .first();
    if (!lock) throw Error('An existing DNS operation owns this domain.');
    let inserted = false,
      submitted = false;
    try {
      const insertedRow = await store.db
        .prepare(
          'INSERT INTO lander_recovery_archive(id,sealed,restored_at) VALUES(?,?,?) ON CONFLICT DO NOTHING RETURNING id',
        )
        .bind(id, sealed, Date.now())
        .first();
      if (!insertedRow)
        throw Error(
          'This request already has a DNS receipt. Recheck it instead.',
        );
      inserted = true;
      // Fence and re-read immediately before the single native append. Never
      // replay an intent, even when a timed-out submission is not yet observable.
      await fence();
      const fresh = z
        .object({ glue_info: z.record(z.string(), z.unknown()) })
        .parse(await api.call(s.domain, '/records'));
      const freshDnssec = await api.call(s.domain, '/dnssec');
      await this.confirmNoPublicDs(s.domain);
      if (
        canonicalJson(fresh) !== canonicalJson(raw) ||
        canonicalJson(freshDnssec) !== canonicalJson(dnssec) ||
        canonicalJson(nsList(await api.call(s.domain, '/nameservers'))) !==
          canonicalJson(previousNs) ||
        (await sha(api.credentials().apiKey!)) !==
          payload.snapshot!.providerAccountId
      )
        throw Error(
          'The approved registrar configuration changed before submission.',
        );
      let error: unknown;
      try {
        submitted = true;
        await api.call(s.domain, '/records', 'POST', desired);
      } catch (e) {
        error = e;
      }
      const result = await this.reconcile(
        store,
        api,
        s,
        requestId,
        sealed,
        payload,
      );
      if (
        result.state !== 'configured' &&
        error instanceof LanderDnsError &&
        !error.uncertain
      ) {
        const unchanged = z
          .object({ glue_info: z.record(z.string(), z.unknown()) })
          .parse(await api.call(s.domain, '/records'));
        if (
          canonicalJson(unchanged) === canonicalJson(raw) &&
          canonicalJson(nsList(await api.call(s.domain, '/nameservers'))) ===
            canonicalJson(previousNs)
        ) {
          payload.snapshot!.settings.phase = 'rejected';
          await store.db
            .prepare(
              'UPDATE lander_recovery_archive SET sealed=? WHERE id=? AND sealed=?',
            )
            .bind(await store.seal(payload), id, sealed)
            .run();
          await this.unlock(store, s, requestId);
          return { domain: s.domain, state: 'rejected' as const, receipt: id };
        }
      }
      return result;
    } catch (e) {
      if (inserted && !submitted) {
        payload.snapshot!.settings.phase = 'rejected';
        await store.db
          .prepare(
            'UPDATE lander_recovery_archive SET sealed=? WHERE id=? AND sealed=?',
          )
          .bind(await store.seal(payload), id, sealed)
          .run();
      }
      if (!inserted || !submitted) await this.unlock(store, s, requestId);
      throw e;
    }
  }
  private async unlock(store: SalesStore, s: DynadotDnsSetupScope, id: string) {
    await store.db
      .prepare(
        'DELETE FROM lander_domain_locks WHERE domain_hash=? AND job_id=? AND generation=?',
      )
      .bind(await store.hash('domain', s.domain), id, id)
      .run();
  }
  private async reconcile(
    store: SalesStore,
    api: LanderDynadot,
    s: DynadotDnsSetupScope,
    requestId: string,
    sealed: string,
    payload: z.infer<typeof landerRecoverySchema.shape.payload>,
  ) {
    const receipt = 'dns-setup:' + requestId;
    if (payload.snapshot!.settings.phase === 'rejected')
      return { domain: s.domain, state: 'rejected' as const, receipt };
    try {
      const current = await api.read(s.domain);
      let ns = nsList(await api.call(s.domain, '/nameservers'), true);
      if (!ns.length)
        ns = (await resolveNameservers(s.domain, this.fetcher))
          .map(normalize)
          .sort();
      const matches =
        current.records.length === 2 &&
        current.records.some(
          (r) =>
            r.type === 'ANAME' &&
            r.name === s.domain &&
            normalize(r.content) === 'park.io',
        ) &&
        current.records.some(
          (r) =>
            r.type === 'CNAME' &&
            r.name === 'www.' + s.domain &&
            normalize(r.content) === 'park.io',
        ) &&
        current.value.ttl === 300 &&
        ns.length > 0 &&
        registrarHostsDns('dynadot', ns) &&
        (await sha(api.credentials().apiKey!)) ===
          payload.snapshot!.providerAccountId;
      if (!matches)
        return { domain: s.domain, state: 'held' as const, receipt };
      payload.snapshot!.settings.phase = 'verified';
      payload.snapshot!.settings.result = {
        nameservers: ns,
        registrarConfiguration: current.value,
        observedAt: Date.now(),
      };
      const updated = await store.db
        .prepare(
          'UPDATE lander_recovery_archive SET sealed=? WHERE id=? AND sealed=? RETURNING id',
        )
        .bind(await store.seal(payload), receipt, sealed)
        .first();
      if (updated) await this.unlock(store, s, requestId);
      return {
        domain: s.domain,
        state: 'configured' as const,
        nameservers: ns,
        receipt,
      };
    } catch {
      return { domain: s.domain, state: 'held' as const, receipt };
    }
  }
}
