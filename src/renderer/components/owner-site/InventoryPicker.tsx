import { useEffect, useState } from 'react';
import type { PresencePage } from '../../../shared/publishing-presence';
import { publicationRequest } from '../../lib/publication-client';

/** Shared, controlled selection. Filtering and paging never replace the tray. */
export function InventoryPicker({
  selected,
  onChange,
  limit = 20000,
}: {
  selected: string[];
  onChange: (names: string[]) => void;
  limit?: number;
}) {
  const [q, setQ] = useState(''),
    [tld, setTld] = useState(''),
    [account, setAccount] = useState(''),
    [status, setStatus] = useState(''),
    [cursor, setCursor] = useState('');
  const [data, setData] = useState<PresencePage | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [paste, setPaste] = useState(''),
    [notice, setNotice] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const timer = setTimeout(() => {
      void publicationRequest<PresencePage>(
        `/presence?${new URLSearchParams({ q, tld, account, status, cursor })}`,
        'GET',
        undefined,
        controller.signal,
      )
        .then(setData)
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, tld, account, status, cursor]);
  const choose = (names: string[]) => {
    if (names.length > limit) {
      setNotice(`Choose at most ${limit} names for this batch.`);
      return;
    }
    onChange(names);
    setNotice('');
  };
  const add = (names: string[]) =>
    choose([...new Set([...selected, ...names])]);
  return (
    <div className="os-picker">
      <label>
        Find domains
        <input
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setCursor('');
          }}
        />
      </label>
      <div className="os-fields">
        <label>
          TLD
          <input
            value={tld}
            onChange={(e) => {
              setTld(e.target.value.toLowerCase().replace(/^\./, ''));
              setCursor('');
            }}
          />
        </label>
        <label>
          Registrar or account
          <input
            value={account}
            onChange={(e) => {
              setAccount(e.target.value);
              setCursor('');
            }}
          />
        </label>
        <label>
          Control status
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setCursor('');
            }}
          >
            <option value="">All</option>
            <option value="owned">Fresh control observation</option>
            <option value="stale">Needs refresh</option>
            <option value="unmatched">Imported or unmatched</option>
            <option value="conflict">Conflicting records</option>
          </select>
        </label>
      </div>
      <p>
        Choose exact names. Selection stays in this tab across searches and
        pages; saved drafts are recovered separately.
      </p>
      <p role="status">
        {loading ? 'Loading inventory…' : `${selected.length} selected`}
      </p>
      {error && <p role="alert">{error}</p>}
      <div
        className="os-picker-results"
        role="region"
        aria-label="Inventory results"
        tabIndex={0}
      >
        {!loading &&
          !error &&
          data?.items.map((r) => (
            <label className="os-check" key={r.domain}>
              <input
                type="checkbox"
                checked={selected.includes(r.domain)}
                onChange={(e) =>
                  choose(
                    e.target.checked
                      ? [...selected, r.domain]
                      : selected.filter((n) => n !== r.domain),
                  )
                }
              />
              <span>
                {r.domain}
                <small>
                  {r.inventory.status} ·{' '}
                  {r.profile.state === 'unknown'
                    ? 'Profile unknown'
                    : r.profile.value.publishedSelected
                      ? 'On profile'
                      : 'Off profile'}{' '}
                  ·{' '}
                  {r.sales.state === 'unknown'
                    ? 'Domain page unknown'
                    : r.sales.value.publishedRevision
                      ? 'Domain page published'
                      : 'No public domain page'}
                </small>
              </span>
            </label>
          ))}
      </div>
      <div className="os-actions">
        <button
          type="button"
          disabled={loading || !!error || !data?.items.length}
          onClick={() => add(data!.items.map((r) => r.domain))}
        >
          Select visible
        </button>
        <button
          type="button"
          disabled={!cursor || loading}
          onClick={() => setCursor('')}
        >
          First page
        </button>
        <button
          type="button"
          disabled={!data?.cursor || loading}
          onClick={() => setCursor(data!.cursor!)}
        >
          Next page
        </button>
      </div>
      <details>
        <summary>Paste exact names</summary>
        <label>
          Up to 100 names, separated by spaces or commas
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} />
        </label>
        <button
          type="button"
          onClick={() => {
            const names = paste
              .trim()
              .split(/[\s,;]+/)
              .filter(Boolean);
            if (!names.length || names.length > 100) {
              setNotice('Paste between 1 and 100 names.');
              return;
            }
            void publicationRequest<PresencePage>(
              `/presence?names=${encodeURIComponent(JSON.stringify(names))}`,
            )
              .then((r) => {
                add(r.items.map((v) => v.domain));
                setNotice(
                  `${r.items.length} known names; ${names.length - new Set(names).size} duplicates.${r.unknownNames.length ? ` Unknown: ${r.unknownNames.join(', ')}` : ''}`,
                );
              })
              .catch((e) => setNotice(e.message));
          }}
        >
          Check and select known names
        </button>
      </details>
      <details open={selected.length > 0}>
        <summary>Selected names · {selected.length}</summary>
        <ul>
          {selected.map((name) => (
            <li key={name}>
              {name}{' '}
              <button
                type="button"
                aria-label={`Remove ${name} from selection`}
                onClick={() => choose(selected.filter((n) => n !== name))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          disabled={!selected.length}
          onClick={() => choose([])}
        >
          Clear selection
        </button>
      </details>
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}
