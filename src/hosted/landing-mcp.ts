/** Public, local-only walkthrough. Never connects to account or registrar APIs. */
export const landingMcpScriptPath = '/product/mcp-demo-v1.js';
export const landingMcpScript = `// MCP walkthrough: local illustrative content only, with no account access.
(function () {
  const chooser = document.querySelector('.mcp-scenarios');
  if (!chooser) return;
  const buttons = chooser.querySelectorAll('[data-mcp-scenario]');
  const examples = document.querySelectorAll('.mcp-example');
  buttons.forEach(function (button) {
    button.addEventListener('click', function () {
      const selectedId = button.getAttribute('aria-controls');
      buttons.forEach(function (item) {
        item.setAttribute('aria-pressed', item === button ? 'true' : 'false');
      });
      examples.forEach(function (example) {
        example.hidden = example.id !== selectedId;
      });
    });
  });
  chooser.hidden = false;
})();`;

export const landingMcpContent = `<section class="mcp-section" id="mcp" aria-labelledby="mcp-heading">
  <div class="mcp-grid">
    <div class="mcp-left">
      <div class="sec-head">
        <span class="eyebrow">Your portfolio. Your AI.</span>
        <h2 id="mcp-heading">One conversation.<br>Every registrar.</h2>
        <p>Connect your AI agent through <abbr title="Model Context Protocol">MCP</abbr> and put it to work on your domains. Ask a question, compare costs, or make a change across your portfolio — with the permissions you approve.</p>
      </div>

      <div class="mcp-scenarios" role="group" aria-label="Choose an MCP example" hidden>
        <button type="button" class="mcp-scenario" aria-pressed="true" aria-controls="mcp-renewals" data-mcp-scenario="renewals"><span class="mcp-scenario-num" aria-hidden="true">01</span><span><strong>Catch renewals at risk</strong><span>Find what needs attention. Take action.</span></span><span aria-hidden="true">↗</span></button>
        <button type="button" class="mcp-scenario" aria-pressed="false" aria-controls="mcp-budget" data-mcp-scenario="budget"><span class="mcp-scenario-num" aria-hidden="true">02</span><span><strong>Plan your renewal budget</strong><span>Get answers across registrar accounts.</span></span><span aria-hidden="true">↗</span></button>
        <button type="button" class="mcp-scenario" aria-pressed="false" aria-controls="mcp-dns" data-mcp-scenario="dns"><span class="mcp-scenario-num" aria-hidden="true">03</span><span><strong>Inspect your DNS</strong><span>Compare records without switching tabs.</span></span><span aria-hidden="true">↗</span></button>
      </div>
    </div>

    <div class="mcp-demo" aria-labelledby="mcp-heading">
      <div class="mcp-demo-bar"><span>AI agent <span aria-hidden="true">↔</span> Your portfolio</span><span class="mcp-demo-label">Sample MCP demo</span></div>
      <div class="mcp-demo-content" aria-live="polite" aria-atomic="true">
        <article id="mcp-renewals" class="mcp-example" aria-label="Renewal management example">
          <p class="mcp-speaker">You</p>
          <p class="mcp-prompt">“Which domains expire in the next 60 days with auto-renew off?”</p>
          <details class="mcp-trace"><summary>MCP tool · portfolio_query</summary><pre><code>{ "expiringWithinDays": 60,
  "autoRenew": false }</code></pre></details>
          <p class="mcp-speaker">Your agent</p>
          <p>Three domains need attention across three registrars:</p>
          <ul class="mcp-result-list">
            <li><strong>data.app</strong><span>Spaceship · in 12 days</span></li>
            <li><strong>mail.app</strong><span>Namecheap · in 28 days</span></li>
            <li><strong>sdk.io</strong><span>GoDaddy · in 46 days</span></li>
          </ul>
          <p class="mcp-followup">You: “Turn on auto-renew for data.app.”</p>
          <details class="mcp-trace"><summary>MCP tool · domain_set_autorenew</summary><pre><code>{ "domain": "data.app",
  "registrar": "spaceship", "enabled": true }</code></pre></details>
          <p class="mcp-outcome">Auto-renew enabled. Your portfolio reflects the change, too.</p>
        </article>
        <article id="mcp-budget" class="mcp-example" aria-label="Renewal budget example" hidden>
          <p class="mcp-speaker">You</p>
          <p class="mcp-prompt">“What should I budget for the domains expiring in the next 60 days?”</p>
          <details class="mcp-trace"><summary>MCP tool · portfolio_query</summary><pre><code>{ "expiringWithinDays": 60 }</code></pre></details>
          <details class="mcp-trace"><summary>MCP tool · domain_renewal_price × 3</summary><pre><code>{ "domain": "data.app", "registrar": "spaceship" }
{ "domain": "mail.app", "registrar": "namecheap" }
{ "domain": "sdk.io", "registrar": "godaddy" }</code></pre></details>
          <p class="mcp-speaker">Your agent</p>
          <p>Allow <strong>$85.50 USD</strong> for these three annual renewals:</p>
          <ul class="mcp-result-list">
            <li><strong>data.app</strong><span>Spaceship · $15.00</span></li>
            <li><strong>mail.app</strong><span>Namecheap · $17.00</span></li>
            <li><strong>sdk.io</strong><span>GoDaddy · $53.50</span></li>
          </ul>
          <p class="mcp-outcome">One answer across three accounts. No spreadsheet required.</p>
          <p class="mcp-result-note">Renewal estimates, not guaranteed quotes. Actual charges depend on your registrar.</p>
        </article>
        <article id="mcp-dns" class="mcp-example" aria-label="DNS inspection example" hidden>
          <p class="mcp-speaker">You</p>
          <p class="mcp-prompt">“Do data.app and sdk.io point to the same web server?”</p>
          <details class="mcp-trace"><summary>MCP tool · domain_dns_get × 2</summary><pre><code>{ "domain": "data.app", "registrar": "spaceship" }
{ "domain": "sdk.io", "registrar": "godaddy" }</code></pre></details>
          <p class="mcp-speaker">Your agent</p>
          <p>Yes. Both root domains have the same A record:</p>
          <ul class="mcp-result-list">
            <li><strong>data.app</strong><span>A · 192.0.2.10</span></li>
            <li><strong>sdk.io</strong><span>A · 192.0.2.10</span></li>
          </ul>
          <p class="mcp-outcome">DNS compared across registrars. No records changed.</p>
          <p class="mcp-result-note">DNS tools depend on the registrar’s supported capabilities.</p>
        </article>
      </div>
      <p class="mcp-demo-note">Illustrative conversations with sample data. This demo doesn’t connect to registrar accounts or make changes. Paid actions stay off during early access.</p>
    </div>

  </div>
  <p class="mcp-setup">Bring your own AI agent. Open <strong>Settings → MCP</strong> in your portfolio, connect a compatible client and approve its permissions.</p>
</section><script src="${landingMcpScriptPath}" defer></script>`;

