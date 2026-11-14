const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/content.js"), "utf8");

async function runCase(changeBeforeRead, hasNavigation) {
  const intervals = [];
  const events = new Map();
  const navigationEvents = new Map();
  const matchedUrls = [];
  let resolveRead;
  let onChanged;
  let onMessage;
  const document = {
    documentElement: { dataset: {} },
    getElementById() { return null; },
    addEventListener() {},
    dispatchEvent() {},
  };
  const api = {
    storage: {
      sync: {},
      onChanged: { addListener(listener) { onChanged = listener; } },
    },
    runtime: { onMessage: { addListener(listener) { onMessage = listener; } } },
  };
  const config = {
    DEFAULT_SETTINGS: { mode: "selected" },
    SETTINGS_KEY: "settings",
    FEED_SELECTORS: {},
    getApi() { return api; },
    sanitizeSettings(value) { return value; },
    matchShield(url, settings) {
      matchedUrls.push(url);
      return { active: false, reason: settings.mode, host: "example.test" };
    },
    storageGet() {
      return new Promise((resolve) => { resolveRead = resolve; });
    },
  };
  const context = {
    AntiScrollConfig: config,
    document,
    location: { href: "https://example.test/" },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    navigation: hasNavigation ? {
      addEventListener(name, listener) { navigationEvents.set(name, listener); },
    } : undefined,
    setInterval(callback, delay) { intervals.push({ callback, delay }); },
    setTimeout() {},
    clearTimeout() {},
    addEventListener(name, listener) { events.set(name, listener); },
  };
  context.top = context;
  vm.runInNewContext(source, context, { filename: "content.js" });
  assert.equal(typeof onChanged, "function");
  assert.equal(typeof onMessage, "function");

  const change = () => onChanged({ settings: { newValue: { mode: "disabled" } } }, "sync");
  const read = () => resolveRead({ settings: { mode: "selected" } });
  if (changeBeforeRead) {
    change();
    read();
  } else {
    read();
    await Promise.resolve();
    change();
  }
  await Promise.resolve();
  await Promise.resolve();
  let response;
  onMessage({ type: "anti-scroll-current-state" }, {}, (value) => { response = value; });
  assert.equal(response.match.reason, "disabled");

  if (hasNavigation) {
    assert.equal(intervals.length, 0, "Navigation API support should avoid URL polling");
    assert.equal(typeof navigationEvents.get("currententrychange"), "function");
  } else {
    assert.equal(intervals.length, 1);
    assert.equal(intervals[0].delay, 2000, "legacy URL fallback should use a slower interval");
  }

  const signals = [
    () => events.get("popstate")(),
    () => events.get("hashchange")(),
    () => onMessage({ type: "anti-scroll-location-change" }, {}, () => {}),
    hasNavigation
      ? () => navigationEvents.get("currententrychange")()
      : () => intervals[0].callback(),
  ];
  for (let index = 0; index < signals.length; index += 1) {
    context.location.href = `https://example.test/route-${index}`;
    const count = matchedUrls.length;
    signals[index]();
    assert.ok(matchedUrls.length > count, "route changes should refresh shield state");
    assert.equal(matchedUrls.at(-1), context.location.href);
    const updatedCount = matchedUrls.length;
    signals[index]();
    assert.equal(matchedUrls.length, updatedCount, "duplicate signals should not refresh state");
  }
}

(async () => {
  await runCase(true, true);
  await runCase(false, true);
  await runCase(true, false);
  await runCase(false, false);
  console.log("content initialization ordering ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
