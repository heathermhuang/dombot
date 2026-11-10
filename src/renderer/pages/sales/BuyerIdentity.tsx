import type { SalesThread } from '../../../shared/sales-api';
import {
  inquiryBrowser,
  inquiryRoleLabels,
} from '../../../shared/inquiry-identity';

export default function BuyerIdentity({
  thread,
  onRequest,
  requestDisabled,
}: {
  thread: SalesThread;
  onRequest: () => void;
  requestDisabled: boolean;
}) {
  const details = thread.buyerDetails;
  const request = thread.requestMetadata;
  const link = (value?: string) => {
    if (!value) return <span className="identity-missing">Not provided</span>;
    // Old/restored records are still treated as untrusted display content.
    try {
      const url = new URL(value);
      if (
        !['https:', 'http:'].includes(url.protocol) ||
        url.username ||
        url.password
      )
        return <span>{value}</span>;
      return (
        <a href={url.href} target="_blank" rel="noopener noreferrer">
          {value} ↗
        </a>
      );
    } catch {
      return <span>{value}</span>;
    }
  };
  return (
    <section className="buyer-identity" aria-label="Inquiry contact identity">
      <div className="identity-notice">
        <h3>Identity unconfirmed</h3>
        <p>
          {thread.verification === 'verified'
            ? 'The email was confirmed. The person and organization behind it have not been verified.'
            : 'The email has not been confirmed. The person and organization behind it have not been verified.'}
        </p>
        <button
          className="primary"
          onClick={onRequest}
          disabled={requestDisabled}
        >
          Request contact details
        </button>
        <p className="small">
          Prepares a reply for you to review. Nothing is sent automatically.
        </p>
      </div>
      <div className="identity-section-heading">
        <h3>Contact details</h3>
        <span className="small">Private to your portfolio</span>
      </div>
      <p className="identity-name">
        {thread.original.name} <span className="small">Self-reported</span>
      </p>
      <dl className="identity-facts">
        <div>
          <dt>Email</dt>
          <dd>
            {thread.email}
            <br />
            <span className="badge">
              {thread.verification === 'verified'
                ? 'Email confirmed'
                : 'Email not confirmed'}
            </span>
          </dd>
        </div>
        <div>
          <dt>LinkedIn or professional profile</dt>
          <dd>
            {link(details?.profileUrl)}
            {details?.profileUrl && (
              <small>Self-reported · profile ownership unverified</small>
            )}
          </dd>
        </div>
        <div>
          <dt>Company or organization</dt>
          <dd>
            {details?.company || (
              <span className="identity-missing">Not provided</span>
            )}
            {details?.company && <small>Self-reported</small>}
          </dd>
        </div>
        <div>
          <dt>Company website</dt>
          <dd>{link(details?.companyWebsite)}</dd>
        </div>
        <div>
          <dt>Inquiry role</dt>
          <dd>
            {details?.inquiryRole ? (
              inquiryRoleLabels[details.inquiryRole]
            ) : (
              <span className="identity-missing">Not provided</span>
            )}
          </dd>
        </div>
      </dl>
      <div className="identity-section-heading">
        <h3>Submission context</h3>
        <span className="small">Automatically captured</span>
      </div>
      {request ? (
        <>
          <dl className="identity-facts">
            <div>
              <dt>Approximate IP location</dt>
              <dd>
                {[request.city, request.region, request.country]
                  .filter(Boolean)
                  .join(', ') || 'Not available'}
              </dd>
            </div>
            <div>
              <dt>Reported browser / OS</dt>
              <dd>{inquiryBrowser(request.userAgent)}</dd>
            </div>
            <div>
              <dt>Received</dt>
              <dd>{new Date(request.receivedAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt>IP-derived timezone</dt>
              <dd>{request.timezone || 'Not available'}</dd>
            </div>
          </dl>
          <details className="identity-technical">
            <summary>View IP address and user agent</summary>
            <dl className="identity-facts">
              <div>
                <dt>IP address</dt>
                <dd>{request.ipAddress || 'Not available'}</dd>
              </div>
              <div>
                <dt>Reported language</dt>
                <dd>{request.language || 'Not available'}</dd>
              </div>
              <div className="identity-wide">
                <dt>User agent</dt>
                <dd>{request.userAgent || 'Not available'}</dd>
              </div>
            </dl>
            <p className="small">
              A shared network, proxy or VPN can change the apparent location.
              Network and browser details do not verify a person.
            </p>
          </details>
        </>
      ) : (
        <p className="small">
          Request details were not captured for this inquiry. Earlier inquiries
          cannot be backfilled.
        </p>
      )}
    </section>
  );
}
