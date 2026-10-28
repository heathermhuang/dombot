import {
  salesFormScript,
  salesFormScriptPath,
} from '../shared/sales-form-script';
import { z } from 'zod';
import { canonicalDomain } from '../shared/publication';
import { brandFontBytes, brandFontPath } from '../shared/brand-font';
import {
  PROOF_HEADER,
  signGatewayRequest,
  verifyGatewayRequest,
} from '../shared/gateway-proof';
import { salesPublicPath } from '../shared/sales-admission';
import { workspaceSchema, workspaceService } from './workspaces';
import type { HostBinding } from './sales-hostnames';
import { hostnameClaimsExist, ownsHostname } from './hostname-claims';
import {
  legacySalesFormScript,
  legacySalesFormScriptPath,
} from './sales-form-compat';

/** Public-only SaaS origin. No cookies, account routes, owner keys or registrar credentials. */
export default {
  async fetch(incoming, env) {
    const missing = () =>
      new Response('Sales page unavailable', {
        status: 404,
        headers: {
          'X-Domains-Sales-Edge': 'public-v1',
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
        },
      });
    const url = new URL(incoming.url);
    if (
      [salesFormScriptPath, legacySalesFormScriptPath].includes(url.pathname) &&
      incoming.method === 'GET'
    )
      return new Response(
        url.pathname === salesFormScriptPath
          ? salesFormScript
          : legacySalesFormScript,
        {
          headers: {
            'Content-Type': 'text/javascript',
            'Cache-Control': 'public,max-age=3600',
          },
        },
      );
    if (url.pathname === brandFontPath && incoming.method === 'GET')
      return new Response(brandFontBytes, {
        headers: {
          'Content-Type': 'font/woff2',
          'Cache-Control': 'public,max-age=31536000,immutable',
        },
      });
    if (
      env.PORTFOLIO_CUSTOM_HOSTS_ENABLED === 'true' &&
      env.PORTFOLIO_GATEWAY
    ) {
      const portfolio = await env.CONTROL_DB.prepare(
        "SELECT 1 FROM portfolio_hostnames WHERE hostname=? AND status!='detached'",
      )
        .bind(url.hostname)
        .first();
      if (portfolio) {
        if (
          !['GET', 'HEAD'].includes(incoming.method) ||
          !/^\/(?:c\/[a-z0-9-]+\/?)?$/.test(url.pathname)
        )
          return missing();
        const headers = new Headers();
        // The bridge holds no owner or tenant keys and forwards no caller identity.
        return env.PORTFOLIO_GATEWAY.fetch(
          new Request(url, {
            method: incoming.method,
            headers,
            redirect: 'manual',
          }),
        );
      }
    }
    if (env.SALES_CUSTOM_HOSTS_ENABLED !== 'true') return missing();
    let host;
    try {
      host = canonicalDomain(url.hostname);
    } catch {
      return missing();
    }
    const row = await env.CONTROL_DB.prepare(
      "SELECT h.* FROM sales_hostnames h JOIN workspaces w ON w.id=h.workspace_id WHERE h.hostname=? AND h.status IN ('active','checking-page') AND h.control_expires_at>? AND w.enabled=1 AND NOT EXISTS(SELECT 1 FROM closure_requests c WHERE c.workspace_id=w.id) AND NOT EXISTS(SELECT 1 FROM sales_domain_controls d WHERE d.workspace_id=h.workspace_id AND d.listing_id=h.listing_id AND d.status IN ('lost','recovering'))",
    )
      .bind(host, Date.now())
      .first<HostBinding>();
    if (!row) return missing();
    if (await hostnameClaimsExist(env.CONTROL_DB)) {
      if (
        !(await ownsHostname(
          env.CONTROL_DB,
          host,
          'sales',
          `${row.workspace_id}:${row.listing_id}:${row.epoch}`,
        ))
      )
        return missing();
    }
    if (url.protocol !== 'https:') {
      if (!['GET', 'HEAD'].includes(incoming.method))
        return new Response('HTTPS required', { status: 400 });
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }
    const configured = workspaceSchema
      .parse(JSON.parse(env.WORKSPACES))
      .find((w) => w.id === row.workspace_id);
    const key = z
      .record(z.string().min(32))
      .parse(JSON.parse(env.SALES_EDGE_KEYS ?? '{}'))[row.workspace_id];
    if (!configured || !key) return missing();
    if (row.status === 'checking-page') {
      const proof = await verifyGatewayRequest(key, row.workspace_id, incoming);
      if (
        incoming.method !== 'GET' ||
        url.pathname !== '/' ||
        proof?.owner !== null ||
        proof.sales?.purpose !== 'sales-public' ||
        proof.sales.epoch !== row.epoch ||
        proof.sales.listing !== row.listing_id ||
        proof.sales.host !== host
      )
        return missing();
    }
    // The listing may be an apex with an explicitly configured www alias.
    const path =
      url.pathname === '/'
        ? `/d/${row.domain}`
        : url.pathname === '/inquiries'
          ? `/d/${row.domain}/inquiries`
          : url.pathname;
    // No arbitrary /d, /sales, login, assets or POST forwarding on customer hosts.
    if (
      !(url.pathname === '/' && ['GET', 'HEAD'].includes(incoming.method)) &&
      !(url.pathname === '/inquiries' && incoming.method === 'POST') &&
      !/^\/(?:i|t)\/[A-Za-z0-9_-]{43}(?:\/(?:confirm|messages|resend))?$/.test(
        url.pathname,
      )
    )
      return missing();
    if (!salesPublicPath(path, incoming.method)) return missing();
    if (
      incoming.method === 'POST' &&
      incoming.headers.get('origin') !== url.origin
    )
      return new Response('Bad origin', { status: 403 });
    const headers = new Headers(incoming.headers);
    for (const name of [...headers.keys()])
      if (
        /^(?:cookie|authorization|host|x-dombot-|x-forwarded-|forwarded)/i.test(
          name,
        )
      )
        headers.delete(name);
    url.pathname = path;
    const request = new Request(url, {
      method: incoming.method,
      headers,
      body: ['GET', 'HEAD'].includes(incoming.method)
        ? undefined
        : incoming.body,
      redirect: 'manual',
    });
    request.headers.set(
      PROOF_HEADER,
      await signGatewayRequest(key, row.workspace_id, null, request, {
        purpose: 'sales-public',
        host,
        listing: row.listing_id,
        epoch: row.epoch,
      }),
    );
    const response = await workspaceService(env, configured.binding).fetch(
      request,
    );
    const out = new Headers(response.headers);
    out.delete('set-cookie');
    out.set('Cache-Control', 'no-store');
    out.set('Referrer-Policy', 'no-referrer');
    return new Response(response.body, {
      status: response.status,
      headers: out,
    });
  },
} satisfies ExportedHandler<HostedEnv>;
