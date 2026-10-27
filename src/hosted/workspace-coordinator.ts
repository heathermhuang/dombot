import type { AdminInventoryQuery } from '../shared/admin-inventory';
import { DurableObject } from 'cloudflare:workers';
import {
  MaintenanceScheduler,
  mayChangeMaintenance,
} from './maintenance-scheduler';
import worker from '@domains-domains/dombot-engine';
import engineManifest from '@domains-domains/dombot-engine/manifest';
import {
  verifyTenantAdmission,
  signGatewayRequest,
  PROOF_HEADER,
} from '../shared/gateway-proof';
import { summarizeAdmin, failureCode, type Operation } from './admin-metrics';
import type {
  Domain,
  DomainEvent,
  ImportedDomain,
  RegistrarMeta,
  AppSettings,
} from '../shared/ipc';

/** One coordinator per tenant deployment. DomBot owns a single-instance,
 * in-memory store, so every API/MCP request and scheduled sync must reach
 * the same runtime before its hydrate -> mutate -> flush request lock. */
export class WorkspaceCoordinator extends DurableObject<Env> {
  private maintenance = new MaintenanceScheduler(this.ctx.storage, () =>
    worker.maintenanceState(this.env),
  );
  private get sleepPolicy() {
    return (
      Reflect.get(this.env, 'DOMBOT_PLATFORM_ALARMS') === 'true' &&
      Reflect.get(this.env, 'DOMBOT_EMPTY_SLEEP') === 'true'
    );
  }

  async fetch(request: Request): Promise<Response> {
    let rejected = 'invalid';
    const admission = await verifyTenantAdmission(
      this.env,
      request,
      (reason) => {
        rejected = reason;
      },
    );
    if (!admission) {
      return Response.json(
        { error: 'Trusted gateway request required' },
        {
          status: 403,
          headers: {
            'Cache-Control': 'no-store',
            'X-DomBot-Proof-Failure': rejected,
          },
        },
      );
    }
    if (this.sleepPolicy)
      return this.maintenance.run(async () =>
        (await mayChangeMaintenance(request))
          ? this.maintenance.mutate(() =>
              this.fetchAdmitted(request, admission.owner),
            )
          : this.fetchAdmitted(request, admission.owner),
      );
    return this.fetchAdmitted(request, admission.owner);
  }

  private async fetchAdmitted(
    request: Request,
    owner: string | null,
  ): Promise<Response> {
    // User Workers do not need one ordinary cron per tenant. Only the new
    // platform deployments opt in; existing customer schedules stay unchanged.
    if (
      Reflect.get(this.env, 'DOMBOT_PLATFORM_ALARMS') === 'true' &&
      !this.sleepPolicy &&
      owner &&
      !(await this.ctx.storage.getAlarm())
    )
      await this.ctx.storage.setAlarm(Date.now() + 300_000);
    const path = new URL(request.url).pathname;
    let wantsSync = path === '/api/syncRegistrar';
    let syncAccount: string | null = null;
    let syncRegistrar: string | null = null;
    if (
      ['/api/listPortfolio', '/api/syncRegistrar'].includes(path) &&
      request.method === 'POST'
    ) {
      const body = (await request
        .clone()
        .json()
        .catch(() => null)) as { args?: unknown[] } | null;
      if (path === '/api/listPortfolio')
        wantsSync = body !== null && body.args?.[0] !== false;
      else {
        syncRegistrar =
          typeof body?.args?.[0] === 'string' ? body.args[0] : null;
        syncAccount = typeof body?.args?.[1] === 'string' ? body.args[1] : null;
      }
    }
    const started = Date.now();
    const response = await worker
      .fetch(request, this.env, {
        waitUntil: (work: Promise<unknown>) => this.ctx.waitUntil(work),
      })
      .catch(async (error: unknown) => {
        try {
          await this.recordOperation({
            at: Date.now(),
            kind: 'request',
            status: 'failed',
            code: 'runtime',
            durationMs: Date.now() - started,
          });
        } catch {
          console.warn('[operations] recording unavailable');
        }
        throw error;
      });
    if (
      /^\/api\/(listPortfolio|syncRegistrar)$/.test(path) ||
      response.status >= 500
    ) {
      try {
        const sync = response.ok && wantsSync;
        if (sync || response.status >= 500) {
          const meta = sync
            ? await this.adminRead<RegistrarMeta[]>('getRegistrarMetadata')
            : [];
          const failed = meta.find(
            (m) =>
              m.configured &&
              m.enabled &&
              m.sync.lastError &&
              (!syncRegistrar || m.name === syncRegistrar) &&
              (!syncAccount || m.accountId === syncAccount),
          );
          await this.recordOperation({
            at: Date.now(),
            kind: sync ? 'sync' : 'request',
            status: failed || !response.ok ? 'failed' : 'ok',
            code: failed
              ? failureCode(failed.sync.lastError!)
              : response.ok
                ? 'none'
                : 'runtime',
            durationMs: Date.now() - started,
          });
        }
      } catch {
        console.warn('[operations] recording unavailable');
      }
    }
    const headers = new Headers(response.headers);
    headers.set('X-DomBot-Engine', engineManifest.version);
    headers.set('X-DomBot-Engine-Source', engineManifest.sourceSha256);
    return new Response(response.body, { status: response.status, headers });
  }