export const landingMcpStyles = `
.mcp-section{padding:64px 40px;border-bottom:1px solid var(--line)}
.mcp-grid{display:grid;grid-template-columns:.9fr 1.1fr;gap:48px;align-items:start}.mcp-grid>*{min-width:0}
.mcp-section .eyebrow{display:block;font-size:11px;font-weight:600;letter-spacing:.1em;margin-bottom:18px}.mcp-section h2{font-size:clamp(30px,3vw,38px);line-height:1.15;letter-spacing:-.04em;margin:0 0 20px;font-weight:600}
.mcp-section .sec-head p{font-size:15px;line-height:1.7;margin:0;color:var(--muted)}
.mcp-scenarios{display:grid;margin-top:28px}.mcp-scenarios[hidden],.mcp-example[hidden]{display:none}
.mcp-scenario{display:flex;align-items:center;gap:14px;width:100%;min-height:76px;padding:14px 12px;text-align:left;color:var(--muted);background:transparent;border:1px solid transparent;border-bottom-color:var(--line);border-radius:0;cursor:pointer}
.mcp-scenario>span:nth-child(2){flex:1}.mcp-scenario strong{display:block;color:var(--ink);font-size:15px;font-weight:600}.mcp-scenario strong+span{display:block;margin-top:4px;font-size:13px;line-height:1.6}.mcp-scenario-num{color:var(--green);font-size:12px;font-variant-numeric:tabular-nums}
.mcp-scenario:hover{background:#edf2e8}.mcp-scenario[aria-pressed="true"]{background:#e8eee2;border-color:#a9b8a4;border-radius:8px;color:var(--green)}
.mcp-demo{border:1px solid #cbd5c5;border-radius:12px;background:#fff;overflow:hidden}.mcp-demo-bar{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;padding:14px 20px;border-bottom:1px solid var(--line);font-size:12px}.mcp-demo-bar>span:first-child{color:var(--ink);font-weight:600}.mcp-demo-bar>span:first-child span{color:var(--green);margin:0 5px}.mcp-demo-label{color:var(--muted)}
.mcp-demo-content{padding:24px 20px;font-size:14px;line-height:1.6}.mcp-demo-content p{margin:0 0 12px;max-width:none}.mcp-demo-content .mcp-speaker{color:var(--green);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px}.mcp-demo-content .mcp-prompt{font-size:17px;line-height:1.5;color:var(--ink);margin-bottom:14px}
.mcp-trace{margin:8px 0 18px;color:var(--muted);font-size:12px}.mcp-trace summary{overflow-wrap:anywhere}.mcp-trace summary:hover{color:var(--green)}.mcp-trace pre{padding:12px;background:#f6f7f1;border:1px solid var(--line);border-radius:6px;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}
.mcp-result-list{list-style:none;padding:0;margin:14px 0 20px}.mcp-result-list li{display:flex;flex-wrap:wrap;justify-content:space-between;gap:2px 12px;padding:9px 0;border-bottom:1px solid var(--line)}.mcp-result-list strong{font-weight:600}.mcp-result-list span{color:var(--muted);font-size:13px}.mcp-demo-content .mcp-followup{color:var(--ink);margin-top:20px}.mcp-demo-content .mcp-outcome{color:var(--green);font-weight:500}.mcp-demo-content .mcp-result-note{font-size:12px;color:var(--muted);margin-top:12px}.mcp-demo-note{padding:14px 20px;border-top:1px solid var(--line);color:var(--muted);font-size:12px;line-height:1.6;margin:0;max-width:none}
.mcp-setup{margin:24px 0 0;max-width:78ch;font-size:13px;line-height:1.7}.hero-mcp-link{display:inline-flex;align-items:center;gap:10px;min-height:44px;font-size:14px;text-decoration:underline;text-underline-offset:4px}
@media(max-width:880px){.mcp-grid{grid-template-columns:minmax(0,1fr);gap:28px}.mcp-scenarios{margin-top:20px}}
@media(max-width:600px){.mcp-section{padding:40px 22px}.mcp-section h2{font-size:30px}.mcp-demo-content{padding:20px 16px}.mcp-demo-bar,.mcp-demo-note{padding:14px 16px}}
`;
