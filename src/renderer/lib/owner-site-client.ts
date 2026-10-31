import { useSyncExternalStore } from 'react';
import { DraftSession } from './draft-session';
import { publicationRequest } from './publication-client';
import {
  editableOwnerSiteSchema,
  type OwnerSiteDraft,
  type AnyDraft,
  type AnyPublished,
  emptyOwnerSite,
  isOwnerSite,
} from '../../shared/owner-site';
import type { ReconciledListing } from '../../shared/publication';
export interface SiteState {
  draft: AnyDraft;
  revision: string | null;
  enabled: boolean;
  v3Enabled?: boolean;
  compositeEnabled?: boolean;
  publishedRevision?: string | null;
  publishedSnapshot: AnyPublished | null;
  review: ReconciledListing[];
}
export interface EditableSiteState extends Omit<SiteState, 'draft'> {
  draft: OwnerSiteDraft;
}
export const loadSite = () => publicationRequest<SiteState>('/site');
export const siteEditor = new DraftSession<OwnerSiteDraft, EditableSiteState>(
  {
    load: async () => {
      const state = await loadSite();
      if (state.revision && !isOwnerSite(state.draft))
        throw new Error('Review the legacy conversion first.');
      return {
        ...state,
        draft: isOwnerSite(state.draft) ? state.draft : emptyOwnerSite(),
      };
    },
    save: (draft, revision) =>
      publicationRequest('/site', 'PUT', { draft, revision }),
    publish: (revision) => publicationRequest('/publish', 'POST', { revision }),
    unpublish: (revision) =>
      publicationRequest('/unpublish', 'POST', { revision }),
  },
  {
    editable: (state) => state.draft,
    issues: (draft) =>
      editableOwnerSiteSchema.safeParse(draft).success
        ? []
        : ['Fix the fields before saving.'],
    valid: (_draft, saved) => saved,
    schema: editableOwnerSiteSchema,
    validationMessage:
      'Fix the listed fields before saving. Your edits are still here.',
  },
);
export const useSiteEditor = () =>
  useSyncExternalStore(siteEditor.subscribe, siteEditor.getSnapshot);
