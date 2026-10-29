import tenant from './tenant';
import { verifyGatewayRequest } from '../shared/gateway-proof';
import { provisioningHash as tokenHash } from './provisioning-hash';
import { z } from 'zod';

const schema = z
  .object({ statements: z.array(z.string().min(1).max(50000)).min(1).max(100) })
  .strict();

/** Only newly provisioned tenants use this entrypoint. The receipt and complete
 * schema commit in one D1 batch, so a lost response can be safely reconciled. */
export async function bootstrapTenant(request: Request, env: Env) {
  const expected = Reflect.get(env, 'DOMBOT_BOOTSTRAP_SHA256');
  const proof = await verifyGatewayRequest(
    env.DOMBOT_GATEWAY_SECRET ?? '',
    env.DOMBOT_WORKSPACE_ID ?? '',
    request,
  );
  if (
    request.method !== 'POST' ||
    typeof expected !== 'string' ||
    !proof ||
    proof.owner !== null ||
    proof.sales ||
    proof.mcp
  )
    return new Response('Forbidden', { status: 403 });
  const text = await request.text();
  if (text.length > 200000 || (await tokenHash(text)) !== expected)
    return new Response('Invalid schema', { status: 400 });
  const parsed = schema.safeParse(JSON.parse(text));
  if (!parsed.success) return new Response('Invalid schema', { status: 400 });
  const tables = (
    await env.DB.prepare(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
    ).all<{ name: string }>()
  ).results;
  const receiptName = 'on-demand-bootstrap:' + expected;
  if (tables.some((t) => t.name === 'd1_migrations')) {
    const receipts = (
      await env.DB.prepare(
        "SELECT name FROM d1_migrations WHERE name LIKE 'on-demand-bootstrap:%'",
      ).all<{ name: string }>()
    ).results;
    if (receipts.length)
      return Response.json(
        { ready: receipts.length === 1 && receipts[0].name === receiptName },
        {
          status:
            receipts.length === 1 && receipts[0].name === receiptName
              ? 200
              : 409,
        },
      );
  }
  if (tables.some((t) => t.name !== 'd1_migrations'))
    return new Response('Database is not new', { status: 409 });
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TEXT DEFAULT CURRENT_TIMESTAMP)',
  ).run();
  await env.DB.batch([
    ...parsed.data.statements.map((sql) => env.DB.prepare(sql)),
    env.DB.prepare('INSERT INTO d1_migrations(name) VALUES(?)').bind(
      receiptName,
    ),
  ]);
  return Response.json({ ready: true });
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === '/platform-internal/bootstrap')
      return bootstrapTenant(request, env);
    return tenant.fetch!(request, env);
  },
} satisfies ExportedHandler<Env>;
export { WorkspaceCoordinator } from './workspace-coordinator';
