import { describe, expect, it } from 'vitest';
import { accountForm, accountSecurity } from './views';

describe('managed account help and identity', () => {
  it('provides an actionable recovery contact at login and signup', () => {
    for (const kind of ['login', 'join'] as const)
      expect(accountForm(kind)).toContain(
        'mailto:domains@domains.domains?subject=Workspace%20account%20recovery',
      );
  });
  it('escapes the signed-in identity and workspace label in the account page', () => {
    const html = accountSecurity({
      email: 'owner@example.test',
      label: '<script>bad()</script>',
    });
    expect(html).toContain('owner@example.test');
    expect(html).toContain('&lt;script&gt;bad()&lt;/script&gt;');
    expect(html).not.toContain('<script>bad()');
  });
});
