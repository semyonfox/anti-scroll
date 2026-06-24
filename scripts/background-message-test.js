require("../src/constants.js");

const config = globalThis.AntiScrollConfig;
const storage = {
  sync: Object.create(null),
  local: Object.create(null)
};
let messageListener = null;

function storageArea(name) {
  return {
    get(defaults, callback) {
      const result = { ...(defaults || {}), ...storage[name] };
      callback?.(result);
      return undefined;
    },
    set(values, callback) {
      Object.assign(storage[name], values);
      callback?.();
      return undefined;
    }
  };
}

globalThis.chrome = {
  runtime: {
    id: "anti-scroll-test",
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: {
      addListener(listener) {
        messageListener = listener;
      }
    }
  },
  storage: {
    sync: storageArea("sync"),
    local: storageArea("local"),
    onChanged: { addListener() {} }
  },
  alarms: {
    create() {},
    clear(_name, callback) {
      callback?.(true);
    },
    onAlarm: { addListener() {} }
  },
  action: {
    setBadgeText(_details, callback) {
      callback?.();
    },
    setBadgeBackgroundColor(_details, callback) {
      callback?.();
    },
    setTitle(_details, callback) {
      callback?.();
    }
  },
  scripting: {
    registerContentScripts() {
      return Promise.resolve();
    },
    unregisterContentScripts() {
      return Promise.resolve();
    }
  },
  webNavigation: { onHistoryStateUpdated: { addListener() {} } },
  tabs: { sendMessage() {} }
};

require("../src/background.js");

if (typeof messageListener !== "function") {
  throw new Error("background should register a runtime message listener");
}

function sendAttempt(message, senderUrl) {
  return new Promise((resolve) => {
    const keepAlive = messageListener(
      { type: "anti-scroll-attempt", ...message },
      { id: "anti-scroll-test", url: senderUrl },
      resolve
    );
    if (!keepAlive) {
      // Invalid payloads respond synchronously before returning false.
    }
  });
}

(async () => {
  const accepted = await sendAttempt(
    { matchType: "preset", presetId: "x", domain: "x.com" },
    "https://x.com/home"
  );
  if (!accepted?.ok) {
    throw new Error("expected matching preset sender to be accepted");
  }

  const forgedPreset = await sendAttempt(
    { matchType: "preset", presetId: "x", domain: "x.com" },
    "https://www.reddit.com/"
  );
  if (forgedPreset?.ok) {
    throw new Error("expected mismatched preset sender to be rejected");
  }

  const forgedCustom = await sendAttempt(
    { matchType: "custom", domain: "evil.example" },
    "https://example.com/"
  );
  if (forgedCustom?.ok) {
    throw new Error("expected mismatched custom sender to be rejected");
  }

  const extensionSender = await sendAttempt(
    { matchType: "preset", presetId: "x", domain: "x.com" },
    "chrome-extension://anti-scroll-test/popup/popup.html"
  );
  if (extensionSender?.ok) {
    throw new Error("expected non-http sender to be rejected");
  }

  const analytics = config.sanitizeAnalytics(storage.local[config.ANALYTICS_KEY]);
  if (
    analytics.total !== 1 ||
    analytics.bySite.x !== 1 ||
    analytics.byDomain["x.com"] !== 1
  ) {
    throw new Error("analytics should include only the validated sender attempt");
  }

  console.log("background message validation ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
