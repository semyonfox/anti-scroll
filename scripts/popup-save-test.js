const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
require("../src/constants.js");

const config = globalThis.AntiScrollConfig;
const nodes = new Map();
class Node {
  constructor() {
    this.dataset = {};
    this.listeners = {};
    this.classes = new Set();
    this.classList = {
      add: (name) => this.classes.add(name),
      toggle: (name, active) => active ? this.classes.add(name) : this.classes.delete(name),
    };
    this.value = "";
  }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  setAttribute() {}
  append() {}
  replaceChildren() {}
  querySelector() { return null; }
}
const document = {
  getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, new Node());
    return nodes.get(id);
  },
  createElement() { return new Node(); },
  createDocumentFragment() { return new Node(); },
  addEventListener(type, listener) { this.listeners[type] = listener; },
  listeners: {},
};
let failWrite = true;
let failRead = false;
let holdWrite = false;
let finishWrite;
let refreshTick;
const stored = { [config.SETTINGS_KEY]: config.DEFAULT_SETTINGS };
const area = {
  get(defaults, callback) {
    if (failRead) {
      chrome.runtime.lastError = { message: "synthetic read failure" };
      callback(defaults);
      chrome.runtime.lastError = null;
      return;
    }
    callback({ ...defaults, ...stored });
  },
  set(value, callback) {
    if (holdWrite) { finishWrite = () => { Object.assign(stored, value); callback(); }; return; }
    if (failWrite) {
      chrome.runtime.lastError = { message: "synthetic quota failure" };
      callback();
      chrome.runtime.lastError = null;
      return;
    }
    Object.assign(stored, value);
    callback();
  },
};
globalThis.chrome = {
  runtime: { lastError: null },
  storage: {
    sync: area,
    local: { get(defaults, callback) { callback(defaults); } },
    onChanged: { addListener() {} },
  },
  tabs: { query(_query, callback) { callback([]); } },
};
const source = fs.readFileSync(path.join(__dirname, "../popup/popup.js"), "utf8");
vm.runInNewContext(source, {
  AntiScrollConfig: config,
  document,
  setInterval(callback) { refreshTick = callback; },
});
document.listeners.DOMContentLoaded();
document.getElementById("modeSelected").dataset.mode = "selected";
document.getElementById("modeAll").dataset.mode = "all";

(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  const off = document.getElementById("modeDisabled");
  off.dataset.mode = "disabled";
  await off.listeners.click({ currentTarget: off });
  assert.equal(stored[config.SETTINGS_KEY].mode, config.MODES.SELECTED);
  assert.equal(document.getElementById("statusPill").textContent, "Save failed");
  assert.equal(document.getElementById("currentStatus").textContent, "Could not save settings");
  assert.equal(document.getElementById("modeSelected").classes.has("active"), true);
  assert.equal(off.classes.has("active"), false);

  failWrite = false;
  await off.listeners.click({ currentTarget: off });
  assert.equal(stored[config.SETTINGS_KEY].mode, config.MODES.DISABLED);
  assert.equal(document.getElementById("statusPill").textContent, "Off");

  holdWrite = true;
  document.getElementById("durationMinutes").value = "30";
  const timerSave = document.getElementById("startTimer").listeners.click();
  assert.equal(document.getElementById("clearTimer").disabled, true);
  refreshTick();
  assert.equal(document.getElementById("clearTimer").disabled, true, "timer refresh must not reopen actions while saving");
  assert.equal(document.getElementById("siteSearch").disabled, true);
  finishWrite();
  await timerSave;
  assert.equal(document.getElementById("clearTimer").disabled, false);
  holdWrite = false;

  stored[config.SETTINGS_KEY] = config.DEFAULT_SETTINGS;
  failRead = true;
  nodes.clear();
  vm.runInNewContext(source, {
    AntiScrollConfig: config,
    document,
    setInterval() {},
  });
  document.listeners.DOMContentLoaded();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.getElementById("statusPill").textContent, "Load failed");
  assert.equal(document.getElementById("currentStatus").textContent, "Could not load settings");
  const offAfterReadFailure = document.getElementById("modeDisabled");
  offAfterReadFailure.dataset.mode = "disabled";
  await offAfterReadFailure.listeners.click({ currentTarget: offAfterReadFailure });
  assert.equal(stored[config.SETTINGS_KEY].mode, config.MODES.SELECTED);
  console.log("popup save behavior ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
