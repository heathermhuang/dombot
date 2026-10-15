import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  signGatewayRequest,
  verifyGatewayRequest,
  PROOF_HEADER,
} from './gateway-proof';
const secret = 'synthetic-proof-only-key-'.repeat(3),
  workspace = '11111111-1111-4111-8111-111111111111';
afterEach(() => vi.useRealTimers());
describe('private gateway proof diagnostics', () => {
  it('reports a future-issued proof without accepting it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const now = Date.now(),
      request = new Request('https://example.test/publishing/preview');
    vi.setSystemTime(now + 10000);
    request.headers.set(
      PROOF_HEADER,
      await signGatewayRequest(secret, workspace, 'owner', request),
    );
    vi.setSystemTime(now);
    const reasons: string[] = [];
    expect(
      await verifyGatewayRequest(secret, workspace, request, (r) =>
        reasons.push(r),
      ),
    ).toBeNull();
    expect(reasons).toEqual(['issued_in_future']);
  });
  it('accepts a small cross-host clock offset but keeps tenant and request binding', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const now = Date.now(),
      request = new Request('https://example.test/publishing/preview');
    vi.setSystemTime(now + 3000);
    request.headers.set(
      PROOF_HEADER,
      await signGatewayRequest(secret, workspace, 'owner', request),
    );
    vi.setSystemTime(now);
    expect(await verifyGatewayRequest(secret, workspace, request)).toEqual({
      owner: 'owner',
    });
    expect(
      await verifyGatewayRequest(
        secret,
        '22222222-2222-4222-8222-222222222222',
        request,
      ),
    ).toBeNull();
    const changed = new Request('https://example.test/publishing', {
      headers: request.headers,
    });
    expect(await verifyGatewayRequest(secret, workspace, changed)).toBeNull();
    vi.setSystemTime(now + 39000);
    expect(await verifyGatewayRequest(secret, workspace, request)).toBeNull();
  });
  it('keeps expired and wrongly signed requests rejected', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const now = Date.now(),
      request = new Request('https://example.test/publishing/preview');
    request.headers.set(
      PROOF_HEADER,
      await signGatewayRequest(secret, workspace, 'owner', request),
    );
    vi.setSystemTime(now + 60000);
    const reasons: string[] = [];
    expect(
      await verifyGatewayRequest(secret, workspace, request, (r) =>
        reasons.push(r),
      ),
    ).toBeNull();
    expect(reasons).toEqual(['expired']);
    vi.setSystemTime(now);
    expect(
      await verifyGatewayRequest(
        'different-synthetic-key-'.repeat(3),
        workspace,
        request,
      ),
    ).toBeNull();
  });
});
