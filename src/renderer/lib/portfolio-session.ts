import {
  draftSchema,
  type PortfolioDraft,
  type PublicationState,
} from '../../shared/publication';
import { editableDraft, includeDomains } from '../../shared/publication-edit';

export interface PublicationClient {
  load(): Promise<PublicationState>;
  save(
    draft: PortfolioDraft,
    revision: string | null,
  ): Promise<{ revision: string }>;
  publish(revision: string): Promise<{ url: string }>;
  unpublish(revision: string): Promise<unknown>;
}
export type EditorSnapshot = {
  state: PublicationState | null;
  draft: PortfolioDraft | null;
  status: 'loading' | 'saved' | 'unsaved' | 'saving' | 'error';
  error: string;
};

/** A session survives route navigation. Saves are serialized, never last-response-wins. */
export class PortfolioSession {
  private snapshot: EditorSnapshot = {
    state: null,
    draft: null,
    status: 'loading',
    error: '',
  };
  private listeners = new Set<() => void>();
  private saved = '';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private loading: Promise<void> | null = null;
  private saving: Promise<void> | null = null;
  private conflict = false;
  constructor(
    private client: PublicationClient,
    private delay = 650,
  ) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit(patch: Partial<EditorSnapshot>) {
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
      const draft = editableDraft(state);
      this.saved = JSON.stringify(draft);
      this.conflict = false;
      this.emit({ state, draft, status: 'saved', error: '' });
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }
  update(draft: PortfolioDraft) {
    this.emit({
      draft,
      status: this.conflict ? 'error' : 'unsaved',
      error: this.conflict ? this.snapshot.error : '',
    });
    clearTimeout(this.timer);
    if (!this.conflict)
      this.timer = setTimeout(() => {
        void this.flush().catch(() => {});
      }, this.delay);
  }
  private fail(error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      'status' in error &&
      error.status === 409
    )
      this.conflict = true;
    this.emit({
      status: 'error',
      error:
        error instanceof Error
          ? error.message
          : 'Could not save the draft. Your edits are still here.',
    });
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.conflict) throw new Error(this.snapshot.error);
    if (this.saving) {
      await this.saving;
      return this.flush();
    }
    if (!this.snapshot.draft || !this.snapshot.state) return;
    if (!this.isDirty() && this.snapshot.state.revision) {
      this.emit({ status: 'saved', error: '' });
      return;
    }
    const input = this.snapshot.draft;
    const revision = this.snapshot.state.revision;
    this.emit({ status: 'saving', error: '' });
    this.saving = (async () => {
      try {
        const parsed = draftSchema.safeParse(input);
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
  async add(names: string[]) {
    const alreadyLoaded = !!this.snapshot.state;
    await this.load();
    if (alreadyLoaded) await this.refreshReview();
    // Merge fresh inventory into the current editor buffer after the read, so
    // navigation or edits made during a slow response cannot be overwritten.
    const listings = new Map(
      editableDraft(this.snapshot.state!).listings.map((item) => [
        item.domain,
        item,
      ]),
    );
    for (const item of this.snapshot.draft!.listings)
      listings.set(item.domain, item);
    this.update(
      includeDomains(
        { ...this.snapshot.draft!, listings: [...listings.values()] },
        names,
      ),
    );
    await this.flush();
  }
  async publish() {
    await this.flush();
    const revision = this.snapshot.state?.revision;
    if (!revision) throw new Error('Save a draft first.');
    await this.client.publish(revision);
    // Publishing may finish after the user has navigated back to editing.
    // Refresh the public baseline without replacing their newer draft buffer.
    await this.refreshReview();
  }
  async unpublish() {
    await this.flush();
    const revision = this.snapshot.state?.revision;
    if (!revision) throw new Error('Save a draft first.');
    await this.client.unpublish(revision);
    await this.read();
  }
}
