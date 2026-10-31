import { expect, it } from 'vitest';
import {
  convertOwnerSiteV3,
  emptyOwnerSite,
  previewOwnerSite,
} from './owner-site';
import {
  resolvedPreviewLinks,
  type PreviewSalesTerm,
} from './preview-sales-links';
import { renderOwnerSite } from './render-owner-site';
import { publishedSaleSchema } from './sales';
const id = '11111111-1111-4111-8111-111111111111',
  revision = '22222222-2222-4222-8222-222222222222';
function site() {
  const s = convertOwnerSiteV3(emptyOwnerSite());
  s.domainPresentations = [
    {
      id: 'linked',
      domain: 'linked.example',
      ownership: 'current',
      availability: 'inquiries',
      description: 'Reviewed name',
      askingPrice: null,
      currency: 'USD',
    },
  ];
  s.catalogue = { enabled: true, domainIds: ['linked'] };
  s.salesLinks = [
    {
      presentationId: 'linked',
      listingId: id,
      expectedPublishedRevision: revision,
    },
  ];
  return previewOwnerSite(s);
}
const term = (): PreviewSalesTerm => ({
  presentationId: 'linked',
  domain: 'linked.example',
  listingId: id,
  publishedRevision: revision,
  mode: 'offer',
  price: { amount: '12345', currency: 'USD' },
  minimumOffer: { amount: '1000', currency: 'USD' },
  url: 'https://public.example/w/fixture/d/linked.example',
});
it('shows the exact bound public price in preview while disabling the action', () => {
  const s = site(),
    html = renderOwnerSite(
      s,
      new URL('https://preview.invalid/p/portfolio?view=catalogue'),
      true,
      resolvedPreviewLinks(s, [term()]),
    );
  expect(html).toContain('USD 12,345');
  expect(html).toContain('View domain page · disabled in preview');
  expect(html).not.toContain(
    'href="https://public.example/w/fixture/d/linked.example"',
  );
  expect(html).not.toContain('mailto:');
});
it('does not reuse asynchronous terms after a reference changes', () => {
  const s = site();
  if (s.version !== 3) throw new Error('Expected v3');
  s.salesLinks[0].publishedRevision = crypto.randomUUID();
  expect(resolvedPreviewLinks(s, [term()]).size).toBe(0);
  const html = renderOwnerSite(
    s,
    new URL('https://preview.invalid/p/portfolio?view=catalogue'),
    true,
    resolvedPreviewLinks(s, [term()]),
  );
  expect(html).not.toContain('12,345');
  expect(html).toContain('Inquiries currently unavailable');
});
it('previews exact staged review terms that are not published yet', () => {
  const s = site(),
    staged = publishedSaleSchema.parse({
      version: 1,
      id,
      domain: 'linked.example',
      displayName: 'linked.example',
      mode: 'offer',
      description: '',
      categories: [],
      publicPrice: { amount: '22000', currency: 'USD' },
      publicMinimumOffer: null,
      destination: null,
      allowQuestions: true,
      sellerDisplayName: '',
      revision,
      publishedAt: 1,
    });
  const html = renderOwnerSite(
    s,
    new URL('https://preview.invalid/p/portfolio?view=catalogue'),
    true,
    resolvedPreviewLinks(s, [], [staged]),
  );
  expect(html).toContain('USD 22,000');
  expect(html).toContain('disabled in preview');
});
it('orders linked prices with legacy fractional prices without converting either value', () => {
  const s = site();
  s.profile.contactEmail = 'public@example.com';
  s.domainPresentations.push({
    id: 'legacy',
    domain: 'legacy.example',
    ownership: 'current',
    availability: 'inquiries',
    description: '',
    askingPrice: 12.34,
    currency: 'USD',
  });
  s.catalogue.domainIds = ['legacy', 'linked'];
  const html = renderOwnerSite(
    s,
    new URL('https://preview.invalid/p/portfolio?view=catalogue&sort=price'),
    true,
    resolvedPreviewLinks(s, [
      { ...term(), price: { amount: '5', currency: 'USD' } },
    ]),
  );
  expect(html.indexOf('<h3>linked.example')).toBeLessThan(
    html.indexOf('<h3>legacy.example'),
  );
  expect(html).toContain('12.34');
  expect(html).toContain('USD 5');
});
