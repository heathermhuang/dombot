import { describe, expect, it } from 'vitest';
import {
  accountForm,
  accountSecurity,
  recoveryForm,
  home,
  page,
} from './views';

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

describe('public website brand and product clarity', () => {
  it('uses the full wordmark and excludes the owner-rejected d.d mark on every page', () => {
    for (const html of [
      home(true),
      accountForm('login'),
      accountForm('join'),
      accountSecurity({ email: 'owner@example.test', label: 'Workspace' }),
      recoveryForm(''),
      page('Status', '<p>Status</p>'),
    ]) {
      const brand = html.match(/<a class="brand"[^>]*>(.*?)<\/a>/s)?.[1];
      expect(html).toContain('aria-label="domains.domains"');
      expect(brand?.match(/domains/g)).toHaveLength(2);
      expect(brand).not.toContain('<svg');
      expect(html).not.toContain('viewBox="0 0 320 200"');
      expect(html).not.toContain('M140 10H104');
    }
  });
  it('labels sample portfolio data and keeps the real access and collection paths', () => {
    const html = home(true);
    expect(html).toContain('Sample data');
    expect(html).toContain(
      'Illustration only. Renewal estimates are not registrar quotes.',
    );
    expect(html).toContain('studio.example');
    expect(html).toContain('href="/signup"');
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/domains"');
    expect(html).toContain('By invitation, as workspaces become available.');
    expect(home(false)).not.toContain('href="/domains"');
  });
});
