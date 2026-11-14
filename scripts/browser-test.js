const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "anti-scroll-browser-"));
  const extension = path.resolve(__dirname, "..");
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const id = new URL(worker.url()).host;
    await context.route("https://www.youtube.com/**", (route) => route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><style>body {min-height:4000px} #nested {height:100px;overflow:auto}</style>
        <input aria-label="Message"><div id="nested"><div style="height:2000px">Nested content</div></div>
        <ytd-browse page-subtype="home"><ytd-rich-grid-renderer><div id="contents">Feed</div></ytd-rich-grid-renderer></ytd-browse>
        <div id="related">Recommendations</div><a id="watch" href="/watch?v=fixture">Watch</a>`,
    }));
    const page = await context.newPage();
    await page.goto("https://www.youtube.com/");
    await page.waitForFunction(() => document.documentElement.dataset.antiScrollFeedSurface === "true");
    assert.equal(await page.locator("ytd-rich-grid-renderer").isVisible(), false);
    assert.equal(await page.locator("#anti-scroll-feed-placeholder").isVisible(), true);
    await page.evaluate(() => history.pushState({}, "", "/watch?v=fixture"));
    await page.waitForFunction(() => document.documentElement.dataset.antiScrollFeedSurface !== "true");
    assert.equal(await page.locator("ytd-rich-grid-renderer").isVisible(), true);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/popup.html`);
    await popup.locator("#modeDisabled").click();
    await popup.waitForFunction(async () => (await chrome.storage.sync.get("antiScrollSettings")).antiScrollSettings.mode === "disabled");
    await popup.locator("#modeSelected").click();
    await page.goto("https://www.youtube.com/");
    await page.waitForFunction(() => document.documentElement.dataset.antiScrollFeedSurface === "true");
    await page.evaluate(() => history.pushState({}, "", "/watch?v=fixture"));
    await popup.locator("#mode-youtube").selectOption("full-page");
    await page.waitForFunction(() => document.documentElement.dataset.antiScrollShield === "true");
    await popup.locator("#mode-youtube").selectOption("entry-points");
    await page.waitForFunction(() => document.documentElement.dataset.antiScrollEntryPoints === "true");
    assert.equal(await page.locator("#related").isVisible(), false);
    assert.equal(await page.locator("ytd-rich-grid-renderer").isVisible(), true);
    assert.equal(await page.locator("#anti-scroll-feed-placeholder").count(), 0);
    await popup.locator("#mode-youtube").selectOption("off");
    await page.waitForFunction(() => document.documentElement.dataset.antiScrollFeedSurface !== "true");
    assert.equal(await page.locator("#related").isVisible(), true);
    await popup.locator("#mode-youtube").selectOption("");
    for (const colourScheme of ["light", "dark"]) {
      await popup.emulateMedia({ colorScheme: colourScheme });
      await popup.setViewportSize({ width: 380, height: 850 });
      await popup.screenshot({ path: `/tmp/anti-scroll-modes-${colourScheme}.png`, fullPage: true });
    }
    await popup.locator("#durationMinutes").fill("5");
    await popup.locator("#startTimer").click();
    await popup.waitForFunction(async () => (await chrome.storage.sync.get("antiScrollSettings")).antiScrollSettings.activeUntil > Date.now());
    await popup.locator("#clearTimer").click();
    await popup.waitForFunction(async () => (await chrome.storage.sync.get("antiScrollSettings")).antiScrollSettings.activeUntil === null);
    await worker.evaluate(async () => {
      const { antiScrollSettings: settings } = await chrome.storage.sync.get("antiScrollSettings");
      await chrome.storage.sync.set({ antiScrollSettings: { ...settings, mode: "all" } });
    });
    await page.waitForFunction(() => document.documentElement.dataset.antiScrollShield === "true");
    await page.evaluate(() => { window.scrollTo(0, 500); document.querySelector("#nested").scrollTop = 300; });
    await page.waitForFunction(() => window.scrollY === 0 && document.querySelector("#nested").scrollTop === 0);
    await popup.locator("#modeDisabled").click();
    await page.waitForFunction(() => document.documentElement.dataset.antiScrollShield !== "true");
    await page.evaluate(() => window.scrollTo(0, 500));
    assert.equal(await page.evaluate(() => window.scrollY), 500);
    await worker.evaluate(() => chrome.storage.local.set({ antiScrollAnalytics: { total: 4, bySite: {}, byDomain: {}, lastAt: Date.now() } }));
    await popup.locator("#resetStats").click();
    await popup.waitForFunction(async () => (await chrome.storage.local.get("antiScrollAnalytics")).antiScrollAnalytics.total === 0);
    console.log("browser extension behaviour ok");
  } finally {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
