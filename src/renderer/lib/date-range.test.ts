import { describe, it, expect } from 'vitest';
import {
  calendarDay,
  isDateRangeSet,
  dateRangeSummary,
  matchesDateRange,
  presetRange,
  resolveDateRange,
  utcDay,
} from './date-range';

describe('calendarDay', () => {
  it('keeps a YYYY-MM-DD day and rejects anything else', () => {
    expect(calendarDay('2026-01-01')).toBe('2026-01-01');
    expect(calendarDay('')).toBeNull();
    expect(calendarDay(null)).toBeNull();
    expect(calendarDay(undefined)).toBeNull();
    expect(calendarDay('2026-1-1')).toBeNull();
    expect(calendarDay('01/01/2026')).toBeNull();
  });
});

describe('utcDay', () => {
  it('uses the UTC day the table prints', () => {
    expect(utcDay(new Date('2026-01-15T00:00:00.000Z'))).toBe('2026-01-15');
    expect(utcDay('2026-01-15T23:30:00.000Z')).toBe('2026-01-15');
    expect(utcDay(null)).toBeNull();
    expect(utcDay(undefined)).toBeNull();
    expect(utcDay('')).toBeNull();
    expect(utcDay(new Date('not a date'))).toBeNull();
  });
});

describe('dateRangeSummary', () => {
  it('reads as on-or-after, on-or-before, a span, or one day', () => {
    expect(dateRangeSummary({ from: '', to: '' })).toBeNull();
    expect(dateRangeSummary({ from: 'nope', to: '' })).toBeNull();
    expect(dateRangeSummary({ from: '2026-01-01', to: '' })).toBe(
      '≥ 2026-01-01',
    );
    expect(dateRangeSummary({ from: '', to: '2026-12-31' })).toBe(
      '≤ 2026-12-31',
    );
    expect(dateRangeSummary({ from: '2026-01-01', to: '2026-12-31' })).toBe(
      '2026-01-01 – 2026-12-31',
    );
    expect(dateRangeSummary({ from: '2026-03-15', to: '2026-03-15' })).toBe(
      '= 2026-03-15',
    );
    expect(dateRangeSummary({ from: '2026-01-01', to: 'nope' })).toBe(
      '≥ 2026-01-01',
    );
  });
});

describe('matchesDateRange', () => {
  it('matches every row, including a blank date, when the filter is empty', () => {
    expect(matchesDateRange('2026-06-01', { from: '', to: '' })).toBe(true);
    expect(matchesDateRange(null, { from: '', to: '' })).toBe(true);
    expect(matchesDateRange(undefined, { from: 'nope', to: '' })).toBe(true);
  });

  it('keeps the ends of a span and drops a blank date', () => {
    expect(matchesDateRange('2026-01-01', { from: '2026-01-01', to: '' })).toBe(
      true,
    );
    expect(matchesDateRange('2025-12-31', { from: '2026-01-01', to: '' })).toBe(
      false,
    );
    expect(matchesDateRange('2026-12-31', { from: '', to: '2026-12-31' })).toBe(
      true,
    );
    expect(matchesDateRange('2027-01-01', { from: '', to: '2026-12-31' })).toBe(
      false,
    );
    expect(
      matchesDateRange('2026-01-01', { from: '2026-01-01', to: '2026-12-31' }),
    ).toBe(true);
    expect(
      matchesDateRange('2026-12-31', { from: '2026-01-01', to: '2026-12-31' }),
    ).toBe(true);
    expect(
      matchesDateRange('2026-06-15', { from: '2026-06-15', to: '2026-06-15' }),
    ).toBe(true);
    expect(
      matchesDateRange('2026-06-16', { from: '2026-06-15', to: '2026-06-15' }),
    ).toBe(false);
    expect(matchesDateRange(null, { from: '2026-01-01', to: '' })).toBe(false);
    expect(matchesDateRange('', { from: '2026-01-01', to: '' })).toBe(false);
    expect(matchesDateRange('not-a-date', { from: '2026-01-01', to: '' })).toBe(
      false,
    );
  });

  it('matches nothing when From is after To', () => {
    expect(
      matchesDateRange('2026-06-01', { from: '2026-12-31', to: '2026-01-01' }),
    ).toBe(false);
  });
});

describe('isDateRangeSet', () => {
  it('is set when either side is a real day', () => {
    expect(isDateRangeSet({ from: '', to: '' })).toBe(false);
    expect(isDateRangeSet({ from: 'nope', to: '' })).toBe(false);
    expect(isDateRangeSet({ from: '2026-01-01', to: '' })).toBe(true);
    expect(isDateRangeSet({ from: '', to: '2026-12-31' })).toBe(true);
  });
});

describe('shortcuts', () => {
  // A local Saturday, 2026-10-10.
  const today = new Date(2026, 9, 10, 15, 30);

  it('counts from the local day, both ends included', () => {
    expect(presetRange('expired', today)).toEqual({
      from: '',
      to: '2026-10-09',
      preset: 'expired',
    });
    expect(presetRange('next30', today)).toMatchObject({
      from: '2026-10-10',
      to: '2026-11-09',
    });
    expect(presetRange('next90', today)).toMatchObject({
      from: '2026-10-10',
      to: '2027-01-08',
    });
    expect(presetRange('last30', today)).toMatchObject({
      from: '2026-09-10',
      to: '2026-10-10',
    });
    expect(presetRange('last12m', today)).toMatchObject({
      from: '2025-10-10',
      to: '2026-10-10',
    });
  });

  it('takes Feb 29 a year back to Mar 1', () => {
    expect(presetRange('last12m', new Date(2028, 1, 29))).toMatchObject({
      from: '2027-03-01',
      to: '2028-02-29',
    });
  });

  it('names the shortcut on the chip and is set', () => {
    const range = presetRange('next60', today);
    expect(dateRangeSummary(range)).toBe('Next 60 days');
    expect(isDateRangeSet({ from: '', to: '', preset: 'expired' })).toBe(true);
  });

  it('counts a shortcut from the day it is checked, not the day it was picked', () => {
    const picked = presetRange('next30', today);
    const later = new Date(2026, 11, 1);
    expect(resolveDateRange(picked, later)).toMatchObject({
      from: '2026-12-01',
      to: '2026-12-31',
    });
    expect(matchesDateRange('2026-11-05', picked, today)).toBe(true);
    expect(matchesDateRange('2026-11-05', picked, later)).toBe(false);
  });

  it('keeps Expired to days before today', () => {
    const expired = presetRange('expired', today);
    expect(matchesDateRange('2026-10-09', expired, today)).toBe(true);
    expect(matchesDateRange('2026-10-10', expired, today)).toBe(false);
    expect(matchesDateRange(null, expired, today)).toBe(false);
  });

  it('typed days have no shortcut and stay fixed', () => {
    const typed = { from: '2026-01-01', to: '2026-03-31' };
    expect(resolveDateRange(typed, today)).toBe(typed);
  });
});
