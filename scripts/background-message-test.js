require("../src/constants.js");

const config = globalThis.AntiScrollConfig;
const storage = {
  sync: Object.create(null),
  local: Object.create(null),
};
let messageListener = null;
let permissionDecisions = new Map();
let permissionRemovals = [];
let removeShouldFail = false;
const registeredScripts = [];
const storageChangeListeners = [];
let registrationGate = null;
let registrationFailures = 0;
let historyStateListener = null;
const badgeTitles = [];
const sentTabMessages = [];

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
    },
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
      },
    },
  },
  storage: {
    sync: storageArea("sync"),
    local: storageArea("local"),
    onChanged: {
      addListener(listener) {
        storageChangeListeners.push(listener);
      },
    },
  },
  permissions: {
    contains(details, callback) {
      const granted = (details.origins || []).every(
        (origin) => permissionDecisions.get(origin) !== false,
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
    },
  },
  alarms: {
    create() {},
    clear(_name, callback) {
      callback?.(true);
    },
    onAlarm: { addListener() {} },
  },
  action: {
    setBadgeText(_details, callback) {
      callback?.();
    },
    setBadgeBackgroundColor(_details, callback) {
      callback?.();
    },
    setTitle(details, callback) {
      badgeTitles.push(details.title);
      callback?.();
    },
  },
  scripting: {
    registerContentScripts(details) {
      if (registrationFailures > 0) {
        registrationFailures -= 1;
        return Promise.reject(new Error("unsupported world"));
      }
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
    },
  },
  webNavigation: {
    onHistoryStateUpdated: {
      addListener(listener) {
        historyStateListener = listener;
      },
    },
  },
  tabs: {
    sendMessage(tabId, message) {
      sentTabMessages.push([tabId, message]);
    },
  },
};

require("../src/background.js");

if (typeof messageListener !== "function") {
  throw new Error("background should register a runtime message listener");
}

function sendMessage(
  message,
  sender = {
    id: "anti-scroll-test",
    url: "chrome-extension://anti-scroll-test/popup/popup.html",
  },
) {
  return new Promise((resolve) => {
    messageListener(message, sender, resolve);
  });
}

