import { describe, expect, it } from 'vitest';
import {
  parseParkioExport,
  mergeParkio,
  parkioContentHash,
  parkioRows,
  type ParkioSource,
} from './parkio';
import { buildDomainCatalog } from './domain-catalog';
import { privateListing } from './publication';
const head =
  'Order ID,Domain,Created Date,Paid Date,Amount (USD),Expiration Date,On park.io\n';
const csv = (name = 'alpha.test', expires = '2028-02-29', flag = 'Yes') =>
  head + `12,${name},2025-01-01,2025-01-02,100,${expires},${flag}\n`;
describe('qualified Park.io inventory', () => {
  it('maps only demonstrated inventory fields and skips explicit off-platform rows', () => {
    const [r] = parseParkioExport(csv(), 100);
    expect(r).toEqual({
      domain: 'alpha.test',
      orderId: '12',
      expirationDate: '2028-02-29',
      lastSeenAt: 100,
      missingSince: null,
    });
    expect(JSON.stringify(r)).not.toContain('2025');
    expect(parseParkioExport(csv('alpha.test', '2028-02-29', 'No'))).toEqual(
      [],
    );
  });
  it('rejects unknown status, invalid dates, malformed CSV, schema drift and conflicting duplicates', () => {
    for (const text of [
      csv('alpha.test', '2027-02-29'),
      csv('alpha.test', '2028-02-29', 'Maybe'),
      head + '"12,alpha.test',
      csv().replace('On park.io', 'Status'),
      csv() + '12,alpha.test,,,100,2029-01-01,Yes\n',
    ])
      expect(() => parseParkioExport(text)).toThrow();
  });
  it('preserves absent names and reviews expiry regressions', () => {
    const old = parseParkioExport(csv(), 100);
    const absent = mergeParkio(old, [], 200);
    expect(absent.reviewRequired).toBe(true);
    expect(absent.records[0]).toMatchObject({
      domain: 'alpha.test',
      lastSeenAt: 100,
      missingSince: 200,
    });
    const shorter = mergeParkio(
      old,
      parseParkioExport(csv('alpha.test', '2027-01-01'), 200),
    );
    expect(shorter.summary.expiryRegressions).toBe(1);
    expect(shorter.reviewRequired).toBe(true);
  });
  it('keeps content freshness distinct from check freshness', async () => {
    expect(await parkioContentHash(parseParkioExport(csv(), 100))).toBe(
      await parkioContentHash(parseParkioExport(csv(), 200)),
    );
  });
  it('cannot grant registrar mutation authority to a connector observation', () => {
    const s = {
      id: '11111111-1111-4111-8111-111111111111',
      label: 'Park.io',
      lastSuccessfulCheckAt: 100,
      connection: 'connected',
    } as ParkioSource;
    const [row] = parkioRows(
      [{ source: s, records: parseParkioExport(csv(), 100) }],
      [],
    );
    expect(row.autoRenewUnknown).toBe(true);
    const catalog = buildDomainCatalog(
      [privateListing('alpha.test')],
      [row],
      [],
    );
    expect(catalog.get('alpha.test')?.target).toBeNull();
    expect(row.parkio?.sourceId).toBe(s.id);
    expect(
      parkioRows(
        [{ source: s, records: parseParkioExport(csv(), 100) }],
        [row],
      ),
    ).toEqual([]);
  });
});
