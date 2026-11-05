// Opt-in browser regression on the disposable local fixture, never production.
// No Playwright dependency is added to the pinned engine/build lock.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
const { values } = parseArgs({
  options: {
    'out-dir': { type: 'string', default: '.data/home-ui-qualification' },
    help: { type: 'boolean' },
  },
});
if (values.help) {
  console.log(
    'Start scripts/import-allocation-qualification.mjs --sales [--source-ui], then run with DOMBOT_UI_QA_TOOLS=/temporary/npm/tool-directory and DOMBOT_UI_QA_CHROME=/path/to/official/chrome. Optional: --out-dir PATH. Only http://127.0.0.1:5196 is accepted.',
  );
  process.exit(0);
}
const tools = process.env.DOMBOT_UI_QA_TOOLS;
assert(
  tools && path.isAbsolute(tools),
  'Set DOMBOT_UI_QA_TOOLS to an absolute temporary npm tools directory containing playwright-core.',
);
const { chromium } = createRequire(path.join(tools, 'qa-runner.cjs'))(
  'playwright-core',
);
const chrome =
  process.env.DOMBOT_UI_QA_CHROME ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const origin = 'http://127.0.0.1:5196',
  out = path.resolve(values['out-dir']);
await fs.mkdir(out, { recursive: true, mode: 0o700 });
const state = await (
  await fetch(origin + '/__qualification/status', {
    signal: AbortSignal.timeout(10000),
  })
).json();
assert(
  state.synthetic === true && /^[a-f0-9-]{36}$/.test(state.workspace),
  'Only the disposable synthetic fixture is eligible.',
);
const seed = await fetch(origin + '/__qualification/session', {
    redirect: 'manual',
  }),
  cookie = seed.headers.get('set-cookie').split(';')[0];
