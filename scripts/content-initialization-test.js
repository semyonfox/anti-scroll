const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/content.js"), "utf8");

async function runCase(changeBeforeRead) {
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
    matchShield(_url, settings) {
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
    setInterval() {},
    setTimeout() {},
    clearTimeout() {},
    addEventListener() {},
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
}

(async () => {
  await runCase(true);
  await runCase(false);
  console.log("content initialization ordering ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
