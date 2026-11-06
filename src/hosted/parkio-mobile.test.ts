import { describe, it, expect } from 'vitest';
import {
  parkioMobileConnection,
  mayTypeIntoParkio,
} from '../../hosted/parkio-mobile-contract';

const good = {
  devtoolsFrontendUrl: 'https://live.browser.run/ui/view?mode=tab&wss=fixture',
  webSocketDebuggerUrl:
    'wss://live.browser.run/api/devtools/browser/fixture/page/fixture?jwt=synthetic-only',
};
describe('owner mobile browser connection contract', () => {
  it('permits only the existing Cloudflare viewer and session-scoped signed socket', () => {
    expect(parkioMobileConnection(good)).toEqual({
      viewerUrl: good.devtoolsFrontendUrl,
      socketUrl: good.webSocketDebuggerUrl,
    });
  });
  it.each([
    { ...good, devtoolsFrontendUrl: 'https://other.test/ui/view' },
    { ...good, devtoolsFrontendUrl: 'https://live.browser.run/not-a-viewer' },
    {
      ...good,
      webSocketDebuggerUrl:
        'ws://live.browser.run/api/devtools/browser/fixture',
    },
    {
      ...good,
      webSocketDebuggerUrl: 'wss://other.test/api/devtools/browser/fixture',
    },
    { ...good, webSocketDebuggerUrl: 'wss://live.browser.run/unscoped' },
    {
      ...good,
      webSocketDebuggerUrl:
        'wss://user:secret@live.browser.run/api/devtools/browser/fixture',
    },
  ])('rejects capability destinations outside the contract', (value) => {
    expect(() => parkioMobileConnection(value)).toThrow();
  });
  it('requires a focused editable field on the authenticated provider origin', () => {
    expect(
      mayTypeIntoParkio({ origin: 'https://park.io', editable: true }),
    ).toBe(true);
    expect(
      mayTypeIntoParkio({ origin: 'https://www.park.io', editable: true }),
    ).toBe(true);
    for (const value of [
      null,
      {},
      { origin: 'https://other.test', editable: true },
      { origin: 'https://park.io', editable: false },
      { origin: 'http://park.io', editable: true },
    ])
      expect(mayTypeIntoParkio(value)).toBe(false);
  });
});
