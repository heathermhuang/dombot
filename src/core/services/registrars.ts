import { protectRegistrar, redactRegistrarMessage } from './registrar-errors';
import { importedRows } from '../../shared/imported-domains';
import { getImportedDomains } from './imported-domains';
import {
  NotImplementedError,
  RateLimitError,
  RegistrarError,
  RegistrarClient,
  createRegistrar,
  listPortfolio,
  registrars,
  type OperationResult,
  type RegisterDomainInput,
  type Registrar,
  type RegistrarCredentials,
  type RegistrarName,
  type RequestOptions,
} from '@aoxborrow/registrar-client';
import {
  accountById,
  assertUniqueAccountLabel,
  createAccount,
  nextAccountLabel,
  setAccountProxy,
  isSavedAccount,
  listAccounts,
  removeAccountRecord,
} from './accounts';
import { domainKey } from '../../shared/account-key';
import { toAscii } from '../../shared/domain-name';
import { currencyInfo } from '../../shared/money';
import { expiryDay, type AccountHoldings } from '../../shared/sync-diff';
import { recordSync } from './domain-history';
import { serialByKey } from './serial-by-key';
import { getStoredCredentials, setStoredCredentials } from './credentials';
import { createProxiedRegistrar, proxyFailureMessage } from './proxy-transport';
import {
  createDynadotFetch,
  clearDynadotPricingCapabilities,
} from './dynadot-transport';
import { Namespace } from '../storage/namespace';
import { recordSyncAttempt } from './sync-diagnostics';
import type { SyncTrigger } from '../../shared/sync-monitor';
import { broadcastPortfolioChanged } from '../events';
import { isBulkRunning } from './bulk-jobs';
import { accountProxyRoute, getProxyProfile } from './proxies';
import { managedProxyFor } from './managed-proxy';
import {
  DEFAULT_PROXY_ID,
  proxySecrets,
  type ProxyRoute,
} from '../../shared/proxy';
import { resolveNameservers } from '../dns';
import { isRegistrarEnabled, setRegistrarEnabled } from './registrar-state';
import {
  clearEntry,
  isStale,
  patchEntryData,
  readAll,
  readEntry,
  writeEntry,
} from './cache';
import {
  resolvePricing,
  setTldRate,
  tldOf,
  usesPerNameQuote,
  type RenewalQuote,
} from './pricing';
import {
  dummyNameForTld,
  planGoDaddyRenewalFetches,
  renewalFromGodaddyPricing,
  tldsNeedingPremiumFlags,
} from './godaddy-renewal-quotes';
import type {
  Domain,
  RegistrarAccount,
  RegistrarDefinition,
  Portfolio,
  PortfolioErrorInfo,
  RegistrarMeta,
  RenewalPricing,
  RenewalPricingProgress,
} from '../../shared/ipc';

const detailKey = (accountId: string, domain: string): string =>
  `${accountId}:${domain}`;

// A cached per-domain detail record: the domain's detail fields (nameservers,
// privacy, lock, creation date) plus an optional per-name renewal quote captured
// during Sync for the registrars that can price a specific owned domain. Keeping
// the quote here means one cache for all domain data — refreshed and cleared with
// the detail, never on a separate pricing schedule.
type DetailRecord = Partial<Domain> & {
  renewalQuote?: RenewalQuote;
  renewalQuoteFetchedAt?: number;
};

/** A detail record without its renewal quote — the domain-only view callers get. */
function withoutQuote(record: DetailRecord): Partial<Domain> {
  const rest = { ...record };
  delete rest.renewalQuote;
  delete rest.renewalQuoteFetchedAt;
  delete rest.accountId;
  delete rest.accountLabel;
  return rest;
}

/** A cached row: what the account's list returned. `assemblePortfolio`
 *  stamps the account and `source` on it. */
type CachedDomain = Omit<Domain, 'source'>;

/**
 * One registrar's slice of the portfolio, cached under the 'portfolio' namespace
 * keyed by registrar id (so each syncs independently). `lastSyncedAt` is the last
 * time domains were fetched *successfully*; `lastError` is the most recent
 * attempt's error (null when it succeeded), and `lastErrorAt` when it happened.
 * On a failed sync we keep the last-good `domains` and `lastSyncedAt`, and only
 * set the error.
 */
interface RegistrarPortfolioEntry {
  domains: CachedDomain[];
  lastSyncedAt: number | null;
  lastError: string | null;
  /** Absent in entries written before it was recorded. */
  lastErrorAt?: number | null;
  recovery?: RegistrarMeta['sync']['recovery'];
}

/** Older bundles can contain raw transport errors with credentials in URLs
 * and echoed response bodies. Sanitize those before storing or displaying. */
function registrarErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const transport = message.match(
    /^(Request to|Failed to reach|Failed to parse JSON response from) '([^']+)'(?: failed with (?:HTTP )?(\d{3})| timed out after (\d+)ms)?/,
  );
  if (!transport) return message;
  if (transport[1] === 'Failed to reach') {
    const proxy = proxyFailureMessage(message);
    if (proxy) return proxy;
  }
  try {
    const url = new URL(transport[2]);
    const endpoint = `${url.origin}${url.pathname}`;
    if (transport[3])
      return `Request to '${endpoint}' failed with HTTP ${transport[3]}`;
    if (transport[4])
      return `Request to '${endpoint}' timed out after ${transport[4]}ms`;
    return `${transport[1]} '${endpoint}'`;
  } catch {
    return 'Registrar request failed.';
  }
}

/** Dates round-trip through JSON as ISO strings; revive them back to `Date`. */
function reviveDomainDates<T extends Partial<Domain>>(d: T): T {
  const out = { ...d } as Partial<Domain>;
  if (out.createdDate != null) out.createdDate = new Date(out.createdDate);
  if (out.expirationDate != null)
    out.expirationDate = new Date(out.expirationDate);
  return out as T;
}

// Cache one client per account so we don't rebuild it on every call.
const clients = new Map<string, RegistrarClient>();
const inventoryInFlight = new Map<string, Promise<void>>();

const RENEWAL_QUOTE_STRATEGY = 'rest-single-search-v1';
interface RenewalPricingJob {
  quoteStrategy?: string;
  syncedAt: number;
  pending: string[];
  failed: number;
  failures?: Record<string, { code: string; at: number }>;
  notBefore?: number;
  attempts?: number;
}
const renewalJobs = new Namespace<RenewalPricingJob>('renewal-pricing-jobs', {
  cache: true,
  local: true,
});
let incrementalRenewalPricing = false;
/** Workers advance read-only pricing in bounded requests; desktop keeps its
 * existing in-process sync. Jobs survive reloads and stay out of data exports. */
export function configureIncrementalRenewalPricing(enabled: boolean): void {
  incrementalRenewalPricing = enabled;
}

/** Reconcile cached holdings without a provider refresh. Older queues omitted
 * uniform TLDs; finished queues also need to notice quotes aging past 24 hours.
 * Retry the previous lookup strategy's failures once; retain their records
 * until success, and preserve order, attempts and the real cooldown. */
function currentRenewalJob(
  id: string,
  entry: RegistrarPortfolioEntry,
): RenewalPricingJob | null {
  if (entry.lastSyncedAt == null) return null;
  const saved = renewalJobs.get(id);
  const current = saved?.syncedAt === entry.lastSyncedAt ? saved : undefined;
  const retryPriorFailures = Boolean(
    current && current.quoteStrategy !== RENEWAL_QUOTE_STRATEGY,
  );
  const missing = entry.domains
    .filter((domain) => {
      if (current?.failures?.[domain.domainName]) return retryPriorFailures;
      const detail = readEntry<DetailRecord>(
        'detail',
        detailKey(id, domain.domainName),
      );
      const quote = detail?.data.renewalQuote;
      const at = detail?.data.renewalQuoteFetchedAt ?? 0;
      return (
        !quote ||
        quote.renewal == null ||
        !Number.isFinite(quote.renewal) ||
        quote.renewal < 0 ||
        !currencyInfo(quote.currency) ||
        !Number.isFinite(at) ||
        at > Date.now() ||
        Date.now() - at >= 24 * 60 * 60_000
      );
    })
    .map((d) => d.domainName);
  return {
    ...current,
    syncedAt: entry.lastSyncedAt,
    quoteStrategy: RENEWAL_QUOTE_STRATEGY,
    pending: [...new Set([...(current?.pending ?? []), ...missing])],
    failed: current?.failed ?? 0,
    ...(saved?.notBefore ? { notBefore: saved.notBefore } : {}),
  };
}

function currentRenewalJobs(): [string, RenewalPricingJob][] {
  return getActiveAccounts().flatMap((account) => {
    if (account.registrar !== 'dynadot') return [];
    const entry = readRegistrarEntry(account.id);
    const job = entry && currentRenewalJob(account.id, entry);
    return job ? [[account.id, job] as [string, RenewalPricingJob]] : [];
  });
}

