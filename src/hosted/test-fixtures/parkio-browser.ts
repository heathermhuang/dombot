import type { BrowserRun } from '../../../hosted/browser-run-types';
import { parkioNativeSnapshot } from '../../../hosted/parkio-native-contract';
const csv = 'Domain,Expires\nalpha.test,2028-02-29\nbeta.test,2029-01-01\n';
export const qualifiedCsv =
  'Order ID,Domain,Created Date,Paid Date,Amount (USD),Expiration Date,On park.io\n12,alpha.test,2025-01-01,2025-01-02,100,2028-02-29,Yes\n13,beta.test,2025-01-01,2025-01-02,100,2029-01-01,Yes\n';
export function fixtureBrowser(
  env: HostedEnv,
  marker: { id?: string },
  qualified = false,
  counters = { acquisitions: 0 },
) {
  let closed = false;
  const mode = Reflect.get(env, 'TEST_MODE');
  let closeCalls = 0;
  const browser = {
    acquire: async () => {
      counters.acquisitions++;
      if (mode === 'launch-fails')
        throw Error('upstream raw secret must not escape');
      closed = false;
      return { sessionId: 'synthetic-browser' };
    },
    devtools: { newTarget: async () => ({ id: 'synthetic-page' }) },
    getLiveView: async () => ({
      devtoolsFrontendUrl:
        Reflect.get(env, 'TEST_VIEWER_URL') ??
        'https://live.browser.run/ui/view?mode=tab&jwt=synthetic-only',
      webSocketDebuggerUrl:
        Reflect.get(env, 'TEST_SOCKET_URL') ??
        'wss://live.browser.run/api/devtools/browser/synthetic-browser/page/synthetic-page?jwt=synthetic-only',
    }),
    closeSession: async () => {
      if (mode === 'close-fails') throw Error('close unavailable');
      if (mode === 'delayed-close' && ++closeCalls === 1)
        return { status: 'closing' };
      closed = true;
      return { status: 'closed' };
    },
    getSession: async () => {
      if (closed && mode === 'native-not-found')
        throw Error('BrowserBindingError: Session not found (status=404)');
      if (closed && mode === 'lookup-fails')
        throw Error('BrowserBindingError: Service unavailable (status=503)');
      return closed ? null : { sessionId: 'synthetic-browser' };
    },
    connectSession: async () => ({
      webSocket: {
        fetch: async () => {
          const pair = new WebSocketPair();
          pair[1].accept();
          pair[1].addEventListener('message', (event) => {
            const message = JSON.parse(String(event.data));
            let result: unknown;
            if (message.method === 'Storage.getCookies')
              result = {
                cookies: [
                  {
                    name: qualified ? 'parkio_user_signin' : 'session',
                    value: 'synthetic-private-cookie',
                    domain: 'park.io',
                    path: '/',
                    secure: true,
                    httpOnly: true,
                    expires: -1,
                  },
                ],
              };
            else if (message.method === 'Runtime.callFunctionOn')
              result = {
                result: {
                  value: {
                    ok: true,
                    status: 200,
                    contentType: 'text/csv',
                    text: qualified ? qualifiedCsv : csv,
                  },
                },
              };
            else if (message.params.expression === 'globalThis')
              result = { result: { objectId: 'synthetic-global' } };
            else if (message.method === 'Runtime.releaseObject') result = {};
            else if (message.params.expression === parkioNativeSnapshot)
              result = {
                result: {
                  value: {
                    kind:
                      mode === 'not-authenticated'
                        ? 'credentials'
                        : 'candidate',
                    origin: 'https://park.io',
                    path: '/orders/active',
                    rejected: false,
                    active: true,
                    orders: null,
                    activeOrders: null,
                    nativeAttemptId:
                      String(mode).startsWith('scheduled') ||
                      mode === 'delayed-close' ||
                      qualified
                        ? marker.id
                        : null,
                  },
                },
              };
            else if (message.params.expression.includes('hasPassword'))
              result = {
                result: {
                  value: {
                    origin: 'https://park.io',
                    path: '/orders/active',
                    hasPassword: false,
                    links: [
                      qualified
                        ? 'https://park.io/orders/export/active/123.csv'
                        : 'https://park.io/orders/export/active.csv',
                    ],
                    headers: ['Domain', 'Expires'],
                  },
                },
              };
            else
              result = {
                result: {
                  value: {
                    origin: 'https://park.io',
                    path: '/orders/active',
                  },
                },
              };
            pair[1].send(JSON.stringify({ id: message.id, result }));
          });
          return new Response(null, { status: 101, webSocket: pair[0] });
        },
      },
    }),
  } as unknown as BrowserRun;
  return {
    browser,
    idle: () => {
      closed = true;
    },
  };
}
