const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/telemetry.js"), "utf8");
const flush = () => new Promise((resolve) => setImmediate(resolve));
function fixture(options = {}) {
  const requests = [];
  let listener;
  let now = 100000;
  let read = async () => ({ settings: { anonymousTelemetryEnabled: options.enabled ?? true, privateText: "PRIVATE-CANARY" } });
  const context = {
    URL, AbortController, navigator: {}, Date: { now: () => now },
    setTimeout() { return 1; }, clearTimeout() {},
    fetch: async (url, init) => { requests.push({ url, init }); if (options.failFetch) throw new Error("PRIVATE-CANARY"); },
    AntiScrollConfig: {
      SETTINGS_KEY: "settings", storageGet: (...args) => read(...args),
      getApi: () => ({
        runtime: { get lastError() { if (options.throwLastError) throw new Error("private"); return null; } },
        permissions: { contains(_request, callback) {
          if (options.rejectPermission) return Promise.reject(new Error("private"));
          if (options.asyncPermission) { queueMicrotask(() => callback(options.permission ?? true)); return; }
          callback(options.permission ?? true);
        } },
        storage: { sync: {}, onChanged: { addListener(fn) { listener = fn; } } },
      }),
    },
  };
  vm.runInNewContext(options.unconfigured ? source : source.replace('const endpoint = "";', 'const endpoint = "https://collector.invalid/v1/events";'), context);
  return { context, requests, api: context.AntiScrollTelemetry, read(fn) { read = fn; }, advance() { now += 60000; }, change(enabled) { listener({ settings: { newValue: { anonymousTelemetryEnabled: enabled } } }, "sync"); } };
}
(async () => {
  for (const options of [{ unconfigured: true }, { enabled: false }, { enabled: "yes" }, { permission: false }]) {
    const f = fixture(options); f.api.open(); f.api.error("storage_failed"); await flush();
    assert.equal(f.requests.length, 0, "configuration, opt-in and permission are required");
  }
  for (const signal of [{ globalPrivacyControl: true }, { doNotTrack: "1" }, { doNotTrack: "yes" }]) {
    const f = fixture(); Object.assign(f.context.navigator, signal); f.api.open(); await flush(); assert.equal(f.requests.length, 0);
  }
  for (const options of [{ asyncPermission: true, throwLastError: true }, { rejectPermission: true }]) {
    const f = fixture(options); f.api.open(); await flush(); assert.equal(f.requests.length, 0, "async permission errors fail harmlessly");
  }
  const delayed = fixture({ asyncPermission: true }); delayed.api.open(); await flush(); assert.equal(delayed.requests.length, 1);
  const deniedGetter = fixture(); Object.defineProperty(deniedGetter.context.navigator, "globalPrivacyControl", { get() { throw new Error("private"); } }); deniedGetter.api.open(); await flush(); assert.equal(deniedGetter.requests.length, 0);
  const f = fixture({ failFetch: true }); f.api.open(); await flush();
  const payload = JSON.parse(f.requests[0].init.body);
  assert.deepEqual(payload, { version: 1, app: "anti-scroll", kind: "count", name: "app_open", surface: "extension", route: "popup" });
  assert.equal(f.requests[0].url, "https://collector.invalid/v1/events");
  assert.equal(f.requests[0].init.credentials, "omit"); assert.equal(f.requests[0].init.referrerPolicy, "no-referrer"); assert.equal(f.requests[0].init.redirect, "error");
  assert.equal(JSON.stringify(f.requests).includes("PRIVATE-CANARY"), false);
  await flush(); assert.equal(f.requests.length, 1, "failed transport is not retried");
  f.api.error("PRIVATE-CANARY"); await flush(); assert.equal(f.requests.length, 1, "unknown categories are dropped");
  f.api.error("storage_failed"); await flush(); f.api.error("storage_failed"); await flush(); assert.equal(f.requests.length, 2, "repeated errors are deduplicated");
  f.read(async () => { throw new Error("PRIVATE-CANARY"); }); f.api.open(); await flush(); assert.equal(f.requests.length, 2, "unreadable preference fails closed");
  const stale = fixture(); let finish;
  stale.read(() => new Promise((resolve) => { finish = resolve; })); stale.api.open(); await flush(); stale.api.open(); await flush();
  stale.change(false); finish({ settings: { anonymousTelemetryEnabled: true } }); await flush(); assert.equal(stale.requests.length, 0, "stale opt-in cannot override cross-popup opt-out");
  stale.read(async () => ({ settings: { anonymousTelemetryEnabled: false } })); stale.api.open(); await flush(); assert.equal(stale.requests.length, 0);
  for (const failure of ["AbortController", "setTimeout"]) {
    const broken = fixture(); broken.context[failure] = function () { throw new Error("private"); }; broken.api.open(); await flush(); assert.equal(broken.requests.length, 0, "setup failure cannot send");
  }
  const bounded = fixture();
  for (let minute = 0; minute < 11; minute += 1) {
    for (let event = 0; event < 25; event += 1) { bounded.api.open(); await flush(); }
    assert.equal(bounded.requests.length, Math.min((minute + 1) * 20, 200)); bounded.advance();
  }
  const timeoutFixture = fixture(); let timeoutCallback;
  timeoutFixture.context.setTimeout = (callback, delay) => { assert.equal(delay, 2000); timeoutCallback = callback; return 1; };
  timeoutFixture.context.fetch = (url, init) => {
    timeoutFixture.requests.push({ url, init });
    return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("private"))));
  };
  timeoutFixture.api.open(); await flush(); timeoutCallback(); await flush();
  assert.equal(timeoutFixture.requests[0].init.signal.aborted, true);
  assert.equal(timeoutFixture.requests.length, 1, "timeout does not retry");
  timeoutFixture.api.open(); await flush(); assert.equal(timeoutFixture.requests.length, 2, "timeout releases the in-flight guard"); timeoutCallback(); await flush();
  const concurrent = fixture(); let release;
  concurrent.context.fetch = async (url, init) => { concurrent.requests.push({ url, init }); await new Promise((resolve) => { release = resolve; }); };
  concurrent.api.open(); await flush(); concurrent.api.open(); await flush(); assert.equal(concurrent.requests.length, 1); release(); await flush();
  console.log("telemetry privacy, failure and rate limits ok");
})().catch((error) => { console.error(error); process.exitCode = 1; });
