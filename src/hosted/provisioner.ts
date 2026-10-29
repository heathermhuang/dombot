import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';
import { z } from 'zod';
import {
  provisionPortfolio,
  type SetupState,
  type ProvisioningEnv,
} from './provisioning';
const safeId = (id: string) => z.string().uuid().parse(id);
export class PortfolioSetup extends DurableObject<ProvisioningEnv> {
  private queue: Promise<unknown> = Promise.resolve();
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
