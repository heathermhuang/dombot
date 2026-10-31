import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  canonicalDomain,
  type ReconciledListing,
} from '../../../shared/publication';
import type { OwnerSiteDraft } from '../../../shared/owner-site';
import { DomainPicker, SelectionOrder } from './DomainPicker';

const move = (ids: string[], index: number, by: number) => {
  const next = [...ids];
  [next[index], next[index + by]] = [next[index + by], next[index]];
  return next;
};
export function SectionsEditor({
  draft,
  review,
  onChange,
  section,
}: {
  section?: 'collections' | 'domains';
  draft: OwnerSiteDraft;
  review: ReconciledListing[];
  onChange: (draft: OwnerSiteDraft) => void;
}) {
  const [picker, setPicker] = useState<string | null>(null);
  const [history, setHistory] = useState('');
  const [error, setError] = useState('');
  const [domainQuery, setDomainQuery] = useState('');
  const [domainPage, setDomainPage] = useState(1);
  const domainRows = draft.domainPresentations.filter((d) =>
    d.domain.includes(domainQuery.toLowerCase()),
  );
  const orderControls = (kind: 'collectionIds' | 'projectIds', id: string) => {
    const ids = draft.homepage[kind];
    const index = ids.indexOf(id);
    return (
      <div className="os-actions">
        <label className="os-check">
          <input
            type="checkbox"
            checked={index >= 0}
            onChange={() =>
              onChange({
                ...draft,
                homepage: {
                  ...draft.homepage,
                  [kind]:
                    index < 0 ? [...ids, id] : ids.filter((v) => v !== id),
                },
              })
            }
          />
          Include on site
        </label>
        {index >= 0 && (
          <>
            <button
              disabled={index === 0}
              onClick={() =>
                onChange({
                  ...draft,
                  homepage: { ...draft.homepage, [kind]: move(ids, index, -1) },
                })
              }
            >
              Move section up
            </button>
            <button
              disabled={index === ids.length - 1}
              onClick={() =>
                onChange({
                  ...draft,
                  homepage: { ...draft.homepage, [kind]: move(ids, index, 1) },
                })
              }
            >
              Move section down
            </button>
            <small>Site position {index + 1}</small>
          </>
        )}
      </div>
    );
  };
  return (
    <>
      <section hidden={section === 'domains'}>
        <h2>Collections</h2>
        <p>
          Give a selection context. Include it on your site only when it is
          ready; an included collection must contain at least one domain.
        </p>
        {draft.collections.map((c) => (
          <div className="os-section" key={c.id}>
            <div className="os-fields">
              <label>
                Collection title
                <input
                  value={c.title}
                  maxLength={100}
                  onChange={(e) =>
                    onChange({
                      ...draft,
                      collections: draft.collections.map((v) =>
                        v.id === c.id ? { ...v, title: e.target.value } : v,
                      ),
                    })
                  }
                />
              </label>
              <label>
                Collection link
                <input
                  value={c.slug}
                  onChange={(e) =>
                    onChange({
                      ...draft,
                      collections: draft.collections.map((v) =>
                        v.id === c.id ? { ...v, slug: e.target.value } : v,
                      ),
                    })
                  }
                />
                <small>Use lowercase letters, numbers and hyphens.</small>
              </label>
              <label>
                Collection introduction
                <textarea
                  value={c.intro}
                  maxLength={600}
                  onChange={(e) =>
                    onChange({
                      ...draft,
                      collections: draft.collections.map((v) =>
                        v.id === c.id ? { ...v, intro: e.target.value } : v,
                      ),
                    })
                  }
                />
              </label>
            </div>
            {orderControls('collectionIds', c.id)}
            <SelectionOrder
              draft={draft}
              ids={c.domainIds}
              onChange={(ids) =>
                onChange({
                  ...draft,
                  collections: draft.collections.map((v) =>
                    v.id === c.id ? { ...v, domainIds: ids } : v,
                  ),
                })
              }
            />
            <button onClick={() => setPicker(picker === c.id ? null : c.id)}>
              Select domains for {c.title}
            </button>
            {picker === c.id && (
              <DomainPicker
                draft={draft}
                review={review}
                selected={c.domainIds}
                onChange={(records, ids) =>
                  onChange({
                    ...draft,
                    domainPresentations: records,
                    collections: draft.collections.map((v) =>
                      v.id === c.id ? { ...v, domainIds: ids } : v,
                    ),
                  })
                }
              />
            )}
            <button
              onClick={() =>
                onChange({
                  ...draft,
                  collections: draft.collections.filter((v) => v.id !== c.id),
                  homepage: {
                    ...draft.homepage,
                    collectionIds: draft.homepage.collectionIds.filter(
                      (id) => id !== c.id,
                    ),
                  },
                })
              }
            >
              Remove collection
            </button>
          </div>
        ))}
        <button
          disabled={draft.collections.length >= 50}
          onClick={() => {
            const id = `collection-${crypto.randomUUID()}`;
            onChange({
              ...draft,
              collections: [
                ...draft.collections,
                {
                  id,
                  slug: id,
                  title: 'New collection',
                  intro: '',
                  domainIds: [],
                },
              ],
            });
          }}
        >
          Add collection
        </button>
      </section>
      <section hidden={section === 'domains'}>
        <h2>Projects</h2>
        <p>
          Show what you are building. Links and project descriptions are your
          claims; adding a domain requires the same ownership check as a
          collection.
        </p>
        {draft.projects.map((p) => (
          <div className="os-section" key={p.id}>
            <div className="os-fields">
              <label>
                Project title
                <input
                  maxLength={100}
                  value={p.title}
                  onChange={(e) =>
                    onChange({
                      ...draft,
                      projects: draft.projects.map((v) =>
                        v.id === p.id ? { ...v, title: e.target.value } : v,
                      ),
                    })
                  }
                />
              </label>
              <label>
                Project HTTPS link
                <input
                  type="url"
                  value={p.url}
                  onChange={(e) =>
                    onChange({
                      ...draft,
                      projects: draft.projects.map((v) =>
                        v.id === p.id ? { ...v, url: e.target.value } : v,
                      ),
                    })
                  }
                />
              </label>
              <label>
                Project description
                <textarea
                  maxLength={600}
                  value={p.description}
                  onChange={(e) =>
                    onChange({
                      ...draft,
                      projects: draft.projects.map((v) =>
                        v.id === p.id
                          ? { ...v, description: e.target.value }
                          : v,
                      ),
                    })
                  }
                />
              </label>
            </div>
            {orderControls('projectIds', p.id)}
            <SelectionOrder
              draft={draft}
              ids={p.domainIds}
              onChange={(ids) =>
                onChange({
                  ...draft,
                  projects: draft.projects.map((v) =>
                    v.id === p.id ? { ...v, domainIds: ids } : v,
                  ),
                })
              }
            />
            <button onClick={() => setPicker(picker === p.id ? null : p.id)}>
              Select project domains (optional)
            </button>
            {picker === p.id && (
              <DomainPicker
                draft={draft}
                review={review}
                selected={p.domainIds}
                onChange={(records, ids) =>
                  onChange({
                    ...draft,
                    domainPresentations: records,
                    projects: draft.projects.map((v) =>
                      v.id === p.id ? { ...v, domainIds: ids } : v,
                    ),
                  })
                }
              />
            )}
            <button
              onClick={() =>
                onChange({
                  ...draft,
                  projects: draft.projects.filter((v) => v.id !== p.id),
                  homepage: {
                    ...draft.homepage,
                    projectIds: draft.homepage.projectIds.filter(
                      (id) => id !== p.id,
                    ),
                  },
                })
              }
            >
              Remove project
            </button>
          </div>
        ))}
        <button
          disabled={draft.projects.length >= 50}
          onClick={() =>
            onChange({
              ...draft,
              projects: [
                ...draft.projects,
                {
                  id: `project-${crypto.randomUUID()}`,
                  title: 'New project',
                  description: '',
                  url: '',
                  domainIds: [],
                },
              ],
            })
          }
        >
          Add project
        </button>
      </section>
      <section hidden={section === 'domains'}>
        <h2>Optional catalogue</h2>
        <label className="os-check">
          <input
            type="checkbox"
            checked={draft.catalogue.enabled}
            onChange={(e) =>
              onChange({
                ...draft,
                catalogue: { ...draft.catalogue, enabled: e.target.checked },
              })
            }
          />
          Let visitors browse selected holdings
        </label>
        <p>Off by default. New inventory is never selected automatically.</p>
        {draft.catalogue.enabled && (
          <>
            <SelectionOrder
              draft={draft}
              ids={draft.catalogue.domainIds}
              onChange={(ids) =>
                onChange({
                  ...draft,
                  catalogue: { ...draft.catalogue, domainIds: ids },
                })
              }
            />
            <button
              onClick={() =>
                setPicker(picker === 'catalogue' ? null : 'catalogue')
              }
            >
              Select catalogue domains
            </button>
            {picker === 'catalogue' && (
              <DomainPicker
                draft={draft}
                review={review}
                selected={draft.catalogue.domainIds}
                onChange={(records, ids) =>
                  onChange({
                    ...draft,
                    domainPresentations: records,
                    catalogue: { ...draft.catalogue, domainIds: ids },
                  })
                }
              />
            )}
          </>
        )}
      </section>
      <section hidden={section === 'collections'}>
        <h2>Domain details</h2>
        <p>
          One availability and price per domain, shared across every collection.
          Adding details alone does not include a domain on your site.
        </p>
        <label>
          Find a domain to edit
          <input
            type="search"
            value={domainQuery}
            onChange={(e) => {
              setDomainQuery(e.target.value);
              setDomainPage(1);
            }}
          />
        </label>
        {domainRows.slice((domainPage - 1) * 30, domainPage * 30).map((d) => (
          <details className="os-section" key={d.id}>
            <summary>
              {d.domain} ·{' '}
              {d.ownership === 'historical'
                ? 'Previously owned'
                : d.availability === 'inquiries'
                  ? 'Open to inquiries'
                  : 'Not accepting inquiries'}
            </summary>
            {draft.version === 3 &&
              draft.salesLinks
                .filter((l) => l.presentationId === d.id)
                .map((l) => (
                  <p key={l.listingId}>
                    Commercial terms come only from the reviewed{' '}
                    <Link to={`/sales/listings/${l.listingId}`}>
                      domain inquiry page
                    </Link>
                    .{' '}
                    <button
                      type="button"
                      onClick={() =>
                        onChange({
                          ...draft,
                          salesLinks: draft.salesLinks.filter(
                            (v) => v.presentationId !== d.id,
                          ),
                          domainPresentations: draft.domainPresentations.map(
                            (v) =>
                              v.id === d.id
                                ? {
                                    ...v,
                                    availability: 'not-for-sale',
                                    askingPrice: null,
                                  }
                                : v,
                          ),
                        })
                      }
                    >
                      Remove Sales link in this draft
                    </button>
                  </p>
                ))}
            <div className="os-fields">
              <label>
                Ownership assertion
                <select
                  value={d.ownership}
                  onChange={(e) =>
                    onChange({
                      ...draft,
                      domainPresentations: draft.domainPresentations.map((v) =>
                        v.id === d.id
                          ? {
                              ...v,
                              ownership: e.target.value as
                                'current' | 'historical',
                              availability: 'not-for-sale',
                              askingPrice: null,
                            }
                          : v,
                      ),
                    })
                  }
                >
                  <option value="current">
                    Current holding — fresh check required
                  </option>
                  <option value="historical">
                    Previously owned — I assert past ownership
                  </option>
                </select>
              </label>
              <label>
                Availability
                <select
                  value={d.availability}
                  disabled={d.ownership === 'historical'}
                  onChange={(e) =>
                    onChange({
                      ...draft,
                      domainPresentations: draft.domainPresentations.map((v) =>
                        v.id === d.id
                          ? {
                              ...v,
                              availability: e.target.value as
                                'not-for-sale' | 'inquiries',
                              askingPrice: null,
                            }
                          : v,
                      ),
                    })
                  }
                >
                  <option value="not-for-sale">Not accepting inquiries</option>
                  <option value="inquiries">Open to inquiries</option>
                </select>
              </label>
              <label>
                Domain description
                <textarea
                  maxLength={400}
                  value={d.description}
                  onChange={(e) =>
                    onChange({
                      ...draft,
                      domainPresentations: draft.domainPresentations.map((v) =>
                        v.id === d.id
                          ? { ...v, description: e.target.value }
                          : v,
                      ),
                    })
                  }
                />
              </label>
              {d.availability === 'inquiries' && (
                <>
                  <label>
                    Asking price (optional)
                    <input
                      disabled={
                        draft.version === 3 &&
                        draft.salesLinks.some((l) => l.presentationId === d.id)
                      }
                      type="number"
                      min="0.01"
                      step="any"
                      value={d.askingPrice ?? ''}
                      onChange={(e) =>
                        onChange({
                          ...draft,
                          domainPresentations: draft.domainPresentations.map(
                            (v) =>
                              v.id === d.id
                                ? {
                                    ...v,
                                    askingPrice: e.target.value
                                      ? Number(e.target.value)
                                      : null,
                                  }
                                : v,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    Currency
                    <input
                      maxLength={3}
                      value={d.currency}
                      onChange={(e) =>
                        onChange({
                          ...draft,
                          domainPresentations: draft.domainPresentations.map(
                            (v) =>
                              v.id === d.id
                                ? {
                                    ...v,
                                    currency: e.target.value.toUpperCase(),
                                  }
                                : v,
                          ),
                        })
                      }
                    />
                  </label>
                </>
              )}
            </div>
          </details>
        ))}
        {domainRows.length > 30 && (
          <div className="os-actions">
            <button
              disabled={domainPage === 1}
              onClick={() => setDomainPage(domainPage - 1)}
            >
              Previous details
            </button>
            <button
              disabled={domainPage * 30 >= domainRows.length}
              onClick={() => setDomainPage(domainPage + 1)}
            >
              Next details
            </button>
          </div>
        )}
        <details>
          <summary>Add a previously owned name</summary>
          <p>
            This is your explicit assertion of past ownership. It does not mean
            the domain was sold and enables no inquiries.
          </p>
          <label>
            Previously owned domain
            <input
              value={history}
              onChange={(e) => setHistory(e.target.value)}
            />
          </label>
          <button
            onClick={() => {
              try {
                const domain = canonicalDomain(history);
                if (draft.domainPresentations.some((d) => d.domain === domain))
                  throw new Error('This name already has domain details.');
                onChange({
                  ...draft,
                  domainPresentations: [
                    ...draft.domainPresentations,
                    {
                      id: `domain-${crypto.randomUUID()}`,
                      domain,
                      ownership: 'historical',
                      availability: 'not-for-sale',
                      description: '',
                      askingPrice: null,
                      currency: 'USD',
                    },
                  ],
                });
                setHistory('');
                setError('');
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            I previously owned this name — add to draft
          </button>
          {error && <p role="alert">{error}</p>}
        </details>
      </section>
    </>
  );
}
