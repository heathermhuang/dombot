import type { ParkioCacheStatus } from './parkio';

export const PARKIO_SETTINGS_PATH = '/settings?tab=registrars&source=parkio';

export const PARKIO_STATUS = {
  running: { label: 'Updating…', nextAction: 'wait' },
  reconnect_required: { label: 'Reconnect required', nextAction: 'reconnect' },
  disconnected: { label: 'Disconnected', nextAction: 'reconnect' },
  review_required: { label: 'Review required', nextAction: 'review' },
  paused: { label: 'Updates paused', nextAction: 'resume' },
  failed: { label: 'Update failed', nextAction: 'retry' },
  connected: { label: 'Connected', nextAction: null },
} as const;

export type ParkioNextAction =
  (typeof PARKIO_STATUS)[keyof typeof PARKIO_STATUS]['nextAction'];

export function parkioStatus(
  source: Pick<ParkioCacheStatus, 'connection' | 'sync' | 'paused' | 'error'>,
): keyof typeof PARKIO_STATUS {
  if (source.sync === 'running') return 'running';
  if (source.connection !== 'connected') return source.connection;
  if (source.sync === 'review_required') return 'review_required';
  if (source.paused) return 'paused';
  if (
    source.sync === 'blocked' ||
    (source.error && source.error !== 'review_rejected')
  )
    return 'failed';
  return 'connected';
}
