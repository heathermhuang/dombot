import { ParkioPilot, parkioPilotRoutes } from '../parkio-pilot';
import type { BrowserRun } from '../../../hosted/browser-run-types';
import { openPilot, sealPilot } from '../parkio-pilot-contract';
import { parkioNativeSnapshot } from '../../../hosted/parkio-native-contract';

const csv = 'Domain,Expires\nalpha.test,2028-02-29\nbeta.test,2029-01-01\n';

export class TestParkioPilot extends ParkioPilot {
  private idleFixture!: () => void;
  private testContext: DurableObjectState;
  private testEnv: HostedEnv;
  constructor(ctx: DurableObjectState, env: HostedEnv) {
    let closed = false;
    const mode = Reflect.get(env, 'TEST_MODE');
    const browser = {
      acquire: async () => {
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
              else if (message.method === 'Runtime.callFunctionOn')
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
    this.testContext = ctx;
    this.testEnv = env;
    this.idleFixture = () => {
      closed = true;
    };
  }
  override async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === '/fixture-idle') {
      const env = this.testEnv;
      const sealed = await this.testContext.storage.get<string>('sealed');
      const data = await openPilot<Record<string, unknown>>(
        env.PARKIO_PILOT_SECRET!,
        env.PARKIO_PILOT_OWNER_ID!,
        sealed!,
      );
      data.expiresAt = Date.now() - 1;
      data.phase = 'cleanup_required';
      data.cleanupAttempts = 3;
      this.idleFixture();
      await this.testContext.storage.put(
        'sealed',
        await sealPilot(
          env.PARKIO_PILOT_SECRET!,
          env.PARKIO_PILOT_OWNER_ID!,
          data,
        ),
      );
      return new Response('Fixture expired');
    }
    return super.fetch(request);
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
