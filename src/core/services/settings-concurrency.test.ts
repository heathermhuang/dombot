import { describe, expect, it } from 'vitest';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../storage/namespace';
import { getSettings, updateSettings } from './settings';

describe('settings patch persistence', () => {
  it('does not restore a disabled MCP gate while saving an unrelated stale setting', async () => {
    const store = new MemoryDocStore();
    await store.put('settings', 'mcpEnabled', true);
    configureStore(store);
    await hydrateStores();
    expect(getSettings().mcpEnabled).toBe(true);
    // Another runtime commits the disable after this runtime's hydration.
    await store.put('settings', 'mcpEnabled', false);
    updateSettings({ preferredCurrency: 'EUR' });
    await flushWrites();
    expect(await store.get('settings', 'mcpEnabled')).toBe(false);
    expect(await store.get('settings', 'preferredCurrency')).toBe('EUR');
  });
});
