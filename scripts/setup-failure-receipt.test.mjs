import { expect, it } from 'vitest';
import { setupFailureReceipt } from './setup-failure-receipt.mjs';
it('retains useful failure classification while rejecting arbitrary response and secret fields', () => {
  const operationId = '11111111-1111-4111-8111-111111111111';
  expect(
    setupFailureReceipt('importDomains', 503, operationId, {
      operationId,
      phase: 'module-read',
      code: 'setup_failed',
      status: 503,
      upstreamReference: '0123456789abcdef-SIN',
      root: 'secret',
      message: 'private',
      body: 'import-data',
    }),
  ).toEqual({
    method: 'POST',
    stage: 'import-submission',
    status: 503,
    supportReference: operationId,
    operationId,
    phase: 'module-read',
    code: 'setup_failed',
    upstreamStatus: 503,
    upstreamReference: '0123456789abcdef-SIN',
  });
  expect(
    setupFailureReceipt('secret', 503, 'secret', { phase: 'secret' }),
  ).toEqual({ method: 'POST', stage: 'tenant-api', status: 503 });
});
