import { describe, expect, it } from 'vitest';
import { legalPage, legalVersion } from './legal';
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
        'mailto:domains@domains.domains?subject=Account%20recovery',
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
  it('credits upstream DomBot separately from the hosted SaaS source in one shared footer', () => {
    const env = {
      LEGAL_OPERATOR_NAME: 'Magic Crystal Limited',
      LEGAL_JURISDICTION: 'Hong Kong',
    } as HostedEnv;
    for (const html of [
      home(true, true),
      accountForm('login'),
      legalPage('terms', env),
    ]) {
      expect(html.match(/<footer\b/g)).toHaveLength(1);
      expect(html).toContain(
        '<p class="software-credit">domains.domains is a hosted, multi-tenant version of <a href="https://github.com/aoxborrow/dombot">aoxborrow/dombot</a>.</p>',
      );
      expect(html).toContain('href="https://github.com/aoxborrow/dombot"');
      expect(html).toContain('href="/source"');
    }
    expect(legalPage('terms', env)).toContain(
      'The original DomBot project was created by Aaron Oxborrow.',
    );
    expect(legalPage('terms', env)).toContain('Our SaaS layer adds');
    expect(legalPage('terms', env)).toContain(
      'do not reduce rights granted by the software licenses',
    );
  });
  it('publishes the confirmed operator and jurisdiction with the dated policies', () => {
    const env = {
      LEGAL_OPERATOR_NAME: 'Magic Crystal Limited',
      LEGAL_JURISDICTION: 'Hong Kong',
    } as HostedEnv;
    for (const kind of ['terms', 'privacy'] as const) {
      const html = legalPage(kind, env);
      expect(html).toContain('Magic Crystal Limited');
      expect(html).toContain('Hong Kong');
      expect(html).toContain(legalVersion);
      expect(html).not.toContain('publication pending');
      expect(html).not.toContain('[Operator');
    }
    expect(legalPage('privacy', env)).toContain(
      'Office of the Privacy Commissioner',
    );
  });
  it('uses the full wordmark and excludes the owner-rejected d.d mark on every page', () => {
    for (const html of [
      home(true),
      accountForm('login'),
      accountForm('join'),
      accountSecurity({ email: 'owner@example.test', label: 'Portfolio' }),
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
  it('uses account and portfolio wording and only advertises public creation when enabled', () => {
    for (const html of [
      home(true),
      home(true, true),
      accountForm('login'),
      accountForm('join'),
      accountSecurity({ email: 'owner@example.test', label: 'Portfolio' }),
      recoveryForm(''),
    ]) {
      expect(html).not.toMatch(/workspace/i);
      expect(html).not.toContain('Magic Crystal Limited');
    }
    expect(home(true, true)).toContain('Create free account');
    expect(home(true, true)).toContain('No invitation needed.');
    expect(home(true, true)).not.toContain('by invitation');
    expect(home(true)).not.toContain('Create free account');
  });
  it('labels sample portfolio data and keeps the real access and collection paths', () => {
    const html = home(true);
    expect(html).toContain('Sample data');
    expect(html).toContain(
      'Sample data and prices, not a customer portfolio or registrar quote.',
    );
    expect(html.match(/<img\b/g)).toHaveLength(2);
    expect(html).toContain('href="https://demo.dombot.ai/"');
    expect(html).toContain('Original DomBot demo');
    expect(html).toContain('href="/signup"');
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/domains"');
    expect(html).toContain('By invitation, as accounts become available.');
    expect(home(false)).not.toContain('href="/domains"');
  });
});