await seed.body?.cancel();
const rows = Array.from({ length: 60 }, (_, i) => ({
  line: i + 1,
  domain: `fixture-${String(i + 1).padStart(3, '0')}.${i % 2 ? 'example' : 'invalid'}`,
  registration: {
    registrar: i % 2 ? 'namecheap' : 'dynadot',
    expirationDate: i < 5 ? '2026-11-01' : '2027-12-31',
  },
}));
const imported = await fetch(
  origin + '/w/' + state.workspace + '/api/importDomains',
  {
    method: 'POST',
    headers: {
      Cookie: cookie,
      Origin: origin,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      args: [rows, { importId: 'home-ui-qualification-v1' }],
    }),
  },
);
assert.equal(imported.status, 200);
await imported.body?.cancel();
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'dombot-home-ui-'));
const browser = await chromium.launchPersistentContext(profile, {
  executablePath: chrome,
  headless: true,
  viewport: { width: 1512, height: 762 },
  args: [
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
  ],
});
const results = [];
let activePage, desktopGeometry;
async function protect(context) {
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort(),
  );
}
async function ready(page) {
  await page.getByRole('radio', { name: /Owned 60/i }).waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll('tbody [role="checkbox"]').length === 50,
  );
}
async function remove(page, field, touch) {
  const locator = page.getByRole('button', {
      name: `Remove ${field} filter`,
      exact: true,
    }),
    box = await locator.locator('svg').boundingBox();
  assert(box);
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  const target = await page.evaluate(
    ({ x, y }) =>
      document
        .elementFromPoint(x, y)
        ?.closest('button')
        ?.getAttribute('aria-label'),
    { x, y },
  );
  assert.equal(
    target,
    `Remove ${field} filter`,
    'The visible X must not be clipped or covered by another action.',
  );
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  await locator.waitFor({ state: 'detached', timeout: 5000 });
  await page.waitForFunction(
    () => document.querySelectorAll('tbody [role="checkbox"]').length === 50,
    {},
    { timeout: 5000 },
  );
  assert.equal(
    await page
      .getByRole('heading', {
        name: 'Where is each domain public?',
        exact: true,
      })
      .count(),
    0,
    'Removing a filter must not open the presence inspector.',
  );
  results.push({ field, touch, cleared: true, restoredRows: 50 });
}
try {
  await protect(browser);
  for (const touch of [false, true]) {
    const context = touch
      ? await browser
          .browser()
          .newContext({
            viewport: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true,
          })
      : browser;
    if (touch) await protect(context);
    const page = await context.newPage();
    activePage = page;
    await page.goto(origin + '/__qualification/session');
    await ready(page);
    if (!touch) {
      desktopGeometry = await page.evaluate(() => {
        const rect = (e) => {
          const r = e.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        };
        const trigger = [...document.querySelectorAll('button')].find(
          (b) => b.textContent.trim() === 'Inspect public presence',
        );
        return {
          viewport: { width: innerWidth, height: innerHeight },
          inspectorTrigger: rect(trigger),
          table: rect(document.querySelector('.domain-table-scroll')),
          filters: rect(document.querySelector('[data-filter-add]')),
        };
      });
      assert(
        Math.abs(
          desktopGeometry.inspectorTrigger.y - desktopGeometry.filters.y,
        ) <= 2,
        'Collapsed inspector belongs in the toolbar, not a separate editor-width row.',
      );
      await page.screenshot({ path: path.join(out, 'desktop.png') });
    }
    await remove(page, 'Registrar', touch);
    await remove(page, 'Folder', touch);
    await page.reload();
    await ready(page);
    await page
      .getByRole('button', { name: 'Registrar: any', exact: true })
      .click();
    await page.getByRole('menuitemcheckbox', { name: /dynadot/i }).click();
    await page.waitForFunction(
      () => document.querySelectorAll('tbody [role="checkbox"]').length === 30,
    );
    await remove(page, 'Registrar', touch);
    await page.reload();
    await ready(page);
    const pricing = page.getByRole('button', {
      name: 'Pricing: any',
      exact: true,
    });
    if (!(await pricing.count())) {
      await page.getByRole('button', { name: 'Filters', exact: true }).click();
      await page
        .getByRole('menuitemcheckbox', { name: 'Pricing', exact: true })
        .click();
    } else await pricing.click();
    await page.getByRole('menuitemcheckbox', { name: /Has BIN price/ }).click();
    await page.waitForFunction(
      () => document.querySelectorAll('tbody [role="checkbox"]').length === 0,
    );
    await remove(page, 'Pricing', touch);
    const inspector = page.getByRole('button', {
      name: 'Inspect public presence',
      exact: true,
    });
    await inspector.click();
    await page
      .getByRole('heading', {
        name: 'Where is each domain public?',
        exact: true,
      })
      .waitFor();
    await inspector.click();
    await page
      .getByRole('heading', {
        name: 'Where is each domain public?',
        exact: true,
      })
      .waitFor({ state: 'detached' });
    await page.screenshot({
      path: path.join(out, touch ? 'mobile.png' : 'cleared.png'),
    });
    await page.close();
    if (touch) await context.close();
  }
  const result = {
    passed: true,
    synthetic: true,
    personalProfileUsed: false,
    externalRequestsBlocked: true,
    browser: 'Official Chrome in a fresh temporary profile',
    desktopGeometry,
    results,
  };
  await fs.writeFile(
    path.join(out, 'result.json'),
    JSON.stringify(result, null, 2) + '\n',
    { mode: 0o600 },
  );
  console.log(JSON.stringify(result));
} catch (error) {
  if (activePage && !activePage.isClosed())
    await activePage.screenshot({ path: path.join(out, 'failure.png') });
  await fs.writeFile(
    path.join(out, 'failure.json'),
    JSON.stringify(
      { name: error.name, message: error.message, results },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  throw error;
} finally {
  await browser.close();
  await fs.rm(profile, { recursive: true, force: true });
}
