import { PortfolioDomainPanel } from '../components/owner-site/PortfolioDomainPanel';
import {
  PortfolioAddressProvider,
  PortfolioAddressPanel,
  usePortfolioAddress,
} from '../components/owner-site/PortfolioAddress';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import DomainWorkspace from './DomainWorkspace';
import Domains from './Domains';
import {
  loadSite,
  siteEditor,
  useSiteEditor,
  type SiteState,
} from '../lib/owner-site-client';
import { publicationRequest } from '../lib/publication-client';
import { hostPath } from '../lib/platform';
import {
  convertOwnerSite,
  emptyOwnerSite,
  isOwnerSite,
  editableOwnerSiteSchema,
  previewOwnerSite,
  type PublishedOwnerSite,
} from '../../shared/owner-site';
import { siteChanges } from '../../shared/owner-site-review';
import { SitePreview } from '../components/owner-site/SitePreview';
import { ProfileEditor } from '../components/owner-site/ProfileEditor';
import { SectionsEditor } from '../components/owner-site/SectionsEditor';
import './your-site.css';
import { PresenceInspector } from '../components/owner-site/PresenceInspector';
import { PublishingWorkspace } from '../components/owner-site/PublishingWorkspace';

function YourSiteContent({ inventory = false }: { inventory?: boolean }) {
  const location = useLocation();
  const [state, setState] = useState<SiteState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const reload = () => {
    setError('');
    void loadSite()
      .then(setState)
      .catch((e) => setError(e.message));
  };
  useEffect(() => {
    reload();
  }, []);
  if (inventory && error && !state)
    return (
      <>
        <div className="pf-alert" role="alert">
          Public-site information is unavailable. Your private domains remain
          available. <button onClick={reload}>Retry site information</button>
        </div>
        <Domains hidePublication />
      </>
    );
  if (!state)
    return (
      <section className="os-editor">
        <h1>{inventory ? 'Your portfolio' : 'Public profile'}</h1>
        <p role={error ? 'alert' : 'status'}>{error || 'Loading…'}</p>
        {error && <button onClick={reload}>Try again</button>}
      </section>
    );
  if (inventory)
    return (
      <>
        <PresenceInspector />
        {isOwnerSite(state.draft) ? (
          <Domains hidePublication />
        ) : (
          <DomainWorkspace area="domains" />
        )}
      </>
    );
  if (!state.enabled && !isOwnerSite(state.draft))
    return (
      <>
        <PresenceInspector />
        <PortfolioAddressPanel />
        <PortfolioDomainPanel />
        <DomainWorkspace area="page" />
      </>
    );
  if (state.revision && !isOwnerSite(state.draft)) {
    if (new URLSearchParams(location.search).has('legacy'))
      return (
        <>
          <PresenceInspector />
          <PortfolioAddressPanel />
          <PortfolioDomainPanel />
          <DomainWorkspace area="page" />
        </>
      );
    let preview: PublishedOwnerSite | null = null;
    let conversionError = '';
    try {
      const converted = convertOwnerSite(state.draft);
      preview = previewOwnerSite(converted);
    } catch (e) {
      conversionError = (e as Error).message;
    }
    return (
      <section className="os-editor">
        <h1>Update your public profile</h1>
        <p>
          Your live page stays as it is until you review and publish. The update
          preserves your selected names, descriptions, email, prices and
          previously owned assertions. Your existing selection remains in the
          optional catalogue.
        </p>
        <p>Preview this draft conversion before saving it.</p>
        {conversionError ? (
          <p role="alert">{conversionError}</p>
        ) : (
          preview && (
            <SitePreview site={preview} title="Site conversion preview" />
          )
        )}
        <div className="os-actions">
          <button
            disabled={busy || !!conversionError}
            onClick={() => {
              setBusy(true);
              setError('');
              void publicationRequest('/site/convert', 'POST', {
                revision: state.revision,
              })
                .then(() => {
                  reload();
                })
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            Save updated draft
          </button>
          <Link to="/public-page?legacy=1">
            Continue with existing page editor
          </Link>
        </div>
        {error && <p role="alert">{error}</p>}
      </section>
    );
  }
  if (!state.revision && state.enabled)
    return <CreateSite onCreated={reload} />;
  return <SiteAuthor />;
}
function CreateSite({ onCreated }: { onCreated: () => void }) {
  const { state: addressState } = usePortfolioAddress();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <section className="os-editor">
      <h1>Create your public profile</h1>
      <p>
        Introduce yourself without making your portfolio public. Start with a
        name; add collections, projects or an optional website address in
        Settings.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          const draft = emptyOwnerSite();
          draft.handle =
            addressState?.address?.handle ??
            `profile-${crypto.randomUUID().slice(0, 8)}`;
          draft.profile.name = name;
          void publicationRequest('/site', 'PUT', { draft, revision: null })
            .then(onCreated)
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        <div className="os-fields">
          <label>
            Display name
            <input
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        </div>
        <button disabled={busy}>Create private draft</button>
      </form>
      <p>
        Nothing is published by creating a draft. Your inventory remains
        private.
      </p>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
function SiteAuthor() {
  const { state: addressState } = usePortfolioAddress();
  const publicLink = (handle: string) =>
    addressState?.address?.url ?? hostPath(`/p/${handle}`);
  const { state, draft, status, error } = useSiteEditor();
  const location = useLocation();
  const requestedView = new URLSearchParams(location.search).get('view');
  const [view, setView] = useState(
    requestedView === 'preview' || requestedView === 'review'
      ? requestedView
      : 'edit',
  );
  const [section, setSection] = useState<
    'profile' | 'collections' | 'domains' | 'settings'
  >('profile');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState('');
  const [removalNotice, setRemovalNotice] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setActionError('');
    setRemovalNotice('');
    try {
      await action();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void siteEditor
      .load()
      .then(() => {
        if (requestedView === 'review') return siteEditor.refreshReview();
      })
      .catch(() => {});
  }, [requestedView]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (siteEditor.isDirty()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, []);
  const projection = useMemo(() => {
    if (!draft) return { site: null, error: '' };
    if (!editableOwnerSiteSchema.safeParse(draft).success)
      return { site: null, error: '' };
    try {
      return { site: previewOwnerSite(draft), error: '' };
    } catch (e) {
      return { site: null, error: (e as Error).message };
    }
  }, [draft]);
  const changes = useMemo(() => {
    if (!draft || !state || !projection.site) return [];
    return siteChanges(draft, state.publishedSnapshot);
  }, [draft, state, projection]);
  if (!draft || !state)
    return (
      <section className="os-editor">
        <h1>Public profile</h1>
        <p role={error ? 'alert' : 'status'}>
          {error || 'Loading your public profile…'}
        </p>
        {error && (
          <button onClick={() => void siteEditor.load().catch(() => {})}>
            Try again
          </button>
        )}
      </section>
    );
  const issues = editableOwnerSiteSchema.safeParse(draft);
  const update = (value: typeof draft) => {
    setReceipt('');
    siteEditor.update(value);
  };
  const live = state.publishedSnapshot;
  const exportBackup = async () => {
    const text = await window.api.exportData();
    const url = URL.createObjectURL(
      new Blob([text], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'domains-domains-private-backup.json';
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="os-editor">
      <header className="os-header">
        <div>
          <span className="os-eyebrow">Public profile</span>
          <h1>{draft.profile.name}</h1>
          <p>
            Introduce yourself. Share only what you choose. A site with no
            public domains is complete.
          </p>
          <p role="status">
            {status === 'saved'
              ? 'Draft saved'
              : status === 'saving'
                ? 'Saving draft…'
                : status === 'unsaved'
                  ? 'Unsaved changes'
                  : status === 'error'
                    ? 'Draft needs attention'
                    : 'Loading…'}{' '}
            · {live ? 'Profile published' : 'Not published'}
          </p>
        </div>
        <div className="os-actions">
          <a href={publicLink(draft.handle)} target="_blank" rel="noreferrer">
            {live ? 'View published site ↗' : 'Published address'}
          </a>
          <button
            onClick={() => void run(() => siteEditor.flush())}
            disabled={busy || !state.enabled}
          >
            Save draft
          </button>
        </div>
      </header>
      {!state.enabled && (
        <p role="status">
          Site editing is disabled for this account. Your published site remains
          available. You can export a private backup or unpublish.
        </p>
      )}
      {(error || actionError) && (
        <div role="alert" className="os-alert">
          <p>{actionError || error}</p>
          <button
            disabled={busy}
            onClick={() => void run(() => siteEditor.flush())}
          >
            Retry save
          </button>
          <button onClick={() => setConfirmReload(true)}>
            Discard edits and reload…
          </button>
        </div>
      )}
      {confirmReload && (
        <div role="alert">
          <p>Discard local edits and load the saved draft?</p>
          <button
            onClick={() =>
              void run(async () => {
                await siteEditor.discardAndReload();
                setConfirmReload(false);
              })
            }
          >
            Discard and reload
          </button>
          <button onClick={() => setConfirmReload(false)}>Keep editing</button>
        </div>
      )}
      {!issues.success && (
        <ul role="alert">
          {issues.error.issues.slice(0, 6).map((issue, i) => (
            <li key={i}>
              {issue.path
                .map((part) =>
                  typeof part === 'number'
                    ? part + 1
                    : ((
                        {
                          profile: 'Profile',
                          domainPresentations: 'Domain details',
                          projects: 'Projects',
                          collections: 'Collections',
                          url: 'HTTPS link',
                          name: 'Display name',
                          title: 'Title',
                          intro: 'Introduction',
                          contactEmail: 'Public contact email',
                          interests: 'Investment interests',
                          opportunities: 'Conversations welcome',
                          links: 'Profile links',
                          headline: 'Headline',
                          slug: 'Collection link',
                          askingPrice: 'Asking price',
                          currency: 'Currency',
                        } as Record<string, string>
                      )[part] ?? part),
                )
                .join(' → ')}
              : {issue.message}
            </li>
          ))}
        </ul>
      )}
      {projection.error && <p role="alert">{projection.error}</p>}
      {removalNotice && <p role="status">{removalNotice}</p>}
      {receipt && (
        <p role="status">
          Published {receipt}.{' '}
          <a href={publicLink(draft.handle)} target="_blank" rel="noreferrer">
            View your public profile ↗
          </a>
        </p>
      )}
      <nav className="os-tabs" aria-label="Site editor">
        <button aria-pressed={view === 'edit'} onClick={() => setView('edit')}>
          Edit site
        </button>
        <button
          aria-pressed={view === 'preview'}
          onClick={() => setView('preview')}
        >
          Preview
        </button>
        <button
          aria-pressed={view === 'review'}
          disabled={busy || !state.enabled || !projection.site}
          className={view === 'edit' ? 'os-primary' : undefined}
          onClick={() =>
            void run(async () => {
              await siteEditor.flush();
              await siteEditor.refreshReview();
              setView('review');
            })
          }
        >
          Review changes
        </button>
      </nav>
      {view === 'edit' && (
        <nav className="os-tabs" aria-label="Publishing workspace">
          {(['profile', 'collections', 'domains', 'settings'] as const).map(
            (s) => (
              <button
                key={s}
                aria-pressed={section === s}
                onClick={() => setSection(s)}
              >
                {
                  {
                    profile: 'Profile',
                    collections: 'Collections',
                    domains: 'Domain pages',
                    settings: 'Settings',
                  }[s]
                }
              </button>
            ),
          )}
        </nav>
      )}
      {view === 'edit' && section === 'settings' && (
        <>
          <PortfolioAddressPanel />
          <PortfolioDomainPanel />
          {state.v3Enabled && draft.version === 2 && (
            <section>
              <h2>Linked domain pages (v3)</h2>
              <p>
                Conversion keeps selected and excluded draft sections, prices,
                contact fields and order. It creates no Sales links and does not
                publish.
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await siteEditor.flush();
                    await publicationRequest('/site/convert-v3', 'POST', {
                      revision: siteEditor.getSnapshot().state!.revision,
                    });
                    await siteEditor.discardAndReload();
                  })
                }
              >
                Save v3 draft conversion
              </button>
            </section>
          )}
        </>
      )}
      {view === 'edit' && section === 'domains' && (
        <PublishingWorkspace draft={draft} state={state} />
      )}
      {view === 'edit' && section !== 'settings' && (
        <fieldset disabled={!state.enabled || busy}>
          {section === 'profile' && (
            <ProfileEditor
              draft={draft}
              lockedHandle={!!state.revision}
              showAddress={false}
              onChange={update}
            />
          )}
          {section !== 'profile' && (
            <SectionsEditor
              section={section === 'domains' ? 'domains' : 'collections'}
              draft={draft}
              review={state.review}
              onChange={update}
            />
          )}
        </fieldset>
      )}
      {view === 'preview' && (
        <section>
          <h2>Private preview</h2>
          <p>
            Only selected content appears. External links and contact actions
            are disabled.
          </p>
          {projection.site ? (
            <SitePreview site={projection.site} />
          ) : (
            <p>Resolve the selected content above to preview.</p>
          )}
        </section>
      )}
      {view === 'review' && projection.site && (
        <section aria-label="Selected-domain verification">
          <h2>Selected-domain verification</h2>
          {Object.entries(
            state.review
              .filter(
                (r) =>
                  projection.site!.domainPresentations.some(
                    (d) => d.domain === r.domain && d.ownership === 'current',
                  ) && r.ownership !== 'owned',
              )
              .reduce<Record<string, string[]>>((groups, r) => {
                const key = `${r.accountLabels.join(', ') || 'Imported or unmatched'} · ${r.ownership}`;
                (groups[key] ??= []).push(r.domain);
                return groups;
              }, {}),
          ).map(([reason, names]) => (
            <details key={reason} open>
              <summary>
                {reason} · {names.length}
              </summary>
              <p>{names.join(', ')}</p>
              <Link to="/">Open private inventory to resolve control</Link>
            </details>
          ))}
        </section>
      )}
      {view === 'review' && (
        <section>
          <h2>Review exactly what becomes public</h2>
          <p>
            Check your identity, email, external links, project claims, selected
            names, availability and prices. Previously owned is your assertion;
            it does not mean sold.
          </p>
          {changes.length ? (
            changes.map((change) => (
              <article className="os-change" key={change.key}>
                <h3>{change.label}</h3>
                <div>
                  <section>
                    <h4>Currently public</h4>
                    <p>{change.before || 'Not included'}</p>
                  </section>
                  <section>
                    <h4>After publication</h4>
                    <p>{change.after || 'Not included'}</p>
                  </section>
                </div>
              </article>
            ))
          ) : (
            <p>No public changes.</p>
          )}
          {draft.version === 3 && draft.salesLinks.length ? (
            <PublishingWorkspace draft={draft} state={state} fullPage />
          ) : (
            <button
              className="os-primary"
              disabled={
                busy || !projection.site || !issues.success || !state.enabled
              }
              onClick={() =>
                void run(async () => {
                  await siteEditor.publish();
                  setReceipt(new Date().toLocaleString());
                })
              }
            >
              Publish changes
            </button>
          )}
          <p>
            This replaces the published profile at {publicLink(draft.handle)}.
            Draft edits alone never publish.
          </p>
        </section>
      )}
      <footer className="os-footer">
        <button disabled={busy} onClick={() => void run(exportBackup)}>
          Export private backup
        </button>
        {live && (
          <>
            <a href={publicLink(live.handle)} target="_blank" rel="noreferrer">
              View live profile ↗
            </a>
            <button onClick={() => setConfirmRemove(true)}>Unpublish…</button>
          </>
        )}
        {confirmRemove && (
          <div>
            <p>Remove the public profile? Your private draft is kept.</p>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await siteEditor.unpublish();
                  setConfirmRemove(false);
                  setReceipt('');
                  setRemovalNotice(
                    'Public profile removed. Your unfinished edits are kept.',
                  );
                })
              }
            >
              Unpublish profile
            </button>
            <button onClick={() => setConfirmRemove(false)}>
              Keep published
            </button>
          </div>
        )}
      </footer>
    </section>
  );
}

export default function YourSite(props: { inventory?: boolean }) {
  return (
    <PortfolioAddressProvider>
      <YourSiteContent {...props} />
    </PortfolioAddressProvider>
  );
}
