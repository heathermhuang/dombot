import { beforeEach, describe, it, expect } from 'vitest';
import { MemoryDocStore } from '../core/storage/doc-store';
import { configureStore, hydrateStores } from '../core/storage/namespace';
import { createSaleObserver } from './sales-observation';
import { emptySale } from '../shared/sales';
import {
  managedControl,
  managedControls,
} from '../shared/sales-managed-control';
const workspace = '11111111-1111-4111-8111-111111111111',
  domain = 'pilot.fixture.example';
const proof = () => ({
  workspace,
  domain,
  proofId: 'a'.repeat(64),
  observedAt: Date.now() - 1000,
  expiresAt: Date.now() + 3600000,
});
const env = (p = proof()) => ({
  DOMBOT_AUTH: 'gateway',
  DOMBOT_WORKSPACE_ID: workspace,
  DOMBOT_SALES_DNS_CONTROL: JSON.stringify([p]),
});
beforeEach(async () => {
  configureStore(new MemoryDocStore());
  await hydrateStores();
});
describe('operator-managed DNS control', () => {
  it('keeps imported names unqualified without independent operator control', () => {
    const draft = emptySale(domain, 'unreviewed');
    expect(createSaleObserver()(draft).available).toBe(false);
    const observed = createSaleObserver(env())(draft);
    expect(observed.available).toBe(true);
    expect(observed.controlSource).toBe('operator-dns');
    expect(observed.controlExpiresAt).toBeGreaterThan(Date.now());
  });
  it('cannot cross workspace, hostname, expiry or auth-mode boundaries', () => {
    expect(
      managedControl(
        { ...env(), DOMBOT_WORKSPACE_ID: crypto.randomUUID() },
        domain,
      ),
    ).toBeNull();
    expect(managedControl(env(), 'other.fixture.example')).toBeNull();
    expect(
      managedControl(
        env({
          ...proof(),
          observedAt: Date.now() - 2000,
          expiresAt: Date.now() - 1000,
        }),
        domain,
      ),
    ).toBeNull();
    expect(
      managedControl(
        env({ ...proof(), observedAt: Date.now() + 1000 }),
        domain,
      ),
    ).toBeNull();
    expect(
      managedControl({ ...env(), DOMBOT_AUTH: 'password' }, domain),
    ).toBeNull();
  });
  it('rejects oversized leases and unrecognized configuration without accepting seller input', () => {
    expect(
      managedControls(
        JSON.stringify([{ ...proof(), expiresAt: Date.now() + 2 * 86400000 }]),
      ),
    ).toEqual([]);
    expect(
      managedControls(JSON.stringify([{ ...proof(), available: true }])),
    ).toEqual([]);
    expect(managedControls('invalid')).toEqual([]);
  });
});
