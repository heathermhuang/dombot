import { z } from 'zod';

export const DAY = 86_400_000;
export const notificationPreferencesSchema = z
  .object({
    renewalReminders: z.boolean(),
    weeklyOverview: z.boolean(),
    inquiryEmails: z.boolean(),
    timeZone: z
      .string()
      .max(100)
      .refine((s) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: s }).format();
          return true;
        } catch {
          return false;
        }
      }, 'Choose a valid timezone.'),
  })
  .strict();
export type NotificationPreferences = z.infer<
  typeof notificationPreferencesSchema
>;
export const notificationDefaults: NotificationPreferences = {
  renewalReminders: false,
  weeklyOverview: false,
  inquiryEmails: true,
  timeZone: 'UTC',
};

export const renewalNoticeRowSchema = z
  .object({
    domain: z.string().min(1).max(253),
    account: z.string().max(200),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    autoRenew: z.boolean().nullable(),
    stale: z.boolean(),
    imported: z.boolean(),
    observedAt: z.number().nonnegative().nullable(),
    attention: z.boolean().optional(),
    price: z.string().max(100).nullable(),
    // Created only by a trusted adapter. A timeout or a past planning date is not this evidence.
    failure: z
      .object({
        id: z.string().max(200),
        at: z.number(),
        deadlineAt: z.number(),
        reason: z.enum(['expired-status', 'renewal-rejected']).optional(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type RenewalNoticeRow = z.infer<typeof renewalNoticeRowSchema>;
export type NoticeStage = 'review' | 'soon' | 'failure';
export interface RenewalCandidate {
  key: string;
  stage: NoticeStage;
  row: RenewalNoticeRow;
  urgent: boolean;
}

export function localParts(at: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const value = (name: string) =>
    Number(parts.find((p) => p.type === name)!.value);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
  };
}
export function localDay(at: number, timeZone: string) {
  const p = localParts(at, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
function localNine(day: number, timeZone: string) {
  const d = new Date(day),
    target = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 9);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = localParts(guess, timeZone);
    guess += target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  }
  return guess;
}
export function nextWeeklySlot(
  now: number,
  timeZone: string,
  inclusive = false,
) {
  const p = localParts(now, timeZone),
    today = Date.UTC(p.year, p.month - 1, p.day);
  for (let i = 0; i <= 7; i++) {
    const day = today + i * DAY;
    if (new Date(day).getUTCDay() !== 1) continue;
    const at = localNine(day, timeZone);
    if (inclusive ? at >= now : at > now) return at;
  }
  throw new Error('Weekly slot unavailable.');
}
export function nextDailySlot(now: number, timeZone: string) {
  const p = localParts(now, timeZone),
    today = Date.UTC(p.year, p.month - 1, p.day);
  const at = localNine(today, timeZone);
  return at > now ? at : localNine(today + DAY, timeZone);
}

/** One logical key per name/cycle/stage, never per account order or template version. */
export function renewalCandidates(
  rows: RenewalNoticeRow[],
  now: number,
  timeZone: string,
): RenewalCandidate[] {
  const day = Date.parse(localDay(now, timeZone) + 'T00:00:00Z');
  const nextWeekly = nextWeeklySlot(now, timeZone);
  const groups = new Map<string, RenewalNoticeRow[]>();
  for (const row of rows)
    groups.set(row.domain, [...(groups.get(row.domain) ?? []), row]);
  const out: RenewalCandidate[] = [];
  for (const [domain, observations] of groups) {
    // Conflicting accounts cannot select a definitive deadline or auto-renew state.
    const signatures = new Set(
      observations.map((r) => JSON.stringify([r.date, r.autoRenew])),
    );
    if (signatures.size !== 1) continue;
    const row = [...observations].sort(
      (a, b) =>
        Number(a.stale) - Number(b.stale) ||
        (b.observedAt ?? 0) - (a.observedAt ?? 0),
    )[0];
    const date = Date.parse(row.date + 'T00:00:00Z');
    if (
      !Number.isFinite(date) ||
      new Date(date).toISOString().slice(0, 10) !== row.date
    )
      continue;
    const days = Math.round((date - day) / DAY);
    if (row.failure && !row.stale && !row.imported) {
      out.push({
        key: `${domain}|${row.date}|failure|${row.failure.id}`,
        stage: 'failure',
        row,
        urgent: row.failure.deadlineAt <= nextWeekly,
      });
      continue;
    }
    if (days < 0 || days > 30) continue;
    const stage = days <= 7 ? 'soon' : 'review';
    // Routine reviews batch weekly. A real deadline that cannot wait is eligible now.
    const urgent =
      row.autoRenew !== true &&
      stage === 'soon' &&
      !row.stale &&
      (days <= 2 || date <= nextWeekly + DAY);
    out.push({ key: `${domain}|${row.date}|${stage}`, stage, row, urgent });
  }
  return out.sort(
    (a, b) =>
      Number(b.urgent) - Number(a.urgent) ||
      a.row.date.localeCompare(b.row.date) ||
      a.row.domain.localeCompare(b.row.domain),
  );
}

/** Routine summaries are change-only and weekly; urgent events bypass that slot. */
export function selectRenewalNotice(
  candidates: RenewalCandidate[],
  sent: Set<string>,
  decisions: Record<string, 'expire' | 'handled'>,
  prefs: NotificationPreferences,
  now: number,
  lastWeeklyAt: number | null,
) {
  const p = localParts(now, prefs.timeZone);
  const monday =
    new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() === 1;
  const weeklyDue =
    monday &&
    p.hour >= 9 &&
    (lastWeeklyAt === null ||
      localDay(lastWeeklyAt, prefs.timeZone) !==
        localDay(now, prefs.timeZone)) &&
    (lastWeeklyAt === null || now - lastWeeklyAt >= 6 * DAY);
  const pending = prefs.renewalReminders
    ? candidates.filter(
        (c) =>
          (c.row.autoRenew !== true || c.stage === 'failure') &&
          !sent.has(c.key) &&
          decisions[`${c.row.domain}|${c.row.date}`] !== 'expire' &&
          decisions[c.key] !== 'handled',
      )
    : [];
  const urgent = pending.filter((c) => c.urgent);
  if (weeklyDue && prefs.weeklyOverview && candidates.length)
    return {
      items: candidates.filter(
        (c) => decisions[c.row.domain + '|' + c.row.date] !== 'expire',
      ),
      kind: 'overview' as const,
      keys: pending.map((c) => c.key),
    };
  if (weeklyDue && pending.length)
    return {
      items: pending,
      kind: 'weekly' as const,
      keys: pending.map((c) => c.key),
    };
  if (urgent.length)
    return {
      items: urgent,
      kind: 'urgent' as const,
      keys: urgent.map((c) => c.key),
    };
  return null;
}

export const renewalDecisionSchema = z
  .object({ value: z.enum(['expire', 'handled']), revision: z.string().uuid() })
  .strict();
