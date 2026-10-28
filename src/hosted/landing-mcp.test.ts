import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import gateway from './gateway';
import { home } from './views';
import {
  landingMcpContent,
  landingMcpScript,
  landingMcpScriptPath,
} from './landing-mcp';

describe('public MCP walkthrough', () => {
  it('keeps the first conversation readable without script and labels every result as illustrative', () => {
    const html = home(false, true);
    expect(html).toContain('href="#mcp"');
    expect(html).toContain('id="mcp" aria-labelledby="mcp-heading"');
    expect(html).toContain('aria-label="Choose an MCP example" hidden');
    expect(html).toContain('aria-label="Renewal management example">');
    expect(html).toContain('aria-label="Renewal budget example" hidden');
    expect(html).toContain('aria-label="DNS inspection example" hidden');
    expect(html).toContain('Sample MCP demo');
    expect(html).toContain('Illustrative conversations with sample data.');
    expect(html).toContain('Paid actions stay off during early access.');
    expect(html).toContain('Renewal estimates, not guaranteed quotes.');
    expect(html).toContain(`<script src="${landingMcpScriptPath}" defer>`);
    expect(html).not.toContain('<script>');
    for (const name of ['data.app', 'mail.app', 'sdk.io'])
      expect(landingMcpContent).toContain(name);
  });

  it('switches exactly one conversation and its selected control locally without calling an API', () => {
    const buttons = [
      ...landingMcpContent.matchAll(
        /<button[^>]+aria-controls="([^"]+)"[^>]*>/g,
      ),
    ].map(([, id]) => ({
      id,
      listener: () => {},
      pressed: id === 'mcp-renewals' ? 'true' : 'false',
      getAttribute() {
        return this.id;
      },
      setAttribute(_name: string, value: string) {
        this.pressed = value;
      },
      addEventListener(_name: string, listener: () => void) {
        this.listener = listener;
      },
    }));
    expect(buttons).toHaveLength(3);
    const examples = buttons.map(({ id }) => ({
      id,
      hidden: id !== 'mcp-renewals',
    }));
    const chooser = { hidden: true, querySelectorAll: () => buttons };
    const fetch = vi.fn(() => {
      throw new Error('The illustrative demo must not call an API');
    });
    runInNewContext(landingMcpScript, {
      document: {
        querySelector: () => chooser,
        querySelectorAll: () => examples,
      },
      fetch,
    });
    expect(chooser.hidden).toBe(false);
    for (const button of [...buttons, buttons[0]]) {
      button.listener();
      expect(
        examples.filter((example) => !example.hidden).map(({ id }) => id),
      ).toEqual([button.id]);
      expect(buttons.filter(({ pressed }) => pressed === 'true')).toEqual([
        button,
      ]);
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(() =>
      runInNewContext(landingMcpScript, {
        document: { querySelector: () => null },
      }),
    ).not.toThrow();
  });

  it('serves the exact external script without reading account data or allowing arbitrary product files', async () => {
    const fetch = vi.fn();
    const response = await gateway.fetch(
      new Request('https://domains.domains' + landingMcpScriptPath, {
        headers: {
          Cookie: 'private-session',
          Authorization: 'Bearer private-token',
        },
      }),
      { LANDING_ASSETS: { fetch } } as unknown as HostedEnv,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/javascript');
    expect(response.headers.get('Cache-Control')).toContain('immutable');
    expect(await response.text()).toBe(landingMcpScript);
    expect(fetch).not.toHaveBeenCalled();
    expect(
      (
        await gateway.fetch(
          new Request('https://domains.domains/product/mcp-demo-unknown.js'),
          {} as HostedEnv,
        )
      ).status,
    ).toBe(404);
    const terms = await gateway.fetch(
      new Request('https://domains.domains/terms'),
      {} as HostedEnv,
    );
    expect(terms.headers.get('Content-Security-Policy')).not.toContain(
      'script-src',
    );
  });
});
