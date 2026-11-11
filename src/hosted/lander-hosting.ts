import { z } from 'zod';
import { SalesHostnames, salesDns, type HostBinding } from './sales-hostnames';
import { certificateInstructions } from './portfolio-domain-provider';
import { canonicalDomain } from '../shared/publication';
import { type LanderHostingPlan } from '../shared/lander-connection';
import { claimHostname, rememberHostnameProvider } from './hostname-claims';
import { workspaceSchema } from './workspaces';
import { salesHostingProvider } from './sales-hosting-provider';
import { dynadotDnsSetupScope } from '../shared/dynadot-dns-setup';

interface ConnectionHost extends HostBinding {
  connection_key: string | null;
  connection_route_id: string | null;
  connection_intent: string | null;
}
const providerSchema = z
  .object({
    id: z.string().uuid(),
    hostname: z.string(),
    status: z.string(),
    ssl: z.object({
      status: z.string(),
      validation_records: z
        .array(
          z
            .object({
              txt_name: z.string().optional(),
              txt_value: z.string().optional(),
            })
            .passthrough(),
        )
        .optional(),
    }),
    ownership_verification: z
      .object({ type: z.string(), name: z.string(), value: z.string() })
      .optional(),
    custom_metadata: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();
/** Controlled hosting preparation is separate from the read-only DNS planner.
 * It never changes DNS, publications, delegation or existing active bindings. */
export class LanderHosting {
  constructor(
    readonly env: HostedEnv,
    readonly fetcher: typeof fetch = fetch,
    readonly fence: () => Promise<void> = async () => {},
  ) {}
  qualified(workspace: string, domain: string) {
    if (
      this.env.LANDER_CONNECTIONS_ENABLED !== 'true' ||
      !z
        .array(z.string().uuid())
        .parse(JSON.parse(this.env.LANDER_CONNECTION_WORKSPACES ?? '[]'))
        .includes(workspace) ||
      this.env.SALES_CUSTOM_HOSTS_ENABLED !== 'true'
    )
      throw Error(
        'Automatic lander connections are not enabled for this qualified account.',
      );
    if (
      !workspaceSchema
        .parse(JSON.parse(this.env.WORKSPACES))
        .some((w) => w.id === workspace) ||
      !z
        .record(z.string(), z.string().min(32))
        .parse(JSON.parse(this.env.SALES_EDGE_KEYS ?? '{}'))[workspace]
    )
      throw Error('The public edge is not qualified for this account.');
    const allow = new Set((this.env.SALES_HOST_ALLOWLIST ?? '').split(','));
    const fixture = dynadotDnsSetupScope(
      this.env.DYNDNS_SETUP_FIXTURE,
      workspace,
    );
    const admitted = z
      .array(z.string().uuid())
      .parse(JSON.parse(this.env.LANDER_CONNECTION_WORKSPACES ?? '[]'));
    const qualificationOnly =
      fixture?.qualifyEndpoint === true &&
      fixture.domain === domain &&
      admitted.length === 1 &&
      admitted[0] === workspace &&
      Number(this.env.LANDER_QUALIFIED_HOST_CAP) === 2;
    if (
      !allow.has(domain) ||
      !allow.has(`www.${domain}`) ||
      !this.env.LANDER_QUALIFIED_CNAME_TARGET ||
      this.env.LANDER_QUALIFIED_CNAME_TARGET !==
        salesHostingProvider(this.env).target ||
      (this.env.LANDER_APEX_FLATTENING_QUALIFIED !== 'true' &&
        !qualificationOnly)
    )
      throw Error(
        'Root and www routing need controlled provider and endpoint qualification.',
      );
    canonicalDomain(this.env.LANDER_QUALIFIED_CNAME_TARGET);
  }
  async zoneCall(path: string, method = 'GET', body?: unknown) {
    const provider = salesHostingProvider(this.env);
    if (method !== 'GET') await this.fence();
    const r = await this.fetcher(
      `https://api.cloudflare.com/client/v4/zones/${provider.zoneId}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${provider.token}`,
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
      },
    );
    if (
      r.status === 404 &&
      /^\/custom_hostnames\/[a-f0-9-]+$/.test(path) &&
      ['GET', 'DELETE'].includes(method)
    ) {
      await r.body?.cancel();
      return { result: null, result_info: undefined };
    }
    const reader = r.body?.getReader(),
      decoder = new TextDecoder();
    let text = '',
      size = 0;
    if (reader)
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.length;
          if (size > 1000000)
            throw Error('Hosting reply exceeded its safety limit.');
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
      }
    const value = z
      .object({
        success: z.literal(true),
        result: z.unknown(),
        result_info: z.object({ total_count: z.number() }).optional(),
      })
      .parse(JSON.parse(text));
    if (!r.ok) throw Error('Hosting provider unavailable.');
    return value;
  }
  async prepare(
    workspace: string,
    listing: string,
    domain: string,
    generation: string,
  ): Promise<LanderHostingPlan[]> {
    this.qualified(workspace, domain);
    const correlated = this.env.LANDER_CUSTOM_METADATA_QUALIFIED === 'true';
    const controller = new SalesHostnames(this.env, this.fetcher),
      plans: LanderHostingPlan[] = [];
    for (const hostname of [domain, `www.${domain}`]) {
      let row = await this.env.CONTROL_DB.prepare(
        'SELECT * FROM sales_hostnames WHERE hostname=?',
      )
        .bind(hostname)
        .first<ConnectionHost>();
      if (row && row.connection_key !== generation && row.status !== 'detached')
        throw Error(
          'An existing hostname setup is preserved. Review or detach it before a new connection.',
        );
      if (!row || row.connection_key !== generation) {
        await this.fence();
        const plan = await controller.plan(
          workspace,
          listing,
          hostname,
          domain,
        );
        row = await this.env.CONTROL_DB.prepare(
          "UPDATE sales_hostnames SET connection_key=?,connection_route_id=NULL,connection_intent=NULL,connection_receipt=NULL WHERE hostname=? AND workspace_id=? AND listing_id=? AND epoch=? AND status='pending-proof' RETURNING *",
        )
          .bind(generation, hostname, workspace, listing, plan.epoch)
          .first<ConnectionHost>();
      }
      if (
        !row ||
        row.workspace_id !== workspace ||
        row.listing_id !== listing ||
        row.connection_key !== generation
      )
        throw Error('Hostname generation changed.');
      const claim = `${workspace}:${listing}:${row.epoch}`;
      await claimHostname(
        this.env.CONTROL_DB,
        hostname,
        'sales',
        workspace,
        claim,
      );
      let provider;
      if (row.provider_id)
        provider = providerSchema.parse(
          (await this.zoneCall(`/custom_hostnames/${row.provider_id}`)).result,
        );
      else {
        const candidates = z
          .array(providerSchema)
          .max(100)
          .parse(
            (
              await this.zoneCall(
                `/custom_hostnames?hostname=${encodeURIComponent(hostname)}&per_page=100`,
              )
            ).result,
          );
        const exact = candidates.filter(
          (p) =>
            correlated &&
            p.hostname === hostname &&
            p.custom_metadata?.domains_connection === generation,
        );
        if (
          exact.length > 1 ||
          candidates.some(
            (p) =>
              p.hostname === hostname &&
              (!correlated ||
                p.custom_metadata?.domains_connection !== generation),
          )
        )
          throw Error(
            'An existing provider hostname belongs to another setup and was not adopted.',
          );
        if (exact.length) provider = exact[0];
        else {
          if (row.connection_intent)
            throw Error(
              'Hostname creation has an unknown outcome. It was not replayed. Reconcile the provider resource.',
            );
          const count = (await this.zoneCall('/custom_hostnames?per_page=1'))
            .result_info?.total_count;
          if (
            count === undefined ||
            count >= Number(this.env.LANDER_QUALIFIED_HOST_CAP ?? 0)
          )
            throw Error(
              'Qualified hostname capacity is unavailable. No paid entitlement was added.',
            );
          const admitted = await this.env.CONTROL_DB.prepare(
            "UPDATE sales_hostnames SET connection_intent='create-hostname' WHERE hostname=? AND epoch=? AND connection_key=? AND connection_intent IS NULL RETURNING hostname",
          )
            .bind(hostname, row.epoch, generation)
            .first();
          if (!admitted)
            throw Error('Hostname creation is already in progress.');
          provider = providerSchema.parse(
            (
              await this.zoneCall('/custom_hostnames', 'POST', {
                hostname,
                ...(correlated
                  ? { custom_metadata: { domains_connection: generation } }
                  : {}),
                ssl: {
                  method: 'txt',
                  type: 'dv',
                  settings: { min_tls_version: '1.2' },
                },
              })
            ).result,
          );
        }
      }
      if (
        provider.hostname !== hostname ||
        ((correlated ||
          provider.custom_metadata?.domains_connection !== undefined) &&
          provider.custom_metadata?.domains_connection !== generation)
      )
        throw Error('Hosting provider identity changed.');
      if (
        !(await this.env.CONTROL_DB.prepare(
          'UPDATE sales_hostnames SET provider_id=? WHERE hostname=? AND epoch=? AND connection_key=? RETURNING hostname',
        )
          .bind(provider.id, hostname, row.epoch, generation)
          .first())
      )
        throw Error('Hostname generation changed.');
      const proof = z
        .object({ proof: z.object({ value: z.string() }) })
        .passthrough()
        .parse(JSON.parse(row.plan)).proof;
      const records = [
        {
          type: 'TXT' as const,
          name: `_domains-sales.${hostname}`,
          value: proof.value,
        },
        ...certificateInstructions(provider, hostname).map((r) => {
          if (r.type !== 'TXT') throw Error('Unsupported certificate proof.');
          return { ...r, type: 'TXT' as const };
        }),
      ];
      // Install only exact routes. Existing routes, even for our Worker, must
      // already belong to this retained intent; never adopt foreign resources.
      let routeId = row.connection_route_id;
      if (!routeId) {
        const routes = z
          .array(
            z.object({
              id: z.string(),
              pattern: z.string(),
              script: z.string().nullable().optional(),
            }),
          )
          .parse((await this.zoneCall('/workers/routes')).result);
        if (routes.some((r) => r.pattern === hostname + '/*'))
          throw Error('An existing edge route needs ownership reconciliation.');
        const admitted = await this.env.CONTROL_DB.prepare(
          "UPDATE sales_hostnames SET connection_intent='create-route' WHERE hostname=? AND epoch=? AND connection_key=? AND connection_intent!='create-route' RETURNING hostname",
        )
          .bind(hostname, row.epoch, generation)
          .first();
        if (!admitted) throw Error('Edge route creation needs reconciliation.');
        const route = z
          .object({
            id: z.string(),
            pattern: z.literal(hostname + '/*'),
            script: z.literal('domains-sales-lander'),
          })
          .parse(
            (
              await this.zoneCall('/workers/routes', 'POST', {
                pattern: hostname + '/*',
                script: 'domains-sales-lander',
              })
            ).result,
          );
        routeId = route.id;
      }
      const updated = await this.env.CONTROL_DB.prepare(
        "UPDATE sales_hostnames SET provider_id=?,connection_route_id=?,connection_intent='prepared',provider_status=?,ssl_status=? WHERE hostname=? AND epoch=? AND connection_key=? RETURNING hostname",
      )
        .bind(
          provider.id,
          routeId,
          provider.status,
          provider.ssl.status,
          hostname,
          row.epoch,
          generation,
        )
        .first();
      if (!updated)
        throw Error('Hostname generation changed during preparation.');
      await rememberHostnameProvider(
        this.env.CONTROL_DB,
        hostname,
        'sales',
        claim,
        provider.id,
      );
      plans.push({
        hostname,
        epoch: row.epoch,
        challenge: proof.value.replace(/^domains-sales=/, ''),
        records,
        target: this.env.LANDER_QUALIFIED_CNAME_TARGET!,
      });
    }
    return plans;
  }
  async verify(
    workspace: string,
    listing: string,
    domain: string,
    generation: string,
    hosts: LanderHostingPlan[],
    revision: string,
  ) {
    this.qualified(workspace, domain);
    let ready = true,
      certificates = true;
    for (const host of hosts) {
      const row = await this.env.CONTROL_DB.prepare(
        'SELECT * FROM sales_hostnames WHERE hostname=? AND workspace_id=? AND listing_id=? AND epoch=? AND connection_key=?',
      )
        .bind(host.hostname, workspace, listing, host.epoch, generation)
        .first<ConnectionHost>();
      if (!row?.provider_id || row.status === 'detached')
        throw Error('Hostname generation changed.');
      const provider = providerSchema.parse(
        (await this.zoneCall('/custom_hostnames/' + row.provider_id)).result,
      );
      if (
        provider.hostname !== host.hostname ||
        ((this.env.LANDER_CUSTOM_METADATA_QUALIFIED === 'true' ||
          provider.custom_metadata?.domains_connection !== undefined) &&
          provider.custom_metadata?.domains_connection !== generation)
      )
        throw Error('Provider resource is outside this connection.');
      await this.env.CONTROL_DB.prepare(
        'UPDATE sales_hostnames SET connection_receipt=? WHERE hostname=? AND epoch=? AND connection_key=?',
      )
        .bind(
          JSON.stringify({
            providerStatus: provider.status,
            sslStatus: provider.ssl.status,
            checkedAt: Date.now(),
          }),
          host.hostname,
          host.epoch,
          generation,
        )
        .run();
      if (provider.ssl.status !== 'active') certificates = false;
      if (provider.status !== 'active' || provider.ssl.status !== 'active') {
        ready = false;
        continue;
      }
      // Current public DNS is independently required for each requested host.
      const cname = await salesDns(host.hostname, 'CNAME', this.fetcher);
      if (
        host.hostname !== domain &&
        !cname.answers.some(
          (a) =>
            a.type === 5 &&
            a.data.toLowerCase().replace(/\.$/, '') === host.target,
        )
      ) {
        ready = false;
        continue;
      }
      if (host.hostname === domain) {
        const actual = await salesDns(host.hostname, 'A', this.fetcher),
          target = await salesDns(host.target, 'A', this.fetcher);
        const wanted = new Set(
          target.answers.filter((a) => a.type === 1).map((a) => a.data),
        );
        if (
          !wanted.size ||
          !actual.answers.some((a) => a.type === 1 && wanted.has(a.data))
        ) {
          ready = false;
          continue;
        }
      }
      await this.fence();
      const result = await new SalesHostnames(this.env, this.fetcher).activate(
        workspace,
        listing,
        host.hostname,
        host.epoch,
        host.challenge,
        revision,
      );
      if (result.status !== 'active') {
        ready = false;
        continue;
      }
      // Ordinary HTTPS carries no signed controller admission. A successful
      // internal probe alone never produces the connection's live receipt.
      const response = await this.fetcher(`https://${host.hostname}/`, {
        redirect: 'manual',
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
      const exact =
        response.ok &&
        response.headers.get('X-Domains-Sales-Revision') === revision;
      await response.body?.cancel();
      if (!exact) ready = false;
      else
        await this.env.CONTROL_DB.prepare(
          'UPDATE sales_hostnames SET connection_receipt=? WHERE hostname=? AND epoch=? AND connection_key=?',
        )
          .bind(
            JSON.stringify({
              providerStatus: provider.status,
              sslStatus: provider.ssl.status,
              dnsAt: Date.now(),
              ordinaryHttpsAt: Date.now(),
              revision,
            }),
            host.hostname,
            host.epoch,
            generation,
          )
          .run();
    }
    return ready ? 'live' : certificates ? 'tls-ready' : 'waiting';
  }
  async finishPreparation(
    workspace: string,
    listing: string,
    domain: string,
    generation: string,
  ) {
    const rows = await this.env.CONTROL_DB.prepare(
      'SELECT * FROM sales_hostnames WHERE workspace_id=? AND listing_id=? AND connection_key=?',
    )
      .bind(workspace, listing, generation)
      .all<ConnectionHost>();
    for (const row of rows.results) {
      if (
        ![domain, `www.${domain}`].includes(row.hostname) ||
        row.domain !== domain
      )
        throw Error('Preparation cleanup hostname changed.');
      if (!row.provider_id && row.connection_intent === 'create-hostname') {
        const candidates = z
          .array(providerSchema)
          .max(100)
          .parse(
            (
              await this.zoneCall(
                `/custom_hostnames?hostname=${encodeURIComponent(row.hostname)}&per_page=100`,
              )
            ).result,
          );
        const own = candidates.filter(
          (p) =>
            p.hostname === row.hostname &&
            p.custom_metadata?.domains_connection === generation,
        );
        if (
          own.length !== 1 ||
          this.env.LANDER_CUSTOM_METADATA_QUALIFIED !== 'true'
        )
          throw Error(
            'An unknown hostname creation must reconcile before preparation cleanup.',
          );
        row.provider_id = own[0].id;
        await this.env.CONTROL_DB.prepare(
          "UPDATE sales_hostnames SET provider_id=?,connection_intent='prepared-hostname' WHERE hostname=? AND connection_key=? AND epoch=? AND provider_id IS NULL",
        )
          .bind(row.provider_id, row.hostname, generation, row.epoch)
          .run();
      }
      if (!row.connection_route_id && row.connection_intent === 'create-route')
        throw Error(
          'An unknown edge-route creation must reconcile before preparation cleanup.',
        );
      const base =
        row.status === 'control-lost'
          ? row.epoch - 1
          : row.status === 'detached'
            ? row.epoch - 1
            : row.epoch;
      await this.finishRestore(workspace, listing, generation, [
        { hostname: row.hostname, epoch: base },
      ]);
    }
    return 'detached';
  }
  async finishRestore(
    workspace: string,
    listing: string,
    generation: string,
    hosts: Pick<LanderHostingPlan, 'hostname' | 'epoch'>[],
  ) {
    for (const host of hosts) {
      const row = await this.env.CONTROL_DB.prepare(
        'SELECT * FROM sales_hostnames WHERE hostname=? AND workspace_id=? AND listing_id=? AND connection_key=?',
      )
        .bind(host.hostname, workspace, listing, generation)
        .first<ConnectionHost>();
      if (
        !row ||
        !(
          row.epoch === host.epoch ||
          (row.status === 'control-lost' && row.epoch === host.epoch + 1) ||
          (row.status === 'detached' &&
            [host.epoch + 1, host.epoch + 2].includes(row.epoch))
        )
      )
        throw Error('Restore hostname generation changed.');
      await this.fence();
      if (row.status !== 'detached')
        await new SalesHostnames(this.env, this.fetcher).detach(
          workspace,
          listing,
          host.hostname,
          row.epoch,
        );
      if (row.connection_route_id) {
        const routes = z
            .array(
              z.object({
                id: z.string(),
                pattern: z.string(),
                script: z.string().nullable().optional(),
              }),
            )
            .parse((await this.zoneCall('/workers/routes')).result),
          route = routes.find((r) => r.id === row.connection_route_id);
        if (route) {
          if (
            route.pattern !== host.hostname + '/*' ||
            route.script !== 'domains-sales-lander'
          )
            throw Error('Restore route identity changed.');
          await this.zoneCall(
            '/workers/routes/' + encodeURIComponent(route.id),
            'DELETE',
          );
        }
      }
      if (row.provider_id) {
        const value = (
          await this.zoneCall('/custom_hostnames/' + row.provider_id)
        ).result;
        if (value) {
          const provider = providerSchema.parse(value);
          if (
            provider.hostname !== host.hostname ||
            ((this.env.LANDER_CUSTOM_METADATA_QUALIFIED === 'true' ||
              provider.custom_metadata?.domains_connection !== undefined) &&
              provider.custom_metadata?.domains_connection !== generation)
          )
            throw Error('Restore provider identity changed.');
          await this.zoneCall('/custom_hostnames/' + row.provider_id, 'DELETE');
        }
      }
    }
    return 'detached';
  }
}
