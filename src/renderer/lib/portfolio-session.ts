import {
  portfolioIssues,
  validDraftEdits,
} from '../../shared/portfolio-validation';
import {
  draftSchema,
  type PortfolioDraft,
  type PublicationState,
} from '../../shared/publication';
import { editableDraft, includeDomains } from '../../shared/publication-edit';

import {
  DraftSession,
  type DraftClient,
  type DraftEditorSnapshot,
} from './draft-session';
export type PublicationClient = DraftClient<PortfolioDraft, PublicationState>;
export type EditorSnapshot = DraftEditorSnapshot<
  PortfolioDraft,
  PublicationState
>;
export class PortfolioSession extends DraftSession<
  PortfolioDraft,
  PublicationState
> {
  constructor(client: PublicationClient, delay = 650) {
    super(
      client,
      {
        editable: editableDraft,
        issues: portfolioIssues,
        valid: validDraftEdits,
        schema: draftSchema,
      },
      delay,
    );
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
}
