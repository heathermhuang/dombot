import { useState } from 'react';
import type { SaleDestination } from '../../../shared/sales';
import {
  salesRequest,
  useSalesData,
  useSalesAction,
} from '../../lib/sales-client';
import { SalesShell, SalesFeedback, Field } from './shared';

export default function Channels() {
  const remote = useSalesData<{ items: SaleDestination[] }>('/destinations'),
    action = useSalesAction();
  const [provider, setProvider] = useState('Spaceship'),
    [url, setUrl] = useState(''),
    [domain, setDomain] = useState('');
  return (
    <SalesShell>
      <p className="sales-kicker">SALES / CHANNELS</p>
      <h1>Sales channels</h1>
      <p className="small">
        Add a checkout or marketplace link, then select it in a listing. Buyers
        complete payment and transfer with that provider.
      </p>
      <SalesFeedback
        error={remote.error || action.error}
        notice={action.notice}
        loading={action.busy}
        retry={() => void remote.reload()}
      />
      <div className="sales-table-region">
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Connection</th>
              <th>Exact destination</th>
              <th>Link check</th>
            </tr>
          </thead>
          <tbody>
            {remote.data?.items.map((d) => (
              <tr key={d.id}>
                <td>{d.provider}</td>
                <td>Manual link</td>
                <td style={{ overflowWrap: 'anywhere' }}>
                  <a
                    className="link"
                    href={d.url}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {d.url}
                  </a>
                </td>
                <td>
                  {d.check === 'manual'
                    ? 'Seller-configured · purchase availability unverified'
                    : d.check}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form
        style={{ maxWidth: 650 }}
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            await salesRequest('/destinations', 'POST', {
              provider,
              url,
              ...(domain ? { domain } : {}),
              revision: null,
            });
            setUrl('');
            await remote.reload();
            action.setNotice(
              'Manual provider link saved. Select it in the domain editor and review before publishing.',
            );
          });
        }}
      >
        <h2>Add a manual provider link</h2>
        <Field label="Provider">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            {['Spaceship', 'Afternic', 'Sedo', 'Atom', 'Efty'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="Domain this link is for">
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="your-domain.example"
          />
        </Field>
        <Field label="Exact HTTPS checkout or marketplace URL">
          <input
            required
            type="url"
            value={url}
            maxLength={2048}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
        <button className="primary" disabled={action.busy}>
          Save manual link
        </button>
      </form>
      <section className="sales-section">
        <h2>API connections</h2>
        <p className="small">
          Automatic marketplace connections are not available yet. Add a manual
          link above and review it before publishing. Exports can be uploaded to
          your provider; they do not keep listings synchronized.
        </p>
      </section>
    </SalesShell>
  );
}
