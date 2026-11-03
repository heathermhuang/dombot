import { useSalesData } from '../../lib/sales-client';
export function PublicPageJourney({ domain }: { domain: string }) {
  const remote = useSalesData<{
    measured: boolean;
    rows: { day: string; event: string; count: number }[] | null;
    attribution: string;
  }>(`/journey?domain=${encodeURIComponent(domain)}`);
  return (
    <section className="sales-section">
      <h2>Hosted page measurements</h2>
      <p className="small">
        Request and event counts. Provider measurements stay in core reporting.
        A provider click or linked sale does not establish that this page caused
        a completed sale.
      </p>
      {remote.error ? (
        <p role="alert">{remote.error}</p>
      ) : !remote.data ? (
        <p>Loading measurements…</p>
      ) : !remote.data.measured ? (
        <p>Measurements are not enabled for this account.</p>
      ) : (
        <ul>
          {remote.data.rows?.length ? (
            remote.data.rows.map((row) => (
              <li key={`${row.day}:${row.event}`}>
                {row.day} · {row.event} · {row.count}
              </li>
            ))
          ) : (
            <li>No recorded hosted events.</li>
          )}
        </ul>
      )}
    </section>
  );
}
