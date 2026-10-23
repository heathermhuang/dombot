import { describe, expect, it } from 'vitest';
import { isAllowedRendererNavigation } from './navigation';
const entry =
  'file:///Applications/DomBot%20QA.app/Contents/Resources/app.asar/.vite/renderer/main_window/index.html';
describe('renderer navigation boundary', () => {
  it.each([entry, entry + '#/domains', entry + '#/settings?tab=mcp'])(
    'allows the app entry and hash route %s',
    (target) => {
      expect(isAllowedRendererNavigation(target, entry)).toBe(true);
    },
  );
  it.each([
    'file:///tmp/untrusted.html',
    entry.replace('index.html', 'other.html'),
    entry + '?load=untrusted',
    'file://remote-host/tmp/untrusted.html',
    'https://untrusted.example/',
    'data:text/html,untrusted',
    'javascript:alert(1)',
    'not a URL',
  ])('rejects a non-app document %s', (target) => {
    expect(isAllowedRendererNavigation(target, entry)).toBe(false);
  });
  it('checks the actual dev origin rather than its textual prefix', () => {
    const dev = 'http://127.0.0.1:5173/';
    expect(isAllowedRendererNavigation(dev + '#/settings', dev, true)).toBe(
      true,
    );
    expect(isAllowedRendererNavigation(dev + 'src/fixture', dev, true)).toBe(
      true,
    );
    for (const url of [
      'http://127.0.0.1:51730/',
      'http://127.0.0.1:5173@untrusted.example/',
      'http://untrusted.example/',
      'file:///tmp/untrusted.html',
    ])
      expect(isAllowedRendererNavigation(url, dev, true)).toBe(false);
  });
});
