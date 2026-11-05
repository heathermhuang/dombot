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
    'out-dir': { type: 'string', default: '.data/selection-ui-qualification' },
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
      args: [rows, { importId: 'selection-ui-qualification-v1' }],
    }),
  },
);
assert.equal(imported.status, 200);
await imported.body?.cancel();
const profile = await fs.mkdtemp(
  path.join(os.tmpdir(), 'dombot-selection-ui-'),
);
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
let page;
const selectedCount = async () =>
  page.locator('tbody [role="checkbox"][data-state="checked"]').count();
const clear = () =>
  page.getByRole('button', { name: 'Clear selection', exact: true });
async function openAction(name) {
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await page
    .getByRole('menuitem', {
      name: new RegExp(
        '^' + name.replace('…', '') + '(?:\\s*…)?(?:\\s*\\d+)?$',
      ),
    })
    .click();
  await page.getByRole('dialog').waitFor();
}
async function assertSingleDialog(name) {
  const text = await page.getByRole('dialog').innerText();
  assert(text.includes(name), text);
  assert(!/\d+ domains:/.test(text), text);
}
async function closeDialog() {
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
}
try {
  await browser.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort(),
  );
  page = await browser.newPage();
  page.setDefaultTimeout(15000);
  await page.goto(origin + '/__qualification/session');
  await page.waitForFunction(
    () => document.querySelectorAll('tbody [role="checkbox"]').length === 50,
  );
  const search = page.getByRole('searchbox', { name: /Search/ }).first();
  await page.locator('thead [role="checkbox"]').click();
  assert.equal(await selectedCount(), 50);
  await search.fill('fixture-003');
  await page.waitForFunction(
    () => document.querySelectorAll('tbody [role="checkbox"]').length === 1,
  );
  assert.equal(
    await clear().count(),
    0,
    'Changing a filter must clear all prior targets, including hidden rows.',
  );
  await page
    .getByRole('checkbox', { name: 'Select fixture-003.invalid', exact: true })
    .click();
  await openAction('Pricing…');
  await assertSingleDialog('fixture-003.invalid');
  results.push({
    case: 'select-all then filter then single pricing',
    targets: ['fixture-003.invalid'],
  });
  await closeDialog();
  await search.fill('fixture-00');
  await page
    .getByRole('checkbox', { name: 'Select fixture-007.invalid', exact: true })
    .click({ modifiers: ['Shift'] });
  assert.equal(
    await selectedCount(),
    1,
    'Shift anchor must reset with the filter.',
  );
  await openAction('Pricing…');
  await assertSingleDialog('fixture-007.invalid');
  await closeDialog();
  results.push({ case: 'shift selection resets across filters', targets: 1 });
  await search.fill('');
  await page.waitForFunction(
    () => document.querySelectorAll('tbody [role="checkbox"]').length === 50,
  );
  assert.equal(await clear().count(), 0);
  await page
    .getByRole('checkbox', { name: 'Select fixture-001.invalid', exact: true })
    .click();
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await page
    .getByRole('checkbox', { name: 'Select fixture-051.invalid', exact: true })
    .click();
  await openAction('Pricing…');
  const pagedText = await page.getByRole('dialog').innerText();
  assert(
    pagedText.includes('2 domains:') &&
      pagedText.includes('fixture-001.invalid') &&
      pagedText.includes('fixture-051.invalid'),
    pagedText,
  );
  await closeDialog();
  await page
    .getByRole('button', { name: 'Previous page', exact: true })
    .click();
  assert.equal(await selectedCount(), 1);
  results.push({ case: 'pagination preserves explicit selection', targets: 2 });
  await page
    .getByRole('link', { name: /Renewals/ })
    .first()
    .click();
  await page
    .getByRole('link', { name: /Domains/ })
    .first()
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll('tbody [role="checkbox"]').length === 50,
  );
  assert.equal(
    await clear().count(),
    0,
    'Navigation back cannot resurrect the previous selection.',
  );
  results.push({ case: 'navigation clears', selected: 0 });
  await page.locator('thead [role="checkbox"]').click();
  await page
    .getByRole('button', { name: 'Registrar: any', exact: true })
    .click();
  await page.getByRole('menuitemcheckbox', { name: /dynadot/i }).click();
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () => document.querySelectorAll('tbody [role="checkbox"]').length === 30,
  );
  assert.equal(await clear().count(), 0, 'Registrar filter clears selection.');
  await page
    .getByRole('button', { name: 'Remove Registrar filter', exact: true })
    .click();
  await search.fill('fixture-003');
  await page
    .getByRole('checkbox', { name: 'Select fixture-003.invalid', exact: true })
    .click();
  const writes = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/'))
      writes.push({
        method: request.url().split('/api/')[1],
        body: request.postDataJSON(),
      });
  });
  await openAction('Pricing…');
  await assertSingleDialog('fixture-003.invalid');
  await page.locator('#bin-price').fill('123');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  const pricingWrite = writes.find((w) => w.method === 'setListPrices');
  assert(pricingWrite, JSON.stringify(writes));
  assert.deepEqual(
    pricingWrite.body.args[0].map((row) => row.domainName),
    ['fixture-003.invalid'],
  );
  results.push({ case: 'pricing actual synthetic save targets', targets: 1 });
  await openAction('Notes…');
  await assertSingleDialog('fixture-003.invalid');
  await page
    .getByRole('textbox', { name: 'Notes', exact: true })
    .fill('Synthetic selection regression');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  const notes = writes.filter((w) => w.method === 'setNotes');
  assert.equal(notes.length, 1, JSON.stringify(writes));
  assert.equal(notes[0].body.args[0], 'fixture-003.invalid');
  results.push({ case: 'notes actual synthetic save targets', targets: 1 });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const download = await downloadPromise;
  const csv = await fs.readFile(await download.path(), 'utf8');
  assert(
    csv.includes('fixture-003.invalid') && !csv.includes('fixture-001.invalid'),
  );
  assert.deepEqual(csv.match(/fixture-\d{3}\.(?:invalid|example)/g), [
    'fixture-003.invalid',
  ]);
  results.push({ case: 'CSV export targets', targets: 1 });
  let releaseAssignment, assignmentSeen;
  const assignmentWait = new Promise((resolve) => {
    releaseAssignment = resolve;
  });
  const assignmentStarted = new Promise((resolve) => {
    assignmentSeen = resolve;
  });
  await page.route('**/api/assignFolder', async (route) => {
    const response = await route.fetch();
    assignmentSeen();
    await assignmentWait;
    await route.fulfill({ response });
  });
  await page
    .locator('button[aria-haspopup="menu"]:not([data-chip-trigger])')
    .filter({ hasText: /^Folder/ })
    .click();
  await page.getByRole('menuitem', { name: /^None/ }).click();
  await assignmentStarted;
  await search.fill('fixture-005');
  await page
    .getByRole('checkbox', { name: 'Select fixture-005.invalid', exact: true })
    .click();
  const assignmentResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/assignFolder'),
  );
  releaseAssignment();
  await assignmentResponse;
  await page.unroute('**/api/assignFolder');
  await openAction('Pricing…');
  await assertSingleDialog('fixture-005.invalid');
  await closeDialog();
  const assignments = writes.filter((w) => w.method === 'assignFolder');
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0].body.args[0], 'fixture-003.invalid');
  results.push({
    case: 'folder targets and delayed completion after filter change',
    targets: 1,
    newSelectionPreserved: true,
  });
  await search.fill('fixture-003');
  await page
    .getByRole('checkbox', { name: 'Select fixture-003.invalid', exact: true })
    .click();
  await openAction('Record sale…');
  await assertSingleDialog('fixture-003.invalid');
  await closeDialog();
  await openAction('Delete…');
  await assertSingleDialog('fixture-003.invalid');
  await closeDialog();
  results.push({
    case: 'ownership dialog targets; no sale/deletion submitted',
    targets: 1,
  });
  await page
    .getByRole('link', { name: /Activity/ })
    .first()
    .click();
  await page.locator('tbody [role="checkbox"]').first().waitFor();
  await page.locator('thead [role="checkbox"]').click();
  await page.getByRole('searchbox', { name: /Search/ }).fill('fixture-003');
  await page.waitForFunction(
    () => document.querySelectorAll('tbody [role="checkbox"]').length === 1,
  );
  assert.equal(
    await clear().count(),
    0,
    'Activity filters cannot leave hidden bulk targets.',
  );
  await page.locator('tbody [role="checkbox"]').first().click();
  await openAction('Delete');
  await assertSingleDialog('fixture-003.invalid');
  await closeDialog();
  results.push({ case: 'Activity bulk selection after filter', targets: 1 });
  assert.equal(await page.title(), 'domains.domains');
  const mobile = await browser.browser().newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await mobile.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort(),
  );
  const touchPage = await mobile.newPage();
  touchPage.setDefaultTimeout(15000);
  await touchPage.goto(origin + '/__qualification/session');
  await touchPage.locator('tbody [role="checkbox"]').first().waitFor();
  await touchPage.locator('thead [role="checkbox"]').tap();
  await touchPage
    .getByRole('searchbox', { name: /Search/ })
    .fill('fixture-003');
  await touchPage.waitForFunction(
    () => document.querySelectorAll('tbody [role="checkbox"]').length === 1,
  );
  assert.equal(
    await touchPage
      .getByRole('button', { name: 'Clear selection', exact: true })
      .count(),
    0,
  );
  await touchPage.locator('tbody [role="checkbox"]').first().tap();
  assert.equal(
    await touchPage
      .locator('tbody [role="checkbox"][data-state="checked"]')
      .count(),
    1,
  );
  await touchPage.screenshot({ path: path.join(out, 'mobile-selection.png') });
  await mobile.close();
  results.push({ case: 'mobile touch selection after filter', targets: 1 });
  await page.screenshot({ path: path.join(out, 'selection-verified.png') });
  await fs.writeFile(
    path.join(out, 'result.json'),
    JSON.stringify({ status: 'passed', results }, null, 2),
  );
  console.log(JSON.stringify({ status: 'passed', results }));
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(out, 'failure.png') });
    await fs.writeFile(
      path.join(out, 'failure.txt'),
      await page.locator('body').innerText(),
    );
  }
  throw error;
} finally {
  await browser.close();
  await fs.rm(profile, { recursive: true, force: true });
}
