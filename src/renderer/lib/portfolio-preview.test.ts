import { describe, expect, it, vi } from 'vitest';
import { bindPortfolioPreview } from './portfolio-preview';

function frame() {
  const listeners = new Map<string, (event: Event) => void>();
  const scrollIntoView = vi.fn();
  const navigate = vi.fn();
  const document = {
    addEventListener: (type: string, callback: (event: Event) => void) =>
      listeners.set(type, callback),
    getElementById: vi.fn((id: string) =>
      id === 'contact' ? { scrollIntoView } : null,
    ),
  } as unknown as Document;
  bindPortfolioPreview(document, navigate);
  const click = (href: string) => {
    const preventDefault = vi.fn();
    const link = { getAttribute: () => href };
    listeners.get('click')!({
      target: {
        closest: (selector: string) => (selector === 'a' ? link : null),
      },
      preventDefault,
    } as unknown as Event);
    return preventDefault;
  };
  return { listeners, scrollIntoView, navigate, click };
}
describe('script-free preview navigation boundary', () => {
  it('keeps contact fragments inside the existing srcdoc document', () => {
    const f = frame();
    expect(f.click('#contact')).toHaveBeenCalled();
    expect(f.scrollIntoView).toHaveBeenCalledOnce();
    expect(f.navigate).not.toHaveBeenCalled();
  });
  it('renders history and pagination through the owner callback', () => {
    const f = frame();
    expect(f.click('?view=history&page=2')).toHaveBeenCalled();
    expect(f.navigate).toHaveBeenCalledWith('?view=history&page=2');
  });
  it('never follows external or inquiry links', () => {
    const f = frame();
    expect(f.click('mailto:owner@example.com')).toHaveBeenCalled();
    expect(f.click('https://example.com')).toHaveBeenCalled();
    expect(f.navigate).not.toHaveBeenCalled();
  });
  it('cancels native submission and routes an assistive submit event through the owner', () => {
    const f = frame();
    const preventDefault = vi.fn();
    vi.stubGlobal(
      'FormData',
      class {
        forEach(callback: (value: string, key: string) => void) {
          callback('atlas', 'q');
        }
      },
    );
    try {
      f.listeners.get('submit')!({
        target: { tagName: 'FORM' },
        preventDefault,
      } as unknown as Event);
      expect(preventDefault).toHaveBeenCalledOnce();
      expect(f.navigate).toHaveBeenCalledWith('?q=atlas');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
