import { escapeHtml as e, page } from './views';

export const agentConnectPath = '/connect-agent';
export const agentOpenApiPath = '/api/agent/openapi.json';
export const agentCopyScriptPath = '/connect-agent/copy-v1.js';

export const agentCopyScript = `document.querySelectorAll('[data-copy]').forEach((button) => {
  const field = document.getElementById(button.getAttribute('data-copy'));
  if (!(field instanceof HTMLInputElement)) return;
  button.hidden = false;
  button.addEventListener('click', async () => {
    const status = button.parentElement.nextElementSibling;
    try {
      await navigator.clipboard.writeText(field.value);
      status.textContent = 'Copied.';
    } catch {
      field.focus();
      field.select();
      status.textContent = 'Selected. Use your device’s copy command.';
    }
  });
});`;

export function agentConnectPage(origin: string) {
  const mcp = new URL('/mcp/catalog', origin).href;
  const cursor = new URL('cursor://anysphere.cursor-deeplink/mcp/install');
  cursor.searchParams.set('name', 'domains-domains-catalog');
  cursor.searchParams.set('config', btoa(JSON.stringify({ url: mcp })));
  const copy = (id: string, label: string, value: string) =>
    `<div class="agent-copy"><input id="${id}" aria-label="${label}" readonly spellcheck="false" value="${e(value)}"><button type="button" data-copy="${id}" aria-label="Copy ${label}" hidden>Copy</button></div><span class="agent-copy-status" role="status"></span>`;

  return page(
    'Connect your agent',
    `<style>
.agent-connect{max-width:760px;margin:32px auto 56px}.agent-connect h1{font-size:clamp(36px,7vw,60px)}.agent-connect section{padding:20px 0;border-top:1px solid var(--line)}.agent-connect h2,.agent-connect section p{margin:0 0 10px}.agent-connect .agent-url{background:white;border:1px solid var(--line);border-radius:10px;padding:18px;margin:24px 0}.agent-url label{margin:0}.agent-copy{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:stretch;margin-top:8px}.agent-copy button[hidden]{display:none}.agent-copy input{min-width:0;margin:0;font:14px ui-monospace,monospace}.agent-copy-status:not(:empty){display:block;margin-top:6px;font-size:14px}.agent-connect a:not(.button){text-decoration:underline}.agent-connect .docs{font-size:14px}.agent-connect .button{margin-top:5px}.agent-connect .cli{display:grid;gap:12px}.agent-connect .cli label{margin:0}
</style>
<div class="agent-connect">
<h1>Connect your agent</h1>
<p>Search published domains and check seller-confirmed prices. Open the listing to make an offer in your browser.</p>
<div class="agent-url"><label for="catalog-url">Public MCP URL</label>${copy('catalog-url', 'public MCP URL', mcp)}</div>
<section aria-labelledby="claude"><h2 id="claude">Claude</h2><p>In Customize → Connectors, choose Add custom connector. Name it Domains.Domains and paste the MCP URL. No sign in to Domains.Domains is required. Team and Enterprise members can ask an owner to add the connector.</p><a class="docs" href="https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp">Claude connector instructions</a></section>
<section aria-labelledby="chatgpt"><h2 id="chatgpt">ChatGPT</h2><p>On ChatGPT web, use a workspace that allows custom MCP servers. Go to Plugins → + → Add custom MCP server. Enter Domains.Domains and the MCP URL, choose <strong>No authentication</strong>, and create and install the plugin. In a new Work chat, select the plugin with @.</p><a class="docs" href="https://developers.openai.com/plugins/quickstart">ChatGPT plugin instructions</a></section>
<section aria-labelledby="cursor"><h2 id="cursor">Cursor</h2><a class="button" href="${e(cursor.href)}">Install in Cursor</a></section>
<section aria-labelledby="terminal"><h2 id="terminal">Command line</h2><div class="cli">
<div><label for="codex-command">Codex</label>${copy('codex-command', 'Codex command', `codex mcp add domains-domains-catalog --url ${mcp}`)}</div>
<div><label for="claude-command">Claude Code</label>${copy('claude-command', 'Claude Code command', `claude mcp add --transport http domains-domains-catalog ${mcp}`)}</div>
<div><label for="gemini-command">Gemini CLI</label>${copy('gemini-command', 'Gemini CLI command', `gemini mcp add --transport http domains-domains-catalog ${mcp}`)}</div>
</div></section>
<section aria-labelledby="try-catalog"><h2 id="try-catalog">Try a search</h2><p>Ask your agent “Find a domain for a design studio. Check the current asking price and give me the public listing link.”</p><p>Without an MCP connection, share the <a href="/api/agent/listings">public catalog link</a> or open a listing directly. Developers can use the <a href="${agentOpenApiPath}">OpenAPI contract</a>.</p></section>
</div><script src="${agentCopyScriptPath}" defer></script>`,
    undefined,
    { href: '/api/agent/listings', label: 'Public catalog →' },
  );
}
