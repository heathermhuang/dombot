import type { DomBotMaintenanceState } from '@domains-domains/dombot-engine';

const KEY = 'maintenance:v1';
const INTERVAL = 300_000;
interface State {
  generation: number;
  dirty: boolean;
  paused: boolean;
  observedAt: number;
  inspection: DomBotMaintenanceState;
}
const unknown = (): DomBotMaintenanceState => ({
  version: 1,
  state: 'unknown',
  reason: 'inspection-unavailable',
  revision: null,
});

/** Serializes entire engine operations with scheduling decisions. The durable
 * dirty marker + recovery alarm cover a crash between engine commit and inspect.
 * No engine/network I/O runs inside a storage transaction. */
export class MaintenanceScheduler {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private storage: DurableObjectStorage,
    private inspect: () => Promise<DomBotMaintenanceState>,
  ) {}
  run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.catch(() => {});
    return result;
  }
  private async state(
    storage: Pick<DurableObjectStorage, 'get'> = this.storage,
  ): Promise<State> {
    return (
      (await storage.get<State>(KEY)) ?? {
        generation: 0,
        dirty: true,
        paused: false,
        observedAt: 0,
        inspection: unknown(),
      }
    );
  }
  async prepare(): Promise<number> {
    return this.storage.transaction(async (tx) => {
      const s = await this.state(tx);
      s.generation++;
      s.dirty = true;
      await tx.put(KEY, s);
      if (!s.paused && !(await tx.getAlarm()))
        await tx.setAlarm(Date.now() + INTERVAL);
      return s.generation;
    });
  }
  async reconcile(): Promise<DomBotMaintenanceState> {
    const before = await this.state();
    let inspection: DomBotMaintenanceState;
    try {
      inspection = await this.inspect();
      if (
        inspection.version !== 1 ||
        !['empty', 'work', 'unknown'].includes(inspection.state)
      )
        inspection = unknown();
    } catch {
      inspection = unknown();
    }
    await this.storage.transaction(async (tx) => {
      const current = (await tx.get<State>(KEY)) ?? before;
      if (current.generation !== before.generation) return;
      await tx.put(KEY, {
        ...current,
        dirty: false,
        observedAt: Date.now(),
        inspection,
      });
      if (current.paused || inspection.state === 'empty')
        await tx.deleteAlarm();
      else if (!(await tx.getAlarm())) await tx.setAlarm(Date.now() + INTERVAL);
    });
    return inspection;
  }
  async pause() {
    await this.storage.transaction(async (tx) => {
      const s = await this.state(tx);
      await tx.put(KEY, { ...s, generation: s.generation + 1, paused: true });
      await tx.deleteAlarm();
    });
  }
  async resume(policy: boolean) {
    const s = await this.state();
    await this.storage.put(KEY, {
      ...s,
      generation: s.generation + 1,
      paused: false,
    });
    if (policy) await this.reconcile();
    else await this.storage.setAlarm(Date.now() + INTERVAL);
  }
  async status() {
    const s = await this.state();
    return { ...s, alarmAt: await this.storage.getAlarm() };
  }
  async mutate<T>(work: () => Promise<T>): Promise<T> {
    await this.prepare();
    try {
      return await work();
    } finally {
      await this.reconcile();
    }
  }
  async alarm(work: () => Promise<void>) {
    const s = await this.state();
    if (s.paused) {
      await this.storage.deleteAlarm();
      return;
    }
    if ((await this.reconcile()).state === 'empty') return;
    await this.prepare();
    try {
      await work();
    } finally {
      await this.reconcile();
    }
  }
}

// Unknown API/MCP/internal operations conservatively get a recovery alarm.
// These explicit reads cannot introduce maintenance work.
const reads = new Set([
  'getSettings',
  'getRevisions',
  'getFolders',
  'getImportedDomains',
  'getDomainEvents',
  'getRegistrarMetadata',
  'getDomainNotes',
  'getListPrices',
  'getRenewalPrices',
  'getBulkJob',
  'listBulkJobs',
  'getProxySettings',
]);
export async function mayChangeMaintenance(request: Request): Promise<boolean> {
  const path = new URL(request.url).pathname;
  if (request.method === 'GET' || request.method === 'HEAD')
    return !(
      path === '/' ||
      path.startsWith('/assets/') ||
      path.startsWith('/.well-known/') ||
      /^\/(p|d|i|t|shop)\//.test(path) ||
      ['/favicon.ico', '/mcp', '/authorize', '/oauth/status'].includes(path)
    );
  if (request.method === 'POST' && path.startsWith('/api/')) {
    const method = path.slice('/api/'.length);
    if (reads.has(method)) return false;
    if (method === 'listPortfolio') {
      const body = (await request
        .clone()
        .json()
        .catch(() => null)) as { args?: unknown[] } | null;
      return body?.args?.[0] !== false;
    }
  }
  // Discovery/token operations only maintain identity, never holdings/tasks.
  if (
    ['/authorize', '/token', '/register', '/revoke', '/oauth/status'].includes(
      path,
    )
  )
    return false;
  return true;
}
