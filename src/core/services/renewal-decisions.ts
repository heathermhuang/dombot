import { Namespace } from '../storage/namespace';
import { z } from 'zod';
import { toAscii } from '../../shared/domain-name';
import {
  renewalDecisionSchema,
  notificationPreferencesSchema,
} from '../../shared/notification-policy';

const decisions = new Namespace<z.infer<typeof renewalDecisionSchema>>(
  'renewal-decisions',
);
export class RenewalDecisionConflict extends Error {
  constructor() {
    super('This reminder changed. Reload before saving.');
  }
}
export function renewalDecisions() {
  return Object.fromEntries(
    Object.entries(decisions.all()).map(([key, value]) => [
      key,
      renewalDecisionSchema.parse(value).value,
    ]),
  );
}
export async function decideRenewal(
  key: string,
  value: 'expire' | 'handled' | null,
  revision: string | null,
) {
  const old = decisions.get(key);
  if ((old?.revision ?? null) !== revision) throw new RenewalDecisionConflict();
  if (value === null) await decisions.delete(key);
  else await decisions.set(key, { value, revision: crypto.randomUUID() });
}
export function decisionRecords() {
  return decisions.all();
}

const preferenceDrafts = new Namespace<
  z.infer<typeof notificationPreferencesSchema>
>('notification-preference-drafts');
export function notificationPreferenceDraft() {
  const value = preferenceDrafts.get('choices');
  return value ? notificationPreferencesSchema.parse(value) : null;
}
export function forgetRenewalDecisions(names: string[]) {
  const removed = new Set(names.map(toAscii));
  for (const key of Object.keys(decisions.all()))
    if (removed.has(key.split('|')[0])) void decisions.delete(key);
}
