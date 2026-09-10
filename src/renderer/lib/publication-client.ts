import { useSyncExternalStore } from 'react';
import { hostPath } from './platform';
import { PortfolioSession } from './portfolio-session';

async function request<T>(
  path = '',
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const response = await fetch(hostPath(`/publishing${path}`), {
    method,
    credentials: 'same-origin',
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
  return response.json();
}

export const portfolioEditor = new PortfolioSession({
  load: () => request(),
  save: (draft, revision) => request('', 'PUT', { draft, revision }),
  publish: (revision) => request('/publish', 'POST', { revision }),
  unpublish: (revision) => request('/unpublish', 'POST', { revision }),
});
export const usePortfolioEditor = () =>
  useSyncExternalStore(portfolioEditor.subscribe, portfolioEditor.getSnapshot);
