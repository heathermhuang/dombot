/** Owner-authorized public portfolio names; account data and statuses are illustrative. */
export const productImages = {
  hostedSales: {
    path: '/product/hosted-sales-5065c3c6637e.png',
    file: '/portfolio-sales.png',
    width: 1280,
    height: 720,
  },
  domains: {
    path: '/product/domains-cbd31ef738fd.png',
    file: '/portfolio-inventory.png',
    width: 1280,
    height: 720,
  },
  renewals: {
    path: '/product/renewals-441fc0b4819f.png',
    file: '/portfolio-renewals.png',
    width: 1280,
    height: 720,
  },
} as const;

// Existing open pages can still request their lazy-loaded, immutable previews.
export const previousProductImages = [
  {
    path: '/product/hosted-sales-5c8170de15bc.png',
    file: '/dombot-hosted-sales.png',
  },
  {
    path: '/product/domains-ecf103a893af.png',
    file: '/dombot-domains.png',
  },
  {
    path: '/product/renewals-bc197540662d.png',
    file: '/dombot-renewals.png',
  },
] as const;
