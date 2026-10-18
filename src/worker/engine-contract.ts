/** Stable host contract for the pinned DomBot Worker/UI artifact. */
export interface DomBotEnvironment {
  DB: D1Database;
  ASSETS: Fetcher;
  DOMBOT_AUTH: string;
  DOMBOT_OWNER_SITE_V2?: string;
  DOMBOT_SALES_V1?: string;
  SALES_INQUIRIES_ENABLED?: string;
  SALES_PRIVACY_REVIEWED?: string;
  SALES_MAIL_ENABLED?: string;
  SALES_TURNSTILE_SITEKEY?: string;
  SALES_TURNSTILE_SECRET?: string;
  DOMBOT_SALES_ORIGIN?: string;
  DOMBOT_SALES_EDGE_SECRET?: string;
  DOMBOT_SECRET?: string;
  DOMBOT_PASSWORD?: string;
  DOMBOT_GATEWAY_SECRET?: string;
  DOMBOT_WORKSPACE_ID?: string;
  DOMBOT_PUBLIC_BASE_PATH?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
}
export interface DomBotContext {
  waitUntil(work: Promise<unknown>): void;
}
export interface DomBotSchedule {
  cron: string;
  scheduledTime: number;
  noRetry(): void;
}
export interface DomBotEngine {
  fetch(
    request: Request,
    env: DomBotEnvironment,
    context: DomBotContext,
  ): Promise<Response>;
  scheduled(event: DomBotSchedule, env: DomBotEnvironment): Promise<void>;
}
