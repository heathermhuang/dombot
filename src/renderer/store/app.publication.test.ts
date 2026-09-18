import { afterEach, expect, it, vi } from 'vitest';
import { useAppStore } from './app';
import { PortfolioSession } from '../lib/portfolio-session';
import {
  emptyDraft,
  privateListing,
  type PublicationState,
} from '../../shared/publication';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('refreshes publication ownership after a single-account sync without discarding draft edits', async () => {
  vi.useFakeTimers();
  let synced = false;
  const item = privateListing('owned.example');
  const load = async (): Promise<PublicationState> => ({
    draft: { ...emptyDraft(), listings: [item] },
    revision: null,
    published: null,
    publishedSnapshot: null,
    accounts: [],
    review: [
      {
        ...item,
        ownership: synced ? 'owned' : 'unmatched',
        accountLabels: ['test'],
        lastSyncedAt: synced ? Date.now() : null,
      },
    ],
  });
  const editor = new PortfolioSession({
    load,
    save: vi.fn(),
    publish: vi.fn(),
    unpublish: vi.fn(),
  });
  await editor.load();
  editor.update({ ...editor.getSnapshot().draft!, title: 'Unsaved title' });
  vi.stubGlobal('window', {
    api: {
      syncRegistrar: async () => {
        synced = true;
        return {
          domains: [],
          errors: [],
          registrars: [],
          registrarLabels: {},
          fetchedAt: Date.now(),
        };
      },
      getRegistrarMetadata: async () => [],
      getPortfolioPricing: async () => ({}),
    },
  });
  let refreshing: Promise<void> | undefined;
  const unsubscribe = useAppStore.subscribe((next, previous) => {
    if (next.refreshTick !== previous.refreshTick)
      refreshing = editor.refreshReview();
  });
  try {
    await useAppStore.getState().syncRegistrar('namecheap', 'test-account');
    await refreshing;
    expect(editor.getSnapshot().state?.review[0].ownership).toBe('owned');
    expect(editor.getSnapshot().draft?.title).toBe('Unsaved title');
    expect(editor.isDirty()).toBe(true);
  } finally {
    unsubscribe();
  }
});
