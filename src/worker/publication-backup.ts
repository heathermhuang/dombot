import { z } from 'zod';
import { coreMethods, method } from '../core/api';
import { BundleError, parseBundle } from '../core/storage/bundle';
import {
  anyDraftSchema,
  isOwnerSite,
  type AnyDraft,
} from '../shared/owner-site';
import type { PublicationStore } from './publication-store';

/** Host extension to the normal sealed export: draft selections travel, public
 * status never does. The existing root-key rotation script uses these methods. */
export function publicationBackupMethods(
  store: PublicationStore,
  v2WritesEnabled = true,
) {
  return {
    exportData: method<'exportData'>(z.tuple([]), async () => {
      const text = await coreMethods.exportData.handler();
      const saved = await store.draft();
      return JSON.stringify(
        {
          ...JSON.parse(text),
          publicationDraft: saved.revision ? saved.draft : null,
        },
        null,
        2,
      );
    }),
    importData: method<'importData'>(z.tuple([z.string()]), async (text) => {
      // Validate all incoming data BEFORE removing an existing public page.
      const bundle = parseBundle(text) as ReturnType<typeof parseBundle> & {
        publicationDraft?: unknown;
      };
      let draft: AnyDraft | null = null;
      if (bundle.publicationDraft != null) {
        const parsed = anyDraftSchema.safeParse(bundle.publicationDraft);
        if (!parsed.success)
          throw new BundleError(
            'Invalid public portfolio draft in this backup. Nothing was imported.',
          );
        draft = parsed.data;
        if (isOwnerSite(draft) && !v2WritesEnabled)
          throw new BundleError(
            'Enable the compatible owner site editor before restoring a v2 backup. Nothing was imported.',
          );
      }
      await store.restore(draft);
      return coreMethods.importData.handler(text);
    }),
  };
}
