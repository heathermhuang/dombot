import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHttpApi } from './http';

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => vi.stubGlobal('document', { addEventListener: vi.fn() }));

it('does not interrupt app startup when bulk-job results require fresh authentication', async () => {
  vi.stubGlobal('window', {
    location: { pathname: '/w/11111111-1111-4111-8111-111111111111/' },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json(
        { error: 'Confirm your identity before continuing.' },
        { status: 428 },
      ),
    ),
  );
  await expect(createHttpApi().getBulkJob()).resolves.toBeNull();
});

it('keeps actionable bulk-job failures visible', async () => {
  vi.stubGlobal('window', { location: { pathname: '/' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ error: 'Service unavailable' }, { status: 503 }),
    ),
  );
  await expect(createHttpApi().getBulkJob()).rejects.toThrow(
    'Service unavailable',
  );
});
