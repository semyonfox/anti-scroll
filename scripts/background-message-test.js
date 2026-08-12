require("../src/constants.js");

const config = globalThis.AntiScrollConfig;
const storage = {
  sync: Object.create(null),
  local: Object.create(null)
};
let messageListener = null;
let permissionDecisions = new Map();
let permissionRemovals = [];
let removeShouldFail = false;
const registeredScripts = [];
const storageChangeListeners = [];
let registrationGate = null;

function nextTurn() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(check, description) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (check()) {
      return;
    }
    await nextTurn();
  }

  throw new Error(`Timed out waiting for ${description}`);
}

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function captureWarnings(callback) {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);

  try {
    await callback();
  } finally {
    console.warn = originalWarn;
  }

  return warnings;
}

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
    },
    remove(details, callback) {
      permissionRemovals.push(details);
      if (removeShouldFail) {
        return Promise.reject(new Error("permission removal failed"));
      }
      callback?.(true);
      return Promise.resolve(true);
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
      if (registrationGate) {
        const gate = registrationGate;
        registrationGate = null;
        return gate.promise;
      }
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

function sendMessage(
  message,
  sender = {
    id: "anti-scroll-test",
    url: "chrome-extension://anti-scroll-test/popup/popup.html"
  }
) {
  return new Promise((resolve) => {
    messageListener(message, sender, resolve);
  });
}

function sendAttempt(message, senderUrl) {
  return sendMessage(
    { type: "anti-scroll-attempt", ...message },
    { id: "anti-scroll-test", url: senderUrl }
  );
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

  setSettings({ ...config.DEFAULT_SETTINGS, mode: config.MODES.DISABLED });
  await new Promise((resolve) => setTimeout(resolve, 0));
  permissionRemovals = [];
  setSettings({ ...config.DEFAULT_SETTINGS, mode: config.MODES.ALL });
  await new Promise((resolve) => setTimeout(resolve, 0));
  setSettings({ ...config.DEFAULT_SETTINGS, mode: config.MODES.DISABLED });
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (
    permissionRemovals.length !== 1 ||
    permissionRemovals[0].origins.join(",") !== "http://*/*,https://*/*"
  ) {
    throw new Error("expected disabling all-sites mode to revoke only optional all-sites origins");
  }

  setSettings({ ...config.DEFAULT_SETTINGS, mode: config.MODES.DISABLED });
  await new Promise((resolve) => setTimeout(resolve, 0));
  permissionRemovals = [];
  setSettings({ ...config.DEFAULT_SETTINGS, customDomains: ["keep.example", "remove.example"] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  setSettings({ ...config.DEFAULT_SETTINGS, customDomains: ["keep.example"] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const removedCustomOrigins = permissionRemovals[0]?.origins || [];
  if (
    removedCustomOrigins.length !== 4 ||
    removedCustomOrigins.some((origin) => !origin.includes("remove.example"))
  ) {
    throw new Error("expected only removed custom-domain optional origins to be revoked");
  }

  setSettings({ ...config.DEFAULT_SETTINGS, mode: config.MODES.DISABLED });
  await new Promise((resolve) => setTimeout(resolve, 0));
  permissionRemovals = [];
  setSettings({ ...config.DEFAULT_SETTINGS, customDomains: ["keep.example", "retain.example"] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  setSettings({ ...config.DEFAULT_SETTINGS, customDomains: ["retain.example"] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (permissionRemovals[0]?.origins.some((origin) => origin.includes("retain.example"))) {
    throw new Error("expected still-required custom-domain origins to be retained");
  }

  setSettings({ ...config.DEFAULT_SETTINGS, mode: config.MODES.DISABLED });
  await new Promise((resolve) => setTimeout(resolve, 0));
  permissionRemovals = [];
  removeShouldFail = true;
  registeredScripts.length = 0;
  const warnings = await captureWarnings(async () => {
    setSettings({ ...config.DEFAULT_SETTINGS, mode: config.MODES.ALL });
    await nextTurn();
    setSettings({ ...config.DEFAULT_SETTINGS, mode: config.MODES.DISABLED });
    await nextTurn();
  });
  removeShouldFail = false;
  if (!permissionRemovals.length || !registeredScripts.length) {
    throw new Error("expected a removal failure not to block dynamic-script synchronization");
  }
  if (
    !warnings.some(
      ([message]) => message === "Could not remove no-longer-needed optional host permissions"
    )
  ) {
    throw new Error("expected optional permission removal failures to be reported once");
  }

  permissionDecisions = new Map(
    config.getDomainMatchPatterns("grant.example").map((origin) => [origin, false])
  );
  registeredScripts.length = 0;
  setSettings({
    ...config.DEFAULT_SETTINGS,
    customDomains: ["grant.example"]
  });
  await waitFor(
    () =>
      storage.local[config.REGISTRATION_STATUS_KEY]?.missingOrigins?.includes(
        "https://grant.example/*"
      ),
    "the missing grant.example permission"
  );
  if (registeredScripts.length) {
    throw new Error("expected missing permissions to prevent dynamic registration");
  }

  permissionDecisions = new Map(
    config.getDomainMatchPatterns("grant.example").map((origin) => [origin, true])
  );
  const resync = await sendMessage({ type: "anti-scroll-sync-content-scripts" });
  if (!resync?.ok) {
    throw new Error("expected a granted permission to trigger registration resync");
  }
  await waitFor(
    () =>
      registeredScripts.some((details) =>
        details[0].matches.includes("https://grant.example/*")
      ),
    "registration after granting a missing permission"
  );

  setSettings(config.DEFAULT_SETTINGS);
  await sendMessage({ type: "anti-scroll-reset-analytics" });
  const concurrentAttempts = await Promise.all([
    sendAttempt(
      { matchType: "feed", presetId: "x", domain: "x.com" },
      "https://x.com/home"
    ),
    sendAttempt(
      { matchType: "feed", presetId: "x", domain: "x.com" },
      "https://x.com/home"
    )
  ]);
  if (concurrentAttempts.some((response) => !response?.ok)) {
    throw new Error("expected concurrent matching attempts to be accepted");
  }
  const concurrentAnalytics = config.sanitizeAnalytics(
    storage.local[config.ANALYTICS_KEY]
  );
  if (concurrentAnalytics.total !== 2 || concurrentAnalytics.bySite.x !== 2) {
    throw new Error("expected concurrent attempts to be recorded without lost increments");
  }

  const queuedAttempt = sendAttempt(
    { matchType: "feed", presetId: "x", domain: "x.com" },
    "https://x.com/home"
  );
  const queuedReset = sendMessage({ type: "anti-scroll-reset-analytics" });
  await Promise.all([queuedAttempt, queuedReset]);
  if (config.sanitizeAnalytics(storage.local[config.ANALYTICS_KEY]).total !== 0) {
    throw new Error("expected reset to run after an already-queued analytics attempt");
  }

  const statusBeforeDisable = storage.local[config.REGISTRATION_STATUS_KEY];
  setSettings({ ...config.DEFAULT_SETTINGS, mode: config.MODES.DISABLED });
  await waitFor(
    () => storage.local[config.REGISTRATION_STATUS_KEY] !== statusBeforeDisable,
    "disabled registration reconciliation"
  );
  permissionDecisions = new Map();
  registeredScripts.length = 0;
  const stalledRegistration = createDeferred();
  registrationGate = stalledRegistration;
  setSettings({
    ...config.DEFAULT_SETTINGS,
    customDomains: ["first.example"]
  });
  await waitFor(
    () => registeredScripts.length === 1,
    "the first dynamic registration"
  );
  setSettings({
    ...config.DEFAULT_SETTINGS,
    customDomains: ["second.example"]
  });
  await nextTurn();
  if (registeredScripts.length !== 1) {
    throw new Error("expected dynamic registrations to wait for the previous update");
  }
  stalledRegistration.resolve();
  await waitFor(
    () => registeredScripts.length === 2,
    "the second serialized dynamic registration"
  );
  const latestRegistration = registeredScripts.at(-1);
  if (
    !latestRegistration[0].matches.includes("https://second.example/*") ||
    latestRegistration[0].matches.some((match) => match.includes("first.example"))
  ) {
    throw new Error("expected the final dynamic registration to use the latest settings");
  }

  console.log("background message validation ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
