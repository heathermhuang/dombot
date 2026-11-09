import { Hono } from 'hono';
import { ParkioLogin } from '../parkio-login';
import { ParkioPilot } from '../parkio-pilot';
import { parkioConnectorRoutes } from '../parkio-connector';
import { createParkioRoutes } from '../../worker/parkio-routes';
import { buildAuthConfig, type AuthConfig } from '../../worker/auth';
import { fixtureBrowser } from './parkio-browser';
export class TestParkioLogin extends ParkioLogin {
  private readonly marker: { id?: string };
  private readonly counters: { acquisitions: number };
  constructor(ctx: DurableObjectState, env: HostedEnv) {
    const marker = {},
      counters = { acquisitions: 0 };
    const { browser } = fixtureBrowser(env, marker, true, counters);
    super(ctx, { ...env, PARKIO_BROWSER: browser });
    this.marker = marker;
    this.counters = counters;
  }
  override async fetch(request: Request) {
    const path = new URL(request.url).pathname;
    if (path === '/fixture-alarm') {
      await super.alarm();
      return Response.json({ checked: true });
    }
    if (path === '/fixture-metrics') return Response.json(this.counters);
    const result = await super.fetch(request);
    if (path === '/start' && result.ok) {
      const value = (await result.clone().json()) as { attemptId?: string };
      this.marker.id = value.attemptId;
    }
    return result;
  }
}
export class TestOwnerPilot extends ParkioPilot {
  private readonly marker: { id?: string };
  constructor(ctx: DurableObjectState, env: HostedEnv) {
    const marker = {};
    const { browser } = fixtureBrowser(env, marker, true);
    super(ctx, { ...env, PARKIO_BROWSER: browser });
    this.marker = marker;
  }
  override async fetch(request: Request) {
    const result = await super.fetch(request);
    if (new URL(request.url).pathname === '/start' && result.ok) {
      const value = (await result.clone().json()) as { attemptId?: string };
      this.marker.id = value.attemptId;
    }
    return result;
  }
}
const app = new Hono<{ Bindings: HostedEnv }>();
app.route(
  '/connectors/parkio',
  parkioConnectorRoutes(
    async (request) => {
      const user = request.headers.get('X-Test-User');
      return user
        ? {
            id: user,
            workspace_id: request.headers.get('X-Test-Workspace')!,
            email: 'fixture@test.invalid',
            label: 'Test',
            authenticated_at: Date.now(),
            auth_method: 'password',
          }
        : null;
    },
    (request) => request.headers.get('X-Test-Session') ?? undefined,
  ),
);
const tenant = new Hono<{ Bindings: Env; Variables: { auth: AuthConfig } }>();
tenant.use('*', async (c, next) => {
  c.set('auth', await buildAuthConfig(c.env, new Uint8Array(32).fill(1)));
  return next();
});
tenant.route('/internal/parkio', createParkioRoutes(true));
tenant.route('/connectors/parkio', createParkioRoutes());
export default {
  fetch(request: Request, env: HostedEnv & Env, ctx: ExecutionContext) {
    return new URL(request.url).pathname.startsWith('/internal/') ||
      new URL(request.url).hostname === 'tenant.test'
      ? tenant.fetch(request, env, ctx)
      : app.fetch(request, env, ctx);
  },
};
