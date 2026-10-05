const assert = require("node:assert/strict");
require("../src/constants.js");

const { storageGet, storageSet } = globalThis.AntiScrollConfig;
const failure = new Error("synthetic storage failure");

(async () => {
  const rejectedArea = {
    get() {
      return Promise.reject(failure);
    },
    set() {
      return Promise.reject(failure);
    },
  };
  await assert.rejects(storageGet(rejectedArea, {}), failure);
  await assert.rejects(storageSet(rejectedArea, {}), failure);

  globalThis.chrome = { runtime: { lastError: null } };
  const callbackErrorArea = {
    get(_defaults, callback) {
      chrome.runtime.lastError = { message: "synthetic read failure" };
      callback({});
      chrome.runtime.lastError = null;
    },
    set(_values, callback) {
      chrome.runtime.lastError = { message: "synthetic write failure" };
      callback();
      chrome.runtime.lastError = null;
    },
  };
  await assert.rejects(storageGet(callbackErrorArea, {}), /synthetic read failure/);
  await assert.rejects(storageSet(callbackErrorArea, {}), /synthetic write failure/);

  const workingArea = {
    get(defaults, callback) {
      callback({ ...defaults, saved: true });
    },
    set(_values, callback) {
      callback();
    },
  };
  assert.deepEqual(await storageGet(workingArea, { saved: false }), { saved: true });
  await storageSet(workingArea, { saved: true });
  console.log("storage behavior ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
