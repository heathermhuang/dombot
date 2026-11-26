import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const isolatedStage =
  /^https:\/\/domains-[a-z0-9-]+-qa-[a-f0-9]{8}\.[a-z0-9-]+\.workers\.dev$/;

export async function launchReferralBrowser(tools) {
  assert(
    tools && path.isAbsolute(tools),
    'Set DOMBOT_UI_QA_TOOLS to a temporary directory with playwright-core.',
  );
  const { chromium } = createRequire(path.join(tools, 'qa-runner.cjs'))(
    'playwright-core',
  );
  return chromium.launch({
    executablePath:
      process.env.DOMBOT_UI_QA_CHROME ??
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--disable-extensions', '--no-first-run'],
  });
}

/** Runs against one listing allocated and cleaned by the fixture driver. */
export async function qualifyReferrals(browser, fixture, evidence) {
  const {
    origin,
    domain,
    buyer,
    initialPrice,
    revisedPrice,
    partnerToken,
    partnerName,
    workspace,
  } = fixture;
  assert(fixture.synthetic === true && /^[a-f0-9]{40}$/.test(fixture.source));
  assert(
    isolatedStage.test(origin) ||
      (origin === 'https://localhost' && fixture.browserTransport),
  );
  assert(/^referral-qa-[a-f0-9]{8}\.example$/.test(domain));
  const request =
    fixture.request ??
    ((url, options) =>
      fetch(url, {
        ...options,
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      }));
  const contexts = [];
  const openPage = async (viewport, seller = false) => {
    const context = await browser.newContext({
      viewport,
      isMobile: viewport.width < 500,
      hasTouch: viewport.width < 500,
    });
    contexts.push(context);
    if (fixture.browserTransport) await fixture.browserTransport(context);
    if (seller) await fixture.signIn(context);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    return page;
  };
  const feed = (token = partnerToken) =>
    request(origin + '/api/agent/referrals', {
      headers: { Authorization: 'Bearer ' + token },
    });
  const entries = async () => {
    const result = await feed();
    assert.equal(result.status, 200);
    const payload = await result.json();
    assert.deepEqual(Object.keys(payload).sort(), ['listings', 'nextCursor']);
    assert.equal(payload.nextCursor, null, 'Expected one bounded fixture');
    for (const item of payload.listings)
      assert.deepEqual(Object.keys(item).sort(), [
        'askingPrice',
        'domain',
        'lastVerified',
        'offerUrl',
        'priceValidUntil',
      ]);
    return payload.listings;
  };
  const offerLink = async (price) => {
    const items = await entries();
    assert.equal(items.length, 1);
    assert.equal(items[0].domain, domain);
    assert.deepEqual(items[0].askingPrice, price);
    const url = new URL(items[0].offerUrl);
    assert(
      url.origin === origin &&
        url.pathname === '/' + domain &&
        url.searchParams.has('referral'),
    );
    return url.href;
  };
  const checked = (name) => evidence.checks.push(name);
  const sellerPage = await openPage({ width: 1366, height: 820 }, true);
  const desktop = await openPage({ width: 1366, height: 820 });
  const mobile = await openPage({ width: 390, height: 844 });
  const card = sellerPage.locator('article').filter({
    has: sellerPage.getByRole('link', { name: domain, exact: true }),
  });
  const dashboard = origin + '/account/agent-listings';
  const consent = async (label) => {
    await sellerPage.goto(dashboard);
    const posted = sellerPage.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && r.url() === dashboard + '/referrals',
    );
    await card.getByRole('button', { name: label, exact: true }).click();
    const result = await posted;
    assert.equal(
      result.status(),
      303,
      'Seller consent POST must redirect after saving',
    );
    await sellerPage.waitForURL(dashboard);
  };
  const listing = async (page, url) => {
    assert.equal((await page.goto(url)).status(), 200);
    await page
      .getByText(
        'This offer will be marked as a referral from ' + partnerName + '.',
        { exact: true },
      )
      .waitFor();
    const radio = page.getByRole('radio', { name: 'Make an offer' });
    if (await radio.count()) await radio.check();
    await page.locator('#offer').waitFor();
    assert(
      await page
        .locator('main')
        .evaluate(
          (el) => el.scrollWidth <= document.documentElement.clientWidth,
        ),
    );
  };
  try {
    assert.equal((await feed('invalid-synthetic-partner-token')).status, 401);
    assert.deepEqual(await entries(), []);
    await consent('Share this revision');
    const handoff = await offerLink(initialPrice);
    checked(
      'Authorized feed and exact asking price require current seller consent',
    );

    await listing(desktop, handoff);
    await listing(mobile, handoff);
    checked('Desktop and mobile display the referred offer form');
    const formData = await desktop
      .locator('form')
      .filter({ has: desktop.locator('#offer') })
      .evaluate((form) => Object.fromEntries(new FormData(form)));
    const action = await desktop
      .locator('form')
      .filter({ has: desktop.locator('#offer') })
      .getAttribute('action');
    const stale = await request(new URL(action, origin).href, {
      method: 'POST',
      headers: { Origin: origin },
      body: new URLSearchParams({
        ...formData,
        observedRevision: '00000000-0000-4000-8000-000000000000',
      }),
    });
    assert.equal(stale.status, 409);
    checked('A stale submitted revision is rejected');

    await mobile.locator('#name').fill('Synthetic referral buyer');
    await mobile.locator('#email').fill(buyer);
    await mobile.locator('#offer').fill(initialPrice.amount);
    await mobile.locator('#message').fill('Synthetic referral qualification.');
    const pendingPost = mobile.waitForRequest(
      (r) =>
        r.method() === 'POST' &&
        new URL(r.url()).pathname === '/' + domain + '/inquiries',
    );
    await mobile.getByRole('button', { name: /Send (inquiry|offer)/i }).click();
    const submitted = await pendingPost;
    const receiptLabel = mobile.locator('.receipt');
    await receiptLabel.waitFor();
    const receipt = (await receiptLabel.textContent()).match(
      /[a-f0-9-]{36}/,
    )?.[0];
    assert(receipt, 'Expected one Sales receipt');
    fixture.trackReceipt(receipt);
    const retry = await request(submitted.url(), {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': submitted.headers()['content-type'],
      },
      body: submitted.postDataBuffer(),
    });
    assert.equal(retry.status, 202);
    assert(
      (await retry.text()).includes(receipt),
      'Replay must return the original receipt',
    );
    const initial = await fixture.counts(receipt);
    assert.deepEqual(initial, { cases: 1, attributions: 1 });
    evidence.counts = initial;
    checked(
      'Identical browser submission replay returns one case and one attribution',
    );

    const verification = new URL(await fixture.verification(receipt));
    assert(
      verification.origin === origin &&
        verification.pathname.startsWith('/w/' + workspace + '/i/'),
    );
    await mobile.goto(verification.href);
    await mobile
      .getByRole('button', { name: 'Confirm email address', exact: true })
      .click();
    await mobile.getByText('Awaiting seller review', { exact: true }).waitFor();
    const thread = mobile.url();
    assert(new URL(thread).pathname.startsWith('/w/' + workspace + '/t/'));
    await sellerPage.goto(dashboard);
    const caseLink = sellerPage
      .locator('a')
      .filter({ hasText: domain + ' · ' + partnerName });
    assert.equal(
      await caseLink.getAttribute('href'),
      '/w/' + workspace + '/#/sales/inbox/' + receipt,
    );
    await caseLink.click();
    await sellerPage
      .getByText('Email confirmed', { exact: true })
      .last()
      .waitFor();
    const reply = 'Synthetic seller reply from the Sales Inbox.';
    await sellerPage.locator('#inquiry-reply').fill(reply);
    const replyResponse = sellerPage.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname.endsWith(
          '/sales/inbox/' + receipt + '/messages',
        ),
    );
    await sellerPage
      .getByRole('button', { name: 'Queue email reply', exact: true })
      .click();
    assert.equal(
      (await replyResponse).status(),
      200,
      'Expected the Sales Inbox reply to be saved',
    );
    await desktop.goto(thread);
    await desktop.getByText(reply, { exact: true }).waitFor();
    await desktop.getByText('Seller replied', { exact: true }).waitFor();
    assert.deepEqual(await fixture.counts(receipt), initial);
    await offerLink(initialPrice);
    checked(
      'Buyer verified by email and reopened the same thread with the Sales Inbox reply',
    );
    checked('Partner feed excludes buyer and case data');

    await fixture.reprice(revisedPrice);
    assert.equal((await request(handoff)).status, 404);
    assert.deepEqual(await entries(), []);
    await consent('Share this revision');
    const refreshed = await offerLink(revisedPrice);
    assert.equal((await request(handoff)).status, 404);
    checked('Old revision is revoked and new price requires fresh consent');
    await consent('Stop sharing');
    assert.equal((await request(refreshed)).status, 404);
    assert.deepEqual(await entries(), []);
    checked('Opt-out removes the listing and invalidates its handoff');
    await consent('Share this revision');
    const withdrawn = await offerLink(revisedPrice);
    await fixture.withdraw();
    assert.deepEqual(await entries(), []);
    assert.equal((await request(withdrawn)).status, 404);
    await desktop.goto(thread);
    await desktop.getByText(reply, { exact: true }).waitFor();
    checked(
      'Withdrawal removes the listing while the confirmed conversation remains open',
    );
  } finally {
    await Promise.allSettled(contexts.map((context) => context.close()));
  }
}

export async function runReferralQualification(browser, driver, evidence) {
  let fixture;
  try {
    fixture = await driver.prepare();
    evidence.source = fixture.source;
    evidence.target = fixture.browserTransport
      ? 'local simulation'
      : 'isolated staging';
    await qualifyReferrals(browser, fixture, evidence);
  } finally {
    evidence.cleanup = await driver.cleanup(fixture);
  }
  evidence.passed = true;
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  const [driverPath, output] = process.argv.slice(2);
  assert(
    driverPath && output,
    'Usage: node scripts/referral-browser-qualification.mjs PRIVATE_FIXTURE_DRIVER EVIDENCE_JSON',
  );
  const driver = (await import(pathToFileURL(path.resolve(driverPath)).href))
    .default;
  const browser = await launchReferralBrowser(process.env.DOMBOT_UI_QA_TOOLS);
  const evidence = { checks: [], passed: false };
  try {
    await runReferralQualification(browser, driver, evidence);
  } finally {
    await browser.close();
    await writeFile(
      path.resolve(output),
      JSON.stringify(evidence, null, 2) + '\n',
      { mode: 0o600 },
    );
  }
}
