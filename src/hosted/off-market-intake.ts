import { z } from 'zod';
import { PROOF_HEADER, signGatewayRequest } from '../shared/gateway-proof';
import { captureInquiryRequest } from '../shared/inquiry-identity';
import { salesMailReady, salesRecipient } from './sales-notifications';
import { workspaceFor, workspaceKey, workspaceService } from './workspaces';

export async function offMarketIntake(request: Request, env: HostedEnv) {
  const incoming = new URL(request.url);
  const reviewer = z.uuid().safeParse(env.OFF_MARKET_STAGING_REVIEWER);
  const buyer = z.email().safeParse(env.OFF_MARKET_STAGING_BUYER_EMAIL);
  const closed = () =>
    new Response('Page not found', {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  if (
    !reviewer.success ||
    !buyer.success ||
    incoming.origin !== env.CANONICAL_ORIGIN ||
    !/^https:\/\/domains-[a-z0-9-]+-qa-[a-f0-9]{8}\.[a-z0-9-]+\.workers\.dev$/.test(
      incoming.origin,
    ) ||
    env.PUBLIC_REGISTRATION_ENABLED !== 'false' ||
    !salesMailReady(env)
  )
    return closed();
  if (
    request.method === 'POST' &&
    request.headers.get('Origin') !== incoming.origin
  )
    return new Response('Bad origin', { status: 403 });
  if (request.method === 'POST') {
    const clone = request.clone();
    const email = await (
      request.headers.get('Content-Type')?.includes('application/json')
        ? clone.json<{ email?: unknown }>().then((data) => data?.email)
        : clone.formData().then((data) => data.get('email'))
    ).catch(() => null);
    if (
      typeof email !== 'string' ||
      email.trim().toLowerCase() !== buyer.data.toLowerCase()
    )
      return closed();
  }

  const owner = await env.CONTROL_DB.prepare(
    `SELECT u.email,u.workspace_id FROM users u JOIN workspaces w ON u.workspace_id=w.id
    WHERE u.id=? AND w.enabled=1 AND NOT EXISTS(SELECT 1 FROM closure_requests c WHERE c.workspace_id=w.id)`,
  )
    .bind(reviewer.data)
    .first<{ email: string; workspace_id: string }>();
  if (
    !owner ||
    !(await salesRecipient(env, owner.workspace_id, owner.email)).verified
  )
    return closed();
  const id = owner.workspace_id;
  const configured = await workspaceFor(env, id);
  if (!configured) return closed();
  const headers = new Headers();
  for (const key of ['origin', 'content-type', 'cf-connecting-ip']) {
    const value = request.headers.get(key);
    if (value) headers.set(key, value);
  }
  const forwarded = new Request(incoming, {
    method: request.method,
    headers,
    redirect: 'manual',
    body: request.method === 'POST' ? await request.arrayBuffer() : undefined,
  });
  forwarded.headers.set(
    PROOF_HEADER,
    await signGatewayRequest(await workspaceKey(env, id), id, null, forwarded, {
      purpose: 'sales-public',
      host: incoming.hostname,
      listing: null,
      epoch: 0,
      ...(request.method === 'POST'
        ? { inquiryRequest: captureInquiryRequest(request) }
        : {}),
    }),
  );
  const response = await workspaceService(env, configured.binding).fetch(
    forwarded,
  );
  return { response, workspace: id };
}
