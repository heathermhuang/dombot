import { InventoryPicker } from './InventoryPicker';
import type {
  DomainPresentation,
  OwnerSiteDraft,
} from '../../../shared/owner-site';
import type { ReconciledListing } from '../../../shared/publication';

export function DomainPicker({
  draft,
  selected,
  onChange,
}: {
  draft: OwnerSiteDraft;
  review: ReconciledListing[];
  selected: string[];
  onChange: (records: DomainPresentation[], ids: string[]) => void;
}) {
  const byDomain = new Map(draft.domainPresentations.map((d) => [d.domain, d]));
  return (
    <InventoryPicker
      selected={draft.domainPresentations
        .filter((d) => selected.includes(d.id))
        .map((d) => d.domain)}
      onChange={(names) => {
        const added = names
          .filter((n) => !byDomain.has(n))
          .map((domain) => ({
            id: `domain-${crypto.randomUUID()}`,
            domain,
            ownership: 'current' as const,
            availability: 'not-for-sale' as const,
            description: '',
            askingPrice: null,
            currency: 'USD',
          }));
        const records = [...draft.domainPresentations, ...added];
        onChange(
          records,
          names.map((n) => records.find((d) => d.domain === n)!.id),
        );
      }}
    />
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
