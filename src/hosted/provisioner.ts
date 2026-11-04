import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';
import { z } from 'zod';
import {
  qaTemplate,
  readQaRun,
  cleanupProductionImportQa,
  cleanupExpiredProductionImportQa,
  qaLease,
} from './production-import-qa';
import {
  recoverPortfolio,
  recoveryPlanSchema,
  type RecoveryPlan,
} from './provisioning-recovery';
import {
  provisionPortfolio,
  type SetupState,
  type ProvisioningEnv,
} from './provisioning';
const safeId = (id: string) => z.string().uuid().parse(id);
export class PortfolioSetup extends DurableObject<ProvisioningEnv> {
  private queue: Promise<unknown> = Promise.resolve();
  async #retryQa(id: string) {
    try {
      const run = await qaLease(this.env.CONTROL_DB, id);
      if (
        this.ctx.id.toString() !==
          this.env.SETUPS.idFromName(run.workspace_id).toString() ||
        run.state !== 'retry' ||
        run.attempts >= 3
      )
        return false;
      await this.ctx.storage.put('qa-run', id);
      await this.ctx.storage.setAlarm(
        Math.max(Date.now() + 1000, run.next_cleanup_at),
      );
      return true;
    } catch {
      return false;
    }
  }
  armQa(runId: string) {
    const work = this.queue.then(async () => {
      const run = await qaLease(this.env.CONTROL_DB, runId);
      if (
        this.ctx.id.toString() !==
        this.env.SETUPS.idFromName(run.workspace_id).toString()
      )
        throw Error('QA setup object mismatch');
      if (['complete', 'blocked'].includes(run.state)) return { armed: false };
      await this.ctx.storage.put('qa-run', runId);
      await this.ctx.storage.setAlarm(
        Math.max(run.expires_at, run.next_cleanup_at),
      );
      return { armed: true, expiresAt: run.expires_at };
    });
    this.queue = work.catch(() => undefined);
    return work;
  }
  async alarm() {
    const id = await this.ctx.storage.get<string>('qa-run');
    if (!id) return;
    try {
      const run = await qaLease(this.env.CONTROL_DB, id);
      if (run.state === 'complete' || run.state === 'blocked') {
        await this.ctx.storage.deleteAlarm();
        return;
      }
      if (run.cleanup_started_at === null && run.expires_at > Date.now()) {
        await this.ctx.storage.setAlarm(run.expires_at);
        return;
      }
      const result = await this.cleanupQa(id, 'expiry');
      if (!result.complete) await this.#retryQa(id);
    } catch {
      if (!(await this.#retryQa(id))) await this.ctx.storage.deleteAlarm();
      console.error('Production import QA alarm needs attention', {
        runId: id,
      });
    }
  }
  cleanupQa(runId: string, trigger: 'finish' | 'expiry' = 'finish') {
    const work = this.queue.then(async () => {
      const run = await readQaRun(this.env.CONTROL_DB, runId);
      if (
        !run ||
        this.ctx.id.toString() !==
          this.env.SETUPS.idFromName(run.workspace_id).toString()
      )
        throw Error('QA setup object mismatch');
      try {
        return await cleanupProductionImportQa(
          this.env,
          {
            get: () => this.ctx.storage.get<SetupState>('setup'),
            clear: () => this.ctx.storage.deleteAll(),
            empty: async () =>
              (await this.ctx.storage.list({ limit: 1 })).size === 0 &&
              (await this.ctx.storage.getAlarm()) === null,
          },
          runId,
          fetch,
          trigger,
        );
      } catch (error) {
        await this.#retryQa(runId);
        throw error;
      }
    });
    this.queue = work.catch(() => undefined);
    return work;
  }
  recover(plan: RecoveryPlan) {
    const work = this.queue.then(async () =>
      recoverPortfolio(
        this.env,
        await this.ctx.storage.get<SetupState>('setup'),
        plan,
      ),
    );
    this.queue = work.catch(() => undefined);
    return work;
  }
  provision(workspace: string, user: string) {
    const work = this.queue.then(() =>
      provisionPortfolio(
        this.env,
        {
          get: () => this.ctx.storage.get<SetupState>('setup'),
          put: (state) => this.ctx.storage.put('setup', state),
        },
        workspace,
        user,
      ),
    );
    this.queue = work.catch(() => undefined);
    return work;
  }
}
export class Provisioner extends WorkerEntrypoint<ProvisioningEnv> {
  async armQa(runId: string) {
    const run = await qaLease(this.env.CONTROL_DB, runId);
    return this.env.SETUPS.get(
      this.env.SETUPS.idFromName(run.workspace_id),
    ).armQa(runId);
  }
  qaTemplate() {
    return qaTemplate(this.env);
  }
  async cleanupQa(runId: string) {
    const run = await readQaRun(this.env.CONTROL_DB, runId);
    if (!run) throw Error('Unregistered production QA run');
    return this.env.SETUPS.get(
      this.env.SETUPS.idFromName(run.workspace_id),
    ).cleanupQa(runId);
  }
  async qaStatus(runId: string) {
    const run = await readQaRun(this.env.CONTROL_DB, runId);
    if (!run) return null;
    return {
      runId: run.run_id,
      workspace: run.workspace_id,
      state: run.state,
      expiresAt: run.expires_at,
      lastError: run.last_error,
      cleanupTrigger: run.cleanup_trigger,
      nextCleanupAt: run.next_cleanup_at,
      attempts: run.attempts,
      workers: run.worker_absent ? 0 : null,
      databases: run.database_absent ? 0 : null,
      setupKeys: run.setup_erased ? 0 : null,
    };
  }
  recover(input: unknown) {
    const plan = recoveryPlanSchema.parse(input);
    return this.env.SETUPS.get(
      this.env.SETUPS.idFromName(plan.workspace),
    ).recover(plan);
  }
  provision(workspace: string, user: string) {
    safeId(workspace);
    safeId(user);
    return this.env.SETUPS.get(this.env.SETUPS.idFromName(workspace)).provision(
      workspace,
      user,
    );
  }
}
/** Only renderer assets are served over HTTP; provisioning is service-binding RPC. */
export default {
  scheduled(_event: ScheduledController, env: ProvisioningEnv) {
    return cleanupExpiredProductionImportQa(env);
  },
  fetch(request: Request, env: ProvisioningEnv) {
    const path = new URL(request.url).pathname;
    if (
      !['GET', 'HEAD'].includes(request.method) ||
      !(
        path === '/' ||
        path === '/index.html' ||
        path === '/favicon.ico' ||
        /^\/assets\/[A-Za-z0-9_.-]+$/.test(path)
      )
    )
      return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
