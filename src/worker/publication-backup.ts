import { z } from 'zod';
import { coreMethods, method } from '../core/api';
import { BundleError, parseBundle } from '../core/storage/bundle';
import {
  anyDraftSchema,
  isOwnerSite,
  type AnyDraft,
} from '../shared/owner-site';
import type { PublicationStore } from './publication-store';
import type { SalesStore } from './sales-store';
import { exportSales, restoreSales, salesBackupSchema } from './sales-backup';

/** Host extension to the normal sealed export: draft selections travel, public
 * status never does. The existing root-key rotation script uses these methods. */
export function publicationBackupMethods(
  store: PublicationStore,
  v2WritesEnabled = true,
  sales?: SalesStore,
) {
  return {
    exportData: method<'exportData'>(z.tuple([]), async () => {
      const text = await coreMethods.exportData.handler();
      const saved = await store.draft();
      return JSON.stringify(
        {
          ...JSON.parse(text),
          publicationDraft: saved.revision ? saved.draft : null,
          ...(sales ? { sales: await exportSales(sales) } : {}),
        },
        null,
        2,
      );
    }),
    importData: method<'importData'>(z.tuple([z.string()]), async (text) => {
      // Validate all incoming data BEFORE removing an existing public page.
      const bundle = parseBundle(text, { sales: true }) as ReturnType<
        typeof parseBundle
      > & {
        publicationDraft?: unknown;
        sales?: unknown;
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
      const salesBackup =
        bundle.sales === undefined
          ? null
          : salesBackupSchema.parse(bundle.sales);
      if (salesBackup && !sales)
        throw new BundleError(
          'The sales migration/runtime is required before restoring this backup. Nothing was imported.',
        );
      if (sales)
        await restoreSales(
          sales,
          salesBackup ?? {
            version: 1,
            drafts: [],
            destinations: [],
            shop: null,
            leads: [],
            messages: [],
            events: [],
          },
        );
      await store.restore(draft);
      // Restored caches are data, never a fresh registrar-control observation.
      const namespaces = { ...bundle.namespaces };
      if (sales && namespaces['registrar-domains'])
        namespaces['registrar-domains'] = Object.fromEntries(
          Object.entries(namespaces['registrar-domains']).map(
            ([key, value]) => {
              if (value && typeof value === 'object' && !Array.isArray(value)) {
                const row = value as { data?: unknown };
                if (
                  row.data &&
                  typeof row.data === 'object' &&
                  !Array.isArray(row.data)
                )
                  return [
                    key,
                    {
                      ...row,
                      fetchedAt: 0,
                      data: { ...row.data, lastSyncedAt: 0 },
                    },
                  ];
              }
              return [key, value];
            },
          ),
        );
      return coreMethods.importData.handler(
        JSON.stringify({ ...bundle, namespaces, sales: undefined }),
      );
    }),
  };
}
