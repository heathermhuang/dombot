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
  historyFixture = false,
  reauthOnce = true,
  rejectedRequestId = null;
const results = [];
const domain = domains[0];
const missingAttempt = crypto.randomUUID();
const historyJobs = [
  { domain, total: 1, state: 'finished' },
  { domain, total: 2, state: 'finished' },
  { domain, total: 1, state: 'finished' },
  { domain, total: 1, state: 'cancelled' },
  { domain, total: 2, state: 'cancelled' },
  { domain: domains[1], total: 1, state: 'finished' },
].map((attempt, index) => ({
  ...attempt,
  id: crypto.randomUUID(),
  updated_at: Date.UTC(2026, 10, 15, 14 - index),
}));
let openedAttempt;
let historyListReads = 0;
try {
  await browser.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname.endsWith('/publishing/presence')) {
      const [name] = JSON.parse(url.searchParams.get('names'));
      return route.fulfill({
        json: {
          items: [
            {
              domain: name,
              sales: {
                state: 'known',
                value: {
                  id: name === domain ? historyJobs[0].id : null,
                  publishedRevision: name === domain ? historyJobs[0].id : null,
                  actionable: name === domain,
                  pendingChanges: false,
                  suppression: null,
                },
              },
            },
          ],
        },
      });
    }
    if (!url.pathname.includes('/sales/lander/')) return route.continue();
    const suffix = url.pathname.split('/sales/lander/')[1];
    let value;
    if (suffix === 'config') value = { enabled: true, provider: 'cloudflare' };
    else if (suffix === 'jobs' && request.method() === 'GET') {
      if (historyFixture) historyListReads++;
      value = {
        items: historyFixture
          ? historyJobs
          : job
            ? [{ id: job.id, state: job.state, total: job.total }]
            : [],
      };
    } else if (historyFixture) {
      assert.equal(request.method(), 'GET', 'History opens a read-only view.');
      const id = suffix.split('/')[1];
      if (id === missingAttempt)
        return route.fulfill({ status: 404, json: { error: 'Unknown job' } });
      const attempt = historyJobs.find((item) => item.id === id);
      assert(attempt);
      openedAttempt = id;
      value = {
        ...attempt,
        counts: [{ state: 'cancelled', count: 1 }],
        items: [{ ordinal: 0, domain, state: 'cancelled', reason: null }],
        cursor: null,
      };
    } else if (suffix === 'jobs') {
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
  page.setDefaultTimeout(60_000);
  await page.goto(origin + '/__qualification/session');
  await page
    .getByRole('searchbox', { name: /Search/ })
    .first()
    .fill('lander-fixture-');
  await page.waitForFunction(
    () => document.querySelectorAll('tbody [role="checkbox"]').length === 50,
  );
  const column = page.getByRole('columnheader', { name: /public page/i });
  const inventoryColumns = () =>
    page
      .locator('thead th')
      .evaluateAll((headers) =>
        headers.map((header) => header.textContent.trim().toLowerCase()),
      );
  const columns = await inventoryColumns();
  const nameservers = columns.indexOf('nameservers');
  assert(nameservers > 0);
  assert.deepEqual(columns.slice(nameservers, nameservers + 5), [
    'nameservers',
    'public page',
    'folder',
    'bin price',
    'min offer',
  ]);
  await page.getByRole('button', { name: 'Columns', exact: true }).click();
  await page.locator('[data-column-key="publicPage"]').press('Alt+ArrowUp');
  assert.equal((await inventoryColumns()).indexOf('public page'), nameservers);
  await page.reload();
  await column.waitFor();
  assert.equal((await inventoryColumns()).indexOf('public page'), nameservers);
  await page.getByRole('button', { name: 'Columns', exact: true }).click();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.keyboard.press('Escape');
  assert.deepEqual(await inventoryColumns(), columns);
  await page
    .getByRole('searchbox', { name: /Search/ })
    .first()
    .fill('lander-fixture-');
  results.push('inventory default order and saved keyboard rearrangement');
  await page
    .getByRole('button', {
      name: `Public page actions for ${domain}`,
      exact: true,
    })
    .waitFor();
  const beforeHeader = page.getByRole('columnheader', { name: /registrar/i });
  const movedHeader = page.getByRole('columnheader', { name: /created/i });
  const createdBeforeRegistrar = () => {
    const labels = [...document.querySelectorAll('thead th')].map((th) =>
      th.textContent.trim().toLowerCase(),
    );
    return labels.indexOf('created') === labels.indexOf('registrar') - 1;
  };
  await beforeHeader.scrollIntoViewIfNeeded();
  await movedHeader.scrollIntoViewIfNeeded();
  const sourceHeader = movedHeader.getByRole('button', {
    name: /Sort Created/i,
  });
  const [sourceRect, targetRect] = await Promise.all([
    sourceHeader.boundingBox(),
    beforeHeader.boundingBox(),
  ]);
  assert(sourceRect && targetRect);
  await page.mouse.move(
    sourceRect.x + sourceRect.width / 2,
    sourceRect.y + sourceRect.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    targetRect.x + targetRect.width / 4,
    targetRect.y + targetRect.height / 2,
    { steps: 10 },
  );
  const settledTarget = await beforeHeader.boundingBox();
  assert(settledTarget);
  await page.mouse.move(
    settledTarget.x + settledTarget.width / 4,
    settledTarget.y + settledTarget.height / 2,
  );
  await page.mouse.up();
  await page.waitForFunction(createdBeforeRegistrar, null, { timeout: 5000 });
  assert.equal(
    await movedHeader.getAttribute('aria-sort'),
    null,
    'Dragging must not change sorting.',
  );

  await page.reload();
  await movedHeader.waitFor();
  await page.waitForFunction(createdBeforeRegistrar, null, { timeout: 5000 });
  await sourceHeader.click();
  assert.equal(
    await movedHeader.getAttribute('aria-sort'),
    'ascending',
    'Clicking the moved header still sorts.',
  );
  await page.getByRole('button', { name: 'Columns', exact: true }).click();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.keyboard.press('Escape');
  assert.deepEqual(await inventoryColumns(), columns);
  await page
    .getByRole('button', { name: 'Sort Domain ascending', exact: true })
    .click();
  await page
    .getByRole('searchbox', { name: /Search/ })
    .first()
    .fill('lander-fixture-');
  results.push('direct inventory drag saves the order and keeps click-to-sort');
  const menu = page.getByRole('button', {
    name: `Public page actions for ${domain}`,
    exact: true,
  });
  await menu.waitFor();
  assert(
    (await column.boundingBox()).width <= 140,
    'The Public Page column must stay close to its content width.',
  );
  const published = menu.locator('..').getByText('Published', { exact: true });
  const [statusBox, menuBox] = await Promise.all([
    published.boundingBox(),
    menu.boundingBox(),
  ]);
  assert(
    statusBox.y < menuBox.y + menuBox.height &&
      menuBox.y < statusBox.y + statusBox.height,
    'The status and action stay on the same line.',
  );
  const prepare = page.getByRole('button', {
    name: `Prepare public page for ${domains[1]}`,
    exact: true,
  });
  assert(await prepare.isEnabled(), 'A private page can still be prepared.');
  await menu.focus();
  await page.keyboard.press('Enter');
  assert.match(
    await page
      .getByRole('menuitem', { name: 'Edit', exact: true })
      .getAttribute('href'),
    new RegExp(`/sales/listings/${historyJobs[0].id}$`),
  );
  assert.match(
    await page
      .getByRole('menuitem', { name: 'Preview', exact: true })
      .getAttribute('href'),
    new RegExp(`/sales/listings/${historyJobs[0].id}/preview$`),
  );
  assert(
    await page.getByRole('menuitem', { name: 'Copy page link' }).isVisible(),
  );
  await page.keyboard.press('Escape');
  await page.getByRole('menu').waitFor({ state: 'detached' });
  await page.screenshot({
    path: path.join(out, 'inventory-desktop.png'),
    animations: 'disabled',
  });
  results.push(
    'compact Public Page column with keyboard-accessible page actions',
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
    name: 'Confirm identity',
    exact: true,
  });
  await reauth.waitFor();
  const reauthUrl = new URL(await reauth.getAttribute('href'), origin);
  assert.equal(reauthUrl.pathname, '/account/reauth');
  assert.equal(reauthUrl.searchParams.get('reason'), 'domain-setup');
  assert.equal(reauthUrl.origin, origin);
  const reauthReturn = reauthUrl.searchParams.get('next');
  assert(reauthReturn);
  const returnUrl = new URL(reauthReturn, origin);
  assert.equal(returnUrl.origin, origin);
  assert.equal(returnUrl.pathname, `/w/${status.workspace}/`);
  await page.reload();
  await page
    .getByRole('button', { name: 'Continue lander review', exact: true })
    .click();
  results.push('reauthentication return retains selection and idempotency key');
  await page
    .getByRole('heading', { name: 'Review connection', exact: true })
    .waitFor();
  assert.equal(selection.kind, 'domains');
  assert.equal(selection.domains.length, 60);
  assert.equal(new Set(selection.domains).size, 60);
  await page
    .getByText('lander-fixture-000.example · Ready to review', { exact: true })
    .click();
  assert(
    await page
      .getByText('No public price · Open to inquiries · Questions accepted', {
        exact: true,
      })
      .first()
      .isVisible(),
  );
  await page
    .getByRole('button', {
      name: 'Confirm and connect 60 domains',
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
  await page.reload();
  await page
    .getByRole('heading', { name: 'Connecting', exact: true })
    .waitFor();
  assert.equal(approved, 1, 'Reloading inventory does not repeat approval.');
  results.push('an in-progress connection reopens on inventory reload');
  await page.close();
  page = await browser.newPage();
  await page.goto(`${origin}/w/${status.workspace}/#/public-listings`);
  await page.getByText('Recent lander connections', { exact: true }).click();
  await page
    .getByRole('button', { name: '60 domains · Connecting', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'Connecting', exact: true })
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
    .getByRole('heading', { name: 'Review connection', exact: true })
    .waitFor();
  assert.equal(selection.kind, 'matching-listings');
  await page
    .getByRole('heading', { name: 'Review connection', exact: true })
    .scrollIntoViewIfNeeded();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  assert.equal(overflow, false, 'Mobile content must fit the viewport.');
  await page.screenshot({ path: path.join(out, 'mobile.png'), fullPage: true });
  results.push('mobile all-matching review without horizontal overflow');
  await page.close();

  historyFixture = true;
  page = await browser.newPage();
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto(`${origin}/w/${status.workspace}/#/`);
  const history = page.getByText('Recent lander connections', { exact: true });
  await page.getByRole('button', { name: 'Table view', exact: true }).waitFor();
  assert.equal(await history.count(), 0, 'History is absent from inventory.');
  await page.getByRole('button', { name: 'Table view', exact: true }).click();
  await page
    .getByRole('button', {
      name: `Public page actions for ${domain}`,
      exact: true,
    })
    .waitFor();
  const touchSource = page.getByRole('columnheader', { name: /expiration/i });
  const touchTarget = page.getByRole('columnheader', { name: /registrar/i });
  await touchTarget.scrollIntoViewIfNeeded();
  await touchSource.scrollIntoViewIfNeeded();
  const [touchFrom, touchTo] = await Promise.all([
    touchSource.boundingBox(),
    touchTarget.boundingBox(),
  ]);
  assert(touchFrom && touchTo);
  const fromX = touchFrom.x + touchFrom.width / 2;
  const toX = touchTo.x + touchTo.width / 4;
  const y = touchFrom.y + touchFrom.height / 2;
  const touch = await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: fromX, y }],
  });
  for (let step = 1; step <= 8; step++) {
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: fromX + ((toX - fromX) * step) / 8, y }],
    });
  }
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await touch.detach();
  await page.waitForFunction(
    () => {
      const labels = [...document.querySelectorAll('thead th')].map((th) =>
        th.textContent.trim().toLowerCase(),
      );
      return labels.indexOf('expiration') === labels.indexOf('registrar') - 1;
    },
    null,
    { timeout: 5000 },
  );
  await page.getByRole('button', { name: 'Summary view', exact: true }).click();
  results.push('direct column dragging works with touch in the phone table');
  await page
    .getByRole('button', { name: 'Page and domain details', exact: true })
    .first()
    .click();
  const mobileMenu = page.getByRole('button', {
    name: `Public page actions for ${domain}`,
    exact: true,
  });
  await mobileMenu.waitFor();
  const mobileMenuBox = await mobileMenu.boundingBox();
  assert(mobileMenuBox.width >= 44 && mobileMenuBox.height >= 44);
  await mobileMenu.click();
  assert(
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).isVisible(),
  );
  await page.keyboard.press('Escape');
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    ),
    false,
    'Public Page actions fit inside the phone viewport.',
  );
  results.push('mobile Public Page actions have a full-size target');
  await page.goto(
    `${origin}/w/${status.workspace}/#/?landerConnection=${missingAttempt}`,
  );
  // Reload the route to exercise reopening a saved address from a new document.
  await page.reload();
  const recovery = page.getByRole('link', {
    name: 'Find it in Sales pages',
    exact: true,
  });
  await recovery.waitFor();
  assert.equal(historyListReads, 0, 'Inventory never polls for history.');
  await recovery.click();
  await page
    .getByRole('heading', { name: 'Sales pages', exact: true })
    .waitFor();
  await history.waitFor();
  assert(historyListReads > 0, 'Sales pages loads the connection history.');
  const summaryBox = await history.boundingBox();
  assert(summaryBox.height >= 44, 'History has a full-size touch target.');
  const latest = page.getByRole('button', {
    name: `${domain} · Finished`,
    exact: false,
  });
  assert.equal(await latest.count(), 0, 'History starts collapsed.');
  await history.click();
  assert.equal(
    await latest.count(),
    1,
    'Show the latest single-domain attempt.',
  );
  assert.equal(
    await latest.locator('time').getAttribute('datetime'),
    new Date(historyJobs[0].updated_at).toISOString(),
  );
  assert.equal(
    await page
      .getByRole('button', { name: `${domain} +1`, exact: false })
      .count(),
    2,
    'Keep separate batches that name the same first domain.',
  );
  const earlier = page.getByText('2 earlier attempts', { exact: false });
  await earlier.click();
  assert.equal(await latest.count(), 2);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    ),
    false,
    'Expanded history fits the phone viewport.',
  );
  await page
    .getByRole('button', { name: `${domain} · Stopped`, exact: false })
    .click();
  await page.getByRole('heading', { name: 'Stopped', exact: true }).waitFor();
  assert.equal(openedAttempt, historyJobs[3].id);
  results.push(
    'mobile inventory has no history and failed resume links to grouped receipts on Sales pages',
  );
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
