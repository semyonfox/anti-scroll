(function attachAntiScrollConfig(root) {
  "use strict";

  const SETTINGS_KEY = "antiScrollSettings";
  const ANALYTICS_KEY = "antiScrollAnalytics";
  const MODES = {
    DISABLED: "disabled",
    SELECTED: "selected",
    ALL: "all"
  };

  const PRESETS = [
    {
      id: "reddit",
      label: "Reddit",
      domains: ["reddit.com", "old.reddit.com"]
    },
    {
      id: "youtube",
      label: "YouTube",
      domains: ["youtube.com", "youtu.be"]
    },
    {
      id: "instagram",
      label: "Instagram",
      domains: ["instagram.com"]
    },
    {
      id: "tiktok",
      label: "TikTok",
      domains: ["tiktok.com"]
    },
    {
      id: "x",
      label: "X / Twitter",
      domains: ["x.com", "twitter.com"]
    },
    {
      id: "facebook",
      label: "Facebook",
      domains: ["facebook.com"]
    },
    {
      id: "linkedin",
      label: "LinkedIn",
      domains: ["linkedin.com"]
    },
    {
      id: "threads",
      label: "Threads",
      domains: ["threads.net"]
    }
  ];

  const DEFAULT_PRESET_STATE = Object.fromEntries(
    PRESETS.map((preset) => [preset.id, true])
  );

  const DEFAULT_SETTINGS = {
    mode: MODES.SELECTED,
    enabled: true,
    activeUntil: null,
    lockPage: true,
    showNotice: false,
    strictFeeds: true,
    allowEditableFields: true,
    allowMessagingPages: true,
    presets: DEFAULT_PRESET_STATE,
    customDomains: [],
    pausedUntilByHost: {}
  };

  const EMPTY_ANALYTICS = {
    total: 0,
    bySite: {},
    byDomain: {},
    lastAt: null
  };

  const MESSAGING_PATHS = {
    facebook: [/^\/messages(\/|$)/i, /^\/messages\/t(\/|$)/i],
    instagram: [/^\/direct(\/|$)/i],
    linkedin: [/^\/messaging(\/|$)/i],
    x: [/^\/messages(\/|$)/i, /^\/i\/chat(\/|$)/i]
  };

  function normalizeHost(host) {
    return String(host || "")
      .trim()
      .toLowerCase()
      .replace(/\.$/, "")
      .replace(/^(www|m|mobile)\./, "");
  }

  function normalizeDomainInput(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) {
      return "";
    }

    let candidate = raw;
    try {
      candidate = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname;
    } catch {
      candidate = raw.split(/[/?#]/)[0];
    }

    candidate = normalizeHost(candidate.replace(/^\*\./, ""));
    if (!/^[a-z0-9.-]+$/.test(candidate) || candidate.includes("..")) {
      return "";
    }

    return candidate;
  }

  function parseDomainList(value) {
    return String(value || "")
      .split(/[\s,]+/)
      .map(normalizeDomainInput)
      .filter(Boolean);
  }

  function uniqueDomains(domains) {
    return Array.from(new Set(domains.map(normalizeDomainInput).filter(Boolean)));
  }

  function domainMatches(host, domain) {
    const normalizedHost = normalizeHost(host);
    const normalizedDomain = normalizeDomainInput(domain);
    return (
      normalizedHost === normalizedDomain ||
      normalizedHost.endsWith(`.${normalizedDomain}`)
    );
  }

  function sanitizeSettings(value) {
    const incoming = value && typeof value === "object" ? value : {};
    const presetState = { ...DEFAULT_PRESET_STATE };
    const incomingMode =
      typeof incoming.mode === "string" ? incoming.mode : null;
    const mode = Object.values(MODES).includes(incomingMode)
      ? incomingMode
      : incoming.enabled === false
        ? MODES.DISABLED
        : DEFAULT_SETTINGS.mode;
    const activeUntil =
      typeof incoming.activeUntil === "number" && incoming.activeUntil > 0
        ? incoming.activeUntil
        : null;

    if (incoming.presets && typeof incoming.presets === "object") {
      for (const preset of PRESETS) {
        if (typeof incoming.presets[preset.id] === "boolean") {
          presetState[preset.id] = incoming.presets[preset.id];
        }
      }
    }

    const pausedUntilByHost = {};
    if (
      incoming.pausedUntilByHost &&
      typeof incoming.pausedUntilByHost === "object"
    ) {
      for (const [host, until] of Object.entries(incoming.pausedUntilByHost)) {
        const normalizedHost = normalizeDomainInput(host);
        if (normalizedHost && typeof until === "number" && until > Date.now()) {
          pausedUntilByHost[normalizedHost] = until;
        }
      }
    }

    return {
      mode,
      enabled: mode !== MODES.DISABLED,
      activeUntil,
      lockPage:
        typeof incoming.lockPage === "boolean"
          ? incoming.lockPage
          : DEFAULT_SETTINGS.lockPage,
      showNotice: false,
      strictFeeds:
        typeof incoming.strictFeeds === "boolean"
          ? incoming.strictFeeds
          : DEFAULT_SETTINGS.strictFeeds,
      allowEditableFields:
        typeof incoming.allowEditableFields === "boolean"
          ? incoming.allowEditableFields
          : DEFAULT_SETTINGS.allowEditableFields,
      allowMessagingPages:
        typeof incoming.allowMessagingPages === "boolean"
          ? incoming.allowMessagingPages
          : DEFAULT_SETTINGS.allowMessagingPages,
      presets: presetState,
      customDomains: uniqueDomains(incoming.customDomains || []),
      pausedUntilByHost
    };
  }

  function sanitizeAnalytics(value) {
    const incoming = value && typeof value === "object" ? value : {};
    const bySite = {};
    const byDomain = {};

    for (const siteKey of [
      ...PRESETS.map((preset) => preset.id),
      "custom",
      "all"
    ]) {
      const count = incoming.bySite?.[siteKey];
      if (Number.isFinite(count) && count > 0) {
        bySite[siteKey] = count;
      }
    }

    if (incoming.byDomain && typeof incoming.byDomain === "object") {
      for (const [domain, count] of Object.entries(incoming.byDomain)) {
        const normalizedDomain = normalizeDomainInput(domain);
        if (normalizedDomain && Number.isFinite(count) && count > 0) {
          byDomain[normalizedDomain] = count;
        }
      }
    }

    return {
      total: Number.isFinite(incoming.total) && incoming.total > 0 ? incoming.total : 0,
      bySite,
      byDomain,
      lastAt: typeof incoming.lastAt === "number" ? incoming.lastAt : null
    };
  }

  function isMessagingPage(url, presetId) {
    const patterns = MESSAGING_PATHS[presetId];
    if (!patterns) {
      return false;
    }

    try {
      const parsed = new URL(url);
      return patterns.some((pattern) => pattern.test(parsed.pathname));
    } catch {
      return false;
    }
  }

  function getPresetById(id) {
    return PRESETS.find((preset) => preset.id === id) || null;
  }

  function normalizedPathname(url) {
    try {
      const path = new URL(url).pathname.toLowerCase().replace(/\/+$/, "");
      return path || "/";
    } catch {
      return "/";
    }
  }

  function pathSegments(path) {
    return path.split("/").filter(Boolean);
  }

  function isSingleSegmentPath(path, excludedSegments = []) {
    const segments = pathSegments(path);
    if (segments.length !== 1) {
      return false;
    }

    return !excludedSegments.includes(segments[0].toLowerCase());
  }

  function isFeedLikePage(url, presetId) {
    const path = normalizedPathname(url);
    const segments = pathSegments(path);

    switch (presetId) {
      case "reddit":
        return (
          path === "/" ||
          /^\/(best|hot|new|top|controversial)$/.test(path) ||
          /^\/r\/(all|popular)$/.test(path) ||
          (/^\/r\/[^/]+$/.test(path) && !path.includes("/comments/")) ||
          /^\/user\/[^/]+$/.test(path)
        );

      case "youtube":
        return (
          path === "/" ||
          /^\/shorts(\/|$)/.test(path) ||
          /^\/feed(\/|$)/.test(path) ||
          path === "/results"
        );

      case "instagram":
        return (
          path === "/" ||
          /^\/(explore|reels)(\/|$)/.test(path) ||
          isSingleSegmentPath(path, [
            "accounts",
            "about",
            "direct",
            "developer",
            "legal",
            "p",
            "reel",
            "stories"
          ])
        );

      case "tiktok":
        return (
          path === "/" ||
          /^\/(foryou|following|live|explore)(\/|$)/.test(path) ||
          (/^\/@[^/]+$/.test(path) && segments.length === 1)
        );

      case "x":
        return (
          path === "/" ||
          /^\/(home|explore|search|notifications)(\/|$)/.test(path) ||
          /^\/i\/flow(\/|$)/.test(path) ||
          isSingleSegmentPath(path, [
            "about",
            "compose",
            "download",
            "explore",
            "home",
            "i",
            "jobs",
            "messages",
            "privacy",
            "search",
            "settings",
            "tos"
          ])
        );

      case "facebook":
        return (
          path === "/" ||
          /^\/(watch|reel|reels|groups|gaming|marketplace|friends)(\/|$)/.test(
            path
          ) ||
          isSingleSegmentPath(path, [
            "about",
            "events",
            "help",
            "login",
            "messages",
            "privacy",
            "settings"
          ])
        );

      case "linkedin":
        return (
          path === "/" ||
          /^\/feed(\/|$)/.test(path) ||
          /^\/mynetwork(\/|$)/.test(path) ||
          /^\/in\/[^/]+\/recent-activity(\/|$)/.test(path)
        );

      case "threads":
        return (
          path === "/" ||
          isSingleSegmentPath(path, ["about", "privacy", "terms"])
        );

      default:
        return false;
    }
  }

  function matchFeedShield(url, urlMatch, settingsValue) {
    const settings = sanitizeSettings(settingsValue);

    if (
      !settings.strictFeeds ||
      !urlMatch?.active ||
      urlMatch.type !== "preset" ||
      !urlMatch.presetId
    ) {
      return { active: false, reason: "not-feed-shielded" };
    }

    if (!isFeedLikePage(url, urlMatch.presetId)) {
      return {
        active: false,
        reason: "not-feed-like",
        presetId: urlMatch.presetId
      };
    }

    return {
      active: true,
      presetId: urlMatch.presetId,
      label: urlMatch.label,
      host: urlMatch.host
    };
  }

  function matchUrl(url, settingsValue) {
    const settings = sanitizeSettings(settingsValue);
    let parsed;

    try {
      parsed = new URL(url);
    } catch {
      return { active: false, reason: "invalid-url" };
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { active: false, reason: "unsupported-protocol" };
    }

    const host = normalizeHost(parsed.hostname);

    if (settings.mode === MODES.DISABLED || !settings.enabled) {
      return { active: false, reason: "disabled", host };
    }

    if (settings.activeUntil && settings.activeUntil <= Date.now()) {
      return {
        active: false,
        reason: "timer-ended",
        host,
        activeUntil: settings.activeUntil
      };
    }

    const pausedUntil = settings.pausedUntilByHost[host];
    if (pausedUntil && pausedUntil > Date.now()) {
      return { active: false, reason: "paused", host, pausedUntil };
    }

    if (settings.mode === MODES.ALL) {
      return {
        active: true,
        type: "all",
        label: host || "This site",
        host,
        domain: host
      };
    }

    for (const preset of PRESETS) {
      const enabled = settings.presets[preset.id] !== false;
      if (!enabled || !preset.domains.some((domain) => domainMatches(host, domain))) {
        continue;
      }

      if (settings.allowMessagingPages && isMessagingPage(url, preset.id)) {
        return {
          active: false,
          reason: "messaging-page",
          host,
          presetId: preset.id,
          label: preset.label
        };
      }

      return {
        active: true,
        type: "preset",
        presetId: preset.id,
        label: preset.label,
        host,
        domain: preset.domains.find((domain) => domainMatches(host, domain))
      };
    }

    const customDomain = settings.customDomains.find((domain) =>
      domainMatches(host, domain)
    );

    if (customDomain) {
      return {
        active: true,
        type: "custom",
        label: customDomain,
        host,
        domain: customDomain
      };
    }

    return { active: false, reason: "not-blocked", host };
  }

  function getApi() {
    return root.browser || root.chrome;
  }

  root.AntiScrollConfig = {
    SETTINGS_KEY,
    ANALYTICS_KEY,
    MODES,
    PRESETS,
    DEFAULT_SETTINGS,
    EMPTY_ANALYTICS,
    normalizeHost,
    normalizeDomainInput,
    parseDomainList,
    uniqueDomains,
    domainMatches,
    sanitizeSettings,
    sanitizeAnalytics,
    getPresetById,
    isFeedLikePage,
    matchFeedShield,
    matchUrl,
    getApi
  };
})(globalThis);
