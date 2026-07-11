require("../src/constants.js");

const config = globalThis.AntiScrollConfig;
const storage = {
  sync: Object.create(null),
  local: Object.create(null)
};
let messageListener = null;
let permissionDecisions = new Map();
const registeredScripts = [];
const storageChangeListeners = [];

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
    onChanged: {
      addListener(listener) {
        storageChangeListeners.push(listener);
      }
    }
  },
  permissions: {
    contains(details, callback) {
      const granted = (details.origins || []).every(
        (origin) => permissionDecisions.get(origin) !== false
      );
      callback?.(granted);
    }
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
    registerContentScripts(details) {
      registeredScripts.push(details);
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

function setSettings(settings) {
  const oldValue = storage.sync[config.SETTINGS_KEY];
  const newValue = config.sanitizeSettings(settings);
  storage.sync[config.SETTINGS_KEY] = newValue;
  for (const listener of storageChangeListeners) {
    listener({ [config.SETTINGS_KEY]: { oldValue, newValue } }, "sync");
  }
}

(async () => {
  setSettings(config.DEFAULT_SETTINGS);

  const accepted = await sendAttempt(
    { matchType: "feed", presetId: "x", domain: "x.com" },
    "https://x.com/home"
  );
  if (!accepted?.ok) {
    throw new Error("expected matching preset sender to be accepted");
  }

  const forgedPreset = await sendAttempt(
    { matchType: "feed", presetId: "x", domain: "x.com" },
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
    { matchType: "feed", presetId: "x", domain: "x.com" },
    "chrome-extension://anti-scroll-test/popup/popup.html"
  );
  if (extensionSender?.ok) {
    throw new Error("expected non-http sender to be rejected");
  }

  const disabledSettings = {
    ...config.DEFAULT_SETTINGS,
    presets: {
      ...config.DEFAULT_SETTINGS.presets,
      x: false
    }
  };
  setSettings(disabledSettings);

  const stalePreset = await sendAttempt(
    { matchType: "feed", presetId: "x", domain: "x.com" },
    "https://x.com/home"
  );
  if (stalePreset?.ok) {
    throw new Error("expected stale preset attempt to be rejected by current settings");
  }

  const analytics = config.sanitizeAnalytics(storage.local[config.ANALYTICS_KEY]);
  if (
    analytics.total !== 1 ||
    analytics.bySite.x !== 1 ||
    analytics.byDomain["x.com"] !== 1
  ) {
    throw new Error("analytics should include only the validated sender attempt");
  }

  permissionDecisions = new Map([
    ["http://allowed.example/*", true],
    ["https://allowed.example/*", true],
    ["http://*.allowed.example/*", true],
    ["https://*.allowed.example/*", true],
    ["http://blocked.example/*", false],
    ["https://blocked.example/*", false],
    ["http://*.blocked.example/*", false],
    ["https://*.blocked.example/*", false]
  ]);
  registeredScripts.length = 0;
  setSettings({
    ...config.DEFAULT_SETTINGS,
    customDomains: ["allowed.example", "blocked.example"]
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  const firstRegistration = registeredScripts[0];
  if (
    !firstRegistration?.[0]?.matches.includes("http://allowed.example/*") ||
    !firstRegistration[0].matches.includes("https://allowed.example/*")
  ) {
    throw new Error("expected granted HTTP and HTTPS custom domain matches to stay registered");
  }
  if (firstRegistration[0].matches.some((match) => match.includes("blocked.example"))) {
    throw new Error("expected ungranted custom domain matches to be filtered");
  }
  const status = storage.local[config.REGISTRATION_STATUS_KEY];
  if (!status?.missingOrigins.includes("https://blocked.example/*")) {
    throw new Error("expected missing optional permissions to be stored locally");
  }

  console.log("background message validation ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
