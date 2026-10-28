export interface PortfolioDnsRecord {
  type: 'TXT' | 'CNAME';
  name: string;
  value: string;
}
export type PortfolioDomainStatus =
  | 'pending-certificate'
  | 'pending-routing'
  | 'checking'
  | 'active'
  | 'blocked'
  | 'needs-review'
  | 'detaching'
  | 'detached';
export interface PortfolioDomainPlan {
  hostname: string;
  revision: string;
  createdAt: number;
  records: PortfolioDnsRecord[];
  dnsBefore: Record<string, { type: number; data: string }[]>;
}
export interface PortfolioDomainBinding {
  hostname: string;
  epoch: number;
  status: PortfolioDomainStatus;
  records: PortfolioDnsRecord[];
  verificationUrl: string | null;
  needsServiceReview: boolean;
  message: string | null;
}
export interface PortfolioDomainsState {
  enabled: boolean;
  plan: PortfolioDomainPlan | null;
  domain: PortfolioDomainBinding | null;
}
