import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  hydrateStores,
  flushWrites,
} from '../storage/namespace';
import { buildBundle, importBundle, parseBundle } from '../storage/bundle';
import {
  decideRenewal,
  decisionRecords,
  forgetRenewalDecisions,
  notificationPreferenceDraft,
} from './renewal-decisions';
import { notificationDefaults } from '../../shared/notification-policy';
vi.mock('./auto-sync', () => ({ restartAutoSync: vi.fn() }));
let store: MemoryDocStore;
beforeEach(async () => {
  store = new MemoryDocStore();
  configureStore(store);
  await hydrateStores();
});
afterEach(() => vi.restoreAllMocks());
describe('portable owner reminder choices', () => {
  it('preserves choices and preference drafts through the new backup format without enrolling mail', async () => {
    await decideRenewal('sample.example|2026-11-30', 'expire', null);
    await store.put('notification-preference-drafts', 'choices', {
      ...notificationDefaults,
      weeklyOverview: true,
    });
    await hydrateStores();
    const backup = buildBundle({ version: 'synthetic', platform: 'web' });
    expect(backup.version).toBe(18);
    expect(backup.namespaces['renewal-decisions']).toHaveProperty(
      'sample.example|2026-11-30',
    );
    configureStore(new MemoryDocStore());
    await hydrateStores();
    await importBundle(JSON.stringify(backup));
    expect(decisionRecords()['sample.example|2026-11-30'].value).toBe('expire');
    expect(notificationPreferenceDraft()?.weeklyOverview).toBe(true);
    expect(backup.namespaces).not.toHaveProperty('notification_outbox');
  });
  it('refuses invalid preference drafts before any import mutation', () => {
    const backup = buildBundle({ version: 'synthetic', platform: 'web' });
    backup.namespaces['notification-preference-drafts'] = {
      choices: { ...notificationDefaults, timeZone: 'Invalid/Zone' },
    };
    expect(() => parseBundle(JSON.stringify(backup))).toThrow(
      'Invalid notification preference draft',
    );
  });
  it('guards stale decisions and deletes choices only for the selected domain', async () => {
    await decideRenewal('sample.example|2026-11-30', 'expire', null);
    await decideRenewal('other.example|2026-11-30|review', 'handled', null);
    await expect(
      decideRenewal('sample.example|2026-11-30', null, null),
    ).rejects.toThrow('Reload');
    forgetRenewalDecisions(['sample.example']);
    await flushWrites();
    expect(decisionRecords()).not.toHaveProperty('sample.example|2026-11-30');
    expect(decisionRecords()).toHaveProperty('other.example|2026-11-30|review');
  });
  it('does not log private domain keys when a reminder decision write fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(store, 'put').mockRejectedValue(Error('Synthetic disk failure'));
    await expect(
      decideRenewal('private-name.example|2026-11-30', 'expire', null),
    ).rejects.toThrow('Synthetic disk failure');
    await expect(flushWrites()).rejects.toThrow('Synthetic disk failure');
    expect(log.mock.calls.map((v) => v.join(' ')).join('\n')).not.toContain(
      'private-name.example',
    );
  });
});
