import { WorkerEntrypoint } from 'cloudflare:workers';
import { inspectSalesHosting } from './sales-hosting-provider';

/** Operator service-binding RPC only. No HTTP handler, caller-selected paths,
 * credential values, customer hostname lists or mutation methods. */
export class LanderService extends WorkerEntrypoint<HostedEnv> {
  inspectHosting() {
    return inspectSalesHosting(this.env);
  }
}