function failedRenewals(job: RenewalPricingJob): number {
  const keys = Object.keys(job.failures ?? {});
  const pending = new Set(job.pending);
  // A prior failed quote being retried is pending. Retain its failure record
  // until an actual successful read replaces it, and retain unattributed counts.
  return (
    Math.max(0, job.failed - keys.length) +
    keys.filter((key) => !pending.has(key)).length
  );
}
export function getRenewalPricingStatus(): RenewalPricingProgress {
  const active = new Set(getActiveAccounts().map((a) => a.id));
  let remaining = 0;
  let blocked = 0;
  let failed = 0;
  let nextAt = Infinity;
  for (const [id, job] of currentRenewalJobs()) {
    const entry = readRegistrarEntry(id);
    if (!active.has(id) || entry?.lastSyncedAt !== job.syncedAt) continue;
    if (entry.lastError) {
      blocked += job.pending.length;
      failed += failedRenewals(job);
      continue;
    }
    remaining += job.pending.length;
    failed += failedRenewals(job);
    if (job.pending.length > 0) nextAt = Math.min(nextAt, job.notBefore ?? 0);
  }
  return {
    remaining,
    failed,
    ...(blocked ? { blocked } : {}),
    ...(nextAt > Date.now() && Number.isFinite(nextAt) ? { nextAt } : {}),
  };
}

/** At most one quote per account per request. Never performs a paid operation.
 * A failed/crashed request leaves its pending read available for another step. */
export async function stepRenewalPricing(): Promise<RenewalPricingProgress> {
  if (!incrementalRenewalPricing) return getRenewalPricingStatus();
  if (isBulkRunning())
    return { ...getRenewalPricingStatus(), nextAt: Date.now() + 15_000 };
  for (const [id, job] of currentRenewalJobs()) {
    if (JSON.stringify(renewalJobs.get(id)) !== JSON.stringify(job))
      await renewalJobs.set(id, job);
  }
  const active = new Map(getActiveAccounts().map((a) => [a.id, a]));
  let changed = false;
  const results = await Promise.allSettled(
    Object.entries(renewalJobs.all()).map(async ([id, job]) => {
      const account = active.get(id);
      const entry = readRegistrarEntry(id);
      if (!account || entry?.lastSyncedAt !== job.syncedAt) {
        await renewalJobs.delete(id);
        return;
      }
      if (entry.lastError || inventoryInFlight.has(id)) return;
      const domain = job.pending[0];
      if (!domain) return;
      if ((job.notBefore ?? 0) > Date.now()) return;
      if (!entry.domains.some((d) => d.domainName === domain)) {
        await renewalJobs.set(id, { ...job, pending: job.pending.slice(1) });
        changed = true;
        return;
      }
      let generation = generations.get(id) ?? 0;
      let quote: RenewalQuote | null = null;
      let failure: unknown;
      // Background slices don't spend minutes retrying one optional quote.
      try {
        getRegistrarClient(account.registrar, id);
        generation = generations.get(id) ?? 0;
        quote = await fetchRenewalQuote(
          account.registrar,
          domain,
          id,
          {
            retries: 0,
          },
          (error) => {
            failure = error;
          },
        );
      } catch (error) {
        failure = error;
        // An unavailable provider leaves the last saved quote visible.
      }
      if (
        renewalJobs.get(id)?.syncedAt !== job.syncedAt ||
        readRegistrarEntry(id)?.lastSyncedAt !== job.syncedAt ||
        !isRegistrarEnabled(id)
      )
        return;
      if ((generations.get(id) ?? 0) !== generation) return;
      const localCooldown =
        failure instanceof Error &&
        /\[dynadot:(shared|local)-cooldown\]/.test(failure.message);
      if (
        (failure instanceof RateLimitError ||
          (failure instanceof RegistrarError && failure.shouldRetry())) &&
        (failure instanceof RateLimitError ||
          localCooldown ||
          (job.attempts ?? 0) < 2)
      ) {
        // A global/provider throttle is not a per-domain quote failure.
        // After three real rejections, leave the queue intact and retry slowly.
        const seconds =
          failure instanceof RateLimitError
            ? Math.max(
                60,
                failure.retryAfter ?? 60,
                !localCooldown && (job.attempts ?? 0) >= 2 ? 30 * 60 : 0,
              )
            : 30;
        await renewalJobs.set(id, {
          ...job,
          notBefore: Date.now() + seconds * 1000,
          attempts: localCooldown
            ? (job.attempts ?? 0)
            : Math.min(3, (job.attempts ?? 0) + 1),
        });
        changed = true;
        return;
      }
      if (quote?.renewal != null) writeRenewalQuote(id, domain, quote);
      const failures = { ...job.failures };
      const wasFailed = Object.hasOwn(failures, domain);
      if (quote?.renewal == null)
        failures[domain] = {
          code: failure instanceof Error ? failure.name : 'quote_unavailable',
          at: Date.now(),
        };
      else delete failures[domain];
      await renewalJobs.set(id, {
        ...job,
        pending: job.pending.slice(1),
        failed: Math.max(
          0,
          job.failed +
            (quote?.renewal == null ? (wasFailed ? 0 : 1) : wasFailed ? -1 : 0),
        ),
        failures,
        notBefore: 0,
        attempts: 0,
      });
      changed = true;
    }),
  );
  if (changed) broadcastPortfolioChanged();
  const failedWrite = results.find((result) => result.status === 'rejected');
  if (failedWrite?.status === 'rejected') throw failedWrite.reason;
  return getRenewalPricingStatus();
}

/** Builds the provider behind a client. Hosts swap it to run the app against
 *  something other than the real registrars (the demo's in-memory one). */
export type RegistrarFactory = (
  name: RegistrarName,
  credentials: RegistrarCredentials,
  accountId: string,
) => Registrar;

let factory: RegistrarFactory | null = null;

/** Installs (or with null, removes) a replacement provider factory. Existing
 *  clients keep their provider until `resetRegistrarClients()`. */
export function configureRegistrarFactory(next: RegistrarFactory | null): void {
  factory = next;
}

function buildProvider(
  name: RegistrarName,
  credentials: RegistrarCredentials,
  accountId: string,
  proxy: ProxyRoute | null,
): Registrar {
  if (factory) return factory(name, credentials, accountId);
  const wrapFetch =
    name === 'dynadot'
      ? (send: typeof globalThis.fetch) =>
          createDynadotFetch(send, {
            accountId,
            apiKey: credentials.apiKey ?? '',
            routeKey: JSON.stringify(proxy),
          })
      : undefined;
  return proxy
    ? createProxiedRegistrar(name, credentials, proxy, wrapFetch)
    : createRegistrar(
        name,
        credentials,
        wrapFetch
          ? { fetch: wrapFetch(globalThis.fetch.bind(globalThis)) }
          : undefined,
      );
}
const clientCredentials = new Map<string, string>();
const generations = new Map<string, number>();
function invalidateAccount(id: string): void {
  inventoryInFlight.delete(id);
  clients.delete(id);
  clientCredentials.delete(id);
  generations.set(id, (generations.get(id) ?? 0) + 1);
}

/** All built-in registrar ids, e.g. "dynadot", "godaddy". */
export const registrarNames = Object.keys(registrars) as [
  RegistrarName,
  ...RegistrarName[],
];

/** The library's capability list for a provider (core + extended `Feature` ids). */
export function getRegistrarFeatures(name: RegistrarName): readonly string[] {
  return registrars[name].features;
}

/** Resolve once before work starts. Labels never participate in routing. */
export function resolveAccount(
  name: RegistrarName,
  accountId?: string,
  domainName?: string,
): RegistrarAccount {
  const accounts = listAccounts().filter((a) => a.registrar === name);
  const configured = accounts.filter((a) => isConfigured(name, a.id));
  const target = domainName?.trim().toLowerCase();
  const owners = target
    ? listAccounts().filter((a) =>
        readRegistrarEntry(a.id)?.domains.some(
          (d) => d.domainName.toLowerCase() === target,
        ),
      )
    : [];
  let account: RegistrarAccount | undefined;
  if (accountId) {
    account = accountById(accountId);
    if (account.registrar !== name)
      throw new Error(
        `Account "${accountId}" does not belong to registrar "${name}".`,
      );
  } else {
    const ownersHere = owners.filter((a) => a.registrar === name);
    const matches = ownersHere.filter(
      (a) => configured.some((c) => c.id === a.id) && isRegistrarEnabled(a.id),
    );
    if (matches.length === 1) account = matches[0];
    else if (matches.length > 1)
      throw new Error(
        'Multiple accounts match. Pass accountId to disambiguate.',
      );
    // A single cached owner that isn't usable (disabled or missing credentials):
    // resolve to it so the caller gets the precise reason, not a misleading
    // "multiple accounts match" when only one account actually holds the domain.
    else if (ownersHere.length === 1) account = ownersHere[0];
    else if (ownersHere.length > 1 || configured.length > 1)
      throw new Error(
        'Multiple accounts match. Pass accountId to disambiguate.',
      );
    else
      account =
        configured[0] ?? (accounts.length === 1 ? accounts[0] : undefined);
  }
  if (!account)
    throw new Error(
      'No account selected. Configure an account in Settings or pass accountId.',
    );
  if (owners.length && !owners.some((a) => a.id === account.id))
    throw new Error(
      `Domain "${domainName}" is cached in a different account. Sync or select its owning account.`,
    );
  return account;
}

