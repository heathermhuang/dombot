import type {
  DnsSnapshot,
  DnsChange,
  LanderHostingPlan,
  NativeDnsRecord,
} from '../../shared/lander-connection';
import { LanderDnsError, sameRecord } from './lander-cloudflare';

const name = (s: string) => s.toLowerCase().replace(/\.$/, '');
function hold(message: string): never {
  throw new LanderDnsError('DNS_DEPENDENCY', message);
}
/** Conservative dependency analysis. Ambiguous routing is held for review. */
export function planLanderDns(
  snapshot: DnsSnapshot,
  hosts: LanderHostingPlan[],
  connection: string,
): DnsChange[] {
  const domain = snapshot.domain,
    names = new Set([domain, `www.${domain}`]);
  if (
    hosts.length !== 2 ||
    new Set(hosts.map((h) => h.hostname)).size !== 2 ||
    hosts.some((h) => !names.has(h.hostname))
  )
    hold('Root and www require separate qualified hosting plans.');
  const records = snapshot.records;
  if (records.some((r) => r.name.startsWith('*.')))
    hold('Review wildcard DNS before connecting this domain.');
  const depends = new Set(names);
  for (let i = 0; i <= records.length; i++) {
    let changed = false;
    for (const r of records)
      if (
        ['CNAME', 'DNAME'].includes(r.type) &&
        depends.has(name(r.content)) &&
        !depends.has(name(r.name))
      ) {
        depends.add(name(r.name));
        changed = true;
      }
    if (!changed) break;
  }
  for (const r of records) {
    const host = name(r.name);
    if (['HTTPS', 'SVCB', 'DNAME'].includes(r.type) && names.has(host))
      hold('Review HTTPS/SVCB or alias routing before connecting.');
    if (r.type === 'MX' && depends.has(name(r.content)))
      hold(
        'Mail delivery depends on the web address being changed. Move the mail dependency first.',
      );
    if (
      r.type === 'SRV' &&
      depends.has(name(r.content.split(/\s+/).at(-1) ?? ''))
    )
      hold('An SRV service depends on the web address being changed.');
    if (r.type === 'TXT' && /v=spf1/i.test(r.content)) {
      // a/mx default to the owner name; explicit cross-zone terms and macros
      // require separate analysis and are held, not guessed safe.
      for (const term of r.content.replaceAll('"', '').split(/\s+/)) {
        const m = /^[+?~-]?(a|mx)(?::([^/]+))?(?:\/.*)?$/i.exec(term);
        if (m && (depends.has(name(m[2] ?? host)) || m[2]?.includes('%')))
          hold(
            'SPF a/mx authorization depends on the changed web routing. Review email before connecting.',
          );
        if (/^[+?~-]?(?:include:|redirect=)/i.test(term))
          hold(
            'SPF includes or redirects need a verified external dependency review.',
          );
      }
    }
    if (
      r.type === 'NS' &&
      host !== domain &&
      [...names, ...hosts.flatMap((h) => h.records.map((v) => v.name))].some(
        (h) => h === host || h.endsWith('.' + host),
      )
    )
      hold('A requested hostname or proof belongs to a delegated subzone.');
  }
  const changes: DnsChange[] = [];
  for (const h of hosts) {
    const current = records.filter((r) => name(r.name) === h.hostname);
    if (current.some((r) => r.proxied))
      hold(
        'Existing Cloudflare proxy/O2O routing needs separate qualification.',
      );
    const web = current.filter((r) => ['A', 'AAAA', 'CNAME'].includes(r.type));
    if (web.length > 1)
      hold(
        'Multiple web address records need a reviewed provider batch conversion.',
      );
    // A CNAME cannot coexist with other data at its owner (Cloudflare apex
    // flattening is the qualified exception). Preserve all unrelated records.
    if (
      h.hostname !== domain &&
      current.some((r) => !['A', 'AAAA', 'CNAME'].includes(r.type))
    )
      hold(
        'Other records coexist at www. Review them before changing its routing.',
      );
    const before = web[0] ?? null;
    const after = {
      ...(before ?? {}),
      type: 'CNAME',
      name: h.hostname,
      content: h.target,
      ttl: before?.ttl ?? 300,
      proxied: false,
      ...(!before
        ? { comment: `Domains.Domains connection ${connection}` }
        : {}),
    };
    if (!before || !sameRecord(before, after)) changes.push({ before, after });
    for (const proof of h.records) {
      const owner = name(proof.name);
      if (
        !['_domains-sales.', '_cf-custom-hostname.', '_acme-challenge.'].some(
          (p) => owner === p + h.hostname,
        )
      )
        hold('Hosting returned a proof outside the approved hostname.');
      if (records.some((r) => name(r.name) === owner && r.type !== 'TXT'))
        hold(
          'An existing alias conflicts with a required ownership or certificate proof.',
        );
      if (
        !records.some(
          (r) =>
            name(r.name) === owner &&
            r.type === 'TXT' &&
            r.content === proof.value,
        )
      )
        changes.push({
          before: null,
          after: {
            type: 'TXT',
            name: owner,
            content: proof.value,
            ttl: 300,
            comment: `Domains.Domains connection ${connection}`,
          },
        });
    }
  }
  // Prove ownership and prepare certificates before replacing web routing.
  return changes.sort(
    (a, b) =>
      Number(a.after?.type === 'CNAME') - Number(b.after?.type === 'CNAME'),
  );
}
export type ChangeObservation = {
  state: 'before' | 'after' | 'conflict';
  record: NativeDnsRecord | null;
};
/** Reconcile one intent by record identity and exact writable attributes. */
export function observeDnsChange(
  records: NativeDnsRecord[],
  change: DnsChange,
): ChangeObservation {
  if (change.before) {
    const r = records.find((r) => r.id === change.before!.id) ?? null;
    if (!r && !change.after) return { state: 'after', record: null };
    if (r && change.after && sameRecord(r, change.after))
      return { state: 'after', record: r };
    if (r && sameRecord(r, change.before))
      return { state: 'before', record: r };
    return { state: 'conflict', record: r };
  }
  const matches = records.filter(
    (r) => change.after && sameRecord(r, change.after),
  );
  if (matches.length === 1) return { state: 'after', record: matches[0] };
  if (matches.length > 1) return { state: 'conflict', record: null };
  if (
    records.some(
      (r) =>
        change.after &&
        r.name === change.after.name &&
        r.type === change.after.type &&
        (r.type === 'CNAME' || r.comment === change.after.comment),
    )
  )
    return { state: 'conflict', record: null };
  return { state: 'before', record: null };
}
