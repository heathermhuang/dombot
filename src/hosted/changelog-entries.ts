/** Curated public history. Dates describe the event, not an inferred deployment.
 * Add evidence links and explicit rollout status when adding an entry.
 */
export interface ChangelogEntry {
  id: string;
  date: string;
  layer: 'core' | 'saas';
  title: string;
  status: string;
  changes: readonly string[];
  links: readonly { label: string; url: string }[];
}

const hosted = 'https://github.com/heathermhuang/dombot';
const upstream = 'https://github.com/aoxborrow/dombot';

export const changelogEntries: readonly ChangelogEntry[] = [
  {
    id: 'core-2-1-0',
    date: '2026-11-05',
    layer: 'core',
    title: 'DomBot 2.1.0',
    status: 'Upstream released · SaaS source merged; hosted rollout pending',
    changes: [
      'Adds Unstoppable Domains registrar support and improves Namecheap domain details and request pacing.',
      'Improves Afternic sales-history synchronization, sync error visibility and scrubbed desktop logs.',
      'Merged into the SaaS source with hosted compatibility. This source integration does not activate the new engine for managed portfolios.',
    ],
    links: [
      { label: 'Upstream release', url: `${upstream}/releases/tag/v2.1.0` },
      { label: 'SaaS integration #167', url: `${hosted}/pull/167` },
    ],
  },
  {
    id: 'saas-selection-2026-11-05',
    date: '2026-11-05',
    layer: 'saas',
    title: 'Bulk actions follow your current view',
    status: 'Deployed · 2.0.0-hosted.5',
    changes: [
      'Domains and Activity clear selection when you change filters or navigate away. Pagination and sorting within the same result retain your selection.',
      'Bulk-action counts and targets use the same filtered scope, preventing hidden or stale selections from carrying into another view.',
      'Managed portfolio browser tabs now use the domains.domains title.',
    ],
    links: [
      { label: 'Changes #165', url: `${hosted}/pull/165` },
      {
        label: 'Release record',
        url: `${hosted}/blob/a8405d3d/docs/selection-scope-release-20261105.json`,
      },
    ],
  },
  {
    id: 'saas-setup-2026-11-05',
    date: '2026-11-05',
    layer: 'saas',
    title: 'Clearer setup recovery and easier touch controls',
    status: 'Deployed · 2.0.0-hosted.3–4',
    changes: [
      'Setup pauses for reconciliation when a provider write has an uncertain outcome, with a safe reference for support.',
      'Bounds setup artifact downloads so a stalled read cannot leave setup waiting indefinitely.',
      'Fixes touch targets around the Domains filters and presence inspector, and updates production dependencies.',
    ],
    links: [
      { label: 'Setup recovery #161', url: `${hosted}/pull/161` },
      { label: 'Touch and setup fixes #163', url: `${hosted}/pull/163` },
      {
        label: 'Release record',
        url: `${hosted}/blob/d9c59dcf/docs/home-provisioning-release-20261105.json`,
      },
    ],
  },
  {
    id: 'saas-password-2026-11-05',
    date: '2026-11-05',
    layer: 'saas',
    title: 'Password-change confirmation',
    status: 'Deployed · SaaS gateway',
    changes: [
      'After changing your password, the password sign-in page shows the confirmation message and explains the next step.',
    ],
    links: [
      { label: 'Changes #159', url: `${hosted}/pull/159` },
      {
        label: 'Release record',
        url: `${hosted}/blob/7482c035/docs/saas-qa-release-20261105.json`,
      },
    ],
  },
  {
    id: 'saas-renewals-2026-11-04',
    date: '2026-11-04',
    layer: 'saas',
    title: 'More useful renewal reviews',
    status: 'Deployed · 2.0.0-hosted.2',
    changes: [
      'Separates past reported expiry from upcoming renewals so domains that need verification have their own review workflow.',
      'Excludes Gandi update timestamps from renewal deadlines and shows renewal quote age separately from inventory sync age.',
      'Integrates the complete DomBot 2.0.0 core while preserving registrar connections for already-open browser tabs.',
    ],
    links: [
      { label: 'Core integration #156', url: `${hosted}/pull/156` },
      {
        label: 'Release record',
        url: `${hosted}/blob/502ec39e/docs/weekly-review-production-release-20261104/README.md`,
      },
    ],
  },
  {
    id: 'saas-public-links-2026-11-03',
    date: '2026-11-03',
    layer: 'saas',
    title: 'Readable public domain links',
    status: 'Deployed · SaaS public pages',
    changes: [
      'Published domain pages use a domain-based address such as domains.domains/working.io, keeping internal account identifiers out of the shared link.',
      'Existing domain-page URLs redirect to the new address. Publishing remains an explicit owner action.',
      'Public routing follows current publication and domain-control state.',
    ],
    links: [
      { label: 'Changes #138', url: `${hosted}/pull/138` },
      {
        label: 'Release record',
        url: `${hosted}/blob/e470926a/docs/listing-core-production-release-20261103/README.md`,
      },
    ],
  },
  {
    id: 'core-2-0-0',
    date: '2026-11-03',
    layer: 'core',
    title: 'DomBot 2.0.0',
    status: 'Upstream released · Included in the 4 November SaaS release',
    changes: [
      'Adds domain-control TXT verification, marketplace identifiers and optional GoDaddy API settings.',
      'Improves domain action menus, mobile navigation and nameserver normalization.',
      'The SaaS integration also includes the subsequent exact-currency formatting update.',
    ],
    links: [
      { label: 'Upstream release', url: `${upstream}/releases/tag/v2.0.0` },
      { label: 'Currency update #250', url: `${upstream}/pull/250` },
    ],
  },
];
