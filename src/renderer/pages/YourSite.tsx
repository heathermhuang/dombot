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
  ownerSiteDraftSchema,
  selectedSite,
  type PublishedOwnerSite,
} from '../../shared/owner-site';
import { siteChanges } from '../../shared/owner-site-review';
import { SitePreview } from '../components/owner-site/SitePreview';
import { ProfileEditor } from '../components/owner-site/ProfileEditor';
import { SectionsEditor } from '../components/owner-site/SectionsEditor';
import './your-site.css';

export default function YourSite({
  inventory = false,
}: {
  inventory?: boolean;
}) {
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
        <h1>{inventory ? 'Your portfolio' : 'Your site'}</h1>
        <p role={error ? 'alert' : 'status'}>{error || 'Loading…'}</p>
        {error && <button onClick={reload}>Try again</button>}
      </section>
    );
  if (inventory)
    return isOwnerSite(state.draft) ? (
      <>
        <p>
          <Link to="/public-page">Edit your site →</Link> · Domain selections
          are made in Collections or Catalogue.
        </p>
        <Domains hidePublication />
      </>
    ) : (
      <DomainWorkspace area="domains" />
    );
  if (!state.enabled && !isOwnerSite(state.draft))
    return <DomainWorkspace area="page" />;
  if (state.revision && !isOwnerSite(state.draft)) {
    if (new URLSearchParams(location.search).has('legacy'))
      return <DomainWorkspace area="page" />;
    let preview: PublishedOwnerSite | null = null;
    let conversionError = '';
    try {
      const converted = convertOwnerSite(state.draft);
      preview = { ...selectedSite(converted), publishedAt: 1 };
    } catch (e) {
      conversionError = (e as Error).message;
    }
    return (
      <section className="os-editor">
        <h1>Update your site</h1>
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
  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <section className="os-editor">
      <h1>Create your site</h1>
      <p>
        Introduce yourself without making your portfolio public. Start with a
        name and address; add collections or projects when you need them.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          const draft = emptyOwnerSite();
          draft.handle = handle;
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
          <label>
            Site address
            <input
              required
              pattern="[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?"
              maxLength={40}
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
            />
            <small>
              /p/{handle || 'your-name'} · choose once when creating the draft
            </small>
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
  const { state, draft, status, error } = useSiteEditor();
  const location = useLocation();
  const requestedView = new URLSearchParams(location.search).get('view');
  const [view, setView] = useState(
    requestedView === 'preview' || requestedView === 'review'
      ? requestedView
      : 'edit',
  );
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setActionError('');
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
    if (!ownerSiteDraftSchema.safeParse(draft).success)
      return { site: null, error: '' };
    try {
      return { site: { ...selectedSite(draft), publishedAt: 1 }, error: '' };
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
        <h1>Your site</h1>
        <p role={error ? 'alert' : 'status'}>{error || 'Loading your site…'}</p>
        {error && (
          <button onClick={() => void siteEditor.load().catch(() => {})}>
            Try again
          </button>
        )}
      </section>
    );
  const issues = ownerSiteDraftSchema.safeParse(draft);
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
          <span className="os-eyebrow">Your site</span>
          <h1>{state.revision ? 'Make it yours' : 'Create your site'}</h1>
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
            · {live ? 'Site published' : 'Not published'}
          </p>
        </div>
        <div className="os-actions">
          <button
            onClick={() => void run(() => siteEditor.flush())}
            disabled={busy || !state.enabled}
          >
            Save draft
          </button>
          <button onClick={() => setView('preview')}>Preview</button>
          <button
            onClick={() =>
              void run(async () => {
                await siteEditor.flush();
                await siteEditor.refreshReview();
                setView('review');
              })
            }
            disabled={busy || !state.enabled || !projection.site}
          >
            Review changes
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
      {receipt && (
        <p role="status">
          Published {receipt}.{' '}
          <a
            href={hostPath(`/p/${draft.handle}`)}
            target="_blank"
            rel="noreferrer"
          >
            View your site ↗
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
        <fieldset disabled={!state.enabled || busy}>
          <ProfileEditor
            draft={draft}
            lockedHandle={!!state.revision}
            onChange={update}
          />
          <SectionsEditor
            draft={draft}
            review={state.review}
            onChange={update}
          />
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
          <p>
            This replaces the published site at /p/{draft.handle}. Draft edits
            alone never publish.
          </p>
        </section>
      )}
      <footer className="os-footer">
        <button disabled={busy} onClick={() => void run(exportBackup)}>
          Export private backup
        </button>
        {live && (
          <>
            <a
              href={hostPath(`/p/${live.handle}`)}
              target="_blank"
              rel="noreferrer"
            >
              View live site ↗
            </a>
            <button onClick={() => setConfirmRemove(true)}>Unpublish…</button>
          </>
        )}
        {confirmRemove && (
          <div>
            <p>Remove the public site? Your private draft is kept.</p>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (state.enabled) await siteEditor.unpublish();
                  else {
                    await publicationRequest('/unpublish', 'POST', {
                      revision: state.revision,
                    });
                    await siteEditor.discardAndReload();
                  }
                  setConfirmRemove(false);
                  setReceipt('');
                })
              }
            >
              Unpublish site
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
