require("../src/constants.js");

const fs = require("fs");
const path = require("path");
const config = globalThis.AntiScrollConfig;
const baseSettings = config.sanitizeSettings({
  customDomains: ["news.ycombinator.com", "https://example.com/path"],
  showNotice: true
});
const optInSettings = config.sanitizeSettings({
  presets: {
    ...baseSettings.presets,
    github: true,
    hackernews: true,
    substack: true,
    twitch: true
  }
});
const pausedSettings = config.sanitizeSettings({
  pausedUntilByHost: {
    "reddit.com": Date.now() + 60000
  }
});

if (Object.hasOwn(baseSettings, "showNotice")) {
  throw new Error("showNotice should not be persisted");
}

const future = Date.now() + 60000;
const hostileSettings = config.sanitizeSettings({
  pausedUntilByHost: {
    constructor: future,
    "__proto__": future,
    "example.com": future
  }
});
if (Object.getPrototypeOf(hostileSettings.pausedUntilByHost) !== null) {
  throw new Error("pausedUntilByHost should use a null prototype");
}
if (hostileSettings.pausedUntilByHost.constructor !== future) {
  throw new Error("constructor host pause should be an own data value");
}
if (hostileSettings.pausedUntilByHost["example.com"] !== future) {
  throw new Error("example.com pause should be preserved");
}

const hostileAnalytics = config.sanitizeAnalytics({
  total: 2,
  bySite: { constructor: 10, reddit: 1 },
  byDomain: { constructor: 1, "__proto__": 1, "example.com": 3 },
  lastAt: future
});
if (Object.getPrototypeOf(hostileAnalytics.bySite) !== null) {
  throw new Error("bySite should use a null prototype");
}
if (Object.getPrototypeOf(hostileAnalytics.byDomain) !== null) {
  throw new Error("byDomain should use a null prototype");
}
if (hostileAnalytics.bySite.constructor !== undefined) {
  throw new Error("unexpected inherited bySite constructor value");
}
if (hostileAnalytics.byDomain.constructor !== 1) {
  throw new Error("constructor domain count should be an own data value");
}

const cases = [
  [baseSettings, "https://www.reddit.com/r/all", true, "reddit"],
  [baseSettings, "https://x.com/home", true, "x"],
  [baseSettings, "https://twitter.com/home", true, "x"],
  [
    baseSettings,
    "https://www.instagram.com/direct/inbox/",
    false,
    "messaging-page"
  ],
  [baseSettings, "https://news.ycombinator.com/news", true, "custom"],
  [baseSettings, "https://example.com/path", true, "custom"],
  [baseSettings, "https://bsky.app/", true, "bluesky"],
  [baseSettings, "https://www.threads.com/", true, "threads"],
  [baseSettings, "https://github.com/", false, "not-blocked"],
  [baseSettings, "https://openai.com/", false, "not-blocked"],
  [pausedSettings, "https://www.reddit.com/", false, "paused"],
  [
    config.sanitizeSettings({ mode: config.MODES.DISABLED }),
    "https://www.reddit.com/r/all",
    false,
    "disabled"
  ],
  [
    config.sanitizeSettings({ mode: config.MODES.ALL }),
    "https://openai.com/",
    true,
    "all"
  ],
  [
    config.sanitizeSettings({ activeUntil: Date.now() - 1000 }),
    "https://www.reddit.com/r/all",
    false,
    "timer-ended"
  ],
  [
    config.sanitizeSettings({
      mode: config.MODES.ALL,
      activeUntil: Date.now() + 60000
    }),
    "https://openai.com/",
    true,
    "all"
  ]
];

const securityPathCases = [
  ["https://x.com/messages/../home", false],
  ["https://www.facebook.com/messages/../watch", false],
  ["https://www.instagram.com/direct/../explore/", false],
  ["https://www.linkedin.com/messaging/../feed/", false]
];

const feedCases = [
  ["https://www.reddit.com/", true],
  ["https://www.reddit.com/r/all/", true],
  ["https://www.reddit.com/r/webdev/comments/abc/post/", false],
  ["https://www.youtube.com/", true],
  ["https://www.youtube.com/shorts/abc123", true],
  ["https://www.youtube.com/watch?v=abc123", false],
  ["https://www.instagram.com/", true],
  ["https://www.instagram.com/direct/inbox/", false],
  ["https://www.tiktok.com/foryou", true],
  ["https://www.tiktok.com/@someone/video/123", false],
  ["https://x.com/home", true],
  ["https://x.com/messages", false],
  ["https://twitter.com/home", true],
  ["https://twitter.com/messages", false],
  ["https://www.linkedin.com/feed/", true],
  ["https://www.linkedin.com/messaging/", false],
  ["https://www.facebook.com/watch", true],
  ["https://www.facebook.com/messages", false],
  ["https://www.threads.com/@someone", true],
  ["https://bsky.app/", true],
  ["https://github.com/", false],
  ["https://github.com/", true, optInSettings],
  ["https://github.com/openai/codex", false, optInSettings],
  ["https://news.ycombinator.com/news", true, optInSettings],
  ["https://substack.com/home", true, optInSettings],
  ["https://example.substack.com/p/post", false, optInSettings],
  ["https://www.twitch.tv/directory/following", true, optInSettings],
  ["https://www.twitch.tv/some-channel", false, optInSettings]
];

