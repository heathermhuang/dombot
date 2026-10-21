/** Keep the explicit legacy editor choice when moving between its views. */
export function portfolioPagePath(
  view: 'domains' | 'settings' | 'preview' | 'review',
  search: string,
): string {
  const params = new URLSearchParams();
  if (new URLSearchParams(search).has('legacy')) params.set('legacy', '1');
  if (view !== 'settings' && view !== 'domains') params.set('view', view);
  const query = params.toString();
  return `${view === 'domains' ? '/' : '/public-page'}${query ? `?${query}` : ''}`;
}
