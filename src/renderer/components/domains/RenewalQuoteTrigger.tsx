import { useRef, useState, type ReactNode } from 'react';
import type { DomainTarget, RenewalPricing } from '../../../shared/ipc';
import { formatMoneyNumber, type NumberFormatId } from '../../../shared/money';
import { observationLabel } from '../../../shared/renewal-price-age';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

/** Checks only when the estimate is opened, leaving the saved figure intact. */
export function RenewalQuoteTrigger({
  target,
  estimate,
  title,
  numberFormat,
  children,
}: {
  target: DomainTarget;
  estimate: string;
  title: string;
  numberFormat: NumberFormatId;
  children: ReactNode;
}) {
  const [quote, setQuote] = useState<RenewalPricing | null>();
  const pending = useRef(false);

  async function checkQuote(open: boolean) {
    if (!open || pending.current) return;
    pending.current = true;
    setQuote(undefined);
    try {
      setQuote(await window.api.getRegistrarRenewalQuote(target));
    } catch {
      setQuote(null);
    } finally {
      pending.current = false;
    }
  }

  return (
    <Popover onOpenChange={checkQuote}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="rounded-sm text-left font-medium tabular-nums underline decoration-dotted underline-offset-2 hover:text-primary focus-visible:outline-2"
          title={`Check current registrar quote. ${title}`}
          aria-label={`Check current renewal quote for ${target.domainName}. Estimate ${estimate}`}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label={`Renewal quote for ${target.domainName}`}
        className="w-64 text-sm"
      >
        <p className="font-medium">Registrar renewal quote</p>
        <div role="status" className="mt-1">
          {quote === undefined ? (
            <p>Checking registrar…</p>
          ) : quote?.renewal != null ? (
            <>
              <p className="font-semibold tabular-nums">
                {formatMoneyNumber(
                  quote.renewal,
                  quote.currency,
                  '',
                  numberFormat,
                )}{' '}
                per year
              </p>
              <p className="text-xs text-muted-foreground">
                Checked {observationLabel(quote.observedAt)}
              </p>
            </>
          ) : (
            <p>No current quote available for this domain.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
