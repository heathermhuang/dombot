import type { Cipher } from '../core/storage/encrypted';
import {
  draftSchema,
  emptyDraft,
  type PortfolioDraft,
  type PublishedPortfolio,
} from '../shared/publication';

export class PublicationConflict extends Error {
  constructor() {
    super(
      'This draft changed in another tab. Reload before saving or publishing.',
    );
  }
}

export class PublicationStore {
  constructor(
    private readonly db: D1Database,
    private readonly cipher: Cipher,
  ) {}

  async draft(): Promise<{ draft: PortfolioDraft; revision: string | null }> {
    const row = await this.db
      .prepare(
        "SELECT sealed, revision FROM portfolio_drafts WHERE id = 'main'",
      )
      .first<{ sealed: string; revision: string }>();
    // Corrupt or unreadable drafts must fail closed, never become a fresh empty draft.
    return row
      ? {
          draft: draftSchema.parse(
            JSON.parse(await this.cipher.open(row.sealed)),
          ),
          revision: row.revision,
        }
      : { draft: emptyDraft(), revision: null };
  }

  async save(draft: PortfolioDraft, expected: string | null): Promise<string> {
    const revision = crypto.randomUUID();
    const sealed = await this.cipher.seal(
      JSON.stringify(draftSchema.parse(draft)),
    );
    const statement =
      expected === null
        ? this.db
            .prepare(
              "INSERT INTO portfolio_drafts (id, revision, sealed) VALUES ('main', ?1, ?2) ON CONFLICT(id) DO NOTHING RETURNING revision",
            )
            .bind(revision, sealed)
        : this.db
            .prepare(
              "UPDATE portfolio_drafts SET revision = ?1, sealed = ?2 WHERE id = 'main' AND revision = ?3 RETURNING revision",
            )
            .bind(revision, sealed, expected);
    if (!(await statement.first())) throw new PublicationConflict();
    return revision;
  }

  async published(): Promise<{
    snapshot: PublishedPortfolio;
    revision: string;
  } | null> {
    const row = await this.db
      .prepare(
        "SELECT payload, revision FROM published_portfolios WHERE id = 'main'",
      )
      .first<{ payload: string; revision: string }>();
    return row
      ? {
          snapshot: JSON.parse(row.payload) as PublishedPortfolio,
          revision: row.revision,
        }
      : null;
  }

  async publish(snapshot: PublishedPortfolio, expected: string): Promise<void> {
    // Checking the revision and publishing are ONE database statement. A stale
    // preview cannot overwrite a newer draft, even across Worker isolates.
    const row = await this.db
      .prepare(
        "INSERT INTO published_portfolios (id, handle, revision, payload) SELECT 'main', ?1, ?2, ?3 FROM portfolio_drafts WHERE id = 'main' AND revision = ?2 ON CONFLICT(id) DO UPDATE SET handle = excluded.handle, revision = excluded.revision, payload = excluded.payload RETURNING id",
      )
      .bind(snapshot.handle, expected, JSON.stringify(snapshot))
      .first();
    if (!row) throw new PublicationConflict();
  }

  async unpublish(expected: string): Promise<void> {
    // Invalidate concurrent previews as well as removing the public page.
    const next = crypto.randomUUID();
    const results = await this.db.batch([
      this.db
        .prepare(
          "UPDATE portfolio_drafts SET revision = ?1 WHERE id = 'main' AND revision = ?2 RETURNING id",
        )
        .bind(next, expected),
      this.db
        .prepare(
          "DELETE FROM published_portfolios WHERE id = 'main' AND EXISTS (SELECT 1 FROM portfolio_drafts WHERE id = 'main' AND revision = ?1)",
        )
        .bind(next),
    ]);
    if (!results[0].results.length) throw new PublicationConflict();
  }

  /** A backup restore never makes content public. It also works after a root
   * key rotation, when the previous draft can no longer be decrypted. */
  async restore(draft: PortfolioDraft | null): Promise<void> {
    const write = draft
      ? this.db
          .prepare(
            "INSERT INTO portfolio_drafts (id, revision, sealed) VALUES ('main', ?1, ?2) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, sealed = excluded.sealed",
          )
          .bind(
            crypto.randomUUID(),
            await this.cipher.seal(JSON.stringify(draftSchema.parse(draft))),
          )
      : this.db.prepare("DELETE FROM portfolio_drafts WHERE id = 'main'");
    await this.db.batch([
      this.db.prepare("DELETE FROM published_portfolios WHERE id = 'main'"),
      write,
    ]);
  }
}
