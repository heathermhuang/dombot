import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  salesRequest,
  useSalesAction,
  useSalesData,
  downloadSales,
} from '../../lib/sales-client';
import { SalesShell, SalesFeedback, Field } from './shared';

interface Plan {
  hostname: string;
  epoch: number;
  challenge: string;
  proof: { type: string; name: string; value: string };
  changes: {
    type: string;
    name: string;
    target: string;
    prerequisite: string;
  }[];
  before: unknown[];
  rollback: string;
  automaticDnsWrites: boolean;
}
interface Host {
  hostname: string;
  epoch: number;
  status: string;
  provider_status: string | null;
  ssl_status: string | null;
  plan: Plan;
}
export default function DomainSetup() {
  const { id = '' } = useParams(),
    remote = useSalesData<{ items: Host[]; enabled: boolean }>(
      `/hosts?listing=${id}`,
    ),
    action = useSalesAction();
  const [hostname, setHostname] = useState(''),
    [plan, setPlan] = useState<Plan | null>(null);
  return (
    <SalesShell>
      <Link className="link" to={`/sales/listings/${id}`}>
        ← Listing editor
      </Link>
      <p className="sales-kicker">SALES / DOMAIN SETUP</p>
      <h1>Connect the actual domain.</h1>
      <SalesFeedback
        error={remote.error || action.error}
        notice={action.notice}
        loading={action.busy}
        retry={() => void remote.reload()}
      />
      <p className="small">
        Domain activation requires current control, exact routing, an active
        certificate and the published revision served on the hostname. DNS and
        email records remain separate.
      </p>
      {remote.data?.items.map((h) => (
        <section className="sales-section" key={h.hostname}>
          <h2>{h.hostname}</h2>
          <p>
            Status: {h.status} · hostname {h.provider_status ?? 'unobserved'} ·
            certificate {h.ssl_status ?? 'unobserved'}
          </p>
          <button
            onClick={() => downloadSales(`dns-plan-${h.hostname}.json`, h.plan)}
          >
            Export original DNS plan
          </button>{' '}
          <button
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                await salesRequest('/hosts/detach', 'POST', {
                  listingId: id,
                  hostname: h.hostname,
                  epoch: h.epoch,
                });
                await remote.reload();
                action.setNotice(
                  'Binding detached. Follow the exported DNS rollback plan; later unrelated records must be preserved.',
                );
              })
            }
          >
            Detach hostname
          </button>
        </section>
      ))}
      <form
        style={{ maxWidth: 750 }}
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            setPlan(
              await salesRequest<Plan>('/hosts/plans', 'POST', {
                listingId: id,
                hostname,
              }),
            );
            await remote.reload();
          });
        }}
      >
        <h2>Prepare a DNS plan</h2>
        <Field label="Exact apex or www hostname">
          <input
            required
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            placeholder="your-domain.example"
          />
        </Field>
        <p className="small">
          Apex support depends on your DNS provider’s ALIAS/CNAME flattening or
          separately qualified apex proxying. We do not infer an A-record target
          or switch nameservers.
        </p>
        <button disabled={action.busy}>Inspect records and prepare plan</button>
      </form>
      {plan && (
        <section className="sales-section">
          <h2>Review before connecting</h2>
          <p>
            Add control proof: {plan.proof.type} · {plan.proof.name} ·{' '}
            <code>{plan.proof.value}</code>
          </p>
          {plan.changes.map((r) => (
            <p key={r.name}>
              {r.type} · {r.name} → {r.target}
              <br />
              <span className="small">{r.prerequisite}</span>
            </p>
          ))}
          <p>
            MX, TXT, CAA, delegation and DNSSEC settings must be preserved. DNS
            writes are manual.
          </p>
          <button
            onClick={() =>
              downloadSales(`dns-plan-${plan.hostname}.json`, plan)
            }
          >
            Download exact before/after and rollback
          </button>
          <details>
            <summary>Observed records</summary>
            <pre style={{ overflow: 'auto' }}>
              {JSON.stringify(plan.before, null, 2)}
            </pre>
          </details>
          <p>{plan.rollback}</p>
          <button
            className="primary"
            disabled={action.busy || !remote.data?.enabled}
            onClick={() =>
              void action.run(async () => {
                const r = await salesRequest<{
                  status: string;
                  error?: string;
                }>('/hosts/activate', 'POST', {
                  listingId: id,
                  hostname: plan.hostname,
                  epoch: plan.epoch,
                  challenge: plan.challenge,
                });
                await remote.reload();
                action.setNotice(r.error ?? `Domain status: ${r.status}`);
              })
            }
          >
            Check proof, DNS, TLS and served page
          </button>
          {!remote.data?.enabled && (
            <p className="small">
              Activation is disabled until the operator qualifies provider
              access and a named controlled hostname.
            </p>
          )}
        </section>
      )}
    </SalesShell>
  );
}
