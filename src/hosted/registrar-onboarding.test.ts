import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { onboardingScript } from './on-demand-views';

async function submit(result: unknown, ok = true, registrar = 'dynadot') {
  let handler: () => Promise<void> = async () => {};
  const button = { disabled: true };
  const status = { textContent: '' };
  const select = { value: registrar, addEventListener: vi.fn() };
  const form = {
    action: '/w/stable/api/connectRegistrarAccount',
    dataset: { base: '/w/stable' },
    reportValidity: () => true,
    querySelector: (selector: string) =>
      selector.startsWith('select')
        ? select
        : selector.startsWith('button')
          ? button
          : status,
    querySelectorAll: () => [],
    addEventListener: (_: string, callback: typeof handler) => {
      handler = callback;
    },
  };
  const assign = vi.fn();
  const fetch = vi.fn(async (...args: [string, { body: string }]) => {
    void args;
    return { ok, json: async () => result };
  });
  runInNewContext(onboardingScript, {
    document: { querySelectorAll: () => [], querySelector: () => form },
    FormData: class {
      *[Symbol.iterator]() {
        yield [`${registrar}.apiKey`, 'retained-key'];
      }
    },
    fetch,
    location: { assign },
  });
  await (handler as (event: { preventDefault: () => void }) => Promise<void>)({
    preventDefault: vi.fn(),
  });
  return { button, status, assign, fetch };
}

describe('first registrar browser submission', () => {
  it('retains the form and retry control after a structured provider rejection', async () => {
    const state = await submit({
      result: { success: false, status: 401, message: 'Key rejected' },
    });
    expect(state.assign).not.toHaveBeenCalled();
    expect(state.status.textContent).toContain(
      'Dynadot has not accepted this key yet',
    );
    expect(state.button.disabled).toBe(false);
    expect(JSON.parse(state.fetch.mock.calls[0][1].body).args).toEqual([
      'dynadot',
      { apiKey: 'retained-key' },
    ]);
  });
  it('shows other registrar failures without redirecting', async () => {
    const state = await submit(
      { result: { success: false, message: 'Access denied' } },
      true,
      'gandi',
    );
    expect(state.assign).not.toHaveBeenCalled();
    expect(state.status.textContent).toBe('Access denied');
  });
  it('redirects only after the tenant confirms the connection succeeded', async () => {
    const state = await submit({
      result: { success: true, account: { accountId: 'existing' } },
    });
    expect(state.assign).toHaveBeenCalledExactlyOnceWith('/w/stable/');
  });
  it('keeps retry available for HTTP and malformed replies', async () => {
    for (const [reply, ok] of [
      [{ error: 'Setup still pending' }, false],
      [{ result: null }, true],
    ] as const) {
      const state = await submit(reply, ok);
      expect(state.assign).not.toHaveBeenCalled();
      expect(state.button.disabled).toBe(false);
      expect(state.status.textContent.length).toBeGreaterThan(0);
    }
  });
});
