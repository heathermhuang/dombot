import type {
  DnsChange,
  LanderJobView,
  LanderReviewItem,
} from '../../shared/lander-connection';

export const domainCount = (n: number) =>
  `${n} ${n === 1 ? 'domain' : 'domains'}`;
export const landerIssue = (reason: string) =>
  reason ===
  'Connection could not be qualified. Check provider permissions, publication and hosting configuration.'
    ? 'A DNS or hosting check could not finish. The connection stopped; review its saved changes before recovery.'
    : reason;
const states: Record<string, string> = {
  preparing: 'Checking DNS and HTTPS',
  ready: 'Ready to review',
  queued: 'Waiting to start',
  dns: 'Updating DNS',
  'pending-tls': 'Preparing HTTPS',
  hosting: 'Checking the public page',
  live: 'Connected',
  held: 'Needs attention',
  conflict: 'DNS changed — review needed',
  reconciling: 'Checking the provider response',
  cleanup: 'Removing preview',
  restore: 'Restoring DNS',
  'restored-dns': 'Removing hosting resources',
  restored: 'Restored',
  cancelled: 'Stopped',
};
export function landerItemLabel(
  item: Pick<LanderReviewItem, 'state' | 'dnsProgress'>,
) {
  if (item.state === 'restored' && item.dnsProgress?.tracked === 0)
    return 'Connection removed';
  return states[item.state] ?? 'Checking connection';
}
export function landerJobLabel(
  job: Pick<LanderJobView, 'state' | 'total' | 'counts'>,
) {
  if (
    job.total > 0 &&
    job.counts.some((c) => c.state === 'live' && c.count === job.total)
  )
    return 'Connected';
  if (job.counts.some((c) => ['held', 'conflict'].includes(c.state)))
    return 'Needs attention';
  if (
    job.total > 0 &&
    job.counts.some((c) => c.state === 'restored' && c.count === job.total)
  )
    return 'Restored';
  return (
    (
      {
        preparing: 'Preparing connection',
        'awaiting-review': 'Review connection',
        running: 'Connecting',
        restoring: 'Restoring',
        cancelled: 'Stopped',
        finished: 'Finished',
      } as Record<string, string>
    )[job.state] ?? 'Connection'
  );
}
export function savedLanderReview(
  value: string | null,
): { id: string; cursor: number } | null {
  try {
    const v = JSON.parse(value ?? 'null');
    if (
      !v ||
      typeof v.id !== 'string' ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v.id)
    )
      return null;
    return {
      id: v.id,
      cursor: Number.isInteger(v.cursor) && v.cursor >= -1 ? v.cursor : -1,
    };
  } catch {
    return null;
  }
}
type ReviewLocation = Pick<Location, 'pathname' | 'search' | 'hash'>;
export function landerReviewFromLocation(place: ReviewLocation) {
  const hash = place.hash.startsWith('#/')
    ? new URL(place.hash.slice(1), 'https://ui.invalid')
    : null;
  const params = hash?.searchParams.has('landerConnection')
    ? hash.searchParams
    : new URLSearchParams(place.search);
  return savedLanderReview(
    JSON.stringify({
      id: params.get('landerConnection'),
      cursor: Number(params.get('landerCursor') ?? -1),
    }),
  );
}
/** Only a read-only view reference travels through authentication, never an action. */
export function landerReviewPath(
  place: ReviewLocation,
  view: { id: string; cursor: number } | null,
) {
  const outer = new URLSearchParams(place.search);
  const hash = place.hash.startsWith('#/')
    ? new URL(place.hash.slice(1), 'https://ui.invalid')
    : null;
  for (const params of [outer, ...(hash ? [hash.searchParams] : [])]) {
    params.delete('landerConnection');
    params.delete('landerCursor');
  }
  const valid = view ? savedLanderReview(JSON.stringify(view)) : null;
  const params = hash?.searchParams ?? outer;
  if (valid) {
    params.set('landerConnection', valid.id);
    params.set('landerCursor', String(valid.cursor));
  }
  const search = outer.toString();
  return (
    place.pathname +
    (search ? '?' + search : '') +
    (hash ? '#' + hash.pathname + hash.search + hash.hash : place.hash)
  );
}
export function landerRoutingChanges(changes: DnsChange[]) {
  const rows = new Map<
    string,
    { name: string; before: string | null; after: string | null }
  >();
  for (const change of changes) {
    const r = change.after ?? change.before;
    if (!r || !['A', 'AAAA', 'CNAME', 'ANAME'].includes(r.type)) continue;
    const row = rows.get(r.name) ?? { name: r.name, before: null, after: null };
    if (change.before)
      row.before = `${change.before.type} ${change.before.content}`;
    if (change.after)
      row.after = `${change.after.type} ${change.after.content}`;
    rows.set(r.name, row);
  }
  return [...rows.values()];
}
