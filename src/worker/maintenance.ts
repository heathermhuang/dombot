import { aesGcmCipher } from '../core/storage/encrypted';
import { flushWrites } from '../core/storage/namespace';
import { SCHEMA_VERSION } from '../core/storage/migrations';
import { parseRootSecret, deriveEncryptionKey } from './keys';
import { withRequestLock } from './lock';
import { withRootLease } from './root-retirement';
import type { DomBotMaintenanceState } from './engine-contract';

// Presence in any of these tables conservatively preserves the old cadence,
// including publication drafts and records still subject to retention.
export const MAINTENANCE_TABLES = [
  'portfolio_drafts',
  'published_portfolios',
  'sale_drafts',
  'sale_destinations',
  'published_sales',
  'sales_reviews',
  'sales_review_items',
  'sales_shop',
  'sales_shop_reviews',
  'sales_jobs',
  'sales_job_items',
  'sales_events',
  'sales_cas_guard',
  'sales_host_bindings',
  'sales_leads',
  'sales_messages',
  'sales_tokens',
  'sales_outbox',
  'sales_abuse',
  'sales_suppression',
  'sales_control_leases',
] as const;
const infrastructure = new Set([
  'docs',
  'd1_migrations',
  'login_attempts',
  'session_revocations',
  'retired_roots',
  'root_request_leases',
]);
const noMaintenance = new Set(['settings', 'folders', 'mcp', 'sync-monitor']);
const workNamespaces = new Set([
  'registrar-credentials',
  'registrar-accounts',
  'registrar-proxies',
  'registrars',
  'registrar-domains',
  'registrar-details',
  'registrar-last-sync',
  'registrar-tld-rates',
  'renewal-pricing-jobs',
  'imported-domains',
  'manual-domains',
  'domain-events',
  'domain-notes',
  'domain-purchases',
  'domain-prices',
  'domain-list-prices',
  'domain-folders',
  'bulk-jobs',
  'rdap-lookups',
]);
export const unknownMaintenance = (): DomBotMaintenanceState => ({
  version: 1,
  state: 'unknown',
  reason: 'inspection-unavailable',
  revision: null,
});

/** Strict persisted inspection: never use the forgiving UI hydration loader.
 * D1 batch gives the document and SQL presence checks one consistent snapshot.
 * Bounded documents make active, large portfolios cheap to classify. */
export async function readMaintenanceState(
  env: Env,
): Promise<DomBotMaintenanceState> {
  try {
    await flushWrites();
    const tables = (
      await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'",
      ).all<{ name: string }>()
    ).results.map((r) => r.name);
    if (
      MAINTENANCE_TABLES.some((name) => !tables.includes(name)) ||
      tables.some(
        (name) =>
          !infrastructure.has(name) &&
          !MAINTENANCE_TABLES.includes(
            name as (typeof MAINTENANCE_TABLES)[number],
          ),
      )
    )
      return unknownMaintenance();
    const result = await env.DB.batch([
      env.DB.prepare(
        "SELECT ns,key,value FROM docs WHERE ns NOT IN ('settings','folders','mcp','sync-monitor') ORDER BY ns,key LIMIT 101",
      ),
      env.DB.prepare(
        'SELECT ' +
          MAINTENANCE_TABLES.map(
            (t) => `EXISTS(SELECT 1 FROM ${t} LIMIT 1) AS ${t}`,
          ).join(','),
      ),
    ]);
    const rows = result[0].results as {
      ns: string;
      key: string;
      value: string;
    }[];
    const present = result[1].results[0] as Record<string, number>;
    const state = (reason: string): DomBotMaintenanceState => ({
      version: 1,
      state: 'work',
      reason,
      revision: null,
    });
    if (Object.values(present).some(Boolean))
      return state('publication-or-task');
    if (rows.length > 100) return state('stored-work');
    const cipher = await aesGcmCipher(
      await deriveEncryptionKey(parseRootSecret(env.DOMBOT_SECRET)),
    );
    const digest: unknown[] = [];
    for (const row of rows) {
      let value: unknown = JSON.parse(row.value);
      if (value && typeof value === 'object' && '__sealed' in value) {
        const sealed = value as {
          __sealed: unknown;
          alg: unknown;
          ct: unknown;
        };
        if (
          sealed.__sealed !== 1 ||
          sealed.alg !== 'aes-gcm' ||
          typeof sealed.ct !== 'string'
        )
          return unknownMaintenance();
        value = JSON.parse(await cipher.open(sealed.ct));
      }
      digest.push([row.ns, row.key, value]);
      if (row.ns === 'meta') {
        if (row.key === 'schemaVersion') {
          if (value !== SCHEMA_VERSION) return unknownMaintenance();
        } else if (
          !/^rev:(portfolio|bulk|approvals)$/.test(row.key) ||
          typeof value !== 'number'
        )
          return unknownMaintenance();
      } else if (
        row.ns === 'registrar-credentials' &&
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.keys(value).length === 0
      ) {
        // Removing a connection may retain an empty credential object.
      } else if (
        row.ns === 'registrars' &&
        row.key === 'disabled' &&
        Array.isArray(value) &&
        value.length === 0
      ) {
        // Merely toggling an unconfigured registrar does not create work.
      } else if (workNamespaces.has(row.ns)) return state('stored-work');
      else if (!noMaintenance.has(row.ns)) return unknownMaintenance();
    }
    const bytes = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(digest)),
    );
    return {
      version: 1,
      state: 'empty',
      reason: 'no-maintenance-work',
      revision: Array.from(new Uint8Array(bytes), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join(''),
    };
  } catch {
    return unknownMaintenance();
  }
}

export async function maintenanceState(
  env: Env,
): Promise<DomBotMaintenanceState> {
  const response = await withRootLease(env, async () =>
    Response.json(await withRequestLock(() => readMaintenanceState(env))),
  );
  return response.ok ? response.json() : unknownMaintenance();
}
