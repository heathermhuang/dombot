import type { z } from 'zod';
export interface DraftClient<D, S> {
  load(): Promise<S>;
  save(draft: D, revision: string | null): Promise<{ revision: string }>;
  publish(revision: string): Promise<{ url: string }>;
  unpublish(revision: string): Promise<unknown>;
}
export interface DraftAdapter<D, S> {
  editable(state: S): D;
  issues(draft: D): unknown[];
  valid(draft: D, saved: D): D;
  schema: z.ZodType<D, z.ZodTypeDef, unknown>;
  validationMessage?: string;
}
export type DraftEditorSnapshot<D, S> = {
  state: S | null;
  draft: D | null;
  status: 'loading' | 'saved' | 'unsaved' | 'saving' | 'error';
  error: string;
  errorKind: 'validation' | 'request' | null;
};

/** A session survives route navigation. Saves are serialized, never last-response-wins. */
export class DraftSession<D, S extends { draft: D; revision: string | null }> {
  protected snapshot: DraftEditorSnapshot<D, S> = {
    state: null,
    draft: null,
    status: 'loading',
    error: '',
    errorKind: null,
  };
  private listeners = new Set<() => void>();
  private saved = '';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private loading: Promise<void> | null = null;
  private saving: Promise<void> | null = null;
  private publication: Promise<void> | null = null;
  private removing = false;
  private conflict = false;
  constructor(
    protected client: DraftClient<D, S>,
    private adapter: DraftAdapter<D, S>,
    private delay = 650,
  ) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  protected emit(patch: Partial<DraftEditorSnapshot<D, S>>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  isDirty = () =>
    !!this.snapshot.draft && JSON.stringify(this.snapshot.draft) !== this.saved;
  async load() {
    if (this.snapshot.state) return;
    if (this.loading) return this.loading;
    this.loading = this.read();
    try {
      await this.loading;
    } finally {
      this.loading = null;
    }
  }
  private async read() {
    try {
      const state = await this.client.load();
      const draft = this.adapter.editable(state);
      this.saved = JSON.stringify(draft);
      this.conflict = false;
      this.emit({ state, draft, status: 'saved', error: '', errorKind: null });
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }
  update(draft: D) {
    this.emit({
      draft,
      status: this.conflict ? 'error' : 'unsaved',
      error: this.conflict ? this.snapshot.error : '',
      errorKind: this.conflict ? this.snapshot.errorKind : null,
    });
    clearTimeout(this.timer);
    if (!this.conflict)
      this.timer = setTimeout(() => {
        void this.flush().catch(() => {});
      }, this.delay);
  }
  private fail(
    error: unknown,
    errorKind: 'validation' | 'request' = 'request',
  ) {
    if (
      error &&
      typeof error === 'object' &&
      'status' in error &&
      error.status === 409
    )
      this.conflict = true;
    this.emit({
      status: 'error',
      errorKind,
      error:
        error instanceof Error
          ? error.message
          : 'Could not save the draft. Your edits are still here.',
    });
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.removing && this.publication) await this.publication;
    if (this.conflict) throw new Error(this.snapshot.error);
    if (this.saving) {
      await this.saving;
      return this.flush();
    }
    if (!this.snapshot.draft || !this.snapshot.state) return;
    if (!this.isDirty() && this.snapshot.state.revision) {
      this.emit({ status: 'saved', error: '', errorKind: null });
      return;
    }
    const buffer = this.snapshot.draft;
    const issues = this.adapter.issues(buffer);
    const input = issues.length
      ? this.adapter.valid(buffer, JSON.parse(this.saved))
      : buffer;
    if (issues.length && JSON.stringify(input) === this.saved) {
      const error = new Error(
        this.adapter.validationMessage ??
          'Fix the highlighted fields. Other valid edits are saved.',
      );
      this.fail(error, 'validation');
      throw error;
    }
    const revision = this.snapshot.state.revision;
    this.emit({ status: 'saving', error: '', errorKind: null });
    this.saving = (async () => {
      try {
        const parsed = this.adapter.schema.safeParse(input);
        if (!parsed.success)
          throw new Error(
            parsed.error.issues
              .slice(0, 2)
              .map((i) => `${i.path.join('.')}: ${i.message}`)
              .join('; '),
          );
        const result = await this.client.save(parsed.data, revision);
        this.saved = JSON.stringify(input);
        this.emit({
          state: { ...this.snapshot.state!, revision: result.revision },
          status: this.isDirty() ? 'unsaved' : 'saved',
          error: '',
          errorKind: null,
        });
      } catch (error) {
        this.fail(error);
        throw error;
      }
    })();
    try {
      await this.saving;
    } finally {
      this.saving = null;
    }
    if (issues.length) {
      const error = new Error(
        this.adapter.validationMessage ??
          'Fix the highlighted fields. Other valid edits are saved.',
      );
      this.fail(error, 'validation');
      throw error;
    }
    if (this.isDirty()) await this.flush();
  }
  async refreshReview() {
    await this.load();
    const next = await this.client.load();
    // Keep the edit revision: a second tab must not silently authorize overwriting it.
    this.emit({ state: { ...next, revision: this.snapshot.state!.revision } });
  }
  async discardAndReload() {
    clearTimeout(this.timer);
    if (this.saving) await this.saving.catch(() => {});
    await this.read();
  }
  private async publicAction(action: () => Promise<void>): Promise<void> {
    if (this.publication) {
      await this.publication.catch(() => {});
      return this.publicAction(action);
    }
    const pending = Promise.resolve().then(action);
    this.publication = pending;
    try {
      await pending;
    } finally {
      this.publication = null;
      this.removing = false;
    }
  }
  async publish() {
    return this.publicAction(async () => {
      await this.flush();
      const revision = this.snapshot.state?.revision;
      if (!revision) throw new Error('Save a draft first.');
      await this.refreshReview();
      await this.client.publish(revision);
      // Keep edits made while publication was finishing.
      await this.refreshReview();
    });
  }
  async unpublish() {
    return this.publicAction(async () => {
      this.removing = true;
      clearTimeout(this.timer);
      // Only settle a write already sent. Unfinished fields must never prevent
      // removal, and edits made during removal must remain in the buffer.
      if (this.saving) await this.saving.catch(() => {});
      if (this.conflict) throw new Error(this.snapshot.error);
      const revision = this.snapshot.state?.revision;
      if (!revision) throw new Error('No saved public profile to remove.');
      try {
        const result = await this.client.unpublish(revision);
        const state = this.snapshot.state!;
        this.emit({
          state: { ...state, published: null, publishedSnapshot: null },
        });
        // Use only this operation's receipt. A later read could contain another
        // tab's edits and must never authorize overwriting them with our buffer.
        let next: string | null = null;
        if (
          result &&
          typeof result === 'object' &&
          'revision' in result &&
          typeof result.revision === 'string'
        )
          next = result.revision;
        else {
          this.conflict = true;
          this.emit({
            status: 'error',
            errorKind: 'request',
            error:
              'Public profile removed. Reload the saved draft before saving again. Your edits are still here.',
          });
          return;
        }
        this.emit({
          state: { ...this.snapshot.state!, revision: next },
          status: this.isDirty() ? 'unsaved' : 'saved',
          error: '',
          errorKind: null,
        });
      } catch (error) {
        this.fail(error);
        throw error;
      }
    });
  }
}
