/** Branded SaaS previews use synthetic .example fixtures, never private holdings. */
export const productImages = {
  hostedSales: {
    path: '/product/hosted-sales-5c8170de15bc.png',
    file: '/dombot-hosted-sales.png',
    width: 2560,
    height: 1440,
  },
  domains: {
    path: '/product/domains-8d8ae08e58a7.png',
    file: '/portfolio-inventory.png',
    width: 1280,
    height: 720,
  },
  renewals: {
    path: '/product/renewals-783275fc3973.png',
    file: '/portfolio-renewals.png',
    width: 1280,
    height: 720,
  },
} as const;

// Existing open pages can still request their lazy-loaded, immutable previews.
export const previousProductImages = [
  {
    path: '/product/domains-ecf103a893af.png',
    file: '/dombot-domains.png',
  },
  {
    path: '/product/renewals-bc197540662d.png',
    file: '/dombot-renewals.png',
  },
] as const;
