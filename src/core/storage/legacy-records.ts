import { Namespace } from './namespace';
// Retain historical records removed from upstream's active ownership model.
// Included in backups and encrypted by each host, never public or provider-facing.
export const legacyEvents = new Namespace<unknown>('hosted-legacy-events');
export const legacyFolders = new Namespace<unknown>('hosted-legacy-folders');
