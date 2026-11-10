// Disposable synthetic fixture only. Browser interception exercises presentation
// contracts; DNS, scheduling and preservation are verified by Worker fixtures.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const tools = process.env.DOMBOT_UI_QA_TOOLS;
assert(
  tools && path.isAbsolute(tools),
  'Set DOMBOT_UI_QA_TOOLS to the temporary playwright-core directory.',
);
const { chromium } = createRequire(path.join(tools, 'qa-runner.cjs'))(
  'playwright-core',
);
const origin = 'http://127.0.0.1:5196',
  out = path.resolve('.data/lander-ui-qualification');
await fs.mkdir(out, { recursive: true, mode: 0o700 });
const status = await (await fetch(origin + '/__qualification/status')).json();
assert.equal(status.synthetic, true);
const seed = await fetch(origin + '/__qualification/session', {
    redirect: 'manual',
  }),
  cookie = seed.headers.get('set-cookie').split(';')[0];
await seed.body?.cancel();
const domains = Array.from(
  { length: 60 },
  (_, i) => `lander-fixture-${String(i).padStart(3, '0')}.example`,
);
const imported = await fetch(
  `${origin}/w/${status.workspace}/api/importDomains`,
  {
    method: 'POST',
    headers: {
      Cookie: cookie,
      Origin: origin,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      args: [
        domains.map((domain, i) => ({ line: i + 1, domain })),
        { importId: 'lander-browser-fixture' },
      ],
    }),
  },
);
assert.equal(imported.status, 200);
await imported.body?.cancel();
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'lander-ui-'));
const browser = await chromium.launchPersistentContext(profile, {
  executablePath:
    process.env.DOMBOT_UI_QA_CHROME ??
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  viewport: { width: 1512, height: 900 },
  args: [
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
  ],
});
let job = null,
  approved = 0,
  selection = null,
  reauthOnce = true,
  rejectedRequestId = null;
