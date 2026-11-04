import { expect, it } from 'vitest';
import { withProductionQa } from './production-import-qa-lifecycle.mjs';
it.each(['success', 'test-error', 'lost-start-response'])(
  'always cleans and scrubs %s',
  async (mode) => {
    const calls = [];
    const run = () =>
      withProductionQa({
        start: async (prepared) => {
          prepared({ runId: 'owned' });
          if (mode === 'lost-start-response')
            throw Error('lost start response');
          return { runId: 'owned' };
        },
        test: async () => {
          if (mode === 'test-error') throw Error('test failed');
          return 'ok';
        },
        cleanup: async (lease) => {
          expect(lease.runId).toBe('owned');
          calls.push('cleanup');
        },
        scrub: async () => calls.push('scrub'),
        preserve: async () => calls.push('preserve'),
      });
    if (mode === 'success') expect(await run()).toBe('ok');
    else await expect(run()).rejects.toThrow('failed');
    expect(calls).toEqual(['cleanup', 'scrub', 'preserve']);
  },
);
it('never reports a passed test as green when cleanup or preservation fails', async () => {
  const calls = [];
  await expect(
    withProductionQa({
      start: async () => ({ runId: 'owned' }),
      test: async () => true,
      cleanup: async () => {
        throw Error('cleanup blocked');
      },
      scrub: async () => calls.push('scrub'),
      preserve: async () => {
        calls.push('preserve');
        throw Error('real identity changed');
      },
    }),
  ).rejects.toBeInstanceOf(AggregateError);
  expect(calls).toEqual(['scrub', 'preserve']);
});