function sendAttempt(message, senderUrl) {
  return sendMessage(
    { type: "anti-scroll-attempt", ...message },
    { id: "anti-scroll-test", url: senderUrl },
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
    "https://x.com/home",
  );
  if (!accepted?.ok) {
    throw new Error("expected matching preset sender to be accepted");
  }

  const forgedPreset = await sendAttempt(
    { matchType: "feed", presetId: "x", domain: "x.com" },
    "https://www.reddit.com/",
  );
  if (forgedPreset?.ok) {
    throw new Error("expected mismatched preset sender to be rejected");
  }

  const forgedCustom = await sendAttempt(
    { matchType: "custom", domain: "evil.example" },
    "https://example.com/",
  );
  if (forgedCustom?.ok) {
    throw new Error("expected mismatched custom sender to be rejected");
  }

  const extensionSender = await sendAttempt(
    { matchType: "feed", presetId: "x", domain: "x.com" },
    "chrome-extension://anti-scroll-test/popup/popup.html",
  );
  if (extensionSender?.ok) {
    throw new Error("expected non-http sender to be rejected");
  }

  const invalidMatchType = await sendAttempt(
    { matchType: "nonsense" },
    "https://x.com/home",
  );
  if (
    invalidMatchType?.ok ||
    invalidMatchType?.error !== "Invalid analytics payload"
  ) {
    throw new Error(
      `expected unknown matchType to be rejected, got ${JSON.stringify(invalidMatchType)}`,
    );
  }

  const unknownPreset = await sendAttempt(
    { matchType: "feed", presetId: "not-a-preset", domain: "x.com" },
    "https://x.com/home",
  );
  if (unknownPreset?.ok) {
    throw new Error("expected unknown preset ids to be rejected");
  }

  const disabledSettings = {
    ...config.DEFAULT_SETTINGS,
    presets: {
      ...config.DEFAULT_SETTINGS.presets,
      x: false,
    },
  };
  setSettings(disabledSettings);

  const stalePreset = await sendAttempt(
    { matchType: "feed", presetId: "x", domain: "x.com" },
    "https://x.com/home",
  );
  if (stalePreset?.ok) {
    throw new Error(
      "expected stale preset attempt to be rejected by current settings",
    );
  }

  const analytics = config.sanitizeAnalytics(
    storage.local[config.ANALYTICS_KEY],
  );
  if (
    analytics.total !== 1 ||
    analytics.bySite.x !== 1 ||
    analytics.byDomain["x.com"] !== 1
  ) {
    throw new Error(
      "analytics should include only the validated sender attempt",
    );
  }

  setSettings(config.DEFAULT_SETTINGS);
  const tabSenderAttempt = await sendMessage(
    {
      type: "anti-scroll-attempt",
      matchType: "feed",
      presetId: "x",
      domain: "x.com",
    },
    { id: "anti-scroll-test", tab: { url: "https://x.com/home" } },
  );
  if (!tabSenderAttempt?.ok) {
    throw new Error(
      `expected sender.tab.url to be used when sender.url is absent, got ${JSON.stringify(tabSenderAttempt)}`,
    );
  }

  setSettings({
    ...config.DEFAULT_SETTINGS,
    customDomains: ["live.example"],
  });
  const subdomainCustom = await sendAttempt(
    { matchType: "custom", domain: "live.example" },
    "https://sub.live.example/page",
  );
  if (!subdomainCustom?.ok) {
    throw new Error(
      `expected a custom-domain subdomain sender to be accepted, got ${JSON.stringify(subdomainCustom)}`,
    );
  }
  setSettings({ ...config.DEFAULT_SETTINGS });
  const staleCustom = await sendAttempt(
    { matchType: "custom", domain: "live.example" },
    "https://sub.live.example/page",
  );
  if (
    staleCustom?.ok ||
    staleCustom?.error !== "Attempt no longer matches active settings"
  ) {
    throw new Error(
      `expected a removed custom domain to fail revalidation, got ${JSON.stringify(staleCustom)}`,
    );
  }

  permissionDecisions = new Map([
    ["http://allowed.example/*", true],
    ["https://allowed.example/*", true],
    ["http://*.allowed.example/*", true],
    ["https://*.allowed.example/*", true],
    ["http://blocked.example/*", false],
    ["https://blocked.example/*", false],
    ["http://*.blocked.example/*", false],
    ["https://*.blocked.example/*", false],
  ]);
  registeredScripts.length = 0;
  const filteredMarker = storage.local[config.REGISTRATION_STATUS_KEY];
  setSettings({
    ...config.DEFAULT_SETTINGS,
    customDomains: ["allowed.example", "blocked.example"],
  });
  await waitFor(
    () => storage.local[config.REGISTRATION_STATUS_KEY] !== filteredMarker,
    "the filtered custom-domain reconciliation",
  );
  const firstRegistration = registeredScripts.find((details) =>
    details[0]?.matches.includes("https://allowed.example/*"),
  );
  if (
    !firstRegistration?.[0]?.matches.includes("http://allowed.example/*") ||
    !firstRegistration[0].matches.includes("https://allowed.example/*")
  ) {
    throw new Error(
      "expected granted HTTP and HTTPS custom domain matches to stay registered",
    );
  }
  if (
    firstRegistration[0].matches.some((match) =>
      match.includes("blocked.example"),
    )
  ) {
    throw new Error("expected ungranted custom domain matches to be filtered");
  }
  const status = storage.local[config.REGISTRATION_STATUS_KEY];
  if (!status?.missingOrigins.includes("https://blocked.example/*")) {
    throw new Error(
      "expected missing optional permissions to be stored locally",
    );
  }

  const idleMarker = storage.local[config.REGISTRATION_STATUS_KEY];
  setSettings({ ...config.DEFAULT_SETTINGS, mode: config.MODES.DISABLED });
  await waitFor(
    () => storage.local[config.REGISTRATION_STATUS_KEY] !== idleMarker,
    "the disabled idle reconciliation",
  );
  permissionRemovals = [];
  const allModeMarker = storage.local[config.REGISTRATION_STATUS_KEY];
  setSettings({ ...config.DEFAULT_SETTINGS, mode: config.MODES.ALL });
  await waitFor(
    () => storage.local[config.REGISTRATION_STATUS_KEY] !== allModeMarker,
    "the all-sites registration",
  );
  permissionRemovals = [];
  const revokeAllMarker = storage.local[config.REGISTRATION_STATUS_KEY];
  setSettings({ ...config.DEFAULT_SETTINGS, mode: config.MODES.DISABLED });
  await waitFor(
    () => storage.local[config.REGISTRATION_STATUS_KEY] !== revokeAllMarker,
    "the all-sites revocation",
  );
  if (
    permissionRemovals.length !== 1 ||
    permissionRemovals[0].origins.join(",") !== "http://*/*,https://*/*"
  ) {
    throw new Error(
      "expected disabling all-sites mode to revoke only optional all-sites origins",
    );
  }

  const allAnalyticsMarker = storage.local[config.REGISTRATION_STATUS_KEY];
  setSettings({ ...config.DEFAULT_SETTINGS, mode: config.MODES.ALL });
  await waitFor(
    () => storage.local[config.REGISTRATION_STATUS_KEY] !== allAnalyticsMarker,
    "the all-sites registration for analytics",
  );
  const allModeAttempt = await sendAttempt(
    { matchType: "all", domain: "" },
    "https://whatever.example/page",
  );
  if (!allModeAttempt?.ok) {
    throw new Error(
      `expected an all-sites sender to be accepted in all mode, got ${JSON.stringify(allModeAttempt)}`,
    );
  }
  const allModeAnalytics = config.sanitizeAnalytics(allModeAttempt.analytics);
  if (
    allModeAnalytics.bySite.all !== 1 ||
    allModeAnalytics.byDomain["whatever.example"] !== undefined
  ) {
    throw new Error(
      `expected the all-mode attempt under bySite.all without a domain bucket, got ${JSON.stringify(allModeAnalytics)}`,
    );
  }
  const allRevokeMarker = storage.local[config.REGISTRATION_STATUS_KEY];
  setSettings({ ...config.DEFAULT_SETTINGS, mode: config.MODES.DISABLED });
  await waitFor(
    () => storage.local[config.REGISTRATION_STATUS_KEY] !== allRevokeMarker,
    "the all-sites revocation after analytics",
  );

  const keepIdleMarker = storage.local[config.REGISTRATION_STATUS_KEY];
  setSettings({ ...config.DEFAULT_SETTINGS, mode: config.MODES.DISABLED });
  await waitFor(
    () => storage.local[config.REGISTRATION_STATUS_KEY] !== keepIdleMarker,
    "the disabled idle reconciliation before custom-domain removal",
  );
  permissionRemovals = [];
  const addRemoveMarker = storage.local[config.REGISTRATION_STATUS_KEY];
  setSettings({
    ...config.DEFAULT_SETTINGS,
    customDomains: ["keep.example", "remove.example"],
  });
  await waitFor(
    () => storage.local[config.REGISTRATION_STATUS_KEY] !== addRemoveMarker,
    "the two-domain registration",
  );
  const removeDomainMarker = storage.local[config.REGISTRATION_STATUS_KEY];
  setSettings({ ...config.DEFAULT_SETTINGS, customDomains: ["keep.example"] });
  await waitFor(
    () => storage.local[config.REGISTRATION_STATUS_KEY] !== removeDomainMarker,
    "the removed-domain revocation",
  );
  const removedCustomOrigins = permissionRemovals[0]?.origins || [];
  if (
    removedCustomOrigins.length !== 4 ||
    removedCustomOrigins.some((origin) => !origin.includes("remove.example"))
  ) {
    throw new Error(
      "expected only removed custom-domain optional origins to be revoked",
    );
  }

  const retainIdleMarker = storage.local[config.REGISTRATION_STATUS_KEY];
  setSettings({ ...config.DEFAULT_SETTINGS, mode: config.MODES.DISABLED });
  await waitFor(
    () => storage.local[config.REGISTRATION_STATUS_KEY] !== retainIdleMarker,
    "the disabled idle reconciliation before custom-domain retention",
  );
  permissionRemovals = [];
  const addRetainMarker = storage.local[config.REGISTRATION_STATUS_KEY];
  setSettings({
    ...config.DEFAULT_SETTINGS,
    customDomains: ["keep.example", "retain.example"],
  });
  await waitFor(
    () => storage.local[config.REGISTRATION_STATUS_KEY] !== addRetainMarker,
    "the retained-domain registration",
  );
  const keepRetainMarker = storage.local[config.REGISTRATION_STATUS_KEY];
  setSettings({
    ...config.DEFAULT_SETTINGS,
    customDomains: ["retain.example"],
  });
  await waitFor(
    () => storage.local[config.REGISTRATION_STATUS_KEY] !== keepRetainMarker,
    "the kept-domain revocation",
  );
  if (
    permissionRemovals[0]?.origins.some((origin) =>
      origin.includes("retain.example"),
    )
  ) {
    throw new Error(
      "expected still-required custom-domain origins to be retained",
    );
  }

  const failIdleMarker = storage.local[config.REGISTRATION_STATUS_KEY];
  setSettings({ ...config.DEFAULT_SETTINGS, mode: config.MODES.DISABLED });
  await waitFor(
    () => storage.local[config.REGISTRATION_STATUS_KEY] !== failIdleMarker,
    "the disabled idle reconciliation before the removal failure",
  );
  permissionRemovals = [];
  removeShouldFail = true;
  registeredScripts.length = 0;
  const warnings = await captureWarnings(async () => {
    const failAllMarker = storage.local[config.REGISTRATION_STATUS_KEY];
    setSettings({ ...config.DEFAULT_SETTINGS, mode: config.MODES.ALL });
    await waitFor(
      () => storage.local[config.REGISTRATION_STATUS_KEY] !== failAllMarker,
      "the all-sites registration beside a failing removal",
    );
    const failRevokeMarker = storage.local[config.REGISTRATION_STATUS_KEY];
    setSettings({ ...config.DEFAULT_SETTINGS, mode: config.MODES.DISABLED });
    await waitFor(
      () => storage.local[config.REGISTRATION_STATUS_KEY] !== failRevokeMarker,
      "the failing all-sites revocation",
    );
  });
  removeShouldFail = false;
  if (!permissionRemovals.length || !registeredScripts.length) {
    throw new Error(
      "expected a removal failure not to block dynamic-script synchronization",
    );
  }
  if (
    !warnings.some(
      ([message]) =>
        message ===
        "Could not remove no-longer-needed optional host permissions",
    )
  ) {
    throw new Error(
      "expected optional permission removal failures to be reported once",
    );
  }

  const retentionIdleMarker = storage.local[config.REGISTRATION_STATUS_KEY];
  setSettings(config.DEFAULT_SETTINGS);
  await waitFor(
    () => storage.local[config.REGISTRATION_STATUS_KEY] !== retentionIdleMarker,
    "the selected-mode idle reconciliation before analytics retention",
  );

  storage.local[config.ANALYTICS_KEY] = config.sanitizeAnalytics({
    total: 9,
    bySite: { x: 9 },
    lastAt: Date.now() - 31 * 24 * 60 * 60 * 1000,
  });
  const expiredRetentionAttempt = await sendAttempt(
    { matchType: "feed", presetId: "x", domain: "x.com" },
    "https://x.com/home",
  );
  if (
    !expiredRetentionAttempt?.ok ||
    expiredRetentionAttempt.analytics?.total !== 1
  ) {
    throw new Error(
      `expected analytics older than the retention window to reset before counting, got ${JSON.stringify(expiredRetentionAttempt?.analytics)}`,
    );
  }

  storage.local[config.ANALYTICS_KEY] = config.sanitizeAnalytics({
    total: 9,
    bySite: { x: 9 },
    lastAt: Date.now() - 29 * 24 * 60 * 60 * 1000,
  });
  const freshRetentionAttempt = await sendAttempt(
    { matchType: "feed", presetId: "x", domain: "x.com" },
    "https://x.com/home",
  );
  if (
    !freshRetentionAttempt?.ok ||
    freshRetentionAttempt.analytics?.total !== 10
  ) {
    throw new Error(
      `expected recent analytics to survive the retention window, got ${JSON.stringify(freshRetentionAttempt?.analytics)}`,
    );
  }

  const seededByDomain = config.createRecord();
  seededByDomain["reddit.com"] = 500;
  for (let index = 0; index < 205; index += 1) {
    seededByDomain[`d${index}.example`] = index + 1;
  }
  storage.local[config.ANALYTICS_KEY] = config.sanitizeAnalytics({
    total: 5000,
    bySite: { reddit: 5 },
    byDomain: seededByDomain,
    lastAt: Date.now(),
  });
  const trimAttempt = await sendAttempt(
    { matchType: "feed", presetId: "reddit", domain: "reddit.com" },
    "https://www.reddit.com/",
  );
  if (
    !trimAttempt?.ok ||
    Object.keys(trimAttempt.analytics?.byDomain || {}).length !==
      config.MAX_ANALYTICS_DOMAINS ||
    trimAttempt.analytics.byDomain["reddit.com"] !== 501 ||
    trimAttempt.analytics.byDomain["d204.example"] !== 205 ||
    trimAttempt.analytics.byDomain["d5.example"] !== undefined
  ) {
    throw new Error(
      `expected byDomain to keep the top ${config.MAX_ANALYTICS_DOMAINS} counts including the incremented attempt, got ${JSON.stringify(trimAttempt?.analytics?.byDomain && Object.keys(trimAttempt.analytics.byDomain).length)} entries`,
    );
  }

  permissionDecisions = new Map(
    config
      .getDomainMatchPatterns("grant.example")
      .map((origin) => [origin, false]),
  );
  registeredScripts.length = 0;
  setSettings({
    ...config.DEFAULT_SETTINGS,
    customDomains: ["grant.example"],
  });
  await waitFor(
    () =>
      storage.local[config.REGISTRATION_STATUS_KEY]?.missingOrigins?.includes(
        "https://grant.example/*",
      ),
    "the missing grant.example permission",
  );
  if (registeredScripts.length) {
    throw new Error(
      "expected missing permissions to prevent dynamic registration",
    );
  }

  permissionDecisions = new Map(
    config
      .getDomainMatchPatterns("grant.example")
      .map((origin) => [origin, true]),
  );
  const resync = await sendMessage({
    type: "anti-scroll-sync-content-scripts",
  });
  if (!resync?.ok) {
    throw new Error(
      "expected a granted permission to trigger registration resync",
    );
  }
  await waitFor(
    () =>
      registeredScripts.some((details) =>
        details[0].matches.includes("https://grant.example/*"),
      ),
    "registration after granting a missing permission",
  );

  registrationFailures = 1;
  registeredScripts.length = 0;
  setSettings({
    ...config.DEFAULT_SETTINGS,
    customDomains: ["fallback.example"],
  });
  await waitFor(
    () =>
      registeredScripts.some((details) =>
        details[0]?.matches.includes("https://fallback.example/*"),
      ),
    "the simplified retry registration",
  );
  const simplifiedBatch = registeredScripts.find((details) =>
    details[0]?.matches.includes("https://fallback.example/*"),
  );
  if (
    "world" in simplifiedBatch[0] ||
    "matchOriginAsFallback" in simplifiedBatch[0] ||
    "matchOriginAsFallback" in simplifiedBatch[1]
  ) {
    throw new Error(
      "expected the compat retry to drop world and matchOriginAsFallback",
    );
  }
  if (
    JSON.stringify(simplifiedBatch.map((script) => script.id)) !==
    JSON.stringify([
      "anti-scroll-dynamic-page-lock",
      "anti-scroll-dynamic-content",
    ])
  ) {
    throw new Error(
      `expected both dynamic script ids in the retry batch, got ${JSON.stringify(simplifiedBatch.map((script) => script.id))}`,
    );
  }
  if (
    !simplifiedBatch[0].js.includes("src/page-lock.js") ||
    JSON.stringify(simplifiedBatch[1].js) !==
      JSON.stringify(["src/constants.js", "src/content.js"])
  ) {
    throw new Error(
      `expected the retry batch to keep the content script files, got ${JSON.stringify(simplifiedBatch.map((script) => script.js))}`,
    );
  }

  const workingRegister = globalThis.chrome.scripting.registerContentScripts;
  globalThis.chrome.scripting.registerContentScripts = () =>
    Promise.reject(new Error("registration exploded"));
  const failedSync = await sendMessage({
    type: "anti-scroll-sync-content-scripts",
  });
  globalThis.chrome.scripting.registerContentScripts = workingRegister;
  if (
    failedSync?.ok !== false ||
    !String(failedSync?.error).includes("registration exploded")
  ) {
    throw new Error(
      `expected a hard registration failure to reject the sync response, got ${JSON.stringify(failedSync)}`,
    );
  }
  if (
    !String(storage.local[config.REGISTRATION_STATUS_KEY]?.error).includes(
      "registration exploded",
    )
  ) {
    throw new Error(
      `expected the registration error to be stored locally, got ${JSON.stringify(storage.local[config.REGISTRATION_STATUS_KEY])}`,
    );
  }

  setSettings(config.DEFAULT_SETTINGS);
  await sendMessage({ type: "anti-scroll-reset-analytics" });
  const concurrentAttempts = await Promise.all([
    sendAttempt(
      { matchType: "feed", presetId: "x", domain: "x.com" },
      "https://x.com/home",
    ),
    sendAttempt(
      { matchType: "feed", presetId: "x", domain: "x.com" },
      "https://x.com/home",
    ),
  ]);
  if (concurrentAttempts.some((response) => !response?.ok)) {
    throw new Error("expected concurrent matching attempts to be accepted");
  }
  const concurrentAnalytics = config.sanitizeAnalytics(
    storage.local[config.ANALYTICS_KEY],
  );
  if (concurrentAnalytics.total !== 2 || concurrentAnalytics.bySite.x !== 2) {
    throw new Error(
      "expected concurrent attempts to be recorded without lost increments",
    );
  }

  const queuedAttempt = sendAttempt(
    { matchType: "feed", presetId: "x", domain: "x.com" },
    "https://x.com/home",
  );
  const queuedReset = sendMessage({ type: "anti-scroll-reset-analytics" });
  await Promise.all([queuedAttempt, queuedReset]);
  if (
    config.sanitizeAnalytics(storage.local[config.ANALYTICS_KEY]).total !== 0
  ) {
    throw new Error(
      "expected reset to run after an already-queued analytics attempt",
    );
  }

  const statusBeforeDisable = storage.local[config.REGISTRATION_STATUS_KEY];
  setSettings({ ...config.DEFAULT_SETTINGS, mode: config.MODES.DISABLED });
  await waitFor(
    () => storage.local[config.REGISTRATION_STATUS_KEY] !== statusBeforeDisable,
    "disabled registration reconciliation",
  );
  permissionDecisions = new Map();
  registeredScripts.length = 0;
  const stalledRegistration = createDeferred();
  registrationGate = stalledRegistration;
  setSettings({
    ...config.DEFAULT_SETTINGS,
    customDomains: ["first.example"],
  });
  await waitFor(
    () => registeredScripts.length === 1,
    "the first dynamic registration",
  );
  setSettings({
    ...config.DEFAULT_SETTINGS,
    customDomains: ["second.example"],
  });
  await nextTurn();
  if (registeredScripts.length !== 1) {
    throw new Error(
      "expected dynamic registrations to wait for the previous update",
    );
  }
  stalledRegistration.resolve();
  await waitFor(
    () => registeredScripts.length === 2,
    "the second serialized dynamic registration",
  );
  const latestRegistration = registeredScripts.at(-1);
  if (
    !latestRegistration[0].matches.includes("https://second.example/*") ||
    latestRegistration[0].matches.some((match) =>
      match.includes("first.example"),
    )
  ) {
    throw new Error(
      "expected the final dynamic registration to use the latest settings",
    );
  }

  badgeTitles.length = 0;
  setSettings({
    ...config.DEFAULT_SETTINGS,
    customDomains: [],
    mode: config.MODES.DISABLED,
  });
  await waitFor(() => badgeTitles.length > 0, "the off badge update");
  if (badgeTitles.at(-1) !== "Anti Scroll: off") {
    throw new Error(
      `expected the disabled mode to show the off badge, got ${JSON.stringify(badgeTitles)}`,
    );
  }

  badgeTitles.length = 0;
  setSettings({
    ...config.DEFAULT_SETTINGS,
    customDomains: [],
    activeUntil: Date.now() + 90 * 1000,
  });
  await waitFor(
    () => badgeTitles.length > 0 && /min left/.test(badgeTitles.at(-1)),
    "the timer badge update",
  );
  if (!/^Anti Scroll: selected, \d+ min left$/.test(badgeTitles.at(-1))) {
    throw new Error(
      `expected a minutes-left timer badge title, got ${JSON.stringify(badgeTitles)}`,
    );
  }

  setSettings({ ...config.DEFAULT_SETTINGS, activeUntil: Date.now() - 10 });
  await waitFor(() => {
    const stored = config.sanitizeSettings(storage.sync[config.SETTINGS_KEY]);
    return stored.mode === config.MODES.DISABLED && stored.activeUntil === null;
  }, "the expired timer persistence");
  const expiredStoredSettings = config.sanitizeSettings(
    storage.sync[config.SETTINGS_KEY],
  );
  if (
    expiredStoredSettings.mode !== config.MODES.DISABLED ||
    expiredStoredSettings.activeUntil !== null
  ) {
    throw new Error(
      `expected an elapsed timer to persist as disabled with no activeUntil, got ${JSON.stringify(expiredStoredSettings)}`,
    );
  }

  sentTabMessages.length = 0;
  historyStateListener({ frameId: 0, tabId: 7, url: "https://x.com/explore" });
  historyStateListener({ frameId: 3, tabId: 7, url: "https://x.com/subframe" });
  historyStateListener({ frameId: 0, tabId: 7, url: "https://x.com/ignored" });
  if (
    JSON.stringify(sentTabMessages) !==
    JSON.stringify([
      [
        7,
        { type: "anti-scroll-location-change", url: "https://x.com/explore" },
      ],
      [
        7,
        { type: "anti-scroll-location-change", url: "https://x.com/ignored" },
      ],
    ])
  ) {
    throw new Error(
      `expected top-frame SPA navigations to relay a location change but not subframes, got ${JSON.stringify(sentTabMessages)}`,
    );
  }

  console.log("background message validation ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
