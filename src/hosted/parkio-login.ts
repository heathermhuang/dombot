import { z } from 'zod';
import { ParkioPilot } from './parkio-pilot';
import { PilotError } from './parkio-pilot-contract';
const identity = z.string().uuid();
const intentSchema = z
  .object({
    id: identity,
    sourceId: identity,
    expectedEpoch: z.number().int().positive().nullable(),
    sessionHash: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: z.number().int(),
  })
  .strict();
type Intent = z.infer<typeof intentSchema>;
/** One temporary, owner/session-bound sign-in per workspace. No permanent browser. */
export class ParkioLogin {
  #tail: Promise<unknown> = Promise.resolve();
  #serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#tail.then(work);
    this.#tail = next.catch(() => {});
    return next;
  }
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: HostedEnv,
  ) {}
  private async context() {
    const scope = await this.ctx.storage.get<{
      workspace: string;
      owner: string;
    }>('scope');
    if (!scope) throw new PilotError('not_started');
    const actor = 'parkio-login/v1/' + scope.workspace + '/' + scope.owner;
    const pilot = new ParkioPilot(
      this.ctx,
      {
        ...this.env,
        PARKIO_PILOT_OWNER_ID: actor,
        PARKIO_PILOT_SECRET: this.env.PARKIO_LOGIN_SECRET,
        PARKIO_PILOT_ENABLED: 'true',
        PARKIO_PILOT_EXPIRES_AT: new Date(Date.now() + 86400000).toISOString(),
      },
      {
        captureRetentionMs: 15 * 60000,
        automaticFollowups: false,
        acceptCookieRotation: true,
      },
    );
    return { scope, pilot };
  }
  private async release(pilot: ParkioPilot) {
    const state = await pilot.status();
    if (
      ('browserClosed' in state && state.browserClosed) ||
      state.phase === 'not_started'
    ) {
      const { scope } = await this.context();
      await this.env.CONTROL_DB.prepare(
        'DELETE FROM parkio_login_slots WHERE scope=?',
      )
        .bind(scope.workspace + '/' + scope.owner)
        .run();
    }
    if (
      [
        'login',
        'checking',
        'closing',
        'ready',
        'rechecking',
        'passed',
      ].includes(state.phase)
    ) {
      const due = Math.min(
        ('expiresAt' in state ? state.expiresAt : undefined) ??
          Date.now() + 30000,
        Date.now() + 30000,
      );
      const current = await this.ctx.storage.getAlarm();
      if (!current || current > due)
        await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, due));
    }
    return state;
  }
  fetch(request: Request) {
    return this.#serial(() => this.handle(request));
  }
  private async handle(request: Request) {
    if (
      request.method !== 'POST' ||
      new URL(request.url).origin !== 'https://parkio-login.internal'
    )
      return new Response('Forbidden', { status: 403 });
    try {
      const owner = identity.parse(request.headers.get('X-Parkio-Owner')),
        workspace = identity.parse(request.headers.get('X-Parkio-Workspace')),
        sessionHash = z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .parse(request.headers.get('X-Parkio-Session'));
      if (
        this.ctx.id.toString() !==
          this.env
            .PARKIO_LOGIN!.idFromName(workspace + '/' + owner)
            .toString() ||
        (this.env.PARKIO_LOGIN_SECRET?.length ?? 0) < 32
      )
        throw new PilotError('scope_mismatch');
      const previous = await this.ctx.storage.get<{
        workspace: string;
        owner: string;
      }>('scope');
      if (
        previous &&
        (previous.owner !== owner || previous.workspace !== workspace)
      )
        throw new PilotError('scope_mismatch');
      if (!previous) await this.ctx.storage.put('scope', { workspace, owner });
      const { pilot } = await this.context();
      const action = new URL(request.url).pathname.slice(1);
      const savedIntent = await this.ctx.storage.get<unknown>('intent');
      let intent: Intent | undefined = savedIntent
        ? intentSchema.parse(savedIntent)
        : undefined;
      if (action === 'start') {
        const p = z
          .object({
            sourceId: identity,
            intentKey: identity,
            expectedEpoch: z.number().int().positive().nullable(),
          })
          .strict()
          .parse(await request.json());
        if (intent?.id === p.intentKey && intent.sourceId !== p.sourceId)
          throw new PilotError('conflict');
        if (
          intent &&
          (intent.sessionHash !== sessionHash ||
            intent.sourceId !== p.sourceId ||
            intent.createdAt + 10 * 60000 <= Date.now() ||
            intent.id !== p.intentKey ||
            (await this.ctx.storage.get('completed')) === intent.id)
        ) {
          await pilot.cancel();
          const state = await this.release(pilot);
          if ('browserClosed' in state && !state.browserClosed)
            throw new PilotError('cleanup_required');
          intent = undefined;
        }
        if (!intent) {
          intent = {
            id: p.intentKey,
            sourceId: p.sourceId,
            expectedEpoch: p.expectedEpoch,
            sessionHash,
            createdAt: Date.now(),
          };
          await this.ctx.storage.delete('completed');
          await this.ctx.storage.put('intent', intent);
        }
        const scope = workspace + '/' + owner;
        const row = await this.env.CONTROL_DB.prepare(
          'INSERT INTO parkio_login_slots(scope,acquired_at) SELECT ?,? WHERE (SELECT COUNT(*) FROM parkio_login_slots)<2 ON CONFLICT(scope) DO UPDATE SET scope=excluded.scope RETURNING scope',
        )
          .bind(scope, Date.now())
          .first();
        if (
          !row &&
          !(await this.env.CONTROL_DB.prepare(
            'SELECT 1 FROM parkio_login_slots WHERE scope=?',
          )
            .bind(scope)
            .first())
        )
          throw new PilotError('browser_capacity');
        try {
          const state = await pilot.start();
          await this.release(pilot);
          return Response.json({ ...state, intentId: intent.id });
        } catch (error) {
          await this.release(pilot);
          throw error;
        }
      }
      if (!intent || intent.sessionHash !== sessionHash)
        throw new PilotError('session_changed');
      if (
        action !== 'cancelSession' &&
        request.headers.get('X-Parkio-Intent') !== intent.id
      )
        throw new PilotError('connection_replaced');
      if (action === 'cancelSession') {
        const state = await pilot.cancel();
        await this.release(pilot);
        return Response.json(state);
      }
      if (action === 'intent')
        return Response.json({
          id: intent.id,
          sourceId: intent.sourceId,
          expectedEpoch: intent.expectedEpoch,
          completed: (await this.ctx.storage.get('completed')) === intent.id,
        });
      if (
        action === 'status' &&
        (await this.ctx.storage.get('completed')) === intent.id
      )
        return Response.json({
          phase: 'connected',
          browserClosed: true,
          sourceId: intent.sourceId,
        });
      if (action === 'candidate') {
        if (intent.createdAt + 25 * 60000 <= Date.now())
          throw new PilotError('connection_expired');
        const candidate = await pilot.candidate();
        return Response.json({ ...candidate, intent });
      }
      if (action === 'transferred') {
        await pilot.cancel();
        await this.release(pilot);
        await this.ctx.storage.put('completed', intent.id);
        return Response.json({ transferred: true, sourceId: intent.sourceId });
      }
      const actions = {
        status: () => pilot.status(),
        mobile: () => pilot.mobile(),
        view: () => pilot.view(),
        complete: () => pilot.complete(),
        proof: () => pilot.proof(),
        cancel: () => pilot.cancel(),
      };
      if (!Object.hasOwn(actions, action))
        return new Response('Not found', { status: 404 });
      const value = await actions[action as keyof typeof actions]();
      await this.release(pilot);
      return Response.json(value);
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof PilotError
              ? error.code
              : error instanceof z.ZodError
                ? 'invalid_request'
                : 'connection_unavailable',
        },
        { status: 409 },
      );
    }
  }
  alarm() {
    return this.#serial(async () => {
      const { pilot } = await this.context();
      const intent = await this.ctx.storage.get<Intent>('intent');
      const scope = await this.ctx.storage.get<{
        owner: string;
        workspace: string;
      }>('scope');
      let valid = false;
      try {
        valid = !!(
          intent &&
          scope &&
          (await this.env.CONTROL_DB.prepare(
            'SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id JOIN workspaces w ON w.id=u.workspace_id WHERE s.token_hash=? AND s.expires_at>? AND u.id=? AND w.id=? AND w.enabled=1',
          )
            .bind(intent.sessionHash, Date.now(), scope.owner, scope.workspace)
            .first())
        );
      } catch {
        /* Unavailable authorization cannot extend interactive provider access. */
      }
      if (!valid) await pilot.cancel();
      else await pilot.alarm();
      await this.release(pilot);
    });
  }
}
