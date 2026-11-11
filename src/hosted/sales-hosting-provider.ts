import { canonicalDomain } from '../shared/publication';
import { z } from 'zod';

type ProviderEnv = Pick<
  HostedEnv,
  | 'SALES_CF_ZONE_ID'
  | 'SALES_CF_API_TOKEN'
  | 'SALES_CNAME_TARGET'
  | 'PORTFOLIO_CF_ZONE_ID'
  | 'PORTFOLIO_CF_API_TOKEN'
  | 'PORTFOLIO_CNAME_TARGET'
  | 'PORTFOLIO_EDGE_WORKER'
>;
export function salesHostingProvider(env: ProviderEnv) {
  const explicit = !!(env.SALES_CF_ZONE_ID || env.SALES_CF_API_TOKEN);
  const zoneId = explicit ? env.SALES_CF_ZONE_ID : env.PORTFOLIO_CF_ZONE_ID;
  const token = explicit ? env.SALES_CF_API_TOKEN : env.PORTFOLIO_CF_API_TOKEN;
  const target = explicit ? env.SALES_CNAME_TARGET : env.PORTFOLIO_CNAME_TARGET;
  if (!zoneId || !/^[a-f0-9]{32}$/.test(zoneId) || !token)
    throw Error('The service hostname provider is not completely configured.');
  if (
    !explicit &&
    (env.PORTFOLIO_EDGE_WORKER !== 'domains-sales-lander' ||
      (env.SALES_CNAME_TARGET && env.SALES_CNAME_TARGET !== target))
  )
    throw Error(
      'The shared hosting configuration does not match the Sales edge.',
    );
  return {
    source: explicit ? ('sales' as const) : ('existing-portfolio' as const),
    zoneId,
    token,
    target: target ? canonicalDomain(target) : null,
  };
}
export function salesHostingTarget(env: ProviderEnv) {
  if (env.SALES_CNAME_TARGET) return canonicalDomain(env.SALES_CNAME_TARGET);
  try {
    return salesHostingProvider(env).target;
  } catch {
    return null;
  }
}

/** Fixed read-only paths and sanitized results. Credentials remain in the
 * existing gateway; this never changes hostnames, DNS, delegation or billing. */
export async function inspectSalesHosting(
  env: ProviderEnv,
  fetcher: typeof fetch = fetch,
) {
  let config: ReturnType<typeof salesHostingProvider>;
  try {
    config = salesHostingProvider(env);
  } catch {
    return {
      configured: false as const,
      reason: 'incomplete-or-mismatched-provider',
    };
  }
  const read = async (path: string) => {
    let response: Response;
    try {
      response = await fetcher(
        `https://api.cloudflare.com/client/v4/zones/${config.zoneId}${path}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${config.token}` },
          redirect: 'manual',
          signal: AbortSignal.timeout(10000),
        },
      );
    } catch {
      return { ok: false as const, status: 0, reason: 'network' };
    }
    const reader = response.body?.getReader(),
      decoder = new TextDecoder();
    let text = '',
      size = 0;
    try {
      if (reader)
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.length;
          if (size > 262144) throw Error();
          text += decoder.decode(chunk.value, { stream: true });
        }
      text += decoder.decode();
      const value = z
        .object({
          success: z.boolean(),
          result: z.unknown(),
          result_info: z
            .object({ total_count: z.number().int().nonnegative() })
            .optional(),
        })
        .parse(JSON.parse(text));
      if (!response.ok || value.success !== true)
        return {
          ok: false as const,
          status: response.status,
          reason: 'provider-access',
        };
      return { ok: true as const, status: response.status, value };
    } catch {
      await reader?.cancel().catch(() => {});
      return {
        ok: false as const,
        status: response.status,
        reason: 'unreadable-reply',
      };
    }
  };
  const hosts = await read('/custom_hostnames?per_page=1'),
    fallback = await read('/custom_hostnames/fallback_origin');
  const count = hosts.ok
    ? (hosts.value.result_info?.total_count ?? null)
    : null;
  const fallbackState = fallback.ok
    ? z
        .object({
          origin: z.string().max(253).transform(canonicalDomain),
          status: z.string().max(100),
        })
        .safeParse(fallback.value.result)
    : null;
  const origin = fallbackState?.success ? fallbackState.data.origin : null;
  const state = fallbackState?.success ? fallbackState.data.status : null;
  return {
    configured: true as const,
    source: config.source,
    zoneId: config.zoneId,
    target: config.target,
    hostnames: { reachable: hosts.ok, status: hosts.status, count },
    fallback: {
      reachable: fallback.ok,
      status: fallback.status,
      origin,
      state,
    },
  };
}
