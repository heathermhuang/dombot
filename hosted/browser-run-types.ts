// Type-only bridge: the existing gateway runtime declarations predate native
// Browser Run session methods. Keep this hosted SDK contract out of the engine.
export type { BrowserRun } from '@cloudflare/workers-types/experimental';
