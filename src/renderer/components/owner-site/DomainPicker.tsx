import { useState } from 'react';
import type {
  DomainPresentation,
  OwnerSiteDraft,
} from '../../../shared/owner-site';
import type { ReconciledListing } from '../../../shared/publication';

export function DomainPicker({
  draft,
  review,
  selected,
  onChange,
}: {
  draft: OwnerSiteDraft;
  review: ReconciledListing[];
  selected: string[];
  onChange: (records: DomainPresentation[], ids: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const records = new Map(draft.domainPresentations.map((d) => [d.domain, d]));
  const names = [
    ...new Set([...records.keys(), ...review.map((d) => d.domain)]),
  ]
    .filter((v) => v.includes(query.toLowerCase()))
    .sort();
  const checks = new Map(review.map((v) => [v.domain, v.ownership]));
  return (
    <div className="os-picker">
      <label>
        Find domains in your private portfolio
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
      </label>
      <p>
        Only checked names enter this selection. Availability is set under
        Domain details.
      </p>
      {names.slice((page - 1) * 60, page * 60).map((name) => {
        const d = records.get(name);
        const checked = !!d && selected.includes(d.id);
        return (
          <label className="os-check" key={name}>
            <input
              type="checkbox"
              checked={checked}
              onChange={() => {
                const record =
                  d ??
                  ({
                    id: `domain-${crypto.randomUUID()}`,
                    domain: name,
                    ownership: 'current',
                    availability: 'not-for-sale',
                    description: '',
                    askingPrice: null,
                    currency: 'USD',
                  } satisfies DomainPresentation);
                onChange(
                  d
                    ? draft.domainPresentations
                    : [...draft.domainPresentations, record],
                  checked
                    ? selected.filter((id) => id !== record.id)
                    : [...selected, record.id],
                );
              }}
            />
            <span>
              {name}
              <small>
                {d?.ownership === 'historical'
                  ? 'Previously owned · owner assertion'
                  : checks.get(name) === 'owned'
                    ? 'Fresh ownership check'
                    : 'Sync or ownership check needed'}
              </small>
            </span>
          </label>
        );
      })}
      {!names.length && (
        <p>
          No matching names. A profile-only site needs no registrar connection.
        </p>
      )}
      <div className="os-actions">
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>
          Previous
        </button>
        <span>
          Page {page} of {Math.max(1, Math.ceil(names.length / 60))}
        </span>
        <button
          disabled={page * 60 >= names.length}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
export function SelectionOrder({
  draft,
  ids,
  onChange,
}: {
  draft: OwnerSiteDraft;
  ids: string[];
  onChange: (ids: string[]) => void;
}) {
  const names = new Map(draft.domainPresentations.map((d) => [d.id, d.domain]));
  return (
    <ol className="os-order">
      {ids.map((id, index) => (
        <li key={id}>
          <span>{names.get(id) ?? 'Missing domain'}</span>
          <button
            aria-label={`Move ${names.get(id)} up`}
            disabled={!index}
            onClick={() => {
              const next = [...ids];
              [next[index - 1], next[index]] = [next[index], next[index - 1]];
              onChange(next);
            }}
          >
            ↑
          </button>
          <button
            aria-label={`Move ${names.get(id)} down`}
            disabled={index === ids.length - 1}
            onClick={() => {
              const next = [...ids];
              [next[index + 1], next[index]] = [next[index], next[index + 1]];
              onChange(next);
            }}
          >
            ↓
          </button>
          <button
            onClick={() => onChange(ids.filter((v) => v !== id))}
            aria-label={`Remove ${names.get(id)} from selection`}
          >
            Remove
          </button>
        </li>
      ))}
    </ol>
  );
}
