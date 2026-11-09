import { ParkioPilot, parkioPilotRoutes } from '../parkio-pilot';
import { fixtureBrowser } from './parkio-browser';
import { openPilot, sealPilot } from '../parkio-pilot-contract';

type CheckJournalFixture = {
  phase: string;
  checkedAt?: number;
  nextCheckAt?: number;
  firstCheckAt?: number;
  checks?: number;
  checkHistory: Array<{ number: number; startedAt: number; outcome: string }>;
};

export class TestParkioPilot extends ParkioPilot {
  private idleFixture!: () => void;
  private testContext: DurableObjectState;
  private testEnv: HostedEnv;
  private nativeMarker: { id?: string };
  constructor(ctx: DurableObjectState, env: HostedEnv) {
    const marker: { id?: string } = {};
    const { browser, idle } = fixtureBrowser(env, marker);
    super(ctx, { ...env, PARKIO_BROWSER: browser });
    this.testContext = ctx;
    this.testEnv = env;
    this.nativeMarker = marker;
    this.idleFixture = idle;
  }
  override async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/fixture-qualify')
      return super.fetch(
        new Request('https://parkio-pilot.internal/qualify', {
          method: 'POST',
          headers: { 'X-Pilot-Owner': this.testEnv.PARKIO_PILOT_OWNER_ID! },
        }),
      );
    if (
      [
        '/fixture-followup-due',
        '/fixture-interrupted',
        '/fixture-alarm',
        '/fixture-close-budget-used',
      ].includes(path)
    ) {
      if (path !== '/fixture-alarm') {
        const env = this.testEnv;
        const sealed = await this.testContext.storage.get<string>('sealed');
        const data = await openPilot<CheckJournalFixture>(
          env.PARKIO_PILOT_SECRET!,
          env.PARKIO_PILOT_OWNER_ID!,
          sealed!,
        );
        if (path === '/fixture-close-budget-used') {
          Object.assign(data, { cleanupAttempts: 3, browserClosed: true });
        } else if (path === '/fixture-followup-due') {
          data.checkedAt = Date.now() - 61000;
          data.nextCheckAt = Date.now() - 1;
          if (data.checks === 1) data.firstCheckAt = data.checkedAt;
        } else {
          data.phase = 'rechecking';
          data.checks = (data.checks ?? 0) + 1;
          data.checkedAt = Date.now();
          data.nextCheckAt = undefined;
          data.checkHistory.push({
            number: data.checks,
            startedAt: data.checkedAt,
            outcome: 'pending',
          });
        }
        await this.testContext.storage.put(
          'sealed',
          await sealPilot(
            env.PARKIO_PILOT_SECRET!,
            env.PARKIO_PILOT_OWNER_ID!,
            data,
          ),
        );
      }
      await super.alarm();
      return super.fetch(
        new Request('https://parkio-pilot.internal/status', {
          method: 'POST',
          headers: { 'X-Pilot-Owner': this.testEnv.PARKIO_PILOT_OWNER_ID! },
        }),
      );
    }
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
    const response = await super.fetch(request);
    if (path === '/start' && response.ok) {
      const data = (await response.clone().json()) as { attemptId?: string };
      this.nativeMarker.id = data.attemptId;
    }
    return response;
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
