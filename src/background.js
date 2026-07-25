if (!globalThis.AntiScrollConfig && typeof importScripts === "function") {
  importScripts("constants.js");
}

(function startBackground(root) {
  "use strict";

  const config = root.AntiScrollConfig;
  const api = config.getApi();
  const BADGE_ALARM = "anti-scroll-badge-refresh";
  const ANALYTICS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
  const DYNAMIC_SCRIPT_IDS = [
    "anti-scroll-dynamic-page-lock",
    "anti-scroll-dynamic-content"
  ];

  if (!api?.runtime?.onMessage || !api?.storage) {
    return;
  }

  const { storageGet, storageSet } = config;

  function actionApi() {
    return api.action || api.browserAction;
  }

  function callExtensionApi(fn, details) {
    return new Promise((resolve) => {
      if (typeof fn !== "function") {
        resolve();
        return;
      }

      const result = fn(details, resolve);
      if (result?.then) {
        result.then(resolve);
      }
    });
  }

  function permissionsContains(details) {
    if (!api.permissions?.contains) {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      const result = api.permissions.contains(details, resolve);
      if (result?.then) {
        result.then(resolve);
      }
    });
  }

  function permissionsRemove(details) {
    if (!api.permissions?.remove) {
      return Promise.resolve(false);
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (value) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };

      try {
        const result = api.permissions.remove(details, finish);
        if (result?.then) {
          result.then(finish, reject);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  function alarmCreate(name, alarmInfo) {
    const result = api.alarms?.create?.(name, alarmInfo);
    return result?.then ? result : Promise.resolve();
  }

  function alarmClear(name) {
    return new Promise((resolve) => {
      const result = api.alarms?.clear?.(name, resolve);
      if (result?.then) {
        result.then(resolve);
      } else if (!api.alarms?.clear) {
        resolve();
      }
    });
  }

  function domainToMatches(domain) {
    const normalizedDomain = config.normalizeDomainInput(domain);
    if (!normalizedDomain) {
      return [];
    }

    return [
      `http://${normalizedDomain}/*`,
      `https://${normalizedDomain}/*`,
      `http://*.${normalizedDomain}/*`,
      `https://*.${normalizedDomain}/*`
    ];
  }

  function dynamicMatches(settings) {
    if (settings.mode === config.MODES.DISABLED || !settings.enabled) {
      return [];
    }

    if (settings.mode === config.MODES.ALL) {
      return ["http://*/*", "https://*/*"];
    }

    return Array.from(
      new Set(settings.customDomains.flatMap((domain) => domainToMatches(domain)))
    );
  }

  async function removeNoLongerNeededPermissions(previousSettings, nextSettings) {
    const nextOrigins = new Set(dynamicMatches(nextSettings));
    const removedOrigins = dynamicMatches(previousSettings).filter(
      (origin) => !nextOrigins.has(origin)
    );

    if (!removedOrigins.length) {
      return false;
    }

    return permissionsRemove({ origins: removedOrigins });
  }

  function matchesByPermissionOrigin(matches) {
    const grouped = new Map();

    for (const match of matches) {
      if (!grouped.has(match)) {
        grouped.set(match, []);
      }
      grouped.get(match).push(match);
    }

    return grouped;
  }

  async function filterGrantedMatches(matches) {
    const allowed = [];
    const missing = [];

    for (const [origin, originMatches] of matchesByPermissionOrigin(matches)) {
      if (await permissionsContains({ origins: [origin] })) {
        allowed.push(...originMatches);
      } else {
        missing.push(origin);
      }
    }

    return { allowed, missing };
  }

  async function setRegistrationStatus(status) {
    if (!api.storage?.local || !config.REGISTRATION_STATUS_KEY) {
      return;
    }

    await storageSet(api.storage.local, {
      [config.REGISTRATION_STATUS_KEY]: {
        ok: status.missing.length === 0 && !status.error,
        missingOrigins: status.missing,
        error: status.error || "",
        checkedAt: Date.now()
      }
    });
  }

  async function unregisterDynamicContentScripts() {
    if (!api.scripting?.unregisterContentScripts) {
      return;
    }

    try {
      await api.scripting.unregisterContentScripts({ ids: DYNAMIC_SCRIPT_IDS });
    } catch {
      // The scripts may not be registered yet.
    }
  }

  async function registerContentScripts(details) {
    try {
      await api.scripting.registerContentScripts(details);
    } catch (error) {
      const simplified = details.map(
        ({ matchOriginAsFallback, world, ...script }) => script
      );
      await api.scripting.registerContentScripts(simplified);
    }
  }

  async function syncDynamicContentScripts(settings = null) {
    if (!api.scripting?.registerContentScripts) {
      return;
    }

    const nextSettings = settings || (await getSettings());
    const matches = dynamicMatches(nextSettings);
    await unregisterDynamicContentScripts();

    if (!matches.length) {
      await setRegistrationStatus({ missing: [] });
      return;
    }

    const { allowed, missing } = await filterGrantedMatches(matches);
    if (!allowed.length) {
      await setRegistrationStatus({ missing });
      return;
    }

    try {
      await registerContentScripts([
        {
          id: DYNAMIC_SCRIPT_IDS[0],
          matches: allowed,
          js: ["src/page-lock.js"],
          runAt: "document_start",
          allFrames: true,
          matchAboutBlank: true,
          matchOriginAsFallback: true,
          world: "MAIN"
        },
        {
          id: DYNAMIC_SCRIPT_IDS[1],
          matches: allowed,
          js: ["src/constants.js", "src/content.js"],
          runAt: "document_start",
          allFrames: true,
          matchAboutBlank: true,
          matchOriginAsFallback: true
        }
      ]);
      await setRegistrationStatus({ missing });
    } catch (error) {
      await setRegistrationStatus({ missing, error: String(error) });
      throw error;
    }
  }

  async function getSettings() {
    const stored = await storageGet(api.storage.sync, {
      [config.SETTINGS_KEY]: config.DEFAULT_SETTINGS
    });
    return config.sanitizeSettings(stored[config.SETTINGS_KEY]);
  }

  async function saveSettings(settings) {
    await storageSet(api.storage.sync, {
      [config.SETTINGS_KEY]: config.sanitizeSettings(settings)
    });
  }

  async function ensureDefaults() {
    const stored = await storageGet(api.storage.sync, {
      [config.SETTINGS_KEY]: null
    });

    if (!stored[config.SETTINGS_KEY]) {
      await storageSet(api.storage.sync, {
        [config.SETTINGS_KEY]: config.DEFAULT_SETTINGS
      });
    }

    await expireElapsedTimer();
    await syncDynamicContentScripts();
    await updateBadge();
  }

  function badgeState(settings) {
    if (
      settings.mode === config.MODES.DISABLED ||
      (settings.activeUntil && settings.activeUntil <= Date.now())
    ) {
      return {
        text: "OFF",
        color: "#6b7280",
        title: "Anti Scroll: off"
      };
    }

    if (settings.activeUntil) {
      const minutes = Math.max(
        1,
        Math.ceil((settings.activeUntil - Date.now()) / 60000)
      );
      const timeText = minutes < 100 ? `${minutes}m` : `${Math.ceil(minutes / 60)}h`;
      return {
        text: timeText,
        color: settings.mode === config.MODES.ALL ? "#ad2f2a" : "#116c5f",
        title: `Anti Scroll: ${settings.mode}, ${minutes} min left`
      };
    }

    if (settings.mode === config.MODES.ALL) {
      return {
        text: "ALL",
        color: "#ad2f2a",
        title: "Anti Scroll: all sites"
      };
    }

    return {
      text: "SEL",
      color: "#116c5f",
      title: "Anti Scroll: selected sites"
    };
  }

  async function updateBadge(settings = null) {
    const action = actionApi();
    if (!action) {
      return;
    }

    const nextSettings = settings || (await getSettings());
    const badge = badgeState(nextSettings);

    await Promise.all([
      callExtensionApi(action.setBadgeText?.bind(action), { text: badge.text }),
      callExtensionApi(action.setBadgeBackgroundColor?.bind(action), {
        color: badge.color
      }),
      callExtensionApi(action.setTitle?.bind(action), { title: badge.title })
    ]);
  }

  async function scheduleBadgeAlarm(settings = null) {
    const nextSettings = settings || (await getSettings());
    await alarmClear(BADGE_ALARM);

    if (!nextSettings.activeUntil || nextSettings.mode === config.MODES.DISABLED) {
      return;
    }

    const now = Date.now();
    if (nextSettings.activeUntil <= now) {
      await expireElapsedTimer(nextSettings);
      return;
    }

    await alarmCreate(BADGE_ALARM, {
      when: Math.min(nextSettings.activeUntil, now + 60 * 1000)
    });
  }

  async function expireElapsedTimer(settings = null) {
    const nextSettings = settings || (await getSettings());
    if (!nextSettings.activeUntil || nextSettings.activeUntil > Date.now()) {
      return nextSettings;
    }

    const expiredSettings = {
      ...nextSettings,
      mode: config.MODES.DISABLED,
      activeUntil: null
    };

    await saveSettings(expiredSettings);
    return config.sanitizeSettings(expiredSettings);
  }

  function freshAnalytics(value) {
    const analytics = config.sanitizeAnalytics(value);
    if (analytics.lastAt && Date.now() - analytics.lastAt > ANALYTICS_RETENTION_MS) {
      return config.sanitizeAnalytics(config.EMPTY_ANALYTICS);
    }

    return analytics;
  }

  function incrementCounter(record, key) {
    record[key] = (Object.hasOwn(record, key) ? record[key] : 0) + 1;
  }

  function trimDomainAnalytics(byDomain) {
    const entries = Object.entries(byDomain);
    if (entries.length <= config.MAX_ANALYTICS_DOMAINS) {
      return byDomain;
    }

    const trimmed = config.createRecord();
    entries
      .sort((first, second) => second[1] - first[1])
      .slice(0, config.MAX_ANALYTICS_DOMAINS)
      .forEach(([domain, count]) => {
        trimmed[domain] = count;
      });
    return trimmed;
  }

  function senderHttpHost(sender) {
    const url = sender?.url || sender?.tab?.url;
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return "";
      }
      return config.normalizeHost(parsed.hostname);
    } catch {
      return "";
    }
  }

  function senderHttpUrl(sender) {
    const url = sender?.url || sender?.tab?.url || "";
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return "";
      }
      return parsed.href;
    } catch {
      return "";
    }
  }

  function validatedAttempt(message, sender) {
    const matchType =
      typeof message.matchType === "string" ? message.matchType : "";
    if (!["all", "preset", "custom", "feed"].includes(matchType)) {
      return null;
    }

    const senderUrl = senderHttpUrl(sender);
    const senderHost = senderHttpHost(sender);
    if (!senderUrl || !senderHost) {
      return null;
    }

    const presetId =
      typeof message.presetId === "string" &&
      config.getPresetById(message.presetId)
        ? message.presetId
        : null;
    if (matchType === "preset" || matchType === "feed") {
      const preset = presetId ? config.getPresetById(presetId) : null;
      if (
        !preset ||
        !preset.domains.some((domain) => config.domainMatches(senderHost, domain))
      ) {
        return null;
      }
    }

    const claimedDomain = config.normalizeDomainInput(
      message.domain || message.host || senderHost
    );
    if (matchType === "custom" && !config.domainMatches(senderHost, claimedDomain)) {
      return null;
    }

    return {
      matchType,
      presetId,
      domain: matchType === "all" ? "" : claimedDomain,
      senderUrl
    };
  }

  function analyticsPayloadFromMatch(payload, match) {
    if (!match?.active || match.type !== payload.matchType) {
      return null;
    }

    if (payload.matchType === "preset" || payload.matchType === "feed") {
      if (!payload.presetId || match.presetId !== payload.presetId) {
        return null;
      }
    }

    return {
      matchType: match.type,
      presetId: match.presetId || null,
      domain: match.type === "all" ? "" : match.domain || match.host || payload.domain
    };
  }

  async function recordBlockedAttempt(payload) {
    const settings = await getSettings();
    const verifiedPayload = analyticsPayloadFromMatch(
      payload,
      config.matchShield(payload.senderUrl, settings)
    );
    if (!verifiedPayload) {
      return null;
    }

    const stored = await storageGet(api.storage.local, {
      [config.ANALYTICS_KEY]: config.EMPTY_ANALYTICS
    });
    const analytics = freshAnalytics(stored[config.ANALYTICS_KEY]);
    const siteKey =
      verifiedPayload.matchType === "all" ? "all" : verifiedPayload.presetId || "custom";
    const domain = config.normalizeDomainInput(verifiedPayload.domain);

    analytics.total += 1;
    analytics.lastAt = Date.now();
    incrementCounter(analytics.bySite, siteKey);

    if (domain) {
      incrementCounter(analytics.byDomain, domain);
      analytics.byDomain = trimDomainAnalytics(analytics.byDomain);
    }

    await storageSet(api.storage.local, {
      [config.ANALYTICS_KEY]: analytics
    });

    return analytics;
  }

  api.runtime.onInstalled?.addListener(() => {
    ensureDefaults();
  });

  api.runtime.onStartup?.addListener(() => {
    ensureDefaults();
  });

  api.alarms?.onAlarm?.addListener((alarm) => {
    if (alarm.name !== BADGE_ALARM) {
      return;
    }

    expireElapsedTimer()
      .then((settings) => updateBadge(settings))
      .then(() => scheduleBadgeAlarm())
      .catch(() => {});
  });

  api.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync" || !changes[config.SETTINGS_KEY]) {
      return;
    }

    const previousSettings = config.sanitizeSettings(changes[config.SETTINGS_KEY].oldValue);
    const settings = config.sanitizeSettings(changes[config.SETTINGS_KEY].newValue);
    updateBadge(settings);
    scheduleBadgeAlarm(settings);
    removeNoLongerNeededPermissions(previousSettings, settings).catch((error) => {
      console.warn("Could not remove no-longer-needed optional host permissions", error);
    });
    syncDynamicContentScripts(settings).catch((error) => {
      setRegistrationStatus({ missing: [], error: String(error) }).catch(() => {});
    });
  });

  ensureDefaults();

  api.webNavigation?.onHistoryStateUpdated?.addListener((details) => {
    if (details.frameId !== 0 || !details.tabId) {
      return;
    }

    api.tabs?.sendMessage?.(details.tabId, {
      type: "anti-scroll-location-change",
      url: details.url
    });
  });

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== "object") {
      return false;
    }

    if (sender?.id && sender.id !== api.runtime.id) {
      return false;
    }

    if (message.type === "anti-scroll-attempt") {
      const payload = validatedAttempt(message, sender);
      if (!payload) {
        sendResponse({ ok: false, error: "Invalid analytics payload" });
        return false;
      }

      recordBlockedAttempt(payload)
        .then((analytics) => {
          if (!analytics) {
            sendResponse({ ok: false, error: "Attempt no longer matches active settings" });
            return;
          }
          sendResponse({ ok: true, analytics });
        })
        .catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;
    }

    if (message.type === "anti-scroll-get-analytics") {
      storageGet(api.storage.local, {
        [config.ANALYTICS_KEY]: config.EMPTY_ANALYTICS
      })
        .then((stored) =>
          sendResponse({
            ok: true,
            analytics: config.sanitizeAnalytics(stored[config.ANALYTICS_KEY])
          })
        )
        .catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;
    }

    if (message.type === "anti-scroll-reset-analytics") {
      storageSet(api.storage.local, {
        [config.ANALYTICS_KEY]: config.EMPTY_ANALYTICS
      })
        .then(() =>
          sendResponse({ ok: true, analytics: config.EMPTY_ANALYTICS })
        )
        .catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;
    }

    return false;
  });
})(globalThis);
