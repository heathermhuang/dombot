import { expect, it, vi } from 'vitest';
import { signGatewayRequest, PROOF_HEADER } from '../shared/gateway-proof';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(
      protected ctx: unknown,
      protected env: unknown,
    ) {}
  },
}));
const engine = vi.hoisted(() => ({
  fetch: vi.fn(),
  scheduled: vi.fn(),
  maintenanceState: vi.fn(),
}));
vi.mock('@domains-domains/dombot-engine', () => ({ default: engine }));
import { WorkspaceCoordinator } from './workspace-coordinator';

it('serves publication reads outside the maintenance queue while keeping mutations queued', async () => {
  const env = {
    DOMBOT_AUTH: 'gateway',
    DOMBOT_WORKSPACE_ID: '11111111-1111-4111-8111-111111111111',
    DOMBOT_GATEWAY_SECRET: 'synthetic-local-gateway-key-at-least-32-bytes',
    DOMBOT_PLATFORM_ALARMS: 'true',
    DOMBOT_EMPTY_SLEEP: 'true',
  } as unknown as Env;
  const data = new Map<string, unknown>();
  const storage = {
    get: async (key: string) => data.get(key),
    put: async (key: string, value: unknown) => {
      data.set(key, value);
    },
    getAlarm: async () => Date.now() + 300_000,
    transaction: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
      work(storage),
    list: async () => new Map(),
  };
  engine.maintenanceState.mockResolvedValue({
    version: 1,
    state: 'work',
    reason: 'stored-work',
    revision: null,
  });
  const coordinator = new WorkspaceCoordinator(
    { storage, waitUntil() {} } as unknown as DurableObjectState,
    env,
  );
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  engine.scheduled.mockImplementation(async () => {
    entered();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    throw new Error('end of synthetic provider hold');
  });
  engine.fetch.mockImplementation(async () => new Response('read completed'));
  const held = coordinator.runScheduled('test', Date.now()).catch(() => {});
  await started;
  const request = async (path: string, method = 'GET', signed = true) => {
    const r = new Request('https://workspace.example' + path, { method });
    if (signed)
      r.headers.set(
        PROOF_HEADER,
        await signGatewayRequest(
          env.DOMBOT_GATEWAY_SECRET!,
          env.DOMBOT_WORKSPACE_ID!,
          'owner',
          r,
        ),
      );
    return coordinator.fetch(r);
  };
  try {
    for (const path of [
      '/publishing',
      '/publishing/site',
      '/publishing/preview',
    ]) {
      const response = await Promise.race([
        request(path),
        Promise.resolve().then(
          () =>
            new Promise<null>((resolve) =>
              setTimeout(() => resolve(null), 1000),
            ),
        ),
      ]);
      expect(response?.status, path).toBe(200);
    }
    expect((await request('/publishing', 'GET', false)).status).toBe(403);
    const before = engine.fetch.mock.calls.length;
    const write = request('/publishing', 'PUT');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(engine.fetch).toHaveBeenCalledTimes(before);
    release();
    await held;
    await write;
    expect(engine.fetch).toHaveBeenCalledTimes(before + 1);
  } finally {
    release();
    await held;
  }
});