/** Validates a domain target before any cached read or provider operation. */
export function resolveDomainAccount(
  name: RegistrarName,
  domain: string,
  accountId?: string,
): RegistrarAccount {
  const account = resolveAccount(name, accountId, domain);
  requireActive(account);
  return account;
}

function requireActive(account: RegistrarAccount): void {
  if (!isRegistrarEnabled(account.id))
    throw new Error(`Account "${account.label}" is disabled.`);
  if (!isConfigured(account.registrar, account.id))
    throw new Error(
      `Missing credentials for "${account.label}" (configure in Settings).`,
    );
}

/**
 * The registrar's own registration fee for this name, from `getPricing`.
 * `amount` is null when the registrar has no pricing API, or the quote
 * didn't include a registration fee. The amount is a plain decimal string.
 */
export async function getRegistrationQuote(
  name: RegistrarName,
  domainName: string,
  accountId?: string,
): Promise<{ amount: string | null; currency: string }> {
  const account = resolveAccount(name, accountId);
  let pricing;
  try {
    pricing = await getRegistrarClient(name, account.id).getPricing(domainName);
  } catch (err) {
    if (err instanceof NotImplementedError)
      return { amount: null, currency: 'USD' };
    throw err;
  }
  const code = currencyInfo(pricing.currency ?? 'USD')?.code ?? 'USD';
  const decimals = currencyInfo(code)?.decimals ?? 2;
  const registration = pricing.registration;
  if (
    typeof registration !== 'number' ||
    !Number.isFinite(registration) ||
    registration < 0
  ) {
    return { amount: null, currency: code };
  }
  return { amount: registration.toFixed(decimals), currency: code };
}

export function getRegistrarClient(
  name: RegistrarName,
  accountId?: string,
): RegistrarClient {
  const account = resolveAccount(name, accountId);
  requireActive(account);
  const credentials = resolveCredentials(name, account.id);
  // An account may route through the fixed IP proxy. The route is folded into
  // the fingerprint below, so editing the proxy or flipping the account's
  // toggle rebuilds the client.
  const proxy = accountProxyRoute(account);
  const fingerprint =
    JSON.stringify(credentials) +
    (proxy ? `|proxy:${proxy.url}|${proxy.ip}` : '');
  if (clientCredentials.get(account.id) !== fingerprint)
    invalidateAccount(account.id);
  let client = clients.get(account.id);
  if (!client) {
    client = new RegistrarClient(
      protectRegistrar(
        buildProvider(name, credentials, account.id, proxy),
        accountSecrets(account.id, proxy),
      ),
    );
    clients.set(account.id, client);
    clientCredentials.set(account.id, fingerprint);
  }
  return client;
}

/** Verify the host-managed route without changing a saved customer override,
 * credentials, cached holdings, or the client's route for concurrent jobs. */
export async function testRegistrarAccount(
  name: RegistrarName,
  accountId?: string,
  managedRoute = false,
) {
  if (!managedRoute)
    return getRegistrarClient(name, accountId).testConnection();
  const account = resolveAccount(name, accountId);
  requireActive(account);
  const proxy = managedProxyFor(name);
  if (!proxy)
    throw new Error('No managed connection is configured for this registrar.');
  const client = new RegistrarClient(
    protectRegistrar(
      buildProvider(
        name,
        resolveCredentials(name, account.id),
        account.id,
        proxy,
      ),
      accountSecrets(account.id, proxy),
    ),
  );
  return client.testConnection({ retries: 0 });
}

/** Every string that must never appear in this account's diagnostics. */
function accountSecrets(
  accountId: string,
  proxy?: ProxyRoute | null,
): Record<string, string | undefined> {
  const secrets: Record<string, string | undefined> = {
    ...getStoredCredentials(accountId),
  };
  const url =
    proxy === undefined
      ? getProxyProfile(
          listAccounts().find((a) => a.id === accountId)?.proxyId ??
            DEFAULT_PROXY_ID,
        )?.url
      : proxy?.url;
  proxySecrets(url).forEach((value, i) => (secrets[`proxy:${i}`] = value));
  return secrets;
}

export function getConfiguredRegistrars(): RegistrarName[] {
  return [
    ...new Set(
      listAccounts()
        .filter((a) => isConfigured(a.registrar, a.id))
        .map((a) => a.registrar),
    ),
  ];
}

export function getActiveAccounts(): RegistrarAccount[] {
  return listAccounts().filter(
    (a) => isConfigured(a.registrar, a.id) && isRegistrarEnabled(a.id),
  );
}

export function getActiveRegistrars(): RegistrarName[] {
  return [...new Set(getActiveAccounts().map((a) => a.registrar))];
}

// A registrar row needs a name to be a domain. A bad registrar response can
// list rows without one (NameBright did when its API changed casing); they'd
// show as blank rows and fail every per-domain call, so they're dropped on sync
// and on read (the latter for rows cached before this guard).
function hasDomainName(d: { domainName: string }): boolean {
  return typeof d.domainName === 'string' && d.domainName.trim() !== '';
}

/** One registrar's cached slice (dates revived), or null when never synced. */
function readRegistrarEntry(name: string): RegistrarPortfolioEntry | null {
  const cached = readEntry<RegistrarPortfolioEntry>('portfolio', name);
  if (!cached) return null;
  return {
    ...cached.data,
    lastError: cached.data.lastError
      ? redactRegistrarMessage(
          registrarErrorMessage(cached.data.lastError),
          accountSecrets(name),
        )
      : null,
    domains: cached.data.domains.filter(hasDomainName).map(reviveDomainDates),
  };
}

/** Display-name map for every built-in registrar (id → e.g. "Dynadot"). */
function registrarLabelMap(): Record<string, string> {
  return Object.fromEntries(
    registrarNames.map((name) => [name, registrars[name].displayName]),
  );
}

/**
 * Assembles the aggregate portfolio from the per-registrar cache slices of every
 * *configured* registrar. `registrars` and the headline `fetchedAt` cover only
 * registrars that have synced successfully at least once (so counts reflect real
 * data); a configured registrar that only ever errored still contributes its
 * error. No network — pure cache read.
 */
function assemblePortfolio(): Portfolio {
  const domains: Domain[] = [];
  const errors: PortfolioErrorInfo[] = [];
  const registrarIds: string[] = [];
  let fetchedAt: number | null = null;

  for (const account of getActiveAccounts()) {
    const name = account.registrar;
    const entry = readRegistrarEntry(account.id);
    if (!entry) continue;
    domains.push(
      ...entry.domains.map((d): Domain => ({
        ...d,
        registrar: name,
        accountId: account.id,
        accountLabel: account.label,
        source: 'registrar',
      })),
    );
    if (entry.lastError)
      errors.push({
        registrar: name,
        accountId: account.id,
        accountLabel: account.label,
        message: entry.lastError,
      });
    if (entry.lastSyncedAt != null) {
      registrarIds.push(name);
      fetchedAt = Math.max(fetchedAt ?? 0, entry.lastSyncedAt);
    }
  }

  return {
    domains,
    errors,
    registrars: [...new Set(registrarIds)],
    registrarLabels: registrarLabelMap(),
    fetchedAt,
    ...(incrementalRenewalPricing
      ? { renewalPricing: getRenewalPricingStatus() }
      : {}),
  };
}

/**
 * Syncs one registrar's domains into the cache. On success we replace its slice
 * with the freshly-listed domains and stamp `lastSyncedAt`. On failure (missing
 * creds, or a per-registrar list error) we keep the last-good domains and
 * `lastSyncedAt` and only record `lastError`, so a transient failure doesn't blank
 * a registrar that was working.
 */
