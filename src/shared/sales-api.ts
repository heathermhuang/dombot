import type { BuyerDetails, InquiryRequest } from './inquiry-identity';
import type { CoreSaleReference } from './sales-events';
import type { MarketPublicOffer } from './market-public-offer';
import type {
  PublishedSale,
  SaleDraft,
  SaleDestination,
  SaleMoney,
  SaleShop,
} from './hosted-sales';
export interface SalesListing {
  hasPreviousPublication: boolean;
  lastInquiryAt: number | null;
  publishedDraftRevision: string | null;
  priceChanged?: boolean;
  draft: SaleDraft;
  revision: string;
  operationalRevision: string;
  availability: string;
  controlExpiresAt: number;
  published: PublishedSale | null;
}
export interface SalesListingDetail extends SalesListing {
  dnsVerificationEnabled?: boolean;
  marketOffers?: MarketPublicOffer[];
  observation: {
    controlSource?: 'registrar' | 'operator-dns' | 'dns';
    price: {
      amount: string | null;
      currency: string;
      updatedAt: number;
    } | null;
    available: boolean;
    reason: string | null;
    ownershipFingerprint: string;
    controlExpiresAt: number;
  };
  destinations: SaleDestination[];
}
export interface SalesPage<T> {
  items: T[];
  cursor: string | null;
}
export interface SalesInventory {
  domain: string;
  price: { amount: string | null; currency: string; updatedAt: number } | null;
  priceFingerprint: string;
  available: boolean;
  reason: string | null;
}
export interface SalesInboxItem {
  id: string;
  domain: string;
  name: string;
  offer: SaleMoney | null;
  revision: string;
  verification: string;
  status: string;
  updatedAt: number;
  followUpAt: number | null;
}
export interface SalesThread {
  buyerDetails?: BuyerDetails | null;
  requestMetadata?: InquiryRequest | null;
  receivedAt?: number;
  saleEvidence?: {
    reference: CoreSaleReference;
    label: string;
    status: string;
    price: SaleMoney | null;
  }[];
  outcomes: {
    id: string;
    createdAt: number;
    state: string;
    source: 'seller-entered';
    coreSale?: CoreSaleReference;
    coreEvidence?: {
      status: string;
      source?: string;
      paymentEvidence?: string;
      transferEvidence?: string;
      paidOutOn?: string | null;
    };
    evidence: string;
    provider: string;
    price: SaleMoney | null;
  }[];
  id: string;
  revision: string;
  verification: string;
  status: string;
  email: string;
  followUpAt: number | null;
  original: {
    name: string;
    message: string;
    offer: SaleMoney | null;
    snapshot: PublishedSale;
  };
  messages: {
    id: string;
    direction: string;
    createdAt: number;
    body: string;
  }[];
  cursor: string | null;
  deliveries: {
    id: string;
    message_id: string | null;
    kind: string;
    state: string;
    attempts: number;
    updated_at: number;
  }[];
}
export interface SalesShopState {
  draft: SaleShop;
  revision: string | null;
  published: SaleShop | null;
}
export interface SalesHealth {
  publications: {
    id: string;
    domain: string;
    revision: string;
    availability: string;
    control_expires_at: number;
  }[];
  delivery: { state: string; count: number; oldest: number }[];
  observedAt: number;
}