  private async adminRead<T>(method: string, args: unknown[] = []): Promise<T> {
    const request = new Request(`https://workspace.internal/api/${method}`, {
      method: 'POST',
      headers: {
        Origin: 'https://workspace.internal',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ args }),
    });
    request.headers.set(
      PROOF_HEADER,
      await signGatewayRequest(
        this.env.DOMBOT_GATEWAY_SECRET ?? '',
        this.env.DOMBOT_WORKSPACE_ID ?? '',
        'system-observability',
        request,
      ),
    );
    const response = await worker.fetch(request, this.env, {
      waitUntil: (work: Promise<unknown>) => this.ctx.waitUntil(work),
    });
    if (!response.ok) throw Error('Workspace observation unavailable');
    return ((await response.json()) as { result: T }).result;
  }

  private async recordOperation(operation: Operation) {
    await this.ctx.storage.transaction(async (storage) => {
      await storage.put(
        `operation:${operation.at}:${crypto.randomUUID()}`,
        operation,
      );
      const entries = await storage.list({
        prefix: 'operation:',
        reverse: true,
      });
      const expired = [...entries.keys()].slice(100);
      if (expired.length) await storage.delete(expired);
    });
  }

  async syncMonitor(revision?: string) {
    return worker.syncMonitor(this.env, revision);
  }

  async adminInventory(query: AdminInventoryQuery) {
    const work = worker.adminInventory(this.env, query);
    this.ctx.waitUntil(work.then(() => {}).catch(() => {}));
    return work;
  }

  async adminSnapshot() {
    // These are cache reads through the engine's own auth/hydrate/flush lock.
    // No registrar API calls, customer settings changes or secret export.
    const domains = await this.adminRead<{ domains: Domain[] }>(
      'listPortfolio',
      [false],
    );
    const imported =
      await this.adminRead<Record<string, ImportedDomain>>(
        'getImportedDomains',
      );
    const events = await this.adminRead<DomainEvent[]>('getDomainEvents');
    const metadata = await this.adminRead<RegistrarMeta[]>(
      'getRegistrarMetadata',
    );
    const settings = await this.adminRead<AppSettings>('getSettings');
    const operations = await this.ctx.storage.list<Operation>({
      prefix: 'operation:',
      reverse: true,
      limit: 100,
    });
    return {
      ...summarizeAdmin(
        domains.domains,
        imported,
        events,
        metadata,
        settings.autoSyncIntervalMinutes,
        [...operations.values()],
      ),
      maintenance: {
        policy: this.sleepPolicy,
        ...(await this.maintenance.status()),
      },
    };
  }

  async alarm(): Promise<void> {
    if (Reflect.get(this.env, 'DOMBOT_PLATFORM_ALARMS') !== 'true') return;
    if (this.sleepPolicy)
      return this.maintenance.run(() =>
        this.maintenance.alarm(() =>
          this.executeScheduled('platform-alarm', Date.now()),
        ),
      );
    try {
      await this.runScheduled('platform-alarm', Date.now());
    } finally {
      await this.ctx.storage.setAlarm(Date.now() + 300_000);
    }
  }

  async platformHealth() {
    return {
      workspace: this.env.DOMBOT_WORKSPACE_ID,
      alarmAt: await this.ctx.storage.getAlarm(),
      release: Reflect.get(this.env, 'DOMBOT_PLATFORM_RELEASE') ?? '',
      engine: engineManifest.version,
      maintenance: {
        policy: this.sleepPolicy,
        ...(await this.maintenance.status()),
      },
    };
  }

  async pausePlatformAlarm() {
    await this.maintenance.run(() => this.maintenance.pause());
  }

  async reconcileMaintenance() {
    return this.maintenance.run(async () => {
      if (this.sleepPolicy) await this.maintenance.reconcile();
      return this.platformHealth();
    });
  }

  async resumePlatformAlarm() {
    return this.maintenance.run(async () => {
      await this.maintenance.resume(this.sleepPolicy);
      return this.platformHealth();
    });
  }

  async runScheduled(cron: string, scheduledTime: number): Promise<void> {
    return this.maintenance.run(() =>
      this.executeScheduled(cron, scheduledTime),
    );
  }

  private async executeScheduled(
    cron: string,
    scheduledTime: number,
  ): Promise<void> {
    // RPC is available only through the private Durable Object binding.
    // The original handler uses the same request lock as fetch requests.
    const started = Date.now();
    let failed = false;
    let code: Operation['code'] = 'none';
    try {
      await worker.scheduled({ cron, scheduledTime, noRetry() {} }, this.env);
      const meta = await this.adminRead<RegistrarMeta[]>(
        'getRegistrarMetadata',
      );
      const failure = meta.find(
        (m) => m.configured && m.enabled && m.sync.lastError,
      );
      failed = Boolean(failure);
      if (failure) code = failureCode(failure.sync.lastError!);
    } catch (error) {
      failed = true;
      code = 'runtime';
      throw error;
    } finally {
      try {
        await this.recordOperation({
          at: Date.now(),
          kind: 'scheduled',
          status: failed ? 'failed' : 'ok',
          code,
          durationMs: Date.now() - started,
        });
      } catch {
        console.warn('[operations] recording unavailable');
      }
    }
  }
}