async function performInventorySync(
  account: RegistrarAccount,
  trigger: SyncTrigger,
): Promise<void> {
  const startedAt = Date.now();
  let syncError: unknown;
  const { registrar: name, id: accountId } = account;
  let generation = generations.get(accountId) ?? 0;
  const prev = readRegistrarEntry(accountId);
  if (name === 'dynadot' && prev?.recovery) {
    if ((prev.recovery.retryAt ?? 0) > Date.now()) return;
    if (trigger === 'scheduled' && prev.recovery.state === 'failed') return;
  }
  let entry: RegistrarPortfolioEntry;
  try {
    const client = getRegistrarClient(name, accountId);
    generation = (generations.get(accountId) ?? 0) + 1;
    generations.set(accountId, generation);
    const { domains, errors } = await listPortfolio(
      [client],
      name === 'dynadot' ? { retries: 0 } : undefined,
    );
    const error = errors[0]?.error;
    syncError = error;
    entry = error
      ? {
          domains: prev?.domains ?? [],
          lastSyncedAt: prev?.lastSyncedAt ?? null,
          lastError: registrarErrorMessage(error),
          lastErrorAt: Date.now(),
        }
      : {
          domains: domains.filter(hasDomainName),
          lastSyncedAt: Date.now(),
          lastError: null,
          lastErrorAt: null,
        };
  } catch (err) {
    syncError = err;
    entry = {
      domains: prev?.domains ?? [],
      lastSyncedAt: prev?.lastSyncedAt ?? null,
      lastError: registrarErrorMessage(err),
      lastErrorAt: Date.now(),
    };
  }
  if ((generations.get(accountId) ?? 0) !== generation) return;
  const sharedCooldown =
    syncError instanceof Error &&
    /\[dynadot:(shared|local)-cooldown\]/.test(syncError.message);
  if (name === 'dynadot') {
    if (syncError instanceof RateLimitError) {
      // A recovered incident's old count is historical, including records
      // written by releases that retained it. Never spend a new retry budget
      // on a shared cooldown that sent no request to the registrar.
      const previousAttempts =
        prev?.recovery?.state === 'recovered'
          ? 0
          : (prev?.recovery?.attempts ?? 0);
      const attempts = sharedCooldown
        ? previousAttempts
        : (trigger === 'scheduled' ? previousAttempts : 0) + 1;
      entry.recovery = {
        state: attempts >= 3 ? 'failed' : 'deferred',
        attempts,
        retryAt:
          Date.now() +
          Math.max(
            syncError.retryAfter ?? 60,
            60 * 2 ** Math.max(0, attempts - 1),
          ) *
            1000,
      };
      entry.lastError =
        attempts >= 3
          ? 'Dynadot rate limit: automatic inventory retries stopped after three attempts. Cached domains are preserved. Try Sync after the cooldown.'
          : 'Dynadot rate limit: inventory refresh is deferred. Cached domains are preserved; a scheduled retry is pending.';
    } else if (!entry.lastError && prev?.lastError) {
      entry.recovery = {
        state: 'recovered',
        attempts: 0,
      };
    }
  }
  // A shared cooldown is a deferral, not another request/failure at Dynadot.
  if (name === 'dynadot' && !sharedCooldown)
    recordSyncAttempt(
      {
        accountId,
        trigger,
        startedAt,
        at: Date.now(),
        durationMs: Date.now() - startedAt,
        ok: !entry.lastError,
        lastGoodAt: entry.lastSyncedAt,
        domains: entry.domains.length,
        route: account.proxyId
          ? 'custom'
          : managedProxyFor(name)
            ? 'managed'
            : 'direct',
      },
      syncError,
    );
  writeEntry('portfolio', accountId, entry);
  // Refresh renewal quotes as part of the sync (see syncRenewalQuotes).
  if (!entry.lastError && entry.lastSyncedAt != null) {
    // Older detail is overlaid on list rows by both the UI and MCP. Carry
    // reported expiry dates into that cache so an external renewal survives
    // the overlay. Keep detail-only fields, quotes and their age intact; a
    // list that omits a date must not erase a previously known value.
    for (const domain of entry.domains) {
      if (domain.expirationDate == null && domain.renewalDate == null) continue;
      patchEntryData<DetailRecord>(
        'detail',
        detailKey(accountId, domain.domainName),
        (detail) => ({
          ...detail,
          ...(domain.expirationDate != null
            ? { expirationDate: domain.expirationDate }
            : {}),
          ...(domain.renewalDate != null
            ? { renewalDate: domain.renewalDate }
            : {}),
        }),
      );
    }
    if (incrementalRenewalPricing && name === 'dynadot') {
      await renewalJobs.set(accountId, currentRenewalJob(accountId, entry)!);
    } else {
      await syncRenewalQuotes(name, entry.domains, accountId, generation);
    }
  }
}

/** Coalesce overlapping reads of one account; a fleet pass can share a manual pull. */
function syncRegistrarInto(
  account: RegistrarAccount,
  trigger: SyncTrigger,
): Promise<void> {
  const running = inventoryInFlight.get(account.id);
  if (running) return running;
  const work = performInventorySync(account, trigger);
  inventoryInFlight.set(account.id, work);
  const clear = () => {
    if (inventoryInFlight.get(account.id) === work)
      inventoryInFlight.delete(account.id);
  };
  void work.then(clear, clear);
  return work;
}

/** Due inventory recovery bypasses aggregate portfolio freshness (a healthy
 * sibling must not hide a failed account). The ordinary host scheduler owns it. */
export async function retryDeferredSyncs(): Promise<boolean> {
  const due = getActiveAccounts().filter((account) => {
    if (account.registrar !== 'dynadot') return false;
    const entry = readRegistrarEntry(account.id);
    if (!entry?.lastError) return false;
    if (!entry.recovery)
      return /429|rate.?limit|too many/i.test(entry.lastError);
    return (
      entry.recovery.state === 'deferred' &&
      (entry.recovery.retryAt ?? 0) <= Date.now()
    );
  });
  if (!due.length) return false;
  await syncAccounts(due, 'scheduled');
  return true;
}

/**
 * Fetch a fresh per-name renewal quote for a domain (the premium-accurate price
 * a registrar reports for a domain you own), or null on any failure. Only called
 * for `usesPerNameQuote` registrars, so `getPricing` is always supported here.
 */
async function fetchRenewalQuote(
  name: RegistrarName,
  domain: string,
  accountId: string,
  opts?: RequestOptions,
  onError?: (error: unknown) => void,
): Promise<RenewalQuote | null> {
  try {
    const pricing = await getRegistrarClient(name, accountId).getPricing(
      domain,
      opts,
    );
    const currency = currencyInfo(pricing.currency ?? 'USD')?.code;
    return {
      renewal:
        typeof pricing.renewal === 'number' &&
        Number.isFinite(pricing.renewal) &&
        pricing.renewal >= 0 &&
        currency
          ? pricing.renewal
          : null,
      currency: currency ?? 'USD',
    };
  } catch (err) {
    onError?.(err);
    console.warn(`[pricing] ${name} getPricing(${domain}) failed`, err);
    return null;
  }
}

/**
 * The account's own renewal rate for one TLD, from GoDaddy's v3 availability
 * price. Quotes a random unregistered name rather than an owned one: a taken
 * name usually comes back with no prices at all, which would leave the TLD on
 * the bundled list rate. Two dummies (in case one happens to be registered),
 * then an owned name as a last resort.
 */
async function fetchGodaddyTldRenewal(
  tld: string,
  ownedSample: string,
  accountId: string,
): Promise<number | null> {
  const names = [dummyNameForTld(tld), dummyNameForTld(tld), ownedSample];
  for (const domain of names) {
    try {
      const pricing = await getRegistrarClient('godaddy', accountId).getPricing(
        domain,
      );
      const renewal = renewalFromGodaddyPricing(pricing);
      if (renewal != null) return renewal;
    } catch (err) {
      console.warn(`[pricing] GoDaddy getPricing(${domain}) failed`, err);
    }
  }
  return null;
}

/**
 * During a sync, refresh renewal quotes. Gandi/Dynadot/Name.com quote per-name
 * on premium-capable TLDs. GoDaddy takes the v3 availability price, which is
 * quoted for the authenticated shopper (so any account discount is included):
 * one call per TLD to fill that account's TLD rate, plus a per-name call only
 * for names availability marked premium. Namecheap prices per TLD for the
 * authenticated user and reads premium renewals off its availability check
 * (see syncNamecheapRenewalQuotes).
 *
 * Known gap: a premium name we *own* is quoted by its real name, and GoDaddy
 * often returns no prices for a registered name — so that quote can come back
 * empty and the name falls back to its TLD rate, understating it. Quoting a
 * dummy instead is not an option there; a premium price belongs to the
 * specific name.
 */
async function syncRenewalQuotes(
  name: RegistrarName,
  domains: CachedDomain[],
  accountId: string,
  generation: number,
): Promise<void> {
  if (name === 'godaddy') {
    await syncGoDaddyRenewalQuotes(domains, accountId, generation);
    return;
  }
  if (name === 'namecheap') {
    await syncNamecheapRenewalQuotes(domains, accountId, generation);
    return;
  }

  const todo = domains.filter((d) =>
    usesPerNameQuote(name, tldOf(d.domainName)),
  );
  if (todo.length === 0) return;

  const CONCURRENCY = 4;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < todo.length) {
      const d = todo[next++];
      const quote = await fetchRenewalQuote(name, d.domainName, accountId);
      if ((generations.get(accountId) ?? 0) !== generation) return;
      if (!quote) continue;
      writeRenewalQuote(accountId, d.domainName, quote);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker),
  );
}

const AVAILABILITY_BATCH = 50;

