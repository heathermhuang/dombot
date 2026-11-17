import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { MarketAccountView } from '../../../shared/markets';
import type { SaleDestination } from '../../../shared/hosted-sales';
import {
  salesRequest,
  useSalesData,
  useSalesAction,
} from '../../lib/sales-client';
import { SalesShell, SalesFeedback, Field } from './shared';

export default function Channels() {
  const remote = useSalesData<{ items: SaleDestination[] }>('/destinations'),
    action = useSalesAction();
  const accounts = useSalesData<{ items: MarketAccountView[] }>(
    '/market-accounts',
  );
  const [provider, setProvider] = useState('Spaceship'),
    [url, setUrl] = useState(''),
    [domain, setDomain] = useState('');
  const [editing, setEditing] = useState<SaleDestination | null>(null);
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
        loading={action.busy || remote.loading}
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
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {!remote.loading && !remote.error && !remote.data?.items.length && (
              <tr>
                <td colSpan={5}>
                  No provider links yet. Add a link below, then select it in a
                  page draft.
                </td>
              </tr>
            )}
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
                <td>
                  <button
                    type="button"
                    disabled={action.busy}
                    onClick={() => {
                      setEditing(d);
                      setProvider(d.provider);
                      setUrl(d.url);
                      setDomain('');
                    }}
                  >
                    Edit link
                  </button>
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
              ...(editing ? { id: editing.id } : {}),
              revision: editing?.revision ?? null,
            });
            setUrl('');
            setEditing(null);
            await remote.reload();
            action.setNotice(
              'Manual provider link saved. Select it in the domain editor and review before publishing.',
            );
          });
        }}
      >
        <h2>{editing ? 'Edit provider link' : 'Add a manual provider link'}</h2>
        <p className="small">
          Changes update this saved destination. Review affected sales-page
          drafts before publishing; existing public snapshots are not silently
          replaced.
        </p>
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
          {action.busy
            ? 'Saving…'
            : editing
              ? 'Save link changes'
              : 'Save manual link'}
        </button>
        {editing && (
          <button
            type="button"
            disabled={action.busy}
            onClick={() => {
              setEditing(null);
              setUrl('');
              setDomain('');
            }}
          >
            Cancel edit
          </button>
        )}
      </form>
      <section className="sales-section">
        <h2>Connected marketplace accounts</h2>
        {accounts.error && <p role="alert">{accounts.error}</p>}
        {accounts.loading && <p role="status">Loading connected accounts…</p>}
        {!accounts.loading &&
          !accounts.error &&
          !accounts.data?.items.length && (
            <p>
              No marketplace accounts connected.{' '}
              <Link to="/settings?tab=markets">Connect a market account</Link>
            </p>
          )}
        <ul>
          {accounts.data?.items.map((account) => (
            <li key={account.id}>
              {account.label} · {account.market} ·{' '}
              {account.enabled && account.configured
                ? account.sync?.lastError
                  ? 'Sync needs attention'
                  : 'Connected'
                : 'Disabled or not configured'}
            </li>
          ))}
        </ul>
        <p className="small">
          Afternic, Atom and Sedo use the accounts in Settings → Markets.
          Connected listing data can prepare private pages; it does not prove
          domain control or create a verified checkout. Public links require
          separate review. Exports remain manual.{' '}
          <Link className="link" to="/settings?tab=markets">
            Manage market accounts
          </Link>
        </p>
      </section>
    </SalesShell>
  );
}
