import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { salesFormScript } from '../shared/sales-form-script';

function harness(width: number) {
  const button = { disabled: true };
  const status = { textContent: '' };
  const form = {
    querySelectorAll: () => [button],
    querySelector: () => status,
  };
  const widget = {
    dataset: { sitekey: 'test-only-sitekey' } as Record<string, string>,
    isConnected: true,
    closest: () => form,
    getBoundingClientRect: () => ({ width }),
  };
  let resized: (entries: { target: typeof widget }[]) => void;
  const render = vi.fn<
    (widget: unknown, options: Record<string, unknown>) => string
  >(() => `widget-${render.mock.calls.length}`);
  const remove = vi.fn();
  const window = {
    matchMedia: () => ({ matches: false, addEventListener: vi.fn() }),
    turnstile: { render, remove },
    salesChallengeReady: () => {},
  };
  runInNewContext(salesFormScript, {
    window,
    document: { querySelectorAll: () => [widget], addEventListener: vi.fn() },
    ResizeObserver: class {
      constructor(callback: typeof resized) {
        resized = callback;
      }
      observe() {}
      unobserve() {}
    },
  });
  window.salesChallengeReady();
  return {
    render,
    remove,
    button,
    widget,
    resize(next: number) {
      width = next;
      resized([{ target: widget }]);
    },
  };
}

describe('sales challenge container sizing', () => {
  it('uses compact size in a tablet form narrower than 300px', () => {
    const h = harness(233);
    expect(h.render.mock.calls[0][1].size).toBe('compact');
  });

  it('changes size only when the container crosses 300px and invalidates readiness', () => {
    const h = harness(420);
    expect(h.render.mock.calls[0][1].size).toBe('flexible');
    (h.render.mock.calls[0][1].callback as () => void)();
    expect(h.button.disabled).toBe(false);
    h.resize(350);
    expect(h.render).toHaveBeenCalledTimes(1);
    h.resize(233);
    expect(h.remove).toHaveBeenCalledWith('widget-1');
    expect(h.render.mock.calls[1][1].size).toBe('compact');
    expect(h.button.disabled).toBe(true);
    h.resize(300);
    expect(h.render.mock.calls[2][1].size).toBe('flexible');
  });
});
