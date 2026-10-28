import { createHash } from 'node:crypto';

/** Public sample responses, never account or registrar data. */
export const landingExamples = [
  {
    id: 'expiry',
    label: 'What expires next?',
    prompt: 'Which domains need my attention?',
    tool: 'portfolio_query',
    summary: 'Two domains expire within 60 days with auto-renew off.',
    detail: 'data.app · 12 days   sdk.io · 46 days',
    params: { expiringWithinDays: 60, autoRenew: false },
  },
  {
    id: 'budget',
    label: 'Renewal budget',
    prompt: 'What should I budget for the next 60 days?',
    tool: 'portfolio_query + domain_renewal_price',
    summary: 'Allow $82 USD for three annual renewals.',
    detail:
      'data.app $17 · mail.app $17 · sdk.io $48. Estimates, not guaranteed quotes.',
    params: [
      { tool: 'portfolio_query', expiringWithinDays: 60 },
      {
        tool: 'domain_renewal_price',
        domain: 'data.app',
        registrar: 'dynadot',
      },
      {
        tool: 'domain_renewal_price',
        domain: 'mail.app',
        registrar: 'cloudflare',
      },
      {
        tool: 'domain_renewal_price',
        domain: 'sdk.io',
        registrar: 'spaceship',
      },
    ],
  },
  {
    id: 'dns',
    label: 'Compare DNS',
    prompt: 'Do data.app and sdk.io point to the same server?',
    tool: 'domain_dns_get × 2',
    summary: 'Both root domains have the same A record.',
    detail:
      'data.app and sdk.io → 192.0.2.10. No records changed. Support varies by registrar.',
    params: [
      { domain: 'data.app', registrar: 'dynadot' },
      { domain: 'sdk.io', registrar: 'spaceship' },
    ],
  },
] as const;

/** All interactions are local. There is deliberately no form or network transport. */
export const landingScript = `(() => {
  const root = document.querySelector('.landing-page');
  if (!root) return;
  const examples = ${JSON.stringify(landingExamples)};
  const buttons = root.querySelectorAll('[data-agent]');
  buttons.forEach(button => {
    button.addEventListener('click', () => {
      const example = examples.find(value => value.id === button.dataset.agent);
      if (!example) return;
      buttons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      root.querySelector('[data-agent-prompt]').textContent = example.prompt;
      root.querySelector('[data-agent-tool]').textContent = example.tool;
      root.querySelector('[data-agent-summary]').textContent = example.summary;
      root.querySelector('[data-agent-detail]').textContent = example.detail;
      root.querySelector('[data-agent-params]').textContent = JSON.stringify(example.params, null, 2);
    });
  });
  const choices = root.querySelector('.agent-tabs');
  if (choices) choices.hidden = false;

  const search = root.querySelector('[data-sample-search]');
  const rows = Array.from(root.querySelectorAll('[data-domain]'));
  if (search) {
    search.disabled = false;
    search.addEventListener('input', () => {
      const query = search.value.trim().toLowerCase();
      rows.forEach(row => { row.hidden = !row.dataset.domain.includes(query); });
      const count = root.querySelector('[data-sample-count]');
      if (count) {
        const visible = rows.filter(row => !row.hidden).length;
        count.textContent = query ? visible + ' of 4 sample domains' : '4 of 18 shown';
      }
      const empty = root.querySelector('[data-empty-search]');
      if (empty) empty.hidden = rows.some(row => !row.hidden);
    });
  }

  root.querySelectorAll('[data-open-inquiry]').forEach(button => {
    button.hidden = false;
    button.addEventListener('click', () => {
      const panel = button.closest('.inquiry-product');
      const preview = panel.querySelector('[data-sample-form]');
      panel.querySelector('[data-example-inbox]').hidden = true;
      preview.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      preview.querySelector('input').focus();
    });
  });
  root.querySelectorAll('[data-preview-inquiry]').forEach(button => {
    button.addEventListener('click', () => {
      button.closest('[data-sample-form]').querySelector('[role="status"]').textContent =
        'Example preview only. No message was sent.';
    });
  });
  root.querySelectorAll('[data-close-inquiry]').forEach(button => {
    button.addEventListener('click', () => {
      const panel = button.closest('.inquiry-product');
      const preview = panel.querySelector('[data-sample-form]');
      preview.hidden = true;
      preview.querySelectorAll('input, textarea').forEach(field => {
        field.value = field.defaultValue;
      });
      preview.querySelector('[role="status"]').textContent = '';
      panel.querySelector('[data-example-inbox]').hidden = false;
      const opener = panel.querySelector('[data-open-inquiry]');
      opener.setAttribute('aria-expanded', 'false');
      opener.focus();
    });
  });
})();`;

export const landingScriptPath = `/product/landing-demo-${createHash('sha256').update(landingScript).digest('hex').slice(0, 12)}.js`;
