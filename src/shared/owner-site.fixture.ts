import { emptyOwnerSite } from './owner-site';
export function sampleSite() {
  const site = emptyOwnerSite();
  site.profile = {
    ...site.profile,
    name: 'Sample investor',
    headline: 'Sample data · reserved .example names',
    intro: 'Independent investor and builder',
    contactEmail: 'owner@sample.example',
    interests: ['Useful names'],
    opportunities: ['Development partners'],
    links: [{ label: 'Sample project', url: 'https://project.example' }],
  };
  site.domainPresentations = [
    {
      id: 'selected',
      domain: 'selected.example',
      ownership: 'current' as const,
      availability: 'not-for-sale' as const,
      askingPrice: 100,
      currency: 'USD',
      description: 'Selected for development',
    },
    {
      id: 'inquiries',
      domain: 'inquiries.example',
      ownership: 'current' as const,
      availability: 'inquiries' as const,
      askingPrice: 250,
      currency: 'USD',
      description: 'Open to a conversation',
    },
    {
      id: 'history',
      domain: 'history.example',
      ownership: 'historical' as const,
      availability: 'not-for-sale' as const,
      askingPrice: null,
      currency: 'USD',
      description: 'Past ownership, not a sale claim',
    },
    {
      id: 'private',
      domain: 'never-disclose.example',
      ownership: 'current' as const,
      availability: 'not-for-sale' as const,
      askingPrice: 987654,
      currency: 'USD',
      description: 'NEVER_DISCLOSE_DESCRIPTION',
    },
  ];
  site.collections = [
    {
      id: 'one',
      slug: 'one',
      title: 'Selected ideas',
      intro: 'A small focused selection',
      domainIds: ['selected', 'inquiries', 'history'],
    },
    {
      id: 'hidden',
      slug: 'hidden',
      title: 'NEVER_DISCLOSE_TITLE',
      intro: '',
      domainIds: ['private'],
    },
  ];
  site.homepage.collectionIds = ['one'];
  site.projects = [
    {
      id: 'project',
      title: 'Sample developed project',
      description: 'Project claim from owner',
      url: 'https://project.example',
      domainIds: ['selected'],
    },
  ];
  site.homepage.projectIds = ['project'];
  return site;
}
