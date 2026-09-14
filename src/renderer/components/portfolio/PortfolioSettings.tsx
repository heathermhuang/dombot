import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { PortfolioIssue } from '../../../shared/portfolio-validation';
import type { PortfolioDraft } from '../../../shared/publication';
export function PortfolioSettings({
  draft,
  onChange,
  publicUrl,
  issues,
}: {
  draft: PortfolioDraft;
  onChange: (patch: Partial<PortfolioDraft>) => void;
  publicUrl: string;
  issues: PortfolioIssue[];
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
            id="pf-field-title"
            aria-describedby={
              issues.some((issue) => issue.field === 'title')
                ? 'pf-error-title'
                : undefined
            }
            aria-invalid={issues.some((issue) => issue.field === 'title')}
            value={draft.title}
            maxLength={100}
            onChange={(e) => onChange({ title: e.target.value })}
          />
          {issues
            .filter((issue) => issue.field === 'title')
            .map((issue) => (
              <span
                id="pf-error-title"
                key={issue.field}
                className="pf-warning"
              >
                {issue.message}
              </span>
            ))}
        </label>
        <label className="pf-field">
          Introduction
          <Textarea
            id="pf-field-intro"
            aria-describedby={
              issues.some((issue) => issue.field === 'intro')
                ? 'pf-error-intro'
                : undefined
            }
            aria-invalid={issues.some((issue) => issue.field === 'intro')}
            value={draft.intro}
            maxLength={600}
            rows={4}
            placeholder="A few words about your collection."
            onChange={(e) => onChange({ intro: e.target.value })}
          />
          {issues
            .filter((issue) => issue.field === 'intro')
            .map((issue) => (
              <span
                id="pf-error-intro"
                key={issue.field}
                className="pf-warning"
              >
                {issue.message}
              </span>
            ))}
        </label>
        <label className="pf-field">
          Public inquiry email
          <Input
            type="email"
            id="pf-field-contactEmail"
            aria-describedby={
              issues.some((issue) => issue.field === 'contactEmail')
                ? 'pf-error-contactEmail'
                : undefined
            }
            aria-invalid={issues.some(
              (issue) => issue.field === 'contactEmail',
            )}
            value={draft.contactEmail}
            placeholder="you@example.com"
            onChange={(e) => onChange({ contactEmail: e.target.value })}
          />
          {issues
            .filter((issue) => issue.field === 'contactEmail')
            .map((issue) => (
              <span
                id="pf-error-contactEmail"
                key={issue.field}
                className="pf-warning"
              >
                {issue.message}
              </span>
            ))}
          <span className="pf-hint">
            Used for the domains where you accept inquiries.
          </span>
        </label>
        <section className="pf-evidence">
          <h3>Public address</h3>
          <label className="pf-field mt-4">
            Link name
            <Input
              id="pf-field-handle"
              aria-describedby={
                issues.some((issue) => issue.field === 'handle')
                  ? 'pf-error-handle'
                  : undefined
              }
              aria-invalid={issues.some((issue) => issue.field === 'handle')}
              value={draft.handle}
              maxLength={40}
              onChange={(e) =>
                onChange({ handle: e.target.value.toLowerCase() })
              }
            />
            {issues
              .filter((issue) => issue.field === 'handle')
              .map((issue) => (
                <span
                  id="pf-error-handle"
                  key={issue.field}
                  className="pf-warning"
                >
                  {issue.message}
                </span>
              ))}
          </label>
          <p className="break-all">{publicUrl}</p>
          <p>
            Changing the link name removes the previous address when you
            publish.
          </p>
        </section>
      </div>
    </div>
  );
}
