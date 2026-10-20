/** In-memory manual edits survive route changes, but never cross a document/session. */
export class ManualDraft<T> {
  private snapshot: { draft: T; saved: T; revision: string | null } | null =
    null;
  private listeners = new Set<() => void>();
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit() {
    this.listeners.forEach((listener) => listener());
  }
  initialize(draft: T, revision: string | null) {
    if (!this.snapshot) this.reset(draft, revision);
  }
  update(draft: T) {
    if (!this.snapshot) return;
    this.snapshot = { ...this.snapshot, draft };
    this.emit();
  }
  saved(draft: T, revision: string | null) {
    if (!this.snapshot) return;
    // A save response must not discard edits made while it was in flight.
    this.snapshot = { ...this.snapshot, saved: draft, revision };
    this.emit();
  }
  reset(draft: T, revision: string | null) {
    this.snapshot = { draft, saved: draft, revision };
    this.emit();
  }
  isDirty = () =>
    !!this.snapshot &&
    JSON.stringify(this.snapshot.draft) !== JSON.stringify(this.snapshot.saved);
}
