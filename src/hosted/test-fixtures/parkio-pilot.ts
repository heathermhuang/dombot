import { ParkioPilot, parkioPilotRoutes } from '../parkio-pilot';
import type { BrowserRun } from '../../../hosted/browser-run-types';

const csv = 'Domain,Expires\nalpha.test,2028-02-29\nbeta.test,2029-01-01\n';

export class TestParkioPilot extends ParkioPilot {
  constructor(ctx: DurableObjectState, env: HostedEnv) {
    let closed = false;
    const mode = Reflect.get(env, 'TEST_MODE');
    const browser = {
      acquire: async () => {
        if (mode === 'launch-fails')
          throw Error('upstream raw secret must not escape');
        return { sessionId: 'synthetic-browser' };
      },
      devtools: { newTarget: async () => ({ id: 'synthetic-page' }) },
      getLiveView: async () => ({
        devtoolsFrontendUrl:
          'https://live.browser.run/ui/view?mode=tab&jwt=synthetic-only',
      }),
      closeSession: async () => {
        if (mode === 'close-fails') throw Error('close unavailable');
        closed = true;
        return { status: 'closed' };
      },
      getSession: async () =>
        closed ? null : { sessionId: 'synthetic-browser' },
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
                      name: 'session',
                      value: 'synthetic-private-cookie',
                      domain: 'park.io',
                      path: '/',
                      secure: true,
                      httpOnly: true,
                      expires: -1,
                    },
                  ],
                };
              else if (message.params.expression.includes('fetch('))
                result = {
                  result: {
                    value: {
                      ok: true,
                      status: 200,
                      contentType: 'text/csv',
                      text: csv,
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
                      links: ['https://park.io/orders/export/active.csv'],
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
    super(ctx, { ...env, PARKIO_BROWSER: browser });
  }
}

const routes = parkioPilotRoutes(async (request) => {
  const identity = request.headers.get('X-Test-Identity');
  if (!identity) return null;
  return {
    id: identity,
    email: 'test@example.test',
    label: 'Test',
    workspace_id: 'test-workspace',
    authenticated_at: request.headers.has('X-Test-Stale') ? 1 : Date.now(),
    auth_method: 'password',
  };
});
export default { fetch: routes.fetch };