const shieldCases = [
  ["https://www.youtube.com/shorts/abc123", true, "feed"],
  ["https://www.youtube.com/watch?v=abc123", false, "not-feed-like"],
  ["https://www.linkedin.com/feed/", true, "feed"],
  ["https://www.linkedin.com/messaging/", false, "messaging-page"],
  ["https://bsky.app/", true, "feed"],
  ["https://github.com/", true, "feed", optInSettings],
  ["https://github.com/openai/codex", false, "not-feed-like", optInSettings],
  ["https://news.ycombinator.com/news", true, "feed", optInSettings],
  ["https://substack.com/home", true, "feed", optInSettings],
  [
    "https://www.twitch.tv/directory/following",
    true,
    "feed",
    optInSettings
  ],
  ["https://news.ycombinator.com/news", true, "custom"],
  [
    "https://openai.com/",
    true,
    "all",
    config.sanitizeSettings({ mode: config.MODES.ALL })
  ]
];

for (const [settings, url, active, marker] of cases) {
  const match = config.matchUrl(url, settings);

  if (match.active !== active) {
    throw new Error(`${url}: expected active=${active}, got ${match.active}`);
  }

  if (active && marker === "custom" && match.type !== "custom") {
    throw new Error(`${url}: expected custom`);
  }

  if (active && marker === "all" && match.type !== "all") {
    throw new Error(`${url}: expected all`);
  }

  if (active && !["custom", "all"].includes(marker) && match.presetId !== marker) {
    throw new Error(`${url}: expected ${marker}`);
  }

  if (!active && marker !== match.reason) {
    throw new Error(`${url}: expected reason ${marker}, got ${match.reason}`);
  }
}

for (const [url, expected, settings = baseSettings] of feedCases) {
  const match = config.matchUrl(url, settings);
  const shield = config.matchFeedShield(url, match, settings);
  if (shield.active !== expected) {
    throw new Error(`${url}: expected feed shield=${expected}, got ${shield.active}`);
  }
}

for (const [url, expected, marker, settings = baseSettings] of shieldCases) {
  const shield = config.matchShield(url, settings);
  if (shield.active !== expected) {
    throw new Error(`${url}: expected shield=${expected}, got ${shield.active}`);
  }

  if (expected && shield.type !== marker) {
    throw new Error(`${url}: expected shield type ${marker}, got ${shield.type}`);
  }

  if (!expected && shield.reason !== marker) {
    throw new Error(`${url}: expected shield reason ${marker}, got ${shield.reason}`);
  }
}

for (const [url, expected] of securityPathCases) {
  const match = config.matchUrl(url, baseSettings);
  if (match.reason === "messaging-page" !== expected) {
    throw new Error(`${url}: unexpected messaging path allowlist result`);
  }
}

for (const manifestName of [
  "manifest.json",
  "manifest.chromium.json",
  "manifest.firefox.json"
]) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", manifestName), "utf8")
  );
  const scriptMatches = manifest.content_scripts.flatMap(
    (script) => script.matches || []
  );

  if (scriptMatches.includes("http://*/*") || scriptMatches.includes("https://*/*")) {
    throw new Error(`${manifestName}: content scripts should not match all sites`);
  }
  if (manifest.host_permissions.includes("http://*/*")) {
    throw new Error(`${manifestName}: http all-sites host permission should be optional`);
  }
  if (manifest.host_permissions.includes("https://*/*")) {
    throw new Error(`${manifestName}: https all-sites host permission should be optional`);
  }
  if (!manifest.optional_host_permissions?.includes("https://*/*")) {
    throw new Error(`${manifestName}: all-sites permission should be optional`);
  }
  if (manifest.permissions.includes("tabs")) {
    throw new Error(`${manifestName}: tabs permission should be replaced by activeTab`);
  }
  if (!manifest.permissions.includes("webNavigation")) {
    throw new Error(`${manifestName}: SPA navigation refresh needs webNavigation`);
  }
}

const pageLockSource = fs.readFileSync(
  path.join(__dirname, "..", "src", "page-lock.js"),
  "utf8"
);
if (!pageLockSource.includes("event.detail?.token !== token")) {
  throw new Error("page-lock should reject lock-state events without the token");
}

const contentSource = fs.readFileSync(
  path.join(__dirname, "..", "src", "content.js"),
  "utf8"
);
if (
  !contentSource.includes('shieldMatch.type === "feed"') ||
  !contentSource.includes("Array.from(surfaceTargets)")
) {
  throw new Error("feed shield media pausing should stay scoped to feed targets");
}

console.log("matching smoke ok");
