import { describe, expect, it } from 'vitest';
import {
  DAY,
  notificationDefaults,
  notificationPreferencesSchema,
  nextWeeklySlot,
  nextDailySlot,
  renewalCandidates,
  selectRenewalNotice,
  type RenewalNoticeRow,
} from './notification-policy';
const row = (overrides: Partial<RenewalNoticeRow> = {}): RenewalNoticeRow => ({
  domain: 'sample.example',
  account: 'Sample registrar',
  date: '2026-11-30',
  autoRenew: false,
  stale: false,
  imported: false,
  observedAt: Date.parse('2026-11-09'),
  price: 'USD 12.00',
  failure: null,
  ...overrides,
});
const prefs = { ...notificationDefaults, renewalReminders: true };
const choose = (
  rows: RenewalNoticeRow[],
  at: string,
  sent = new Set<string>(),
) => {
  const now = Date.parse(at);
  return selectRenewalNotice(
    renewalCandidates(rows, now, 'UTC'),
    sent,
    {},
    prefs,
    now,
    null,
  );
};
describe('portfolio notification policy', () => {
  it('requires explicit enrollment and a real timezone', () => {
    expect(notificationDefaults.renewalReminders).toBe(false);
    expect(
      notificationPreferencesSchema.safeParse({
        ...prefs,
        timeZone: 'Not/AZone',
      }).success,
    ).toBe(false);
    expect(
      notificationPreferencesSchema.safeParse({
        ...prefs,
        recipient: 'other@example.com',
      }).success,
    ).toBe(false);
  });
  it('keeps routine changes quiet until the weekly slot', () => {
    expect(choose([row()], '2026-11-10T09:00:00Z')).toBeNull();
    expect(choose([row()], '2026-11-09T08:59:00Z')).toBeNull();
    expect(choose([row()], '2026-11-09T09:00:00Z')?.kind).toBe('weekly');
  });
  it('deduplicates accepted stages and canonical names across matching accounts', () => {
    const at = '2026-11-09T09:00:00Z';
    const notice = choose([row(), row({ account: 'Other' })], at)!;
    expect(notice.items).toHaveLength(1);
    expect(
      choose([row()], at, new Set(notice.items.map((c) => c.key))),
    ).toBeNull();
    expect(choose([row(), row({ date: '2026-12-01' })], at)).toBeNull();
  });
  it('sends a confirmed time-critical failure after the routine send time', () => {
    const now = Date.parse('2026-11-10T10:00:00Z');
    const r = row({
      autoRenew: true,
      failure: {
        id: 'provider-rejection-1',
        at: now,
        deadlineAt: now + 3600_000,
      },
    });
    const result = choose([r], new Date(now).toISOString())!;
    expect(result.kind).toBe('urgent');
    expect(
      choose(
        [r],
        new Date(now).toISOString(),
        new Set(result.items.map((c) => c.key)),
      ),
    ).toBeNull();
    expect(
      choose([row({ ...r, stale: true })], new Date(now).toISOString()),
    ).toBeNull();
  });
  it('does not treat auto-renew enabled or a past planning date as a failed renewal', () => {
    expect(
      choose([row({ autoRenew: true })], '2026-11-09T09:00:00Z'),
    ).toBeNull();
    expect(
      choose([row({ date: '2026-11-01' })], '2026-11-09T09:00:00Z'),
    ).toBeNull();
    expect(
      choose([row({ date: '2026-02-30' })], '2026-02-01T09:00:00Z'),
    ).toBeNull();
  });
  it('alerts once for a fresh registrar-held past expiry, including auto-renew, without claiming failure', () => {
    const now = Date.parse('2026-11-10T10:00:00Z');
    const r = row({
      date: '2026-11-01',
      expiryDate: '2026-11-01',
      autoRenew: true,
    });
    const candidates = renewalCandidates([r], now, 'UTC');
    expect(candidates[0]).toMatchObject({ stage: 'past-expiry', urgent: true });
    expect(candidates[0].row.failure).toBeNull();
    const notice = choose([r], new Date(now).toISOString())!;
    expect(notice.kind).toBe('urgent');
    expect(
      choose([r], new Date(now).toISOString(), new Set(notice.keys)),
    ).toBeNull();
    for (const overrides of [
      { stale: true },
      { imported: true },
      { expiryDate: '2026-12-01' },
    ])
      expect(
        choose([row({ ...r, ...overrides })], new Date(now).toISOString()),
      ).toBeNull();
    for (const decisions of [
      { [candidates[0].key]: 'handled' as const },
      { 'sample.example|2026-11-01': 'expire' as const },
    ])
      expect(
        selectRenewalNotice(candidates, new Set(), decisions, prefs, now, null),
      ).toBeNull();
  });
  it('uses the reported UTC expiry day consistently across saved timezones', () => {
    const r = row({ date: '2026-11-10', expiryDate: '2026-11-10' });
    expect(
      renewalCandidates(
        [r],
        Date.parse('2026-11-10T23:00:00Z'),
        'Asia/Singapore',
      )[0]?.stage,
    ).not.toBe('past-expiry');
    expect(
      renewalCandidates(
        [r],
        Date.parse('2026-11-11T01:00:00Z'),
        'America/Los_Angeles',
      )[0]?.stage,
    ).toBe('past-expiry');
  });
  it('prioritizes past expiry ahead of upcoming dates even when a future renewal deadline is supplied', () => {
    const now = Date.parse('2026-11-10T10:00:00Z');
    const candidates = renewalCandidates(
      [
        row({ domain: 'upcoming.example', date: '2026-11-11' }),
        row({
          domain: 'recover.example',
          date: '2026-12-01',
          expiryDate: '2026-11-01',
        }),
      ],
      now,
      'UTC',
    );
    expect(candidates[0]).toMatchObject({
      stage: 'past-expiry',
      row: { domain: 'recover.example' },
    });
  });
  it('shows auto-renew names in an explicitly enabled overview', () => {
    const now = Date.parse('2026-11-09T09:00:00Z');
    expect(
      selectRenewalNotice(
        renewalCandidates([row({ autoRenew: true })], now, 'UTC'),
        new Set(),
        {},
        { ...prefs, weeklyOverview: true },
        now,
        null,
      )?.kind,
    ).toBe('overview');
  });
  it('combines the optional overview with reminders while tracking only new actionable stages', () => {
    const now = Date.parse('2026-11-09T09:00:00Z');
    const candidates = renewalCandidates(
      [row(), row({ domain: 'auto.example', autoRenew: true })],
      now,
      'UTC',
    );
    const notice = selectRenewalNotice(
      candidates,
      new Set(),
      {},
      { ...prefs, weeklyOverview: true },
      now,
      null,
    )!;
    expect(notice.kind).toBe('overview');
    expect(notice.items).toHaveLength(2);
    expect(notice.keys).toEqual(['sample.example|2026-11-30|review']);
  });
  it('starts a near-deadline enrollment at its current stage and respects let-expire', () => {
    const now = Date.parse('2026-11-10T10:00:00Z');
    const list = renewalCandidates([row({ date: '2026-11-11' })], now, 'UTC');
    expect(list[0].stage).toBe('soon');
    expect(
      selectRenewalNotice(
        list,
        new Set(),
        { 'sample.example|2026-11-11': 'expire' },
        prefs,
        now,
        null,
      ),
    ).toBeNull();
  });
  it('batches staggered first reviews weekly instead of fifteen separate emails', () => {
    const start = Date.parse('2026-11-02T09:00:00Z');
    const rows = Array.from({ length: 15 }, (_, i) =>
      row({
        domain: `sample${i}.example`,
        date: new Date(start + (30 + i) * DAY).toISOString().slice(0, 10),
      }),
    );
    const sent = new Set<string>();
    let routine = 0,
      last: number | null = null;
    for (let day = 0; day < 25; day++) {
      const now = start + day * DAY;
      const result = selectRenewalNotice(
        renewalCandidates(rows, now, 'UTC'),
        sent,
        {},
        prefs,
        now,
        last,
      );
      if (!result) continue;
      if (result.kind === 'weekly') {
        routine++;
        last = now;
      }
      result.items.forEach((c) => sent.add(c.key));
    }
    expect(routine).toBe(3);
  });
  it('uses local Monday nine through DST without duplicate weekly slots', () => {
    expect(
      new Date(
        nextWeeklySlot(Date.parse('2026-03-06T12:00:00Z'), 'America/New_York'),
      ).toISOString(),
    ).toBe('2026-03-09T13:00:00.000Z');
    expect(
      new Date(
        nextWeeklySlot(Date.parse('2026-10-30T12:00:00Z'), 'America/New_York'),
      ).toISOString(),
    ).toBe('2026-11-02T14:00:00.000Z');
    expect(
      new Date(
        nextDailySlot(Date.parse('2026-11-09T02:00:00Z'), 'Asia/Singapore'),
      ).toISOString(),
    ).toBe('2026-11-10T01:00:00.000Z');
  });
  it('combines a weekly routine batch and near-deadline work in one envelope', () => {
    const result = choose(
      [row(), row({ domain: 'urgent.example', date: '2026-11-10' })],
      '2026-11-09T09:00:00Z',
    )!;
    expect(result.kind).toBe('weekly');
    expect(result.items).toHaveLength(2);
  });
});