async function syncGoDaddyRenewalQuotes(
  domains: CachedDomain[],
  accountId: string,
  generation: number,
): Promise<void> {
  if (domains.length === 0) return;
  const stillCurrent = () => (generations.get(accountId) ?? 0) === generation;

  const premiumByDomain = new Map<string, boolean | undefined>();
  const needFlags = new Set(tldsNeedingPremiumFlags(domains));
  if (needFlags.size > 0) {
    const client = getRegistrarClient('godaddy', accountId);
    const names = domains
      .filter((d) => needFlags.has(tldOf(d.domainName)))
      .map((d) => d.domainName);
    for (let i = 0; i < names.length; i += AVAILABILITY_BATCH) {
      if (!stillCurrent()) return;
      const chunk = names.slice(i, i + AVAILABILITY_BATCH);
      try {
        const results = await client.checkAvailability(chunk);
        for (const r of results) {
          premiumByDomain.set(r.domainName.toLowerCase(), r.premium);
        }
      } catch {
        // Flags stay unknown — we fall back to one TLD sample.
      }
    }
  }

  const plan = planGoDaddyRenewalFetches(domains, premiumByDomain);
  for (const sample of plan.tldSamples) {
    if (!stillCurrent()) return;
    const renewal = await fetchGodaddyTldRenewal(
      sample.tld,
      sample.domain,
      accountId,
    );
    if (renewal != null) {
      setTldRate('godaddy', sample.tld, renewal, accountId);
    } else {
      // Leave any existing rate alone and let .base fill in; a failed quote is
      // not evidence the old rate is wrong.
      console.warn(`[pricing] GoDaddy .${sample.tld} renewal quote failed`);
    }
  }

  const CONCURRENCY = 4;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < plan.premiums.length) {
      const domain = plan.premiums[next++];
      const quote = await fetchRenewalQuote('godaddy', domain, accountId);
      if (!stillCurrent()) return;
      // A priceless quote is no better than nothing: storing it would only
      // pin an empty entry over the TLD rate on the next read.
      if (quote?.renewal != null) writeRenewalQuote(accountId, domain, quote);
    }
  };
  if (plan.premiums.length > 0) {
    await Promise.all(
      Array.from(
        { length: Math.min(CONCURRENCY, plan.premiums.length) },
        worker,
      ),
    );
  }
}

/**
 * Namecheap's renewal quotes: the account's TLD rates, then a per-name quote
 * for each premium name. A failed TLD pass skips the premium check, since it
 * most likely hit the rate limit.
 */
async function syncNamecheapRenewalQuotes(
  domains: CachedDomain[],
  accountId: string,
  generation: number,
): Promise<void> {
  if (await syncNamecheapTldRates(domains, accountId, generation)) {
    await syncNamecheapPremiumQuotes(domains, accountId, generation);
  }
}

/**
 * Fill the account's TLD rates from Namecheap's users.getPricing, one call per
 * distinct TLD. That table is priced for the authenticated user: `Price` is
 * what the account pays (any discount included) and `RegularPrice` the list
 * price the base table already holds. The ICANN fee (`AdditionalCost`) is left
 * out, matching the base table. Calls run one at a time to stay well inside
 * Namecheap's per-minute limit, and the first failure ends the pass — it is
 * most likely that limit or a credential problem, and every later call would
 * fail the same way. A TLD that isn't priced keeps whatever rate it had.
 * Resolves true when every TLD was asked.
 */
async function syncNamecheapTldRates(
  domains: CachedDomain[],
  accountId: string,
  generation: number,
): Promise<boolean> {
  const tlds = [
    ...new Set(domains.map((d) => tldOf(d.domainName)).filter(Boolean)),
  ];
  const client = getRegistrarClient('namecheap', accountId);
  for (const tld of tlds) {
    if ((generations.get(accountId) ?? 0) !== generation) return false;
    try {
      // getPricing reads a dotted argument as a domain and keeps what follows
      // its first dot, so a bare multi-part TLD ("br.com") would be priced as
      // "com". Hand it a name instead.
      const pricing = await client.getPricing(`example.${tld}`);
      // TLD rates are USD; a quote in anything else would be misread.
      const currency = (pricing.currency ?? 'USD').toUpperCase();
      if (typeof pricing.renewal === 'number' && currency === 'USD') {
        setTldRate('namecheap', tld, pricing.renewal, accountId);
      }
    } catch (err) {
      console.warn(`[pricing] Namecheap getPricing(${tld}) failed`, err);
      return false;
    }
  }
  return true;
}

/**
 * Per-name quotes for premium Namecheap names. domains.check flags premium
 * names and reports their own renewal price (`PremiumRenewalPrice`, USD,
 * without the ICANN fee), 50 names a call. Only TLDs that can carry premium
 * names are checked. A name the check calls standard drops any premium quote
 * it held, so it falls back to the TLD rate; a failed check leaves the rest
 * as they were, as does a result with no premium flag.
 */
async function syncNamecheapPremiumQuotes(
  domains: CachedDomain[],
  accountId: string,
  generation: number,
): Promise<void> {
  const needFlags = new Set(tldsNeedingPremiumFlags(domains));
  const names = domains
    .filter((d) => needFlags.has(tldOf(d.domainName)))
    .map((d) => d.domainName);
  const client = getRegistrarClient('namecheap', accountId);
  for (let i = 0; i < names.length; i += AVAILABILITY_BATCH) {
    if ((generations.get(accountId) ?? 0) !== generation) return;
    const chunk = names.slice(i, i + AVAILABILITY_BATCH);
    let results;
    try {
      results = await client.checkAvailability(chunk);
    } catch (err) {
      console.warn('[pricing] Namecheap premium check failed', err);
      return;
    }
    if ((generations.get(accountId) ?? 0) !== generation) return;
    const byName = new Map(results.map((r) => [r.domainName.toLowerCase(), r]));
    for (const domain of chunk) {
      const result = byName.get(domain.toLowerCase());
      if (!result) continue;
      if (result.premium && typeof result.renewalPrice === 'number') {
        writeRenewalQuote(accountId, domain, {
          renewal: result.renewalPrice,
          currency: 'USD',
        });
      } else if (result.premium === false) {
        clearRenewalQuote(accountId, domain);
      }
    }
  }
}

function writeRenewalQuote(
  accountId: string,
  domain: string,
  quote: RenewalQuote,
): void {
  const key = detailKey(accountId, domain);
  const existing = readEntry<DetailRecord>('detail', key)?.data ?? {};
  writeEntry('detail', key, {
    ...existing,
    renewalQuote: quote,
    renewalQuoteFetchedAt: Date.now(),
  });
}

// Patched rather than rewritten, so the domain detail keeps its fetchedAt.
function clearRenewalQuote(accountId: string, domain: string): void {
  const key = detailKey(accountId, domain);
  if (!readEntry<DetailRecord>('detail', key)?.data.renewalQuote) return;
  patchEntryData<DetailRecord>('detail', key, (data) => {
    const rest = { ...data };
    delete rest.renewalQuote;
    return rest;
  });
}

/** Domain names currently cached for one account. `synced` is true only after
 * a successful pull in this batch — a failure keeps the old list and is not a
 * starting point and not a diff. */
function holdingsOf(
  account: RegistrarAccount,
  synced: boolean,
): AccountHoldings {
  const entry = readRegistrarEntry(account.id);
  const expirations: Record<string, string> = {};
  for (const domain of entry?.domains ?? []) {
    const day = expiryDay(domain.expirationDate);
    if (day) expirations[toAscii(domain.domainName)] = day;
  }
  return {
    accountId: account.id,
    names: (entry?.domains ?? []).map((domain) => domain.domainName),
    expirations,
    known: entry != null && entry.lastSyncedAt != null,
    synced:
      synced &&
      entry != null &&
      entry.lastError == null &&
      entry.lastSyncedAt != null,
  };
}

/** Pull these accounts, then record arrivals, departures, moves, and renewals. */
async function syncAccounts(
  accounts: RegistrarAccount[],
  trigger: SyncTrigger = 'manual',
): Promise<void> {
  await Promise.all(
    accounts.map((account) => syncRegistrarInto(account, trigger)),
  );
  const attempted = new Set(accounts.map((account) => account.id));
  const after = getActiveAccounts().map((account) =>
    holdingsOf(account, attempted.has(account.id)),
  );
  try {
    // Compared with what the last sync saw (registrar-last-sync), not the cache.
    recordSync(after);
  } catch (err) {
    console.error('[domain-history] recording the sync failed', err);
  }
}

/**
 * The aggregated portfolio across every configured registrar, cache-backed.
 *
 * With `refresh` false we return the assembled cache verbatim (instant, no
 * network) — the launch/hydration path. With `refresh` true (the default, e.g.
 * the "Sync domains" button) we re-sync every configured registrar in parallel,
 * then return the assembled result.
 */
export async function getPortfolio(
  refresh = true,
  trigger: SyncTrigger = 'manual',
): Promise<Portfolio> {
  if (refresh) {
    // Only sync enabled registrars — a disabled one keeps its credentials but is
    // deliberately skipped.
    await syncAccounts(getActiveAccounts(), trigger);
  }
  return assemblePortfolio();
}

/**
 * Syncs a single registrar (e.g. right after its credentials are saved) and
 * returns the updated aggregate portfolio, merged with every other registrar's
 * cached slice.
 */
export async function syncRegistrar(
  name: RegistrarName,
  accountId?: string,
  trigger: SyncTrigger = 'manual',
): Promise<Portfolio> {
  const account = resolveAccount(name, accountId);
  if (isConfigured(name, account.id)) {
    // A configured account keeps its cached slice even while disabled — the
    // portfolio just hides it (see setRegistrarEnabledCached, which never
    // clears). Only sync when it's actually enabled.
    if (isRegistrarEnabled(account.id)) await syncAccounts([account], trigger);
  } else {
    // Credentials are gone — drop the stale slice so it can't reappear.
    clearRegistrarData(account.id);
  }
  return assemblePortfolio();
}

