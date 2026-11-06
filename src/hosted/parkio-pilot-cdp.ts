import { PilotError } from './parkio-pilot-contract';
import type { BrowserRun } from '../../hosted/browser-run-types';

/** Native binding: no client library or account API token in the Worker. */
export async function withPilotPage<T>(
  browser: BrowserRun,
  session: string,
  target: string,
  work: (
    command: <R>(
      method: string,
      params?: Record<string, unknown>,
    ) => Promise<R>,
  ) => Promise<T>,
): Promise<T> {
  const connection = await browser.connectSession(session, {
    targetId: target,
  });
  const response = await connection.webSocket.fetch(
    'https://browser-binding.invalid',
    { headers: { Upgrade: 'websocket' } },
  );
  if (!response.webSocket) throw new PilotError('browser_unavailable');
  const socket = response.webSocket;
  socket.accept();
  let id = 0;
  const command = <R>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<R> =>
    new Promise((resolve, reject) => {
      const current = ++id;
      const cleanup = () => {
        clearTimeout(timer);
        socket.removeEventListener('message', message);
        socket.removeEventListener('close', close);
        socket.removeEventListener('error', close);
      };
      const close = () => {
        cleanup();
        reject(new PilotError('browser_unavailable'));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new PilotError('browser_timeout'));
      }, 20_000);
      const message = (event: { data: unknown }) => {
        let value: { id?: number; result: R; error?: unknown };
        try {
          value = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (value.id !== current) return;
        cleanup();
        if (value.error) reject(new PilotError('browser_command_failed'));
        else resolve(value.result);
      };
      socket.addEventListener('message', message);
      socket.addEventListener('close', close);
      socket.addEventListener('error', close);
      try {
        socket.send(JSON.stringify({ id: current, method, params }));
      } catch {
        close();
      }
    });
  try {
    return await work(command);
  } finally {
    socket.close();
  }
}

export async function evaluatePilot<T>(
  command: <R>(method: string, params?: Record<string, unknown>) => Promise<R>,
  expression: string,
): Promise<T> {
  const value = await command<{
    result: { value?: T };
    exceptionDetails?: unknown;
  }>('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (value.exceptionDetails || value.result.value === undefined)
    throw new PilotError('browser_read_failed');
  return value.result.value;
}