const results = [];
try {
  await browser.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.includes('/sales/lander/')) return route.continue();
    const suffix = url.pathname.split('/sales/lander/')[1];
    let value;
    if (suffix === 'config') value = { enabled: true, provider: 'cloudflare' };
    else if (suffix === 'jobs' && request.method() === 'GET')
      value = {
        items: job ? [{ id: job.id, state: job.state, total: job.total }] : [],
      };
    else if (suffix === 'jobs') {
      const input = request.postDataJSON();
      if (reauthOnce) {
        reauthOnce = false;
        rejectedRequestId = input.id;
        return route.fulfill({
          status: 428,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Confirm your identity.',
            reauth: '/account/reauth',
          }),
        });
      }
      if (!job)
        assert.equal(
          input.id,
          rejectedRequestId,
          'Reauthentication must retain the same idempotency key.',
        );
      selection = input.selection;
      const selected =
        selection.kind === 'domains' ? selection.domains : domains;
      job = {
        id: input.id,
        state: 'awaiting-review',
        digest: 'a'.repeat(64),
        total: selected.length,
        counts: [{ state: 'ready', count: selected.length }],
        expiresAt: Date.now() + 900000,
        cursor: null,
        items: selected.map((domain, ordinal) => ({
          ordinal,
          domain,
          state: 'ready',
          reason: null,
          publishes: true,
          publication: {
            id: crypto.randomUUID(),
            domain,
            displayName: domain,
            description: '',
            mode: 'inquiry',
            publicPrice: null,
            publicMinimumOffer: null,
            destination: null,
            allowQuestions: true,
            sellerDisplayName: '',
            categories: [],
            revision: crypto.randomUUID(),
            publishedAt: Date.now(),
            version: 2,
          },
          changes: [
            {
              before: null,
              after: {
                type: 'CNAME',
                name: domain,
                content: 'synthetic-fallback.example',
                ttl: 300,
              },
            },
          ],
        })),
      };
      value = job;
    } else if (suffix.endsWith('/approve')) {
      assert.equal(request.postDataJSON().digest, job.digest);
      approved++;
      job = {
        ...job,
        state: 'running',
        counts: [{ state: 'queued', count: job.total }],
        items: job.items.map((i) => ({ ...i, state: 'queued' })),
      };
      value = job;
    } else value = job;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(value),
    });
  });
  let page = await browser.newPage();
  page.setDefaultTimeout(15000);
  await page.goto(origin + '/__qualification/session');
  await page
    .getByRole('searchbox', { name: /Search/ })
    .first()
    .fill('lander-fixture-');
  await page.waitForFunction(
    () => document.querySelectorAll('tbody [role="checkbox"]').length === 50,
  );
  // Wait for the existing 200ms search debounce before selecting its scope.
  await page.waitForTimeout(350);
  await page.locator('thead [role="checkbox"]').click();
  await fs.writeFile(
    path.join(out, 'selection-debug.txt'),
    await page.locator('body').innerText(),
  );
  await page.screenshot({
    path: path.join(out, 'selection-debug.png'),
    fullPage: true,
  });
  const all = page.getByRole('button', {
    name: 'Select all 60 matching domains across pages',
    exact: true,
  });
  if (await all.count()) await all.click();
  await page
    .getByRole('button', { name: 'Use our lander', exact: true })
    .click();
  const reauth = page.getByRole('link', {
    name: 'Confirm your identity, then return to this selection',
    exact: true,
  });
  await reauth.waitFor();
  assert(
    (await reauth.getAttribute('href')).startsWith('/account/reauth?next='),
  );
  await page.reload();
  await page
    .getByRole('button', { name: 'Continue lander review', exact: true })
    .click();
  results.push('reauthentication return retains selection and idempotency key');
  await page
    .getByRole('heading', { name: 'Connect your domains', exact: true })
    .waitFor();
  assert.equal(selection.kind, 'domains');
  assert.equal(selection.domains.length, 60);
  assert.equal(new Set(selection.domains).size, 60);
  await page
    .getByText('lander-fixture-000.example · ready', { exact: true })
    .click();
  assert(
    await page
      .getByText('No public price · inquiry · questions enabled', {
        exact: true,
      })
      .first()
      .isVisible(),
  );
  await page
    .getByRole('button', {
      name: 'Confirm publication and DNS for 60 domains',
      exact: true,
    })
    .focus();
  await page.keyboard.press('Enter');
  assert.equal(approved, 1);
  await page
    .getByText('Work continues in the background when you close this tab.', {
      exact: false,
    })
    .waitFor();
  await page.screenshot({
    path: path.join(out, 'desktop.png'),
    fullPage: true,
  });
  results.push(
    '60 selected across pages; exact neutral review; one keyboard confirmation',
  );
  await page.close();
  page = await browser.newPage();
  await page.goto(`${origin}/w/${status.workspace}/#/public-listings`);
  await page.getByText('Recent lander connections', { exact: true }).click();
  await page
    .getByRole('button', { name: '60 domains · running', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'Lander connections', exact: true })
    .waitFor();
  results.push('job reopened after tab closure');
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('button', { name: 'Close connection details', exact: true })
    .click();
  await page
    .getByRole('button', {
      name: 'Use our lander for all matching',
      exact: true,
    })
    .click();
  await page
    .getByRole('heading', { name: 'Connect your domains', exact: true })
    .waitFor();
  assert.equal(selection.kind, 'matching-listings');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  assert.equal(overflow, false, 'Mobile content must fit the viewport.');
  await page.screenshot({ path: path.join(out, 'mobile.png'), fullPage: true });
  results.push('mobile all-matching review without horizontal overflow');
  await fs.writeFile(
    path.join(out, 'receipt.json'),
    JSON.stringify(
      { synthetic: true, providerWrites: 0, approved, results },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify({ synthetic: true, results, approved }));
} finally {
  await browser.close();
  await fs.rm(profile, { recursive: true, force: true });
}
