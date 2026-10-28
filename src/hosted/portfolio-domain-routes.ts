import { z } from 'zod';
import {
  PortfolioDomains,
  domainMessage,
  portfolioHostname,
} from './portfolio-domains';
import { DomainServiceError } from './portfolio-domain-provider';
export async function portfolioDomainRequest(
  env: HostedEnv,
  workspace: string,
  path: string,
  request: Request,
) {
  const headers = {
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
  };
  const controller = new PortfolioDomains(env);
  try {
    if (path === '/site-domains' && request.method === 'GET')
      return Response.json(await controller.state(workspace), { headers });
    if (request.method !== 'POST')
      return Response.json({ error: 'Not found' }, { status: 404, headers });
    const raw: unknown = await request.json();
    if (path === '/site-domains/plans') {
      const body = z
        .object({
          hostname: z.string().max(253),
          revision: z.string().uuid().nullable(),
        })
        .strict()
        .parse(raw);
      return Response.json(
        await controller.plan(workspace, body.hostname, body.revision),
        { headers },
      );
    }
    if (path === '/site-domains/verify') {
      const body = z
        .object({ hostname: z.string().max(253), revision: z.string().uuid() })
        .strict()
        .parse(raw);
      return Response.json(
        await controller.verify(
          workspace,
          portfolioHostname(body.hostname, env),
          body.revision,
        ),
        { headers },
      );
    }
    if (path === '/site-domains/detach') {
      const body = z
        .object({
          hostname: z.string().max(253),
          epoch: z.number().int().positive(),
        })
        .strict()
        .parse(raw);
      return Response.json(
        await controller.detach(
          workspace,
          portfolioHostname(body.hostname, env),
          body.epoch,
        ),
        { headers },
      );
    }
    return Response.json({ error: 'Not found' }, { status: 404, headers });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof z.ZodError
            ? 'Check the domain setup fields and reload.'
            : domainMessage(error),
      },
      {
        status:
          error instanceof DomainServiceError && error.code === 'not-ready'
            ? 403
            : 409,
        headers,
      },
    );
  }
}
