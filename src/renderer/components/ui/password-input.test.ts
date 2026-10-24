import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PasswordInput } from './password-input';

describe('secret reveal control identity', () => {
  it('identifies each account secret and associates its toggle with the correct input', () => {
    const html = renderToStaticMarkup(
      createElement(
        'div',
        null,
        createElement(PasswordInput, {
          id: 'key',
          revealLabel: 'Dynadot Personal API key',
          value: 'sample-key',
          readOnly: true,
        }),
        createElement(PasswordInput, {
          id: 'secret',
          revealLabel: 'Dynadot Personal API secret',
          value: 'sample-secret',
          readOnly: true,
        }),
      ),
    );
    expect(html).toContain(
      'aria-label="Show Dynadot Personal API key" aria-controls="key"',
    );
    expect(html).toContain(
      'aria-label="Show Dynadot Personal API secret" aria-controls="secret"',
    );
    expect(html.match(/type="password"/g)).toHaveLength(2);
    expect(html).not.toContain('tabindex="-1"');
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(2);
  });
  it('generates an associated input identity when a caller does not supply one', () => {
    const html = renderToStaticMarkup(
      createElement(PasswordInput, {
        revealLabel: 'export passphrase',
        value: 'sample',
        readOnly: true,
      }),
    );
    const id = html.match(/<input[^>]* id="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`aria-controls="${id}"`);
    expect(html).toContain('aria-label="Show export passphrase"');
  });
});
