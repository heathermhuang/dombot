import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { PortfolioDraft } from '../../../shared/publication';
export function PortfolioSettings({
  draft,
  onChange,
  publicUrl,
}: {
  draft: PortfolioDraft;
  onChange: (patch: Partial<PortfolioDraft>) => void;
  publicUrl: string;
}) {
  return (
    <div className="pf-settings">
      <div>
        <h2>Make it yours</h2>
        <p className="pf-subtitle">
          The identity and contact details visitors see.
        </p>
      </div>
      <div className="pf-settings-form">
        <label className="pf-field">
          Portfolio name
          <Input
            value={draft.title}
            maxLength={100}
            onChange={(e) => onChange({ title: e.target.value })}
          />
        </label>
        <label className="pf-field">
          Introduction
          <Textarea
            value={draft.intro}
            maxLength={600}
            rows={4}
            placeholder="A few words about your collection."
            onChange={(e) => onChange({ intro: e.target.value })}
          />
        </label>
        <label className="pf-field">
          Public inquiry email
          <Input
            type="email"
            value={draft.contactEmail}
            placeholder="you@example.com"
            onChange={(e) => onChange({ contactEmail: e.target.value })}
          />
          <span className="pf-hint">
            Used for the domains where you accept inquiries.
          </span>
        </label>
        <details className="pf-evidence">
          <summary>Public address</summary>
          <label className="pf-field mt-4">
            Link name
            <Input
              value={draft.handle}
              maxLength={40}
              onChange={(e) =>
                onChange({ handle: e.target.value.toLowerCase() })
              }
            />
          </label>
          <p className="break-all">{publicUrl}</p>
          <p>
            Changing the link name removes the previous address when you
            publish.
          </p>
        </details>
      </div>
    </div>
  );
}
