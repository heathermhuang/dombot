import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { workspaceSchema } from './workspaces';

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

export function relaySettings(env: HostedEnv, workspace: string) {
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
  const workspaces = workspaceSchema.parse(JSON.parse(env.WORKSPACES));
  const prefix = workspace.slice(0, 8);
  if (workspaces.filter((w) => w.id.slice(0, 8) === prefix).length !== 1)
    throw Error('Relay workspace configuration ambiguous');
  return { local, domain, prefix };
}
export function newReplyAddress(env: HostedEnv, workspace: string) {
  const settings = relaySettings(env, workspace);
  if (!settings) return null;
  const raw = randomBytes(24).toString('hex');
  return {
    raw,
    address: `${settings.local}+${settings.prefix}.${raw}@${settings.domain}`,
  };
}
