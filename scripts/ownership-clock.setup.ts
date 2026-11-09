import { afterEach, beforeEach, expect, vi } from 'vitest';

// This suite's dates are anchored to this instant. Keep its implicit Date.now()
// calls on the same clock without changing the pinned engine's source archive.
// Other suites keep their own clocks and timers.
if (expect.getState().testPath?.endsWith('/src/shared/ownership.test.ts')) {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-29T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());
}