export async function setRegistrarEnabledCached(
  name: RegistrarName,
  enabled: boolean,
  accountId?: string,
): Promise<Portfolio> {
  const account = resolveAccount(name, accountId);
  invalidateAccount(account.id);
  setRegistrarEnabled(account.id, enabled);
  if (enabled && isConfigured(name, account.id)) await syncAccounts([account]);
  return assemblePortfolio();
}

export async function removeRegistrarAccount(accountId: string): Promise<void> {
  accountById(accountId);
  invalidateAccount(accountId);
  await setStoredCredentials(accountId, {});
  await clearDynadotPricingCapabilities(accountId);
  clearRegistrarData(accountId);
  await removeAccountRecord(accountId);
}

/** Drops a registrar's cached portfolio slice and every one of its detail entries. */
function clearRegistrarData(name: string): void {
  void renewalJobs.delete(name);
  clearEntry('portfolio', name);
  const prefix = `${name}:`;
  for (const key of Object.keys(readAll<DetailRecord>('detail'))) {
    if (key.startsWith(prefix)) clearEntry('detail', key);
  }
}

/** The cached portfolio (revived), or null when nothing has ever synced. */
export function getCachedPortfolio(): Portfolio | null {
  const anySynced = getActiveAccounts().some((account) =>
    readEntry('portfolio', account.id),
  );
  return anySynced ? assemblePortfolio() : null;
}

/**
 * Distinct registrars that hold `domainName` in the cached portfolio
 * (case-insensitive). Backs the MCP tools' automatic registrar resolution, so a
 * caller can act on a domain it owns without knowing which registrar holds it.
 * Normally one; empty when the domain isn't cached (never synced, or added
 * since the last sync), and more than one only if a stale cache still lists a
 * transferred-away domain at its old registrar too.
 */
export function findRegistrarsForDomain(domainName: string): RegistrarName[] {
  const target = domainName.trim().toLowerCase();
  const found = new Set<RegistrarName>();
  for (const d of getCachedPortfolio()?.domains ?? []) {
    if (d.domainName.toLowerCase() === target) {
      found.add(d.registrar as RegistrarName);
    }
  }
  return [...found];
}

/** All cached per-domain detail partials, keyed `registrar:domain` (revived).
 *  The stored renewal quote is dropped — it feeds pricing, not the detail overlay. */
export function getCachedDetail(): Record<string, Partial<Domain>> {
  const all = readAll<DetailRecord>('detail');
  const out: Record<string, Partial<Domain>> = {};
  for (const [key, entry] of Object.entries(all)) {
    out[key] = reviveDomainDates(withoutQuote(entry.data));
  }
  return out;
}

/**
 * Renewal pricing for every cached portfolio domain, computed from local data
 * only (manual override → the quote captured at Sync → shopper TLD rate → the
 * bundled base rate). No network — backs the launch snapshot and the store's
 * post-sync refresh.
 */
export function getPortfolioPricing(): Record<string, RenewalPricing> {
  const portfolio = getCachedPortfolio();
  const out: Record<string, RenewalPricing> = {};
  // Imported names: your price, else the base rate when the registrar is one
  // DomBot knows. Keyed like their rows (`domainKey`).
  for (const d of importedRows(
    getImportedDomains(),
    portfolio?.domains ?? [],
  )) {
    out[domainKey(d)] = resolvePricing(
      d.registrar as RegistrarName,
      d.domainName,
    );
  }
  if (!portfolio) return out;
  const quotes = readAll<DetailRecord>('detail');
  for (const d of portfolio.domains) {
    const registrar = d.registrar as RegistrarName;
    const key = domainKey(d);
    out[key] = {
      ...resolvePricing(
        registrar,
        d.domainName,
        quotes[key]?.data.renewalQuote,
        d.accountId,
      ),
      accountId: d.accountId,
    };
  }
  return out;
}

/**
 * A single domain's renewal price with a fresh per-name quote when the registrar
 * supports one — the live, premium-accurate lookup for the MCP tool. The UI never
 * uses this; it reads the Sync-populated `getPortfolioPricing` instead.
 */
export async function getRenewalPriceLive(
  name: RegistrarName,
  domain: string,
  accountId?: string,
): Promise<RenewalPricing> {
  accountId = resolveDomainAccount(name, domain, accountId).id;
  const live =
    name === 'godaddy' || usesPerNameQuote(name, tldOf(domain))
      ? await fetchRenewalQuote(name, domain, accountId)
      : null;
  // Without a live quote, use the one Sync stored (a Namecheap premium, say).
  const quote =
    live ??
    readEntry<DetailRecord>('detail', detailKey(accountId, domain))?.data
      .renewalQuote;
  return { ...resolvePricing(name, domain, quote, accountId), accountId };
}

// The registrar-client library lists its config fields in an order that puts a
// couple of registrars' account/ID field after the secret it identifies, which
// reads backwards in the form. Override the display order so the identifier
// comes first; registrars not listed keep the library's order. Any field names
// not mentioned here are appended in their original order, so this stays correct
// if the library adds fields later.
//
// GoDaddy is deliberately absent: it now exposes a single credential, the PAT
// (`apiToken`), so there is nothing to reorder. The library still carries the
// legacy sso-key (`apiKey`/`apiSecret`) and `customerId` handling internally,
// but those are no longer configurable — which means GoDaddy domain forwarding
// (which needs `customerId`, plus an sso-key to resolve a numeric shopper ID) is
// unavailable through the app. GoDaddy deprecates sso-key in 2026 regardless.
const FIELD_ORDER: Partial<Record<RegistrarName, string[]>> = {
  cloudflare: ['accountId', 'apiToken'],
};

function orderConfigFields<T extends { name: string }>(
  name: RegistrarName,
  fields: T[],
): T[] {
  const order = FIELD_ORDER[name];
  if (!order) return fields;
  return fields
    .slice()
    .sort(
      (a, b) =>
        (order.indexOf(a.name) + 1 || Infinity) -
        (order.indexOf(b.name) + 1 || Infinity),
    );
}

/** Provider catalog stays available even after its last account is removed. */
export function getRegistrarCatalog(): RegistrarDefinition[] {
  return registrarNames.map((name) => {
    const R = registrars[name];
    return {
      name,
      displayName: R.displayName,
      managedProxyEgressIp: managedProxyFor(name)?.ip,
      supportsSandbox: R.supportsSandbox,
      configFields: orderConfigFields(name, R.configFields).map((f) => ({
        name: f.name,
        label: f.label,
        type: f.type,
        required: f.required,
        options: f.options,
      })),
      features: [...R.features],
    };
  });
}

/** Metadata for stored accounts and backward-compatible default placeholders. */
export function getRegistrarMetadata(): RegistrarMeta[] {
  const catalog = getRegistrarCatalog();
  return listAccounts().map((account) => {
    const sync = readEntry<RegistrarPortfolioEntry>(
      'portfolio',
      account.id,
    )?.data;
    return {
      ...catalog.find((r) => r.name === account.registrar)!,
      accountId: account.id,
      accountLabel: account.label,
      saved: isSavedAccount(account.id),
      proxy: Boolean(account.proxyId || managedProxyFor(account.registrar)),
      proxyManaged:
        !account.proxyId && Boolean(managedProxyFor(account.registrar)),
      proxyEgressIp: account.proxyId
        ? getProxyProfile(account.proxyId)?.egressIp
        : managedProxyFor(account.registrar)?.ip,
      configured: isConfigured(account.registrar, account.id),
      enabled: isRegistrarEnabled(account.id),
      sync: {
        lastSyncedAt: sync?.lastSyncedAt ?? null,
        lastError: sync?.lastError
          ? registrarErrorMessage(sync.lastError)
          : null,
        lastErrorAt: sync?.lastError ? (sync.lastErrorAt ?? null) : null,
        domainCount: sync?.domains.filter(hasDomainName).length ?? 0,
        trackedSince: account.trackedSince ?? null,
        ...(sync?.recovery ? { recovery: sync.recovery } : {}),
      },
    };
  });
}

const publishConnection = serialByKey();

