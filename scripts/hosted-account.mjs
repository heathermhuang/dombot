// Private operator workflow. Requests and issued links stay in owner-only files;
// stdout contains counts and receipt locations, never credentials or invite codes.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
const args = process.argv.slice(2),
  action = args.shift();
const option = (name) => {
  const i = args.indexOf('--' + name);
  return i < 0 ? undefined : args[i + 1];
};
if (
  !['status', 'invite', 'recovery', 'reconcile'].includes(action) ||
  !option('config')
)
  throw Error(
    'Usage: node scripts/hosted-account.mjs status|invite|recovery|reconcile --config private-gateway.json [--request private-request.json --output private-receipt.json]',
  );
const config = JSON.parse(await fs.readFile(option('config'), 'utf8'));
if (
  !/^[a-f0-9]{32}$/.test(config.account_id) ||
  config.name !== 'domains-staging'
)
  throw Error('Use the existing managed gateway config');
const token =
  process.env.CLOUDFLARE_API_TOKEN ||
  (
    await fs.readFile(
      path.join(os.homedir(), '.wrangler/config/default.toml'),
      'utf8',
    )
  ).match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
if (!token)
  throw Error('Existing Cloudflare operator authentication unavailable');
const cf = async (endpoint, body) => {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${config.account_id}${endpoint}`,
    {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    },
  );
  const v = await r.json();
  if (!r.ok || !v.success)
    throw Error(
      `Operator request did not complete: HTTP ${r.status}; reconcile the receipt before retrying`,
    );
  return v.result;
};
const live = await cf(`/workers/scripts/${config.name}/settings`);
const binding = (name) => live.bindings.find((b) => b.name === name);
const db = binding('CONTROL_DB')?.id;
const rows = JSON.parse(binding('WORKSPACES')?.text ?? '[]');
if (
  !db ||
  rows.length > 32 ||
  rows.some((r) => !/^WORKSPACE_(?:[0-9]|[12][0-9]|3[01])$/.test(r.binding)) ||
  new Set(rows.map((r) => r.id)).size !== rows.length
)
  throw Error('Invalid live workspace registry');
const origin = binding('CANONICAL_ORIGIN')?.text;
if (!origin || new URL(origin).protocol !== 'https:')
  throw Error('Verified canonical HTTPS origin is required');
const query = async (sql, params = []) =>
  (await cf(`/d1/database/${db}/query`, { sql, params }))[0].results;
const hash = (x) => createHash('sha256').update(x).digest('hex');
if (action === 'status') {
  const status = await query(
    'SELECT w.id, w.enabled, (SELECT count(*) FROM users u WHERE u.workspace_id=w.id) AS claimed, (SELECT count(*) FROM invitations i WHERE i.workspace_id=w.id AND i.consumed_at IS NULL AND i.expires_at>?) AS invited FROM workspaces w',
    [Date.now()],
  );
  const active = status.filter(
    (w) => w.enabled && rows.some((r) => r.id === w.id),
  );
  console.log(
    JSON.stringify({
      configured: rows.length,
      enabled: active.length,
      claimed: active.filter((w) => w.claimed).length,
      available: active.filter((w) => !w.claimed && !w.invited).length,
      pendingInvitations: active.reduce((n, w) => n + w.invited, 0),
    }),
  );
} else {
  const output = option('output');
  if (!output) throw Error('Provide an owner-only --output receipt path');
  let receipt;
  try {
    receipt = JSON.parse(await fs.readFile(output, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const save = async () => {
    await fs.mkdir(path.dirname(path.resolve(output)), {
      recursive: true,
      mode: 0o700,
    });
    await fs.writeFile(output, JSON.stringify(receipt, null, 2) + '\n', {
      mode: 0o600,
    });
    await fs.chmod(output, 0o600);
  };
  if (receipt) {
    if (receipt.database !== db || receipt.account !== config.account_id)
      throw Error('Receipt target does not match gateway');
    const existing = await query(
      `SELECT expires_at,consumed_at FROM ${receipt.kind === 'invite' ? 'invitations' : 'password_resets'} WHERE token_hash=?`,
      [hash(new URL(receipt.url).searchParams.get('code'))],
    );
    receipt.state = existing.length
      ? existing[0].consumed_at
        ? 'consumed'
        : existing[0].expires_at > Date.now()
          ? 'active'
          : 'expired'
      : 'not_found';
    await save();
    if (action === 'reconcile' || receipt.state !== 'not_found') {
      console.log(JSON.stringify({ state: receipt.state, receipt: output }));
      process.exit(0);
    }
    throw Error(
      'Pending operation is absent. Inspect the saved receipt before choosing a new output/request; no automatic reissue occurred',
    );
  }
  if (action === 'reconcile') throw Error('Receipt does not exist');
  const input = JSON.parse(await fs.readFile(option('request'), 'utf8'));
  if (
    typeof input.email !== 'string' ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) ||
    input.email.length > 254
  )
    throw Error('Request a valid customer email');
  const email = input.email.trim().toLowerCase(),
    code = randomBytes(32).toString('hex'),
    now = Date.now();
  if (
    action === 'recovery' &&
    (input.identityVerified !== true ||
      typeof input.caseRef !== 'string' ||
      !input.caseRef.trim() ||
      input.caseRef.length > 200)
  )
    throw Error(
      'Recovery requires independently verified identity and a support case reference',
    );
  let workspaceId, userId;
  if (action === 'invite') {
    if ((await query('SELECT id FROM users WHERE email=?', [email])).length)
      throw Error('Account already exists; use recovery after verification');
    if (
      (
        await query(
          'SELECT workspace_id FROM invitations WHERE email=? AND consumed_at IS NULL AND expires_at>?',
          [email, now],
        )
      ).length
    )
      throw Error(
        'An invitation is already active for this email; reconcile its original receipt',
      );
    const available = await query(
      'SELECT w.id FROM workspaces w WHERE w.enabled=1 AND NOT EXISTS(SELECT 1 FROM users u WHERE u.workspace_id=w.id) AND NOT EXISTS(SELECT 1 FROM invitations i WHERE i.workspace_id=w.id AND (i.consumed_at IS NOT NULL OR i.expires_at>?)) ORDER BY CASE WHEN EXISTS(SELECT 1 FROM invitations i WHERE i.workspace_id=w.id AND i.email=?2) THEN 0 ELSE 1 END,w.label',
      [now, email],
    );
    workspaceId = available.find((w) => rows.some((r) => r.id === w.id))?.id;
    if (!workspaceId)
      throw Error(
        'No ready workspace is available. Provision and qualify capacity first',
      );
  } else {
    const user = (
      await query(
        'SELECT u.id,u.workspace_id FROM users u JOIN workspaces w ON w.id=u.workspace_id WHERE u.email=? AND w.enabled=1',
        [email],
      )
    )[0];
    if (!user || !rows.some((w) => w.id === user.workspace_id))
      throw Error('Enabled account not found');
    userId = user.id;
    workspaceId = user.workspace_id;
  }
  receipt = {
    kind: action,
    account: config.account_id,
    database: db,
    workspaceId,
    email,
    caseRef: input.caseRef ?? null,
    expiresAt: now + (action === 'recovery' ? 900000 : 86400000),
    state: 'pending',
    url: `${origin}/${action === 'invite' ? 'join' : 'recover'}?code=${code}`,
  };
  await save();
  const result =
    action === 'invite'
      ? await query(
          'INSERT INTO invitations(token_hash,email,workspace_id,expires_at) SELECT ?1,?2,?3,?4 WHERE EXISTS(SELECT 1 FROM workspaces WHERE id=?3 AND enabled=1) AND NOT EXISTS(SELECT 1 FROM users WHERE workspace_id=?3) ON CONFLICT(workspace_id) DO UPDATE SET token_hash=excluded.token_hash,email=excluded.email,expires_at=excluded.expires_at WHERE invitations.consumed_at IS NULL AND invitations.expires_at<=?5 RETURNING workspace_id',
          [hash(code), email, workspaceId, receipt.expiresAt, now],
        )
      : await query(
          'INSERT INTO password_resets(token_hash,user_id,expires_at,operator_case) SELECT ?1,?2,?3,?4 WHERE EXISTS(SELECT 1 FROM users u JOIN workspaces w ON w.id=u.workspace_id WHERE u.id=?2 AND w.enabled=1) ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at,operator_case=excluded.operator_case,consumed_at=NULL,consumption_id=NULL RETURNING user_id',
          [hash(code), userId, receipt.expiresAt, input.caseRef],
        );
  receipt.state = result.length === 1 ? 'active' : 'conflict';
  await save();
  if (receipt.state !== 'active')
    throw Error(
      'Slot changed while issuing the link. Saved receipt records conflict; no second slot was allocated',
    );
  console.log(
    JSON.stringify({
      state: receipt.state,
      kind: action,
      receipt: output,
      expiresAt: new Date(receipt.expiresAt).toISOString(),
    }),
  );
}
