import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryDocStore } from '../storage/doc-store';
import { configureStore, hydrateStores } from '../storage/namespace';
import { configureParkioProjection } from './parkio-projection';
import { importedRow } from '../../shared/imported-domains';
import { renewalNotificationRows } from './renewal-notifications';
const now = Date.parse('2026-11-09T09:00:00Z');
const projection = () => ({
  ...importedRow('sample.example', {
    registrar: null,
    registrarLabel: 'Park.io',
    expirationDate: '2026-11-30',
    autoRenew: null,
    addedAt: now,
    updatedAt: null,
  }),
  parkio: {
    sourceId: '11111111-1111-4111-8111-111111111111',
    label: 'Sample account',
    lastSuccessfulCheckAt: now,
    missingSince: null as number | null,
    connection: 'connected' as const,
    paused: false,
    error: null,
    nextCheckAt: null,
  },
});
beforeEach(async () => {
  configureStore(new MemoryDocStore());
  configureParkioProjection([]);
  await hydrateStores();
});
describe('renewal inventory provenance', () => {
  it('includes current Park.io observations without claiming they were manually supplied or that auto-renew is disabled', () => {
    configureParkioProjection([projection()]);
    const rows = renewalNotificationRows(now);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      domain: 'sample.example',
      account: 'Park.io · Sample account',
      autoRenew: null,
      imported: false,
      stale: false,
      observedAt: now,
    });
  });
  it('does not remind for names missing from the connected source', () => {
    const item = projection();
    item.parkio.missingSince = now;
    configureParkioProjection([item]);
    expect(renewalNotificationRows(now)).toHaveLength(0);
  });
  it('labels paused cached observations as needing refresh without opening a provider session', () => {
    const item = projection();
    item.parkio.paused = true;
    configureParkioProjection([item]);
    expect(renewalNotificationRows(now)[0].stale).toBe(true);
  });
});
