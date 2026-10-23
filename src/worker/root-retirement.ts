import { parseRootSecret, rootGeneration } from './keys';
import {
  buildAuthConfig,
  checkPassword,
  isAuthenticated,
  sameOrigin,
} from './auth';
import {
  clearLoginAttempts,
  loginSource,
  reserveLoginAttempt,
} from './login-rate-limit';

const ROOT_HEADER = 'X-DomBot-Root-Generation';
const unavailable = () =>
  Response.json(
    {
      error:
        'This encryption root is retired. Wait for the new runtime or restore the sealed backup.',
    },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );

/** D1 serializes admission with retirement across isolates. Leases never expire
 * automatically: an ambiguous abandoned writer must hold the rotation closed. */
export async function acquireRootLease(
  db: D1Database,
  root: string,
): Promise<string | null> {
  const id = crypto.randomUUID();
  const row = await db
    .prepare(
      `INSERT INTO root_request_leases(request_id,root_id,started_at)
    SELECT ?1,?2,?3 WHERE NOT EXISTS(SELECT 1 FROM retired_roots WHERE root_id=?2)
    RETURNING request_id`,
    )
    .bind(id, root, Date.now())
    .first<{ request_id: string }>();
  return row?.request_id ?? null;
}

export async function releaseRootLease(
  db: D1Database,
  id: string,
): Promise<void> {
  await db
    .prepare('DELETE FROM root_request_leases WHERE request_id=?1')
    .bind(id)
    .run();
}

export async function retireRoot(db: D1Database, root: string, next: string) {
  const rows = await db.batch([
    db
      .prepare(
        `INSERT INTO retired_roots(root_id,next_root_id,retired_at) VALUES(?1,?2,?3)
      ON CONFLICT(root_id) DO NOTHING`,
      )
      .bind(root, next, Date.now()),
    db
      .prepare(
        'SELECT next_root_id,export_started_at FROM retired_roots WHERE root_id=?1',
      )
      .bind(root),
    db
      .prepare(
        'SELECT COUNT(*) AS active FROM root_request_leases WHERE root_id=?1',
      )
      .bind(root),
  ]);
  return {
    next: (rows[1].results[0] as { next_root_id: string }).next_root_id,
    exportStarted: (rows[1].results[0] as { export_started_at: number | null })
      .export_started_at,
    active: (rows[2].results[0] as { active: number }).active,
  };
}

/** Called before boot, hydration, public inquiry writes, MCP, or scheduled work. */
export async function withRootLease(
  env: Env,
  work: () => Promise<Response>,
  request?: Request,
): Promise<Response> {
  if (env.DOMBOT_AUTH === 'gateway') return work();
  const root = await rootGeneration(parseRootSecret(env.DOMBOT_SECRET));
  const required = request?.headers.get(ROOT_HEADER);
  if (required && required !== root)
    return Response.json(
      { error: 'Encryption root changed; no operation performed' },
      { status: 409 },
    );
  const lease = await acquireRootLease(env.DB, root);
  if (!lease) return unavailable();
  try {
    const response = await work();
    const headers = new Headers(response.headers);
    headers.set(ROOT_HEADER, root);
    headers.set('Cache-Control', 'no-store');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } finally {
    await releaseRootLease(env.DB, lease);
  }
}

/** Retirement itself cannot hold a lease it then waits to drain. It requires
 * a current owner session, the current password, and the same-origin signal. */
export async function retireRootRequest(
  request: Request,
  env: Env,
  exportFinal: () => Promise<Response>,
): Promise<Response> {
  if (env.DOMBOT_AUTH && env.DOMBOT_AUTH !== 'password')
    return Response.json(
      { error: 'Password-mode rotation only' },
      { status: 404 },
    );
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const rootBytes = parseRootSecret(env.DOMBOT_SECRET);
  const root = await rootGeneration(rootBytes);
  if (request.headers.get(ROOT_HEADER) !== root)
    return new Response(null, { status: 409 });
  const auth = await buildAuthConfig(env, rootBytes);
  if (!(await isAuthenticated(auth, request, env.DB)))
    return new Response(null, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    password?: unknown;
    nextRoot?: unknown;
  } | null;
  const source = await loginSource(request, auth.sessionKey!);
  if (!source) return new Response(null, { status: 503 });
  const wait = await reserveLoginAttempt(env.DB, source);
  if (wait > 0)
    return new Response(null, {
      status: 429,
      headers: { 'Retry-After': String(Math.ceil(wait / 1000)) },
    });
  if (
    typeof body?.password !== 'string' ||
    !(await checkPassword(auth, body.password))
  )
    return new Response(null, { status: 403 });
  await clearLoginAttempts(env.DB, source);
  if (
    typeof body.nextRoot !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(body.nextRoot) ||
    body.nextRoot === root
  )
    return Response.json(
      { error: 'A different root generation is required' },
      { status: 400 },
    );
  const state = await retireRoot(env.DB, root, body.nextRoot);
  if (state.next !== body.nextRoot)
    return Response.json(
      { error: 'Another rotation already retired this root' },
      { status: 409 },
    );
  if (state.exportStarted !== null)
    return Response.json(
      {
        error:
          'Final export already started. Preserve the sealed backup and inspect rotation state before recovery.',
      },
      { status: 409 },
    );
  if (state.active === 0) {
    // Exactly one maintenance export after all admitted old-root work drains.
    const lease = crypto.randomUUID();
    const admission = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO root_request_leases(request_id,root_id,started_at)
      SELECT ?1,?2,?3 WHERE NOT EXISTS(SELECT 1 FROM root_request_leases WHERE root_id=?2)
      AND EXISTS(SELECT 1 FROM retired_roots WHERE root_id=?2 AND export_started_at IS NULL)
      RETURNING request_id`,
      ).bind(lease, root, Date.now()),
      env.DB.prepare(
        `UPDATE retired_roots SET export_started_at=?3 WHERE root_id=?2
        AND EXISTS(SELECT 1 FROM root_request_leases WHERE request_id=?1)`,
      ).bind(lease, root, Date.now()),
    ]);
    if (admission[0].results.length) {
      try {
        const response = await exportFinal();
        if (!response.ok) return response;
        const exported = (await response.json()) as { result?: unknown };
        if (typeof exported.result !== 'string')
          throw new Error('Final rotation export failed');
        return Response.json(
          {
            root,
            nextRoot: state.next,
            active: 0,
            drained: true,
            bundle: exported.result,
          },
          {
            headers: { [ROOT_HEADER]: root, 'Cache-Control': 'no-store' },
          },
        );
      } finally {
        await releaseRootLease(env.DB, lease);
      }
    }
  }
  return Response.json(
    {
      root,
      nextRoot: state.next,
      active: Math.max(1, state.active),
      drained: false,
    },
    {
      status: 202,
      headers: { [ROOT_HEADER]: root, 'Cache-Control': 'no-store' },
    },
  );
}
