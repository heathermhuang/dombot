import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { workspaceFor, workspaceSchema } from './workspaces';

export function relayDisplayName(name: string): string {
  const safe = [...name]
    .slice(0, 100)
    .map((char) => {
      const code = char.codePointAt(0)!;
      return code < 32 || code === 127 ? ' ' : char;
    })
    .join('')
    .trim();
  return `${safe || 'Conversation'} via domains.domains`;
}

/** A reply prefix must identify one immutable account across both routing models.
 * Include disabled/reserved rows in the collision check so a stale alias cannot
 * become authority for a newly admitted account with the same prefix. */
export async function relayWorkspaceForPrefix(env: HostedEnv, prefix: string) {
  if (env.SALES_RELAY_ENABLED !== 'true' || !/^[a-f0-9]{8}$/.test(prefix))
    return null;
  const allowed = z
    .array(z.string().uuid())
    .max(32)
    .parse(JSON.parse(env.SALES_RELAY_WORKSPACES ?? '[]'));
  if (!allowed.some((id) => id.slice(0, 8) === prefix)) return null;
  const legacy = workspaceSchema.parse(JSON.parse(env.WORKSPACES));
  const ids = new Set(
    legacy.filter((w) => w.id.slice(0, 8) === prefix).map((w) => w.id),
  );
  if (env.PLATFORM_ENABLED === 'true') {
    const rows = await env.CONTROL_DB.prepare(
      'SELECT id FROM workspaces WHERE substr(id,1,8)=? LIMIT 2',
    )
      .bind(prefix)
      .all<{ id: string }>();
    for (const row of rows.results) ids.add(row.id);
  }
  if (ids.size !== 1) return null;
  const [id] = ids;
  if (!allowed.includes(id)) return null;
  return (await workspaceFor(env, id)) ? id : null;
}

export async function relaySettings(env: HostedEnv, workspace: string) {
  if (env.SALES_RELAY_ENABLED !== 'true') return null;
  const allowed = z
    .array(z.string().uuid())
    .max(32)
    .parse(JSON.parse(env.SALES_RELAY_WORKSPACES ?? '[]'));
  if (!allowed.includes(workspace)) return null;
  const address = z.string().email().parse(env.SALES_RELAY_ADDRESS);
  const [local, domain] = address.toLowerCase().split('@');
  if (!/^[a-z0-9_-]{1,5}$/.test(local))
    throw Error('Relay address configuration invalid');
  const prefix = workspace.slice(0, 8);
  if ((await relayWorkspaceForPrefix(env, prefix)) !== workspace)
    throw Error('Relay workspace configuration ambiguous or unavailable');
  return { local, domain, prefix };
}
export async function newReplyAddress(env: HostedEnv, workspace: string) {
  const settings = await relaySettings(env, workspace);
  if (!settings) return null;
  const raw = randomBytes(24).toString('hex');
  return {
    raw,
    address: `${settings.local}+${settings.prefix}.${raw}@${settings.domain}`,
  };
}
