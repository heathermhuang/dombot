import { z } from 'zod';

const policySchema = z.record(
  z.string(),
  z.object({
    // No policy grants OAuth scope. This is an additional restriction only.
    allowedTools: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,79}$/)).max(80),
    accountIds: z.array(z.string().min(1).max(120)).max(100).default([]),
  }),
);
const spending = new Set([
  'domain_renew',
  'registrar_register_domain',
  'registrar_transfer_domain',
]);
/** Legacy connections remain unable to spend. Only persisted, freshly approved
 * shared-OAuth paid permission may enable upstream registrar purchase tools. */
export function mcpPolicyDenial(
  body: unknown,
  workspace: string,
  raw?: string,
  grantedScopes?: readonly string[],
): string | null {
  if (Array.isArray(body)) return 'Batch MCP requests are not supported';
  if (!body || typeof body !== 'object') return null;
  const rpc = body as {
    method?: unknown;
    params?: { name?: unknown; arguments?: { accountId?: unknown } };
  };
  if (rpc.method !== 'tools/call') return null;
  const name = rpc.params?.name;
  if (typeof name !== 'string') return 'Invalid tool request';
  if (spending.has(name) && !grantedScopes?.includes('domains:spend'))
    return 'Paid registrar operations require explicit paid permission on a newly approved shared connection. This connection’s spending budget is zero.';
  if (!raw) return null;
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return 'Agent access policy is unavailable';
  }
  const parsed = policySchema.safeParse(input);
  if (!parsed.success) return 'Agent access policy is unavailable';
  const policy = parsed.data[workspace];
  if (!policy) return null;
  if (!policy.allowedTools.includes(name))
    return 'This tool is outside this workspace’s agent access policy';
  if (
    policy.accountIds.length &&
    ![
      'registrar_list',
      'folder_list',
      'folder_create',
      'folder_rename',
      'folder_delete',
    ].includes(name)
  ) {
    const id = rpc.params?.arguments?.accountId;
    const scoped = new Set([
      'domain_get',
      'domain_dns_get',
      'domain_nameservers_get',
      'domain_contacts_get',
      'domain_dnssec_get',
      'domain_email_forwarding_get',
      'domain_url_forwarding_get',
      'domain_renewal_price',
      'registrar_test',
      'registrar_domains',
      'registrar_sync',
      'registrar_pricing',
      'registrar_check_availability',
      'domain_dns_set',
      'domain_nameservers_set',
      'domain_contacts_set',
      'domain_set_privacy',
      'domain_set_autorenew',
      'domain_set_lock',
      'domain_email_forwarding_set',
      'domain_url_forwarding_set',
      'domain_auth_code_get',
    ]);
    // Portfolio-wide aggregation cannot be scoped by an account selector.
    if (
      !scoped.has(name) ||
      typeof id !== 'string' ||
      !policy.accountIds.includes(id)
    )
      return 'Choose an explicitly permitted registrar account for this tool';
  }
  return null;
}
