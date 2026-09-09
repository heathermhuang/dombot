export const HOSTED_SCOPES = [
  'portfolio:read',
  'domains:write',
  'domains:spend',
] as const;
const tools: Record<string, (typeof HOSTED_SCOPES)[number]> = {
  registrar_list: 'portfolio:read',
  portfolio_query: 'portfolio:read',
  portfolio_sync: 'portfolio:read',
  registrar_test: 'portfolio:read',
  registrar_domains: 'portfolio:read',
  registrar_sync: 'portfolio:read',
  registrar_check_availability: 'portfolio:read',
  registrar_pricing: 'portfolio:read',
  domain_get: 'portfolio:read',
  domain_contacts_get: 'portfolio:read',
  domain_nameservers_get: 'portfolio:read',
  domain_dns_get: 'portfolio:read',
  domain_email_forwarding_get: 'portfolio:read',
  domain_url_forwarding_get: 'portfolio:read',
  domain_dnssec_get: 'portfolio:read',
  domain_renewal_price: 'portfolio:read',
  domain_nameservers_set: 'domains:write',
  domain_dns_set: 'domains:write',
  domain_contacts_set: 'domains:write',
  domain_set_privacy: 'domains:write',
  domain_set_autorenew: 'domains:write',
  domain_set_lock: 'domains:write',
  domain_email_forwarding_set: 'domains:write',
  domain_url_forwarding_set: 'domains:write',
  domain_auth_code_get: 'domains:write',
  registrar_register_domain: 'domains:spend',
  registrar_transfer_domain: 'domains:spend',
  domain_renew: 'domains:spend',
};
export function permitsTool(name: string, scopes: readonly string[]): boolean {
  return Object.hasOwn(tools, name) && scopes.includes(tools[name]);
}
