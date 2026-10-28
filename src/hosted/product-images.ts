/** Owner-authorized public portfolio names; account data and statuses are illustrative. */
export const productImages = {
  domains: {
    path: '/product/inventory-11cff5d336ff.png',
    file: '/portfolio-inventory-11cff5d336ff.png',
    width: 2128,
    height: 1360,
    mobile: {
      path: '/product/inventory-mobile-1328da96ea34.png',
      file: '/portfolio-inventory-mobile-1328da96ea34.png',
      width: 696,
      height: 734,
    },
  },
  renewals: {
    path: '/product/renewals-c3e5916d84ec.png',
    file: '/portfolio-renewals-c3e5916d84ec.png',
    width: 2128,
    height: 1360,
    mobile: {
      path: '/product/renewals-mobile-1f27552adf14.png',
      file: '/portfolio-renewals-mobile-1f27552adf14.png',
      width: 670,
      height: 692,
    },
  },
  hostedSales: {
    path: '/product/inquiries-e0bebbc99975.png',
    file: '/portfolio-inquiries-e0bebbc99975.png',
    width: 874,
    height: 1364,
    mobile: {
      path: '/product/inquiries-mobile-fec862622238.png',
      file: '/portfolio-inquiries-mobile-fec862622238.png',
      width: 670,
      height: 1544,
    },
  },
} as const;

export const productImageVariants = Object.values(productImages).map(
  (image) => image.mobile,
);

// Existing open pages can still request their lazy-loaded, immutable previews.
export const previousProductImages = [
  {
    path: '/product/hosted-sales-2b927a790d41.png',
    file: '/portfolio-sales.png',
  },
  {
    path: '/product/domains-6971d866ec48.png',
    file: '/portfolio-inventory.png',
  },
  {
    path: '/product/renewals-b7d52273a139.png',
    file: '/portfolio-renewals.png',
  },
  {
    path: '/product/hosted-sales-5065c3c6637e.png',
    file: '/portfolio-sales-5065c3c6637e.png',
  },
  {
    path: '/product/domains-cbd31ef738fd.png',
    file: '/portfolio-inventory-cbd31ef738fd.png',
  },
  {
    path: '/product/renewals-441fc0b4819f.png',
    file: '/portfolio-renewals-441fc0b4819f.png',
  },

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
