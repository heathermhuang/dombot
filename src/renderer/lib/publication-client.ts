import { useSyncExternalStore } from 'react';
import { hostPath } from './platform';
import { PortfolioSession } from './portfolio-session';

export async function publicationRequest<T>(
  path = '',
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  // Bound reads through body consumption too. A stalled read must release the
  // session's in-flight load so the workspace can show recovery controls.
  // Writes keep their existing semantics: aborting cannot undo a server write.
  const controller = method === 'GET' ? new AbortController() : null;
  let timedOut = false;
  const timer = controller
    ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 15_000)
    : undefined;
  try {
    const response = await fetch(hostPath(`/publishing${path}`), {
      method,
      credentials: 'same-origin',
      ...(controller || signal
        ? {
            signal: controller
              ? signal
                ? AbortSignal.any([signal, controller.signal])
                : controller.signal
              : signal,
          }
        : {}),
      ...(body === undefined
        ? {}
        : {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
    });
    if (!response.ok) {
      const value = await response.json().catch(() => ({}));
      throw Object.assign(
        new Error(
          value.error ||
            'Could not reach the portfolio editor. Your edits are still here.',
        ),
        { status: response.status },
      );
    }
    return await response.json();
  } catch (error) {
    if (timedOut)
      throw new Error(
        'Loading your portfolio timed out. Check your connection and try again.',
      );
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export const portfolioEditor = new PortfolioSession({
  load: () => publicationRequest(),
  save: (draft, revision) => publicationRequest('', 'PUT', { draft, revision }),
  publish: (revision) => publicationRequest('/publish', 'POST', { revision }),
  unpublish: (revision) =>
    publicationRequest('/unpublish', 'POST', { revision }),
});
export const usePortfolioEditor = () =>
  useSyncExternalStore(portfolioEditor.subscribe, portfolioEditor.getSnapshot);
