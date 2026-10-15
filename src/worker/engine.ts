import worker from './index';
import type { DomBotEngine, DomBotEnvironment } from './engine-contract';
import { mcpPreflight as admitMcp } from './mcp-preflight';

const engine: DomBotEngine = {
  fetch: async (request, env, context) =>
    worker.fetch(request, env, {
      waitUntil: (work) => context.waitUntil(work),
      passThroughOnException() {},
      props: {},
    }),
  scheduled: (event, env) => worker.scheduled(event, env),
};
export default engine;
export const mcpPreflight = (request: Request, env: DomBotEnvironment) =>
  admitMcp(request, env);
export type {
  DomBotEngine,
  DomBotEnvironment,
  DomBotContext,
  DomBotSchedule,
} from './engine-contract';
