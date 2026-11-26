import { z } from 'zod';
import { PROOF_HEADER, signGatewayRequest } from '../shared/gateway-proof';
import { checkoutCaseSchema, type CheckoutCase } from './checkout-case-schema';
import { workspaceFor, workspaceKey, workspaceService } from './workspaces';

const path = '/platform-internal/checkout-case';
export function stagingCheckout(env: HostedEnv, workspace: string) {
  return (
    env.CHECKOUT_SIMULATOR &&
    (env.CHECKOUT_SIMULATOR_KEY?.length ?? 0) >= 32 &&
    z.uuid().safeParse(workspace).success &&
    env.CHECKOUT_STAGING_WORKSPACE === workspace &&
    /^https:\/\/domains-[a-z0-9-]+-qa-[a-f0-9]{8}\.[a-z0-9-]+\.workers\.dev$/.test(
      env.CANONICAL_ORIGIN ?? '',
    ) &&
    env.PUBLIC_REGISTRATION_ENABLED === 'false'
  );
}

async function requestCheckoutCase(
  env: HostedEnv,
  workspace: string,
  input: CheckoutCase | { thread: string } | { caseId: string },
) {
  if (!stagingCheckout(env, workspace)) return null;
  const selected = await workspaceFor(env, workspace);
  if (!selected) return null;
  const request = new Request(new URL(path, env.CANONICAL_ORIGIN), {
    method: 'POST',
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(4000),
  });
  request.headers.set(
    PROOF_HEADER,
    await signGatewayRequest(
      await workspaceKey(env, workspace),
      workspace,
      null,
      request,
    ),
  );
  return workspaceService(env, selected.binding).fetch(request);
}

export async function verifyCheckoutCase(
  env: HostedEnv,
  workspace: string,
  input: CheckoutCase,
) {
  const response = await requestCheckoutCase(env, workspace, input);
  if (!response) return false;
  await response.body?.cancel();
  if (response.status !== 204 && response.status !== 404)
    throw new Error('Checkout case verifier unavailable');
  return response.status === 204;
}

export async function findCheckoutCase(
  env: HostedEnv,
  workspace: string,
  thread: string,
) {
  const response = await requestCheckoutCase(env, workspace, { thread });
  if (!response || !response.ok) {
    await response?.body?.cancel();
    return null;
  }
  return z
    .object({ caseId: z.uuid() })
    .strict()
    .parse(await response.json()).caseId;
}

export async function readCheckoutQuote(
  env: HostedEnv,
  workspace: string,
  caseId: string,
) {
  const response = await requestCheckoutCase(env, workspace, { caseId });
  if (!response || !response.ok) {
    await response?.body?.cancel();
    return null;
  }
  return checkoutCaseSchema.parse(await response.json());
}
