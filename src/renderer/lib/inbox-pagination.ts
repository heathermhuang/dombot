export function navigateInboxPage(
  history: string[],
  expectedCursor: string,
  direction: 'first' | 'previous' | 'next',
  nextCursor: string | null | undefined,
  loading: boolean,
) {
  if (loading || history.at(-1) !== expectedCursor) return history;
  if (direction === 'first') return history.length > 1 ? [''] : history;
  if (direction === 'previous')
    return history.length > 1 ? history.slice(0, -1) : history;
  // Retained response data must not add the same page twice while the next
  // request starts. An old click handler must not move a newer page either.
  return nextCursor && !history.includes(nextCursor)
    ? [...history, nextCursor]
    : history;
}
