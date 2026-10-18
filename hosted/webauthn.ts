// This facade resolves the SaaS-only dependencies from hosted/node_modules.
// It does not change the pinned upstream engine's dependency graph.
export * from '@simplewebauthn/server';
export { isoCBOR } from '@simplewebauthn/server/helpers';
