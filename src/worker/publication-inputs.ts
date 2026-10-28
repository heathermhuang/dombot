import type { Domain, RegistrarMeta } from '../shared/ipc';

export interface PublicationInputs {
  domains: Domain[];
  accounts: RegistrarMeta[];
}

/** A detached view of completed inventory, never an in-flight provider mutation.
 * Drafts and public snapshots still come directly from D1. Publishing always
 * reconciles against the freshly hydrated state under the request lock. */
export class PublicationReadCache {
  private value: PublicationInputs | null = null;
  clear() {
    this.value = null;
  }
  capture(input: PublicationInputs) {
    this.value = structuredClone(input);
  }
  read = (): PublicationInputs | null => this.value;
}