/** Check draft credentials without saving them, then publish a complete account. */
export async function connectRegistrarAccount(
  name: RegistrarName,
  credentials: RegistrarCredentials,
  label?: string,
  useProxy = false,
): Promise<RegistrarAccount> {
  const provider = getRegistrarCatalog().find((r) => r.name === name);
  if (!provider) throw new Error('Unknown registrar.');
  const clean: RegistrarCredentials = {};
  const proxy = useProxy ? requireProxy() : managedProxyFor(name);
  // Through the proxy, its outgoing address is the Client IP Namecheap sees, so
  // a proxy-only account needs no direct one. It is supplied when the client is
  // built, never stored as if it were the user's own address.
  const proxySupplies = (field: string) =>
    Boolean(proxy) && name === 'namecheap' && field === 'clientIp';
  for (const field of provider.configFields) {
    const value = credentials[field.name]?.trim();
    if (value) clean[field.name] = value;
    else if (field.required && !proxySupplies(field.name))
      throw new Error(`${field.label} is required.`);
  }
  if (!Object.keys(clean).length)
    throw new Error('Enter your account credentials.');
  if ((label?.trim().length ?? 0) > 100)
    throw new Error('Account name must contain at most 100 characters.');
  // Fail on a taken nickname before spending a network round trip.
  if (label?.trim()) assertUniqueAccountLabel(name, label);
  const assertNotDuplicate = () => {
    const duplicate = getRegistrarMetadata().find(
      (account) =>
        account.name === name &&
        account.saved &&
        provider.configFields
          .filter((field) => name !== 'namecheap' || field.name !== 'clientIp')
          .every(
            (field) =>
              (getStoredCredentials(account.accountId ?? name)[
                field.name
              ]?.trim() ?? '') === (clean[field.name] ?? ''),
          ),
    );
    if (duplicate)
      throw new Error(
        `These credentials are already connected as "${duplicate.accountLabel}". Edit that account instead.`,
      );
  };
  assertNotDuplicate();
  // Validate through the proxy when one is configured, so a fixed-IP account is
  // tested over the connection it will actually use.
  const secrets: Record<string, string | undefined> = { ...clean };
  proxySecrets(proxy?.url).forEach((v, i) => (secrets[`proxy:${i}`] = v));
  // (The account doesn't exist yet, so the id here is a placeholder.)
  const client = new RegistrarClient(
    protectRegistrar(buildProvider(name, clean, name, proxy), secrets),
  );
  const result = await client.testConnection();
  if (!result.success)
    throw new Error(
      result.message ||
        'Connection failed. Check your credentials and try again.',
    );
  // Concurrent tests may both pass before either account exists. Recheck and
  // publish serially, while keeping network tests outside this short queue.
  return publishConnection(name, async () => {
    assertNotDuplicate();
    return createAccount(
      name,
      label?.trim() || nextAccountLabel(name),
      clean,
      useProxy ? DEFAULT_PROXY_ID : undefined,
    );
  });
}

/** The configured proxy, for an account that is about to start using it. */
function requireProxy(): ProxyRoute {
  const profile = getProxyProfile();
  if (!profile)
    throw new Error('Set up the fixed IP proxy in Settings → Proxy first.');
  return { url: profile.url, ip: profile.egressIp };
}

/** The saved credential values for a registrar (for pre-filling the form). */
export function getRegistrarCredentialValues(
  name: RegistrarName,
  accountId?: string,
): RegistrarCredentials {
  return getStoredCredentials(resolveAccount(name, accountId).id);
}

/** Drops every cached client (credentials were replaced wholesale, e.g. by
 *  a data import) so the next call rebuilds from what's stored now. */
export function resetRegistrarClients(): void {
  for (const id of clients.keys()) invalidateAccount(id);
}

/** Saves credentials and invalidates the cached client so the next call rebuilds. */
export async function saveRegistrarCredentials(
  name: RegistrarName,
  creds: RegistrarCredentials,
  accountId?: string,
  useProxy?: boolean,
): Promise<void> {
  const account = resolveAccount(name, accountId);
  const previous = getStoredCredentials(account.id);
  const sameNamecheapAccount =
    name === 'namecheap' &&
    Boolean(previous.username && previous.apiKey) &&
    ['username', 'apiKey'].every(
      (field) => previous[field]?.trim() === creds[field]?.trim(),
    );
  // Check the route exists before persisting anything.
  if (useProxy) {
    if (account.proxyId) accountProxyRoute(account);
    else requireProxy();
  }
  invalidateAccount(account.id);
  // The proxy no longer lives in the credentials; never let it back in.
  const clean = { ...creds };
  delete clean.proxyUrl;
  delete clean.proxyIp;
  await setStoredCredentials(account.id, clean);
  if (name === 'dynadot') await clearDynadotPricingCapabilities(account.id);
  if (useProxy !== undefined)
    await setAccountProxy(
      account.id,
      useProxy ? (account.proxyId ?? DEFAULT_PROXY_ID) : null,
    );
  if (!sameNamecheapAccount) clearRegistrarData(account.id);
}

/**
 * Best-available detail for a single domain, for lazy per-row UI enrichment.
 * Returns a partial that the caller merges over the list summary:
 *  - `getDomain` for the full record (privacy/lock/dates/nameservers), then
 *  - a `getNameservers` fallback for providers whose detail omits them, then
 *  - a live DNS `NS` query for the rest — the source of truth for domains whose
 *    registrar can't report nameservers (a Cloudflare domain not added as a zone,
 *    or one on the registrar's own DNS, e.g. Dynadot's `ns*.dyna-ns.net`). It
 *    runs even when `getDomain` fails (e.g. Dynadot's detail API rejects some
 *    TLDs its list still returns).
 * Creation date is taken only from the registrar; providers that don't report
 * one (e.g. NameBright) leave it blank rather than triggering an extra lookup.
 * Returns null only when nothing could be resolved.
 */
export async function getDomainDetail(
  name: RegistrarName,
  domainName: string,
  refresh = false,
  accountId?: string,
): Promise<Partial<Domain> | null> {
  accountId = resolveDomainAccount(name, domainName, accountId).id;
  const client = getRegistrarClient(name, accountId);
  const generation = generations.get(accountId) ?? 0;
  const key = detailKey(accountId, domainName);
  // Preserve any renewal quote captured at Sync when we rewrite this entry below,
  // so refreshing detail doesn't drop the domain's price.
  const priorRecord = readEntry<DetailRecord>('detail', key)?.data;
  const priorQuote = priorRecord?.renewalQuote;
  const withQuote = <T extends object>(record: T): T & DetailRecord =>
    priorQuote
      ? {
          ...record,
          renewalQuote: priorQuote,
          renewalQuoteFetchedAt: priorRecord?.renewalQuoteFetchedAt,
        }
      : record;
  if (!refresh) {
    const cached = readEntry<DetailRecord>('detail', key);
    // Serve a fresh-enough cached partial without any network calls.
    if (cached && !isStale(cached)) {
      return {
        ...reviveDomainDates(withoutQuote(cached.data)),
        registrar: name,
        accountId,
        accountLabel: accountById(accountId).label,
      };
    }
  }

  let domain: CachedDomain | null = null;
  try {
    domain = await client.getDomain(domainName);
  } catch {
    // Detail unavailable for this TLD — fall through to registry-only lookups.
  }

  let nameservers = domain?.nameservers ?? [];
  if (nameservers.length === 0) {
    try {
      const fromRegistrar = await client.getNameservers(domainName);
      if (fromRegistrar.length > 0) nameservers = fromRegistrar;
    } catch {
      // registrar can't supply them via this endpoint either
    }
  }

  const createdDate = domain?.createdDate ?? null;

  // Fall back to a live DNS query only for nameservers the registrar can't
  // report (a Cloudflare domain not added as a zone, or one on the registrar's
  // own DNS). Creation date is left to the registrar — providers that omit it
  // (e.g. NameBright) stay blank rather than triggering an extra lookup.
  if (nameservers.length === 0) {
    nameservers = await lookupNameservers(domainName);
  }

  if ((generations.get(accountId) ?? 0) !== generation)
    throw new Error(
      'Account changed while loading detail; refresh the portfolio.',
    );
  if (domain) {
    const result = {
      ...domain,
      registrar: name,
      accountId,
      accountLabel: accountById(accountId).label,
      nameservers,
      ...(createdDate ? { createdDate } : {}),
    };
    if ((generations.get(accountId) ?? 0) === generation)
      writeEntry('detail', key, withQuote(result));
    return result;
  }
  const partial: Partial<Domain> = {};
  if (nameservers.length > 0) partial.nameservers = nameservers;
  if (createdDate) partial.createdDate = createdDate;
  // Nothing resolved this round: don't drop a previously-stored quote — keep the
  // entry alive if one exists, else stay uncached so a later refresh retries.
  if (Object.keys(partial).length === 0) {
    return priorQuote ? {} : null;
  }
  if ((generations.get(accountId) ?? 0) === generation)
    writeEntry('detail', key, withQuote(partial));
  return partial;
}

/**
 * Portfolio domains merged with any cached per-domain detail (nameservers,
 * privacy, lock, creation date), plus sync health: the headline `fetchedAt`, the
 * registrars that have synced, and any per-registrar sync `errors` (so a caller
 * knows the result is incomplete). A pure cache read — no network — mirroring
 * the renderer's `enriched` overlay so filters on detail-only fields work when a
 * domain has been enriched. Backs the MCP `portfolio_query` tool.
 */
export function getMergedPortfolio(): {
  domains: Domain[];
  fetchedAt: number | null;
  registrars: string[];
  errors: PortfolioErrorInfo[];
} {
  const portfolio = getCachedPortfolio();
  if (!portfolio)
    return { domains: [], fetchedAt: null, registrars: [], errors: [] };
  const detail = getCachedDetail();
  const domains = portfolio.domains.map((d) => {
    const extra = detail[domainKey(d)];
    return extra
      ? {
          ...d,
          ...extra,
          registrar: d.registrar,
          accountId: d.accountId,
          accountLabel: d.accountLabel,
        }
      : d;
  });
  return {
    domains,
    fetchedAt: portfolio.fetchedAt,
    registrars: portfolio.registrars,
    errors: portfolio.errors,
  };
}

