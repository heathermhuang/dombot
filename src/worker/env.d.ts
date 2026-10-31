// Secrets and optional vars the Worker reads. `wrangler types` only emits the
// plain vars present in wrangler.jsonc, so the rest is declared here. All
// optional: boot fails with a clear message when a required one is missing.
interface Env {
  /** SaaS-only default; URL is a Worker secret, never customer data. */
  DOMBOT_MANAGED_PROXY_URL?: string;
  DOMBOT_MANAGED_PROXY_IP?: string;
  DOMBOT_PROXY_SCHEDULER_IP?: string;
  DOMBOT_PROXY_SCHEDULER?: Fetcher;
  /** Host-only HTTPS relay, never stored in customer data. */
  DOMBOT_PROXY_RELAY_URL?: string;
  DOMBOT_SALES_DNS_CONTROL?: string;
  SALES_DNS_CONTROL_ENABLED?: string;
  DOMBOT_SALES_V1?: string;
  SALES_INQUIRIES_ENABLED?: string;
  SALES_PRIVACY_REVIEWED?: string;
  SALES_MAIL_ENABLED?: string;
  SALES_TURNSTILE_SITEKEY?: string;
  SALES_TURNSTILE_SECRET?: string;
  DOMBOT_SALES_ORIGIN?: string;
  DOMBOT_SALES_EDGE_SECRET?: string;
  /** Opt-in per instance. Compatible public reads/export/unpublish remain on. */
  DOMBOT_OWNER_SITE_V2?: string;
  DOMBOT_OWNER_SITE_V3?: string;
  DOMBOT_COMPOSITE_PUBLISH?: string;
  DOMBOT_GATEWAY_SECRET?: string;
  DOMBOT_WORKSPACE_ID?: string;
  DOMBOT_PUBLIC_BASE_PATH?: string;
  /** Root key: 32 random bytes, base64. Set via `npm run web:secrets`. */
  DOMBOT_SECRET?: string;
  /** Login password (password auth mode). Set via `npm run web:secrets`. */
  DOMBOT_PASSWORD?: string;
  /** cloudflare-access mode: https://<team>.cloudflareaccess.com */
  CF_ACCESS_TEAM_DOMAIN?: string;
  /** cloudflare-access mode: the Access application's audience tag. */
  CF_ACCESS_AUD?: string;
}
