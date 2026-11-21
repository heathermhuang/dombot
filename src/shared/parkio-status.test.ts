import { describe, expect, it } from 'vitest';
import { parkioStatus } from './parkio-status';

const connected = {
  connection: 'connected',
  sync: 'idle',
  paused: false,
  error: null,
} as const;

describe('Park.io status precedence', () => {
  it('shows an active check before asking for another sign-in', () => {
    expect(
      parkioStatus({
        ...connected,
        connection: 'reconnect_required',
        sync: 'running',
      }),
    ).toBe('running');
  });

  it('preserves reconnect and pause as distinct next steps', () => {
    expect(parkioStatus({ ...connected, paused: true })).toBe('paused');
    expect(
      parkioStatus({
        ...connected,
        paused: true,
        connection: 'reconnect_required',
        sync: 'blocked',
      }),
    ).toBe('reconnect_required');
  });

  it('prioritizes a pending review and treats keeping saved domains as success', () => {
    expect(
      parkioStatus({
        ...connected,
        sync: 'review_required',
        paused: true,
      }),
    ).toBe('review_required');
    expect(parkioStatus({ ...connected, error: 'review_rejected' })).toBe(
      'connected',
    );
    expect(parkioStatus({ ...connected, sync: 'blocked' })).toBe('failed');
  });
});