/**
 * Applies a known field change to both the portfolio slice and the per-domain
 * detail cache (each entry's `fetchedAt` preserved), so a relaunch — and an open
 * Domains table (via the `portfolioChanged` event) — reflect the new value
 * without waiting for the next full sync. No-op for entries that don't exist.
 */
/** Overlay confirmed field values on a domain's cached rows. */
export function patchCachedDomain(
  name: RegistrarName,
  domainName: string,
  patch: Partial<Domain>,
  accountId?: string,
): void {
  patchDomainInCaches(
    name,
    domainName,
    patch,
    resolveDomainAccount(name, domainName, accountId).id,
  );
}

function patchDomainInCaches(
  name: RegistrarName,
  domainName: string,
  patch: Partial<Domain>,
  accountId: string,
): void {
  patchEntryData<RegistrarPortfolioEntry>('portfolio', accountId, (e) => ({
    ...e,
    domains: e.domains.map((d) =>
      d.domainName === domainName ? { ...d, ...patch } : d,
    ),
  }));
  patchEntryData<Partial<Domain>>(
    'detail',
    detailKey(accountId, domainName),
    (d) => ({
      ...d,
      ...patch,
    }),
  );
}

/**
 * Sets auto-renew and, on success, writes the new value into the portfolio and
 * detail caches. Returns the raw `OperationResult` (some providers report a soft
 * failure via `success: false` rather than throwing) without throwing, so an MCP
 * caller sees the provider's own message. The UI-facing `setDomainAutoRenew`
 * wraps this and normalizes a soft failure to a throw for its optimistic toggle.
 */
export async function setAutoRenewCached(
  name: RegistrarName,
  domainName: string,
  enabled: boolean,
  opts?: RequestOptions,
  accountId?: string,
): Promise<OperationResult> {
  accountId = resolveDomainAccount(name, domainName, accountId).id;
  const result = await getRegistrarClient(name, accountId).setAutoRenew(
    domainName,
    enabled,
    opts,
  );
  if (result.success)
    patchDomainInCaches(name, domainName, { autoRenew: enabled }, accountId);
  return result;
}

/** Sets the transfer lock and, on success, patches the caches. Returns the raw
 * result (no throw). */
export async function setLockCached(
  name: RegistrarName,
  domainName: string,
  locked: boolean,
  opts?: RequestOptions,
  accountId?: string,
): Promise<OperationResult> {
  accountId = resolveDomainAccount(name, domainName, accountId).id;
  const client = getRegistrarClient(name, accountId);
  const result = await (locked
    ? client.lockDomain(domainName, opts)
    : client.unlockDomain(domainName, opts));
  if (result.success)
    patchDomainInCaches(name, domainName, { locked }, accountId);
  return result;
}

/** Sets WHOIS privacy and, on success, patches the caches. Returns the raw
 * result (no throw). */
export async function setPrivacyCached(
  name: RegistrarName,
  domainName: string,
  enabled: boolean,
  opts?: RequestOptions,
  accountId?: string,
): Promise<OperationResult> {
  accountId = resolveDomainAccount(name, domainName, accountId).id;
  const result = await getRegistrarClient(name, accountId).setPrivacy(
    domainName,
    enabled,
    opts,
  );
  if (result.success)
    patchDomainInCaches(name, domainName, { privacy: enabled }, accountId);
  return result;
}

/** Replaces the nameservers and, on success, patches the caches. Returns the raw
 * result (no throw). */
export async function setNameserversCached(
  name: RegistrarName,
  domainName: string,
  nameservers: string[],
  opts?: RequestOptions,
  accountId?: string,
): Promise<OperationResult> {
  accountId = resolveDomainAccount(name, domainName, accountId).id;
  const result = await getRegistrarClient(name, accountId).updateNameservers(
    domainName,
    nameservers,
    opts,
  );
  if (result.success && !result.pending)
    patchDomainInCaches(name, domainName, { nameservers }, accountId);
  return result;
}

/**
 * Renews a domain. The registrar's `OperationResult` doesn't carry the new
 * expiry, so on success we re-fetch the domain's detail (which writes through the
 * detail cache) and patch the fresh expiration/renewal/status into the portfolio
 * slice too — that patch is returned so the caller can overlay it on its row. A
 * re-fetch failure is swallowed — the renewal still succeeded and the next Sync
 * corrects the date. Returns the raw result (no throw).
 *
 * No retry override is needed: registrar-client never re-sends a renewal whose
 * outcome is unknown, so a timed-out one can't be charged twice.
 */
export async function renewDomainCached(
  name: RegistrarName,
  domainName: string,
  years?: number,
  opts?: RequestOptions,
  accountId?: string,
): Promise<{ result: OperationResult; patch: Partial<Domain> }> {
  accountId = resolveDomainAccount(name, domainName, accountId).id;
  const result = await getRegistrarClient(name, accountId).renewDomain(
    domainName,
    years,
    opts,
  );
  const patch: Partial<Domain> = {};
  if (result.success) {
    try {
      const detail = await getDomainDetail(name, domainName, true, accountId);
      if (detail?.expirationDate != null)
        patch.expirationDate = detail.expirationDate;
      if (detail?.renewalDate != null) patch.renewalDate = detail.renewalDate;
      if (detail?.status != null) patch.status = detail.status;
      if (Object.keys(patch).length > 0)
        patchDomainInCaches(name, domainName, patch, accountId);
    } catch {
      // Renewal succeeded; leave the cached expiry for the next Sync to correct.
    }
  }
  return { result, patch };
}

/**
 * Registers a new domain and, on success, syncs that registrar's slice so the
 * new name enters the portfolio cache (the registrar's `OperationResult` doesn't
 * return a full `Domain` to append). Returns the raw result (no throw).
 */
export async function registerDomainCached(
  name: RegistrarName,
  domainName: string,
  input: RegisterDomainInput,
  accountId?: string,
): Promise<OperationResult> {
  accountId = resolveAccount(name, accountId).id;
  const result = await getRegistrarClient(name, accountId).registerDomain(
    domainName,
    input,
  );
  // Through syncAccounts so the new name is recorded as an arrival.
  if (result.success) await syncAccounts([accountById(accountId)]);
  return result;
}

/**
 * Reads a domain's live nameservers via a DNS `NS` query — the delegation the
 * domain actually uses, and the only way to see nameservers a registrar won't
 * report (a Cloudflare domain not added as a zone, or one on the registrar's own
 * DNS, e.g. Dynadot's `ns*.dyna-ns.net`). Goes over DNS-over-HTTPS so it works
 * on every host (see core/dns.ts); empty on any failure, timeout, or undelegated
 * domain.
 */
async function lookupNameservers(domainName: string): Promise<string[]> {
  try {
    return await resolveNameservers(domainName);
  } catch {
    // resolveNameservers already swallows failures; this is belt-and-braces.
    return [];
  }
}

// ── internals ────────────────────────────────────────────────────────────────

// Resolve a field to the value the user saved in Settings (encrypted at rest
// by the host). Credentials come only from the GUI store now — no .env or
// process.env fallback, so ambient vars from other tools can't shadow creds.
// `accountId` is the storage key (a UUID, or the registrar id for the legacy
// default account); `registrar` tells us which provider it is so the Namecheap
// proxy override works for every account, not just the default-keyed one.
function resolveField(
  registrar: RegistrarName,
  accountId: string,
  field: string,
): string | undefined {
  if (registrar === 'namecheap' && field === 'clientIp') {
    // Through the proxy, its outgoing address is the ClientIp Namecheap sees.
    const account = listAccounts().find((a) => a.id === accountId);
    const proxy = account ? accountProxyRoute(account) : null;
    if (proxy) return proxy.ip;
  }
  return getStoredCredentials(accountId)[field];
}

function isConfigured(name: RegistrarName, accountId: string): boolean {
  // A malformed stored proxy makes parseNamecheapProxy throw; treat that account
  // as unconfigured rather than crashing callers that only ask "is it set up?".
  try {
    const fields = registrars[name].configFields;
    // Every required field must resolve to a value.
    const requiredOk = fields.every(
      (field) =>
        !field.required || Boolean(resolveField(name, accountId, field.name)),
    );
    if (!requiredOk) return false;
    // Some registrars mark every credential field optional because they accept
    // one of several auth shapes. There "all required fields present" is vacuously
    // true even with nothing entered, which would make the registrar look
    // configured on a fresh install and then 401 on the first query. So when
    // nothing is required, also demand at least one credential value before
    // treating the registrar as configured.
    if (fields.some((field) => field.required)) return true;
    return fields.some((field) =>
      Boolean(resolveField(name, accountId, field.name)),
    );
  } catch {
    return false;
  }
}

function resolveCredentials(
  name: RegistrarName,
  accountId: string,
): RegistrarCredentials {
  const creds: RegistrarCredentials = {};
  const missing: string[] = [];
  for (const field of registrars[name].configFields) {
    const value = resolveField(name, accountId, field.name);
    if (value) creds[field.name] = value;
    else if (field.required) missing.push(field.name);
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing credentials for "${name}": ${missing.join(', ')} (configure in Settings).`,
    );
  }
  return creds;
}
