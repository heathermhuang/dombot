import { workspaceFor, workspaceKey, workspaceService } from './workspaces';
import { signGatewayRequest, PROOF_HEADER } from '../shared/gateway-proof';
export interface ProbeFailure {
  observedAt: number;
  durationMs: number;
  attempt: number;
  phase: 'configuration' | 'transport' | 'response' | 'validation';
  code:
    | 'observer_configuration'
    | 'observer_transport'
    | 'observation_timeout'
    | 'observation_http_error'
    | 'invalid_diagnostics';
  httpStatus: number | null;
  backendFailure?: string;
  probeId?: string;
  runtimeCause?: string;
}
/** Allowlisted runtime evidence only; raw messages can contain secrets. */
export function observationRuntimeCause(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /too many subrequests|subrequest limit|too many worker invocations/i.test(
      message,
    )
  )
    return 'invocation_limit';
  if (/cpu.*limit|exceeded.*cpu/i.test(message)) return 'cpu_limit';
  if (/memory.*limit|exceeded.*memory/i.test(message)) return 'memory_limit';
  if (/network connection lost|connection reset|ECONNRESET/i.test(message))
    return 'connection_lost';
  if (/will never generate a response|hung request/i.test(message))
    return 'runtime_hung';
  if (/D1_ERROR|D1_TIMEOUT/i.test(message)) return 'd1_error';
  return 'unclassified';
}
export interface ProbeReport {
  at: number;
  durationMs: number;
  attempts: number;
  backend: 'direct-d1' | 'coordinator' | 'unknown';
  readMs: number | null;
  failure: ProbeFailure | null;
}
export class ObservationFailure extends Error {
  constructor(readonly probe: ProbeReport) {
    super('Workspace observation unavailable');
  }
}

/** Private cached reads only. One bounded retry handles transient read failures;
 * every attempt receives a fresh proof and its own cancellation signal. */
export async function readWorkspace<T>(
  env: HostedEnv,
  workspace: string,
  endpoint: 'sync-monitor' | 'admin-inventory',
  validate: (value: unknown) => T,
  options: {
    revision?: string;
    body?: unknown;
    timeoutMs?: number;
    attempts?: number;
    backoffMs?: number;
  } = {},
): Promise<{ value: T; probe: ProbeReport }> {
  const started = Date.now();
  let failure: ProbeFailure | null = null;
  const attempts = options.attempts ?? (endpoint === 'sync-monitor' ? 2 : 1);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const probeId = crypto.randomUUID();
    const at = Date.now(),
      controller = new AbortController();
    let phase = 'configuration',
      status: number | null = null;
    let backend: ProbeReport['backend'] = 'unknown';
    let backendFailure: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retryable = false,
      retryAfter = options.backoffMs ?? 250;
    try {
      const work = async () => {
        const configured = await workspaceFor(env, workspace);
        if (!configured) throw Error('Configuration unavailable');
        const key = await workspaceKey(env, workspace);
        controller.signal.throwIfAborted();
        const url = new URL(
          'https://workspace.internal/platform-internal/' + endpoint,
        );
        if (options.revision)
          url.searchParams.set('revision', options.revision);
        const request = new Request(url, {
          method: options.body === undefined ? 'GET' : 'POST',
          body:
            options.body === undefined
              ? undefined
              : JSON.stringify(options.body),
          signal: controller.signal,
          headers:
            options.body === undefined
              ? {}
              : { 'Content-Type': 'application/json' },
        });
        request.headers.set('X-DomBot-Observation-ID', probeId);
        if (attempt > 1)
          request.headers.set('X-DomBot-Observation-Debug', 'retry');
        request.headers.set(
          PROOF_HEADER,
          await signGatewayRequest(key, workspace, null, request),
        );
        controller.signal.throwIfAborted();
        phase = 'transport';
        retryable = true;
        const response = await workspaceService(env, configured.binding).fetch(
          request,
        );
        status = response.status;
        const pathHint = response.headers.get('X-DomBot-Monitor-Path');
        backend =
          pathHint === 'direct-d1'
            ? 'direct-d1'
            : pathHint === 'coordinator'
              ? 'coordinator'
              : 'unknown';
        const fault = response.headers.get('X-DomBot-Monitor-Failure');
        backendFailure =
          fault &&
          [
            'storage',
            'envelope',
            'decryption',
            'validation',
            'unknown',
          ].includes(fault)
            ? fault
            : undefined;
        phase = 'response';
        if (!response.ok) {
          retryable = [429, 500, 502, 503, 504].includes(status);
          const after = response.headers.get('retry-after');
          if (after) {
            const delay = Number.isFinite(Number(after))
              ? Number(after) * 1000
              : Date.parse(after) - Date.now();
            if (delay > 1000) retryable = false;
            else if (delay > retryAfter) retryAfter = delay;
          }
          await response.body?.cancel();
          throw Error('HTTP observation failed');
        }
        phase = 'validation';
        retryable = false;
        const json: unknown = await response.json();
        const value = validate(json);
        const path = response.headers.get('X-DomBot-Monitor-Path');
        const ms = Number(response.headers.get('X-DomBot-Monitor-Read-Ms'));
        return {
          value,
          backend:
            path === 'direct-d1'
              ? ('direct-d1' as const)
              : path === 'coordinator'
                ? ('coordinator' as const)
                : ('unknown' as const),
          readMs:
            response.headers.has('X-DomBot-Monitor-Read-Ms') &&
            Number.isFinite(ms) &&
            ms >= 0 &&
            ms < 120000
              ? ms
              : null,
        };
      };
      const result = await Promise.race([
        work(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(Error('Observation timeout'));
          }, options.timeoutMs ?? 8000);
        }),
      ]);
      if (timer) clearTimeout(timer);
      return {
        value: result.value,
        probe: {
          at: started,
          durationMs: Date.now() - started,
          attempts: attempt,
          backend: result.backend,
          readMs: result.readMs,
          failure,
        },
      };
    } catch (error) {
      if (timer) clearTimeout(timer);
      failure = {
        observedAt: at,
        probeId,
        durationMs: Date.now() - at,
        attempt,
        phase: phase as ProbeFailure['phase'],
        code: controller.signal.aborted
          ? 'observation_timeout'
          : phase === 'configuration'
            ? 'observer_configuration'
            : phase === 'transport'
              ? 'observer_transport'
              : phase === 'response' && status !== null && status >= 400
                ? 'observation_http_error'
                : 'invalid_diagnostics',
        httpStatus: status,
        ...(backendFailure ? { backendFailure } : {}),
        runtimeCause: controller.signal.aborted
          ? 'deadline'
          : observationRuntimeCause(error),
      };
      retryable = controller.signal.aborted || retryable;
      // Preserve a sanitized first failure even when the retry recovers.
      console.warn(
        'workspace-observation',
        JSON.stringify({
          workspace,
          ...failure,
          retrying: retryable && attempt < attempts,
        }),
      );
      if (!retryable || attempt === attempts)
        throw new ObservationFailure({
          at: started,
          durationMs: Date.now() - started,
          attempts: attempt,
          backend,
          readMs: null,
          failure,
        });
      await new Promise((resolve) => setTimeout(resolve, retryAfter));
    }
  }
  throw Error('Observation attempt budget exhausted');
}
