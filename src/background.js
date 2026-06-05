if (!globalThis.AntiScrollConfig && typeof importScripts === "function") {
  importScripts("constants.js");
}

(function startBackground(root) {
  "use strict";

  const config = root.AntiScrollConfig;
  const api = config.getApi();
  const BADGE_ALARM = "anti-scroll-badge-refresh";

  if (!api?.runtime?.onMessage || !api?.storage) {
    return;
  }

  function storageGet(area, defaults) {
    return new Promise((resolve) => {
      const result = area.get(defaults, resolve);
      if (result?.then) {
        result.then(resolve);
      }
    });
  }

  function storageSet(area, value) {
    return new Promise((resolve) => {
      const result = area.set(value, resolve);
      if (result?.then) {
        result.then(resolve);
      }
    });
  }

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

  async function recordBlockedAttempt(payload) {
    const stored = await storageGet(api.storage.local, {
      [config.ANALYTICS_KEY]: config.EMPTY_ANALYTICS
    });
    const analytics = config.sanitizeAnalytics(stored[config.ANALYTICS_KEY]);
    const siteKey =
      payload.matchType === "all" ? "all" : payload.presetId || "custom";
    const domain = config.normalizeDomainInput(payload.domain || payload.host);

    analytics.total += 1;
    analytics.lastAt = Date.now();
    analytics.bySite[siteKey] = (analytics.bySite[siteKey] || 0) + 1;

    if (domain) {
      analytics.byDomain[domain] = (analytics.byDomain[domain] || 0) + 1;
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

    const settings = config.sanitizeSettings(changes[config.SETTINGS_KEY].newValue);
    updateBadge(settings);
    scheduleBadgeAlarm(settings);
  });

  ensureDefaults();

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== "object") {
      return false;
    }

    if (message.type === "anti-scroll-attempt") {
      recordBlockedAttempt(message)
        .then((analytics) => sendResponse({ ok: true, analytics }))
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
