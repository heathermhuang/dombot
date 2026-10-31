// Local synthetic backup/root-rotation qualification; no provider or mail transport.
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = process.cwd(),
  temp = await fs.mkdtemp(
    path.join(os.tmpdir(), 'dombot-publication-recovery-'),
  );
await build({
  stdin: {
    contents: `
export { aesGcmCipher } from '${root}/src/core/storage/encrypted';
export { deriveEncryptionKey } from '${root}/src/worker/keys';
export { PublicationStore } from '${root}/src/worker/publication-store';
export { publicationBackupMethods } from '${root}/src/worker/publication-backup';
export { SalesStore } from '${root}/src/worker/sales-store';
export { PublicationChangeSets } from '${root}/src/worker/publication-change-sets';
export { bindSiteLinks } from '${root}/src/worker/publication-links';
export { emptyOwnerSite, convertOwnerSiteV3 } from '${root}/src/shared/owner-site';
export { emptySale } from '${root}/src/shared/sales';
export { sourcePriceFingerprint } from '${root}/src/core/publication/sales';
export { configureStore, hydrateStores } from '${root}/src/core/storage/namespace';
export { MemoryDocStore } from '${root}/src/core/storage/doc-store';`,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: path.join(temp, 'fixture.mjs'),
  logLevel: 'silent',
});
const f = await import(path.join(temp, 'fixture.mjs'));
f.configureStore(new f.MemoryDocStore());
await f.hydrateStores();
const mf = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      {
        name: 'recovery',
        modules: true,
        script: 'export default {fetch(){return new Response("local")}}',
        compatibilityDate: '2026-10-08',
        d1Databases: ['DB'],
      },
    ],
  }),
);
try {
  const db = await mf.getD1Database('DB');
  for (const file of (await fs.readdir('migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort())
    await db.exec(
      (await fs.readFile('migrations/' + file, 'utf8'))
        .replace(/^--.*$/gm, '')
        .replace(/\n/g, ' '),
    );
  const oldRoot = new Uint8Array(32).fill(13),
    newRoot = new Uint8Array(32).fill(17);
  const publication = new f.PublicationStore(
    db,
    await f.aesGcmCipher(await f.deriveEncryptionKey(oldRoot)),
  );
  const sales = await f.SalesStore.from({
    DB: db,
    DOMBOT_SECRET: btoa(String.fromCharCode(...oldRoot)),
  });
  const observe = () => ({
    price: null,
    ownershipFingerprint: 'local-synthetic-control',
    available: true,
    reason: null,
    controlExpiresAt: Date.now() + 3600000,
  });
  const listing = f.emptySale(
      'recovery.example',
      f.sourcePriceFingerprint(null),
    ),
    listingRevision = await sales.save(listing, null),
    review = await sales.prepare(
      [{ id: listing.id, revision: listingRevision }],
      observe,
    );
  await sales.publish(review.id, observe);
  const publicSale = (await sales.get(listing.id)).published;
  const draft = f.convertOwnerSiteV3(f.emptyOwnerSite());
  draft.profile.name = 'Synthetic recovery';
  draft.domainPresentations = [
    {
      id: 'linked',
      domain: 'recovery.example',
      ownership: 'current',
      availability: 'inquiries',
      description: 'Private description survives',
      askingPrice: null,
      currency: 'USD',
    },
  ];
  draft.catalogue = { enabled: true, domainIds: ['linked'] };
  draft.salesLinks = [
    {
      presentationId: 'linked',
      listingId: listing.id,
      expectedPublishedRevision: publicSale.revision,
    },
  ];
  const revision = await publication.save(draft, null);
  await publication.publish(await f.bindSiteLinks(db, draft), revision);
  const changes = new f.PublicationChangeSets(
    publication,
    sales,
    'fixture',
    'https://fixture.example',
  );
  await changes.prepare(
    {
      requestKey: crypto.randomUUID(),
      draftRevision: revision,
      operation: { kind: 'withdraw', domains: ['recovery.example'] },
    },
    { domains: [], accounts: [] },
    observe,
    'synthetic',
  );
  const text = await f
      .publicationBackupMethods(publication, true, sales)
      .exportData.handler(),
    backup = JSON.parse(text);
  assert.equal(backup.version, 9);
  assert(!('publicationChangeSets' in backup));
  const rotatedPublication = new f.PublicationStore(
      db,
      await f.aesGcmCipher(await f.deriveEncryptionKey(newRoot)),
    ),
    rotatedSales = await f.SalesStore.from({
      DB: db,
      DOMBOT_SECRET: btoa(String.fromCharCode(...newRoot)),
    });
  await f
    .publicationBackupMethods(rotatedPublication, false, rotatedSales)
    .importData.handler(text);
  assert.deepEqual((await rotatedPublication.draft()).draft, draft);
  assert.equal(await rotatedPublication.published(), null);
  assert.equal((await rotatedSales.get(listing.id)).published, null);
  assert.equal(
    (
      await db
        .prepare('SELECT count(*) AS n FROM publication_change_sets')
        .first()
    ).n,
    0,
  );
  assert.equal(
    (await db.prepare('SELECT count(*) AS n FROM sales_reviews').first()).n,
    0,
  );
  await assert.rejects(() => f.bindSiteLinks(db, draft), /changed|unavailable/);
  await assert.rejects(() => publication.draft());
  console.log(
    JSON.stringify({
      localOnly: true,
      backupVersion: 9,
      v3PrivateRestore: true,
      rootRotation: true,
      liveProjectionsRevoked: true,
      operationalReviewsInvalidated: true,
      rebindRequired: true,
      mailOrProviderCalls: 0,
    }),
  );
} finally {
  await mf.dispose();
}
