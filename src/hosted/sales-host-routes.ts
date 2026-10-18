import { z } from 'zod';
import { SalesHostnames } from './sales-hostnames';
import { PROOF_HEADER, signGatewayRequest } from '../shared/gateway-proof';
import { gatewayKey, workspaceSchema, workspaceService } from './workspaces';
import type { SalesListingDetail } from '../shared/sales-api';

export async function salesHostRequest(
  env: HostedEnv,
  workspace: string,
  owner: string,
  path: string,
  request: Request,
): Promise<Response> {
  const hostnames = new SalesHostnames(env);
  try {
    if (request.method === 'GET' && path === '/sales/hosts') {
      const listing = z
        .string()
        .uuid()
        .parse(new URL(request.url).searchParams.get('listing'));
      return Response.json(
        {
          items: await hostnames.list(workspace, listing),
          enabled: env.SALES_CUSTOM_HOSTS_ENABLED === 'true',
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (request.method !== 'POST')
      return Response.json({ error: 'Not found' }, { status: 404 });
    const raw: unknown = await request.json();
    const common = z.object({
      listingId: z.string().uuid(),
      hostname: z.string().max(253),
    });
    const body =
      path === '/sales/hosts/plans'
        ? common.strict().parse(raw)
        : common
            .extend({
              epoch: z.number().int().positive(),
              ...(path.endsWith('/activate')
                ? { challenge: z.string().min(20).max(100) }
                : {}),
            })
            .strict()
            .parse(raw);
    const configured = workspaceSchema
      .parse(JSON.parse(env.WORKSPACES))
      .find((w) => w.id === workspace);
    if (!configured) throw new Error('Account unavailable');
    const read = new Request(
      new URL(`/sales/listings/${body.listingId}`, env.CANONICAL_ORIGIN),
    );
    read.headers.set(
      PROOF_HEADER,
      await signGatewayRequest(
        gatewayKey(env, workspace),
        workspace,
        owner,
        read,
        { purpose: 'sales-owner', recipientVerified: false },
      ),
    );
    const response = await workspaceService(env, configured.binding).fetch(
      read,
    );
    if (!response.ok) throw new Error('The listing is unavailable.');
    const listing = (await response.json()) as SalesListingDetail;
    let result;
    if (path === '/sales/hosts/plans')
      result = await hostnames.plan(
        workspace,
        body.listingId,
        body.hostname,
        listing.draft.domain,
      );
    else if (
      path === '/sales/hosts/detach' &&
      'epoch' in body &&
      typeof body.epoch === 'number'
    )
      result = await hostnames.detach(
        workspace,
        body.listingId,
        body.hostname,
        body.epoch,
      );
    else if (
      path === '/sales/hosts/activate' &&
      'epoch' in body &&
      typeof body.epoch === 'number' &&
      'challenge' in body &&
      typeof body.challenge === 'string'
    ) {
      if (
        !listing.observation.available ||
        !listing.published ||
        listing.availability !== 'available'
      )
        throw new Error(
          'Publish an available listing with current control before activating.',
        );
      result = await hostnames.activate(
        workspace,
        body.listingId,
        body.hostname,
        body.epoch,
        body.challenge,
        listing.published.revision,
      );
    } else return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof z.ZodError
            ? 'Check the hostname request fields.'
            : e instanceof Error
              ? e.message
              : 'Domain setup failed.',
      },
      { status: 409, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
