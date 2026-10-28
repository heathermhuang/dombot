import { useEffect, useState, useRef } from 'react';
import type {
  PortfolioDnsRecord,
  PortfolioDomainsState,
  PortfolioDomainStatus,
} from '../../../shared/portfolio-domains';
import {
  portfolioDomainsRequest,
  PortfolioDomainRequestError,
} from '../../lib/portfolio-domains-client';
import { webAuthMode, hostPath } from '../../lib/platform';
import { usePortfolioAddress } from './PortfolioAddress';
const labels: Record<PortfolioDomainStatus, string> = {
  'pending-certificate': 'Waiting for DNS and HTTPS verification',
  'pending-routing': 'Getting the domain route ready',
  checking: 'Ready for a domain visit',
  active: 'Connected',
  blocked: 'Needs attention',
  'needs-review': 'Waiting for a service-side check',
  detaching: 'Not active · cleanup pending',
  detached: 'Removed',
};
function Records({
  records,
  label,
}: {
  records: PortfolioDnsRecord[];
  label: string;
}) {
  const [copied, setCopied] = useState<string | null>(null),
    [error, setError] = useState('');
  if (!records.length) return null;
  return (
    <section className="os-domain-records" aria-label={label}>
      <h3>{label}</h3>
      {records.map((record, i) => (
        <div
          className="os-domain-record"
          key={record.type + record.name + record.value}
        >
          <div>
            <strong>{record.type}</strong>
            <span>Name</span>
            <code>{record.name}</code>
            <span>Value</span>
            <code>{record.value}</code>
          </div>
          <button
            type="button"
            aria-label={`Copy ${record.type} value for ${record.name} record ${i + 1}`}
            onClick={() => {
              void navigator.clipboard
                .writeText(record.value)
                .then(() => setCopied(record.type + record.name + record.value))
                .catch(() => setError('Select the record value to copy it.'));
            }}
          >
            {copied === record.type + record.name + record.value
              ? 'Copied'
              : 'Copy value'}
          </button>
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
function safeVisit(
  value: string | null | undefined,
  hostname: string | undefined,
) {
  try {
    if (!value || !hostname) return null;
    const url = new URL(value);
    return url.protocol === 'https:' &&
      url.hostname === hostname &&
      !url.port &&
      !url.username &&
      !url.password &&
      url.pathname === '/'
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function PortfolioDomainPanel() {
  const readVersion = useRef(0),
    mutating = useRef(false);
  const storageKey =
    'portfolio-domain-input:' +
    (typeof window === 'undefined' ? '' : hostPath('/'));
  const [state, setState] = useState<PortfolioDomainsState | null>(null),
    [hostname, setHostname] = useState(() => {
      try {
        return window.sessionStorage.getItem(storageKey) ?? '';
      } catch {
        return '';
      }
    }),
    [error, setError] = useState(''),
    [reauth, setReauth] = useState(false),
    [busy, setBusy] = useState(false),
    [confirmRemove, setConfirmRemove] = useState(false);
  const { reload: reloadAddress } = usePortfolioAddress();
  const reloadAddressRef = useRef(reloadAddress);
  useEffect(() => {
    reloadAddressRef.current = reloadAddress;
  }, [reloadAddress]);
  const reload = () => {
    if (mutating.current) return;
    const version = ++readVersion.current;
    setError('');
    void portfolioDomainsRequest()
      .then((value) => {
        if (readVersion.current === version) setState(value);
      })
      .catch((e: Error) => {
        if (readVersion.current === version) setError(e.message);
      });
  };
  useEffect(() => {
    try {
      window.sessionStorage.setItem(storageKey, hostname);
    } catch {
      /* Session storage may be unavailable; keep the in-memory input. */
    }
  }, [storageKey, hostname]);
  useEffect(() => {
    if (webAuthMode() !== 'gateway') return;
    let active = true;
    const load = () => {
      if (mutating.current) return;
      const version = ++readVersion.current;
      void portfolioDomainsRequest()
        .then((value) => {
          if (active && version === readVersion.current) setState(value);
        })
        .catch((e: Error) => {
          if (active && version === readVersion.current) setError(e.message);
        });
    };
    load();
    const onFocus = () => {
      if (mutating.current) return;
      load();
      reloadAddressRef.current();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      window.removeEventListener('focus', onFocus);
    };
  }, []);
  const run = async (path: string, body: unknown) => {
    mutating.current = true;
    const version = ++readVersion.current;
    setBusy(true);
    setError('');
    setReauth(false);
    try {
      const value = await portfolioDomainsRequest(path, body);
      if (version === readVersion.current) setState(value);
      setConfirmRemove(false);
      reloadAddress();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'The domain request could not be completed.',
      );
      setReauth(e instanceof PortfolioDomainRequestError && e.reauth);
      try {
        const value = await portfolioDomainsRequest();
        if (version === readVersion.current) setState(value);
      } catch {
        /* Preserve the current draft and error if status is unavailable. */
      }
    } finally {
      mutating.current = false;
      setBusy(false);
    }
  };
  if (webAuthMode() !== 'gateway') return null;
  if (!state)
    return error ? (
      <section className="os-address">
        <p role="alert">{error}</p>
        <button onClick={reload}>Retry domain information</button>
      </section>
    ) : null;
  if (!state.enabled && !state.domain) return null;
  const domain = state.domain,
    plan = state.plan,
    visit = safeVisit(domain?.verificationUrl, domain?.hostname),
    routingReady = domain && ['checking', 'active'].includes(domain.status);
  return (
    <section
      className="os-address os-custom-domain"
      aria-label="Your own domain"
    >
      <h2>Use your own domain</h2>
      <p>
        Give your published profile an address you control. Your domain stays
        with its registrar, and your short portfolio link keeps working.
      </p>
      {domain ? (
        <>
          <p className="os-address-url">{domain.hostname}</p>
          <p role="status">
            {domain.status === 'detaching' && domain.needsServiceReview
              ? 'Not active · service check needed'
              : labels[domain.status]}
          </p>
          {domain.message && <p role="status">{domain.message}</p>}
          {domain.status === 'active' && (
            <a
              href={`https://${domain.hostname}/`}
              target="_blank"
              rel="noreferrer"
            >
              View your domain ↗
            </a>
          )}
          {visit && state.enabled && (
            <p>
              <a
                className="os-domain-visit"
                href={visit}
                target="_blank"
                rel="noreferrer"
              >
                Open your domain to finish connecting ↗
              </a>
            </p>
          )}
          {domain.needsServiceReview && (
            <p>
              <a href="mailto:domains@domains.domains">Contact support</a>
            </p>
          )}
        </>
      ) : null}
      {!domain && state.enabled && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run('/plans', { hostname, revision: plan?.revision ?? null });
          }}
        >
          <label htmlFor="portfolio-domain-name">Domain or subdomain</label>
          <div className="os-address-input">
            <input
              id="portfolio-domain-name"
              value={hostname}
              onChange={(event) => setHostname(event.target.value)}
              required
              maxLength={253}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="portfolio.yourbrand.com"
              disabled={busy}
            />
          </div>
          <p>
            Use an unused subdomain to keep an existing website in place. For an
            apex domain, your DNS provider must support CNAME flattening or
            ALIAS records.
          </p>
          <button disabled={busy}>
            {busy
              ? 'Preparing…'
              : plan
                ? 'Prepare a new setup'
                : 'Prepare domain setup'}
          </button>
        </form>
      )}
      {plan && (
        <>
          <h3>DNS setup for {plan.hostname}</h3>
          <Records
            records={plan.records.filter((record) => record.type === 'TXT')}
            label="1. Verify domain ownership"
          />
          {!!domain?.records.length && (
            <Records records={domain.records} label="2. Verify HTTPS" />
          )}
          <p>
            Add the TXT records at your DNS provider. Keep existing mail and
            verification records; this service does not change DNS
            automatically.
          </p>
          <details open={!!routingReady}>
            <summary>3. Point the domain here, after HTTPS is ready</summary>
            <p>
              Changing this record routes this hostname to your profile. Wait
              for HTTPS verification before changing an existing website’s
              routing.
            </p>
            <Records
              records={plan.records.filter((record) => record.type === 'CNAME')}
              label="Routing record"
            />
          </details>
          {state.enabled &&
            domain?.status !== 'needs-review' &&
            domain?.status !== 'detaching' && (
              <div className="os-actions">
                <button
                  disabled={busy}
                  onClick={() =>
                    void run('/verify', {
                      hostname: plan.hostname,
                      revision: plan.revision,
                    })
                  }
                >
                  {busy ? 'Checking…' : 'Check connection'}
                </button>
              </div>
            )}
        </>
      )}
      {domain && !confirmRemove && (
        <p>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmRemove(true)}
          >
            Remove connection…
          </button>
        </p>
      )}
      {domain && confirmRemove && (
        <div className="os-domain-remove">
          <p>
            Remove {domain.hostname}? It will stop serving this profile. Your
            published content and short portfolio link stay available. Restore
            DNS at your provider if you want the hostname to point elsewhere.
          </p>
          <div className="os-actions">
            <button
              disabled={busy}
              onClick={() =>
                void run('/detach', {
                  hostname: domain.hostname,
                  epoch: domain.epoch,
                })
              }
            >
              Remove connection
            </button>
            <button disabled={busy} onClick={() => setConfirmRemove(false)}>
              Keep domain
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert">
          {error}
          {reauth && (
            <>
              {' '}
              <a
                href={
                  '/account/reauth?next=' +
                  encodeURIComponent(hostPath('/') + '#/public-page')
                }
              >
                Confirm your identity
              </a>
              , then return here to retry.
            </>
          )}
        </p>
      )}
    </section>
  );
}
