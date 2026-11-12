import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import WebEntry from './WebEntry';

it.each(['loading', 'unavailable', 'sign-in'] as const)(
  'never requests an instance password during hosted entry: %s',
  (state) => {
    const html = renderToStaticMarkup(
      createElement(WebEntry, {
        state,
        managed: true,
        returnTo:
          '/w/00000000-0000-0000-0000-000000000000/?landerConnection=saved',
        onRetry() {},
      }),
    );
    expect(html).toContain('domains.domains');
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('instance');
    if (state !== 'loading') expect(html).toContain('/login?next=%2Fw%2F');
    if (state === 'unavailable') expect(html).toContain('Try again');
  },
);
