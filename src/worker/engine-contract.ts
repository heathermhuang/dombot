/** Stable host contract for the pinned DomBot Worker/UI artifact. */
export interface DomBotEnvironment {
  DB: D1Database;
  ASSETS: Fetcher;
  DOMBOT_AUTH: string;
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
