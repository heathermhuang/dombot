interface HostedEnv {
  LANDING_ASSETS?: Fetcher;
  CANONICAL_ORIGIN?: string;
  MCP_POLICIES?: string;
  PUBLIC_PORTFOLIO_PATH?: string;
  PUBLIC_PORTFOLIO_ORIGIN?: string;
  AUTH_PEPPER: string;
  GATEWAY_KEYS: string;
  EXTRA_GATEWAY_KEYS?: string;
  EMAIL?: SendEmail;
  EMAIL_FROM?: string;
  EMAIL_DELIVERY_VERIFIED?: string;
  PUBLIC_REGISTRATION_ENABLED?: string;
  PUBLIC_SIGNUP_IDS?: string;
  LEGAL_OPERATOR_NAME?: string;
  LEGAL_JURISDICTION?: string;
  SOURCE_COMMIT?: string;
}
