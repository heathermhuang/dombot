import { describe, expect, it } from 'vitest';
import { emptyDraft, privateListing } from './publication';
import {
  anyDraftSchema,
  anyPublishedSchema,
  convertOwnerSite,
  emptyOwnerSite,
  httpsUrl,
  selectedSite,
} from './owner-site';
import { ownerSiteSnapshot } from '../core/publication/owner-site';
import { renderOwnerSite } from './render-owner-site';
import { siteChanges } from './owner-site-review';

import { sampleSite } from './owner-site.fixture';
describe('owner site disclosure contract', () => {
  it('reviews an existing v2 publication without treating its publication date as draft data', () => {
    const site = sampleSite();
    expect(
      siteChanges(site, { ...selectedSite(site), publishedAt: 1000 }),
    ).toEqual([]);
  });
  it('accepts an intentional profile without inventory or catalogue UI', () => {
    const site = emptyOwnerSite();
    site.profile.name = 'Sample profile';
    const publicSite = ownerSiteSnapshot(site, [], 1000);
    const html = renderOwnerSite(
      publicSite,
      new URL('https://site.example/p/portfolio'),
    );
    expect(html).toContain('Sample profile');
    expect(html).toContain(
      'domains.domains is a hosted, multi-tenant version of',
    );
    expect(html).toContain('href="https://github.com/aoxborrow/dombot"');
    expect(html).not.toMatch(/Search|0 holdings|Browse selected|No domains/);
  });
  it('projects only selected references with one availability and no private fields', () => {
    const site = sampleSite();
    site.collections[1].domainIds = ['missing'];
    const publicSite = selectedSite(site);
    const raw = JSON.stringify(publicSite);
    expect(raw).not.toMatch(/never-disclose|NEVER_DISCLOSE|987654|missing/);
    expect(publicSite.domainPresentations[0].askingPrice).toBeNull();
    expect(
      anyPublishedSchema.safeParse({ ...publicSite, publishedAt: 1000 })
        .success,
    ).toBe(true);
    const contaminated = { ...site, publishedAt: 1000 };
    expect(anyPublishedSchema.safeParse(contaminated).success).toBe(false);
  });
  it('blocks only selected ownership failures including project references', () => {
    const site = sampleSite();
    const reviews = ['selected', 'inquiries'].map((id) => ({
      ...privateListing(`${id}.example`),
      ownership: 'owned' as const,
      accountLabels: [],
      lastSyncedAt: 1000,
    }));
    expect(() => ownerSiteSnapshot(site, reviews, 1000)).not.toThrow();
    expect(() =>
      ownerSiteSnapshot(
        site,
        reviews.filter((v) => v.domain !== 'selected.example'),
        1000,
      ),
    ).toThrow(/selected.example/);
    site.homepage.collectionIds = [];
    expect(() => ownerSiteSnapshot(site, [], 1000)).toThrow(/selected.example/);
  });
  it('blocks selected empty/missing collections and invalid inquiries; disabled catalogue never expands selection', () => {
    const site = sampleSite();
    site.collections[0].domainIds = [];
    expect(() => selectedSite(site)).toThrow(/Add domains/);
    site.homepage.collectionIds = ['absent'];
    expect(() => selectedSite(site)).toThrow(/missing collection/);
    site.homepage.collectionIds = ['one'];
    site.collections[0].domainIds = ['history'];
    site.domainPresentations[2].availability = 'inquiries';
    expect(() => selectedSite(site)).toThrow(/previously owned/);
    site.domainPresentations[2].availability = 'not-for-sale';
    site.collections[0].domainIds = ['inquiries'];
    site.profile.contactEmail = '';
    expect(() => selectedSite(site)).toThrow(/public contact email/);
    site.homepage.collectionIds = [];
    site.homepage.projectIds = [];
    site.catalogue.domainIds = ['private'];
    expect(selectedSite(site).domainPresentations).toEqual([]);
  });
  it('escapes text, suppresses preview actions, paginates and never broadens unknown selections', () => {
    const site = sampleSite();
    site.profile.name = '<script>owner</script>';
    const publicSite = { ...selectedSite(site), publishedAt: 1000 };
    const html = renderOwnerSite(
      publicSite,
      new URL('https://site.example/p/portfolio'),
    );
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('never-disclose');
    const collection = renderOwnerSite(
      publicSite,
      new URL('https://site.example/p/portfolio/c/one'),
    );
    expect(collection).toContain('Not for sale');
    expect(collection).toContain('USD 250');
    expect(collection).toContain('Previously owned');
    expect(collection).not.toContain('USD 100');
    const preview = renderOwnerSite(
      publicSite,
      new URL('https://site.example/p/portfolio/c/one'),
      true,
    );
    expect(preview).not.toMatch(/href="mailto:/);
    const standalone = renderOwnerSite(
      publicSite,
      new URL('https://site.example/publishing/preview'),
      true,
    );
    expect(standalone).toContain('href="?collection=one"');
    expect(standalone).not.toContain('/publishing/preview/c/');
    for (const suffix of [
      '?collection=missing',
      '/c/hidden',
      '?view=catalogue&q=never',
    ]) {
      const scoped = renderOwnerSite(
        publicSite,
        new URL(`https://site.example/p/portfolio${suffix}`),
      );
      expect(scoped).toContain('Selection not found');
      expect(scoped).not.toContain('selected.example');
    }
    publicSite.collections[0].domainIds = Array.from(
      { length: 61 },
      (_, i) => `d-${i}`,
    );
    publicSite.domainPresentations = Array.from({ length: 61 }, (_, i) => ({
      ...site.domainPresentations[0],
      id: `d-${i}`,
      domain: `name-${i}.example`,
      askingPrice: null,
    }));
    const page = renderOwnerSite(
      publicSite,
      new URL('https://site.example/p/portfolio/c/one?page=2'),
    );
    expect(page).toContain('name-60.example');
    expect(page).not.toContain('name-59.example');
  });
  it('keeps incomplete unselected sections private without blocking the profile', () => {
    const site = emptyOwnerSite();
    site.projects = [
      {
        id: 'draft',
        title: '',
        description: '',
        url: '',
        domainIds: ['missing'],
      },
    ];
    site.collections = [
      { id: 'draft', slug: 'draft', title: '', intro: '', domainIds: [] },
    ];
    expect(selectedSite(site).projects).toEqual([]);
    site.homepage.projectIds = ['draft'];
    expect(() => selectedSite(site)).toThrow(/Complete the title/);
  });
  it('reviews reordered sections and duplicate titles without inventing removals', () => {
    const site = sampleSite();
    site.homepage.collectionIds = ['one', 'hidden'];
    site.collections[1].title = site.collections[0].title;
    const live = { ...selectedSite(site), publishedAt: 1000 };
    site.homepage.collectionIds.reverse();
    expect(siteChanges(site, live).map((v) => v.key)).toEqual([
      'Collection order',
    ]);
    site.collections[1].intro = 'Different context';
    expect(siteChanges(site, live).map((v) => v.key)).toEqual([
      'Collection order',
      'collection:hidden',
    ]);
  });
  it('rejects unsafe URLs and unknown versions/fields', () => {
    for (const value of [
      'javascript:alert(1)',
      'data:text/html,hi',
      'http://insecure.example',
      'https://user:pass@host.example',
      'https://host.example/\nsecret',
    ])
      expect(httpsUrl.safeParse(value).success).toBe(false);
    expect(
      anyDraftSchema.safeParse({ ...emptyOwnerSite(), version: 3 }).success,
    ).toBe(false);
    expect(
      anyDraftSchema.safeParse({ ...emptyOwnerSite(), credentials: 'private' })
        .success,
    ).toBe(false);
  });
  it('converts legacy selections deterministically, without inventing sales or exposing private names', () => {
    const old = {
      ...emptyDraft(),
      title: 'Sample legacy',
      contactEmail: 'owner@sample.example',
      listings: [
        {
          ...privateListing('one.example'),
          collection: 'Short names; Ideas',
          visibility: 'inquiry' as const,
          askingPrice: 250,
        },
        {
          ...privateListing('two.example'),
          collection: 'Short names',
          visibility: 'historical' as const,
        },
        privateListing('private.example'),
      ],
    };
    const site = convertOwnerSite(old);
    expect(convertOwnerSite(site)).toEqual(site);
    expect(convertOwnerSite(old)).toEqual(site);
    expect(site.catalogue.domainIds).toEqual(['domain-1', 'domain-2']);
    expect(site.collections[0].domainIds).toEqual(['domain-1', 'domain-2']);
    expect(site.collections[1].domainIds).toEqual(['domain-1']);
    expect(selectedSite(site).domainPresentations.map((v) => v.domain)).toEqual(
      ['one.example', 'two.example'],
    );
    const changes = siteChanges(site, null);
    expect(changes.some((v) => v.after.includes('owner@sample.example'))).toBe(
      true,
    );
    expect(changes.some((v) => v.after.includes('USD 250'))).toBe(true);
  });
});
