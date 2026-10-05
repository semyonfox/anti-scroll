const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/content.js"), "utf8").replace(
  "})(globalThis);",
  `root.__test = {
    registerScrollContainer,
    stopContainerWatch,
    restoreElement,
    surfaceTargets,
    refreshFeedTargets,
    setFeedMatch(match) { shieldMatch = match; },
  }; })(globalThis);`,
);

class TestElement {
  constructor() {
    this.scrollTop = 10;
    this.scrollLeft = 0;
    this.scrollHeight = 200;
    this.clientHeight = 100;
    this.scrollWidth = 100;
    this.clientWidth = 100;
    this.dataset = {};
    this.isConnected = true;
  }
  addEventListener() {}
  removeEventListener() {}
}

const document = {
  documentElement: new TestElement(),
  getElementById() { return null; },
  addEventListener() {},
  dispatchEvent() {},
};
const api = {
  storage: {
    sync: {},
    onChanged: { addListener() {} },
  },
  runtime: { onMessage: { addListener() {} } },
};
const config = {
  DEFAULT_SETTINGS: { mode: "disabled" },
  SETTINGS_KEY: "settings",
  FEED_SELECTORS: {},
  getApi() { return api; },
  storageGet() { return new Promise(() => {}); },
};
const context = {
  AntiScrollConfig: config,
  Element: TestElement,
  HTMLElement: TestElement,
  document,
  location: { href: "https://example.test/" },
  CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  getComputedStyle() { return { overflowY: "auto", overflowX: "hidden" }; },
  setInterval() {},
  setTimeout() {},
  clearTimeout() {},
  clearInterval() {},
  addEventListener() {},
};
context.top = context;
vm.runInNewContext(source, context, { filename: "content.js" });

const bridge = context.__test;
assert.ok(bridge, "test bridge should be installed");
const scroller = new TestElement();
bridge.registerScrollContainer(scroller, false);
bridge.stopContainerWatch();
scroller.scrollTop = 100;
bridge.registerScrollContainer(scroller, false);
scroller.scrollTop = 110;
bridge.restoreElement(scroller);
assert.equal(scroller.scrollTop, 100, "new lock session should capture the current position");

const target = new TestElement();
target.dataset.antiScrollFeedTarget = "true";
bridge.surfaceTargets.add(target);
target.isConnected = false;
bridge.setFeedMatch({ active: true, type: "feed", presetId: "example" });
bridge.refreshFeedTargets([]);
assert.equal(target.dataset.antiScrollFeedTarget, undefined, "detached target should lose hiding marker");
assert.equal(bridge.surfaceTargets.has(target), false);
console.log("content DOM behavior ok");
