import { describe, expect, it } from 'vitest';
import { accountForm, accountSecurity, recoveryForm } from './views';

describe('managed account help and identity', () => {
  it('provides an actionable recovery contact at login and signup', () => {
    for (const kind of ['login', 'join'] as const)
      expect(accountForm(kind)).toContain('href="/recover"');
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
  it('escapes retained form context and never fills a password after an error', () => {
    const html = accountForm('login', 'Try again', '', '/app', {
      email: '"><script>bad()</script>',
      notice: '<script>notice()</script>',
    });
    expect(html).toContain(
      'value="&quot;&gt;&lt;script&gt;bad()&lt;/script&gt;"',
    );
    expect(html).not.toContain('<script>');
    const passwordInput = html.match(/<input[^>]*type="password"[^>]*>/)?.[0];
    expect(passwordInput).toContain('autocomplete="current-password"');
    expect(passwordInput).not.toContain('value=');
  });
  it('keeps a valid recovery code on validation errors without accepting malformed markup', () => {
    const html = recoveryForm('a'.repeat(64), '<script>bad()</script>');
    expect(html).toContain('role="alert"');
    expect(html).toContain('name="code" value="' + 'a'.repeat(64) + '"');
    expect(html).not.toContain('<script>');
    expect(recoveryForm('"><script>bad()</script>')).not.toContain(
      'name="code"',
    );
  });
});
