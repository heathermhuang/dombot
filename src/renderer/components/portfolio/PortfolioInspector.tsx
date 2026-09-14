import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  currencies,
  type PortfolioIssue,
} from '../../../shared/portfolio-validation';
import type {
  PortfolioListing,
  ReconciledListing,
} from '../../../shared/publication';

export const visibilityLabel = {
  private: 'Not on page',
  showcase: 'Display only',
  inquiry: 'Inquiries on',
  historical: 'Previously owned',
};
export const ownershipLabel = {
  owned: 'Ready for publication',
  stale: 'Verification is stale or the last sync failed',
  unmatched: 'Connect the registrar that holds this name',
  conflict: 'Resolve duplicate account records',
};
export function PortfolioInspector({
  item,
  check,
  onClose,
  onChange,
  onHistory,
  issues,
  onResolve,
  saveStatus,
  error,
}: {
  item: PortfolioListing | null;
  check?: ReconciledListing;
  onClose: () => void;
  onChange: (patch: Partial<PortfolioListing>) => void;
  onHistory: () => void;
  issues: PortfolioIssue[];
  onResolve: () => void;
  saveStatus: string;
  error: string;
}) {
  return (
    <Dialog
      open={!!item}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="pf-drawer inset-y-0 right-0 left-auto block h-dvh max-w-full translate-x-0 translate-y-0 overflow-y-auto rounded-none border-y-0 border-r-0 p-0 sm:max-w-[28rem]">
        {item && (
          <>
            <div className="pf-drawer-head">
              <span className="pf-eyebrow">Domain details</span>
              <DialogTitle className="mt-3 break-all text-2xl tracking-tight">
                {item.domain}
              </DialogTitle>
              <DialogDescription className="mt-2">
                {ownershipLabel[check?.ownership ?? 'unmatched']}
              </DialogDescription>
            </div>
            <div className="pf-drawer-body">
              {check?.ownership !== 'owned' &&
                item.visibility !== 'historical' && (
                  <div className="pf-note">
                    <p>
                      {check?.accountLabels.join(', ') ||
                        'No connected account matches this domain.'}
                    </p>
                    <p>
                      {check?.lastSyncedAt
                        ? `Last successful sync: ${new Date(check.lastSyncedAt).toLocaleString()}`
                        : 'No successful sync recorded.'}
                    </p>
                    <Button variant="outline" onClick={onResolve}>
                      {check?.ownership === 'stale'
                        ? 'Refresh verification'
                        : check?.ownership === 'conflict'
                          ? 'Resolve account conflict'
                          : 'Connect registrar'}
                    </Button>
                  </div>
                )}

              <label className="pf-field">
                On your public page
                {item.visibility === 'historical' ? (
                  <div className="pf-note">Previously owned · no inquiries</div>
                ) : (
                  <select
                    aria-label={`Availability for ${item.domain}`}
                    value={item.visibility}
                    onChange={(e) =>
                      onChange({
                        visibility: e.target
                          .value as PortfolioListing['visibility'],
                      })
                    }
                  >
                    <option value="private">Not on page</option>
                    <option
                      value="showcase"
                      disabled={!check || check.ownership === 'unmatched'}
                    >
                      Display only
                    </option>
                    <option
                      value="inquiry"
                      disabled={!check || check.ownership === 'unmatched'}
                    >
                      Accept inquiries
                    </option>
                  </select>
                )}
              </label>
              <label className="pf-field">
                Collections
                <Input
                  aria-label={`Collections for ${item.domain}`}
                  value={item.collection}
                  maxLength={200}
                  placeholder="e.g. Short names; AI"
                  onChange={(e) => onChange({ collection: e.target.value })}
                />
                <span className="pf-hint">
                  Use a semicolon to place a name in more than one collection.
                </span>
              </label>
              <label className="pf-field">
                Public description
                <Textarea
                  aria-label={`Description for ${item.domain}`}
                  value={item.description}
                  rows={4}
                  maxLength={400}
                  placeholder="What makes this name interesting?"
                  onChange={(e) => onChange({ description: e.target.value })}
                />
                <span className="pf-hint">{item.description.length}/400</span>
              </label>
              {item.visibility !== 'historical' && (
                <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
                  <label className="pf-field">
                    Asking price{' '}
                    {item.visibility !== 'inquiry' ? '(not public)' : ''}
                    <Input
                      aria-label={`Asking price for ${item.domain}`}
                      id="pf-field-askingPrice"
                      aria-invalid={issues.some(
                        (issue) => issue.field === 'askingPrice',
                      )}
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={item.askingPrice ?? ''}
                      placeholder="On request"
                      onChange={(e) =>
                        onChange({
                          askingPrice: e.target.value
                            ? Number(e.target.value)
                            : null,
                        })
                      }
                    />
                    {issues
                      .filter((issue) => issue.field === 'askingPrice')
                      .map((issue) => (
                        <span key={issue.field} className="pf-warning">
                          {issue.message}
                        </span>
                      ))}
                  </label>
                  <label className="pf-field">
                    Currency
                    <select
                      id="pf-field-currency"
                      aria-label={`Currency for ${item.domain}`}
                      value={item.currency}
                      onChange={(e) => onChange({ currency: e.target.value })}
                    >
                      {[...new Set([...currencies, item.currency])].map(
                        (currency) => (
                          <option key={currency} value={currency}>
                            {currency}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <p className="pf-hint col-span-2">
                    Prices appear only when inquiries are on. Renewal costs are
                    never published.
                  </p>
                </div>
              )}
              {check?.accountLabels.length ? (
                <details className="pf-evidence">
                  <summary>Registrar evidence</summary>
                  <p>{check.accountLabels.join(', ')}</p>
                  <p>
                    {check.lastSyncedAt
                      ? `Last synced ${new Date(check.lastSyncedAt).toLocaleString()}`
                      : 'No recent sync'}
                  </p>
                </details>
              ) : null}
              {item.visibility === 'private' && (
                <button
                  type="button"
                  className="pf-text-button"
                  onClick={onHistory}
                >
                  Add as previously owned…
                </button>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
            <div className="pf-drawer-foot">
              <span role="status" className="pf-hint">
                {saveStatus}
              </span>
              <Button onClick={onClose}>Done</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
