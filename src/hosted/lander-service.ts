import { WorkerEntrypoint } from 'cloudflare:workers';
import { inspectSalesHosting } from './sales-hosting-provider';
import { LanderHosting } from './lander-hosting';

/** Operator service-binding RPC only. No HTTP handler, caller-selected paths,
 * credential values, customer hostname lists or mutation methods. The fixture
 * inspection is bound to the currently approved root/www pair and returns only
 * status/match counts. */
export class LanderService extends WorkerEntrypoint<HostedEnv> {
  inspectQualification() {
    return new LanderHosting(this.env).inspectQualification();
  }
  inspectHosting() {
    return inspectSalesHosting(this.env);
  }
}
