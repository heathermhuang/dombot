import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import gateway from './gateway';
import { accountForm, home } from './views';
import {
  landingExamples,
  landingScript,
  landingScriptPath,
} from './landing-interactions';

describe('approved MCP-first landing page', () => {
  it('renders readable first-screen content without requiring JavaScript', () => {
    const html = home(false, true);
    expect(html).toContain('Every domain.<br><em>One conversation.</em>');
    expect(html).toContain(landingExamples[0].summary);
    expect(html).toContain('data-agent="dns"');
    expect(html).toContain('Search sample domains');
    expect(html).toContain('autocomplete="off" disabled');
    expect(html).toContain('aria-label="Try an MCP example" hidden');
    expect(html).toContain('Interactive illustration · Sample data');
    expect(html).toContain('No message is sent.');
    expect(html).not.toContain('<picture>');
  });

  it('cannot submit example contact details through a native form, including without JavaScript', () => {
    const html = home(false, true);
    expect(html).not.toMatch(/<form\b/i);
    expect(html).not.toMatch(/type="submit"/i);
    expect(html).toContain('role="group" aria-label="Sample inquiry preview"');
    expect(html).toContain('Your details are not submitted or stored.');
    expect(landingScript).not.toMatch(
      /\b(fetch|XMLHttpRequest|sendBeacon|localStorage|sessionStorage)\b/,
    );
    expect(landingScript).not.toContain('innerHTML');
    expect(landingScript).toContain(
      'Example preview only. No message was sent.',
    );
  });

  it('serves exact versioned JavaScript under the existing restrictive network policy', async () => {
    expect(landingScriptPath).toContain(
      createHash('sha256').update(landingScript).digest('hex').slice(0, 12),
    );
    const response = await gateway.fetch(
      new Request('https://domains.domains' + landingScriptPath),
      {} as HostedEnv,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/javascript');
    expect(response.headers.get('Cache-Control')).toContain('immutable');
    expect(await response.text()).toBe(landingScript);
    const page = await gateway.fetch(
      new Request('https://domains.domains/'),
      {} as HostedEnv,
    );
    const policy = page.headers.get('Content-Security-Policy');
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("script-src 'self'");
    expect(policy).not.toContain('connect-src');
    expect(policy).not.toContain("script-src 'unsafe-inline'");
  });

  it('retains registration gating and keeps the new composition off account pages', () => {
    expect(home(false, false)).toContain(
      'By invitation, as accounts become available.',
    );
    expect(home(false, false)).not.toContain('Create free account');
    expect(home(false, true)).toContain('No invitation needed.');
    expect(home(false, true)).toContain('Create free account');
    expect(accountForm('login')).not.toContain('.hero-a');
    expect(accountForm('login')).not.toContain('Every domain.');
  });
});
