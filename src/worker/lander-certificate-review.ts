import {
  canonicalJson,
  landerPlanSchema,
  type LanderPlan,
  type LanderHostingPlan,
} from '../shared/lander-connection';
import { SalesError } from '../shared/sales-review';
import {
  isLanderWebChange,
  planLanderDns,
} from '../core/services/lander-dns-plan';

/** Preserve the approved prefix and rollback baseline; require a new digest
 * before any changed provider challenge can be written. */
export function revisedCertificatePlan(
  plan: LanderPlan,
  currentHosts: LanderHostingPlan[],
  generation: string,
  submittedThrough: number,
) {
  const fail = (): never => {
    throw new SalesError(
      'CERTIFICATE_REVIEW',
      'Certificate setup changed outside the retained DNS review. Restore before preparing another connection.',
      409,
    );
  };
  if (currentHosts.length !== 2) fail();
  const hosts = plan.hosts.map((old) => {
    const current = currentHosts.find((h) => h.hostname === old.hostname);
    if (
      !current ||
      current.epoch !== old.epoch ||
      current.challenge !== old.challenge ||
      current.target !== old.target
    )
      return fail();
    if (
      current.records.some(
        (r) =>
          !old.records.some((v) => canonicalJson(v) === canonicalJson(r)) &&
          r.name !== `_acme-challenge.${old.hostname}`,
      )
    )
      fail();
    const all = [...old.records];
    for (const record of current.records)
      if (!all.some((v) => canonicalJson(v) === canonicalJson(record)))
        all.push(record);
    return { ...old, records: all };
  });
  const web = plan.changes.findIndex(isLanderWebChange),
    boundary = web < 0 ? plan.changes.length : web;
  if (
    submittedThrough >= boundary ||
    plan.changes.slice(0, boundary).some(isLanderWebChange) ||
    plan.changes.slice(boundary).some((c) => !isLanderWebChange(c))
  )
    fail();
  const added = planLanderDns(plan.snapshot, hosts, generation).filter(
    (c) => !plan.changes.some((old) => canonicalJson(old) === canonicalJson(c)),
  );
  if (
    !added.length ||
    added.some(
      (c) =>
        c.before ||
        c.after?.type !== 'TXT' ||
        !hosts.some((h) => c.after?.name === `_acme-challenge.${h.hostname}`),
    )
  )
    fail();
  return landerPlanSchema.parse({
    ...plan,
    hosts,
    changes: [
      ...plan.changes.slice(0, boundary),
      ...added,
      ...plan.changes.slice(boundary),
    ],
    expiresAt: Date.now() + 900000,
  });
}
