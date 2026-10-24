import { Fragment, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { SalesReview } from '../../../shared/sales-review';
import type { PublishedSale } from '../../../shared/sales';
import {
  salesRequest,
  useSalesAction,
  useSalesData,
} from '../../lib/sales-client';
import { hostPath } from '../../lib/platform';
import {
  SalesShell,
  SalesFeedback,
  salePriceLabel,
  saleModeLabel,
} from './shared';

const terms = (s: PublishedSale | null) =>
  s
    ? [
        s.domain,
        salePriceLabel(s.publicPrice),
        saleModeLabel(s.mode),
        s.description || '—',
        s.sellerDisplayName || '—',
        s.destination
          ? `${s.destination.provider}: ${s.destination.url}`
          : 'Direct inquiry',
        s.displayName,
        s.publicMinimumOffer ? salePriceLabel(s.publicMinimumOffer) : 'None',
        s.allowQuestions ? 'Questions enabled' : 'Questions disabled',
        s.categories.join(', ') || 'None',
      ]
    : Array(10).fill('Not published');
export default function PublicationReview() {
  const { jobId, reviewId } = useParams();
  return <PublicationReviewView key={jobId ?? reviewId} />;
}
function PublicationReviewView() {
  const { reviewId = '', jobId = '' } = useParams(),
    review = useSalesData<SalesReview & { digest?: string }>(
      jobId ? `/jobs/${jobId}/review` : `/reviews/${reviewId}`,
    ),
    action = useSalesAction();
  const [receipt, setReceipt] = useReceiptState(),
    [page, setPage] = useState(0);
  useEffect(() => {
    setReceipt(null);
    setPage(0);
  }, [reviewId, jobId, setReceipt]);
  return (
    <SalesShell>
      <Link className="link" to="/sales">
        ← Sales pages
      </Link>
      <div className="sales-heading">
        <div>
          <p className="sales-kicker">SALES / PUBLICATION REVIEW</p>
          <h1>Review exactly what goes public.</h1>
          <p className="small">
            Kept private: floors, acquisition and renewal costs, notes,
            credentials, and buyer records.
          </p>
        </div>
        <button
          className="primary"
          disabled={!review.data || action.busy || !!receipt}
          onClick={() =>
            void action.run(async () => {
              if (jobId) {
                const result = await commitBulkPublication(
                  jobId,
                  review.data!.digest!,
                  action.setNotice,
                );
                setReceipt(result);
                return;
              }
              const r = await salesRequest<{
                items: { id: string; domain: string; revision: string }[];
                message: string;
              }>('/publications', 'POST', { reviewId });
              setReceipt(r);
            })
          }
        >
          Publish {review.data?.items.length ?? ''} reviewed{' '}
          {review.data?.items.length === 1 ? 'sales page' : 'changes'}
        </button>
      </div>
      <SalesFeedback
        error={review.error || action.error}
        loading={action.busy}
        notice={action.notice}
        retry={() => void review.reload()}
      />
      {receipt && (
        <section role="status">
          <h2>Publication results</h2>
          <p>{receipt.message}</p>
          {receipt.failures?.map((f) => (
            <p key={f.id}>
              <Link className="link" to={`/sales/listings/${f.id}`}>
                Review sales page
              </Link>{' '}
              · {f.error}
            </p>
          ))}
          {receipt.items.map((r) => (
            <p key={r.id}>
              <a
                className="link"
                href={hostPath(`/d/${r.domain}`)}
                target="_blank"
                rel="noreferrer"
              >
                Open {r.domain}
              </a>
              <span className="small"> · revision {r.revision}</span>
            </p>
          ))}
        </section>
      )}
      {review.data && (
        <>
          <p className="small">
            Review expires {new Date(review.data.expiresAt).toLocaleString()}.
            Price, draft, control and destination revisions are checked again
            when you publish.
          </p>
          {review.data.items.length > 100 && (
            <div className="sales-toolbar">
              <button
                disabled={page === 0}
                onClick={() => setPage((v) => v - 1)}
              >
                Previous review batch
              </button>
              <span>
                {page * 100 + 1}–
                {Math.min((page + 1) * 100, review.data.items.length)} of{' '}
                {review.data.items.length} exact reviewed names
              </span>
              <button
                disabled={(page + 1) * 100 >= review.data.items.length}
                onClick={() => setPage((v) => v + 1)}
              >
                Next review batch
              </button>
            </div>
          )}
          <div className="sales-review-list">
            {review.data.items
              .slice(page * 100, (page + 1) * 100)
              .map((item) => (
                <section key={item.id}>
                  <h2>{item.after.domain}</h2>
                  <dl>
                    <dt>Public field</dt>
                    <dd>
                      <strong>Before</strong>
                    </dd>
                    <dd>
                      <strong>After</strong>
                    </dd>
                    {[
                      'Domain',
                      'Public price',
                      'Sale mode',
                      'Description',
                      'Seller name',
                      'Destination',
                      'Display name',
                      'Minimum offer',
                      'Questions',
                      'Categories',
                    ].map((label, i) => (
                      <ReviewRow
                        key={label}
                        label={label}
                        before={terms(item.before)[i]}
                        after={terms(item.after)[i]}
                      />
                    ))}
                    <ReviewRow
                      label="Shop inclusion"
                      before={item.beforeIncludeInShop ? 'Included' : 'Omitted'}
                      after={
                        item.includeInShop
                          ? 'Include this domain'
                          : 'Omit this domain'
                      }
                    />
                  </dl>
                  <details>
                    <summary>Review inputs</summary>
                    <p className="small">
                      Draft revision: {item.revision}
                      <br />
                      Source price fingerprint: {item.priceFingerprint}
                      <br />
                      Control observed:{' '}
                      {new Date(item.controlObservedAt).toLocaleString()}
                      <br />
                      Destination revision: {item.destinationRevision ?? 'None'}
                    </p>
                  </details>
                </section>
              ))}
          </div>
        </>
      )}
    </SalesShell>
  );
}
function ReviewRow({
  label,
  before,
  after,
}: {
  label: string;
  before: string;
  after: string;
}) {
  return (
    <Fragment>
      <dt>{label}</dt>
      <dd>{before}</dd>
      <dd>{after}</dd>
    </Fragment>
  );
}
function useReceiptState() {
  return useState<{
    items: { id: string; domain: string; revision: string }[];
    message: string;
    failures?: { id: string; error: string }[];
  } | null>(null);
}

interface BulkReceiptPage {
  status: string;
  counts: { state: string; count: number }[];
  items: {
    listing_id: string;
    state: string;
    result: { revision?: string; domain?: string; error?: string } | null;
  }[];
  cursor: number | null;
}
async function commitBulkPublication(
  id: string,
  digest: string,
  progress: (value: string) => void,
) {
  await salesRequest(`/jobs/${id}/approve`, 'POST', { digest });
  let last: BulkReceiptPage | null = null;
  for (let n = 0; n < 25; n++) {
    last = await salesRequest<BulkReceiptPage>(`/jobs/${id}/step`, 'POST', {});
    progress(last.counts.map((c) => `${c.count} ${c.state}`).join(' · '));
    if (last.status === 'finished') break;
  }
  if (last?.status !== 'finished')
    throw new Error(
      'This job still has pending items. Resume it from Recent bulk jobs; completed items are retained.',
    );
  const items: { id: string; domain: string; revision: string }[] = [],
    failures: { id: string; error: string }[] = [];
  let cursor: number | null = -1;
  for (let n = 0; n < 5 && cursor !== null; n++) {
    const page: BulkReceiptPage = await salesRequest<BulkReceiptPage>(
      `/jobs/${id}?cursor=${cursor}`,
    );
    for (const row of page.items) {
      if (row.state === 'complete' && row.result?.domain && row.result.revision)
        items.push({
          id: row.listing_id,
          domain: row.result.domain,
          revision: row.result.revision,
        });
      else
        failures.push({
          id: row.listing_id,
          error: row.result?.error ?? 'Review this item again.',
        });
    }
    cursor = page.cursor;
  }
  return {
    items,
    failures,
    message: `${items.length} publication receipts · ${failures.length} need review. Domain activation is separate; current availability remains visible in Sales pages.`,
  };
}
