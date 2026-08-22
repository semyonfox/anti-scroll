require("../src/constants.js");

const fs = require("fs");
const path = require("path");
const config = globalThis.AntiScrollConfig;
const baseSettings = config.sanitizeSettings({
  customDomains: ["news.ycombinator.com", "https://example.com/path"],
  showNotice: true,
});
const optInSettings = config.sanitizeSettings({
  presets: {
    ...baseSettings.presets,
    github: true,
    hackernews: true,
    substack: true,
    twitch: true,
  },
});
const pausedSettings = config.sanitizeSettings({
  pausedUntilByHost: {
    "reddit.com": Date.now() + 60000,
  },
});

if (Object.hasOwn(baseSettings, "showNotice")) {
  throw new Error("showNotice should not be persisted");
}

const future = Date.now() + 60000;
const hostileSettings = config.sanitizeSettings({
  pausedUntilByHost: {
    constructor: future,
    __proto__: future,
    "example.com": future,
  },
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
  byDomain: { constructor: 1, __proto__: 1, "example.com": 3 },
  lastAt: future,
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

const expiredPause = config.sanitizeSettings({
  pausedUntilByHost: { "x.com": Date.now() - 1000 },
});
if (Object.keys(expiredPause.pausedUntilByHost).length !== 0) {
  throw new Error(
    "expired pause entries should be dropped during sanitization",
  );
}

const normalizedPause = config.sanitizeSettings({
  pausedUntilByHost: { "WWW.X.com.": future },
});
if (normalizedPause.pausedUntilByHost["x.com"] !== future) {
  throw new Error(
    `expected pause host normalized to x.com, got ${JSON.stringify(normalizedPause.pausedUntilByHost)}`,
  );
}

if (
  config.sanitizeSettings({ enabled: false }).mode !== config.MODES.DISABLED
) {
  throw new Error("enabled=false should fall back to disabled mode");
}
if (config.sanitizeSettings({ mode: "bogus" }).mode !== config.MODES.SELECTED) {
  throw new Error("unknown mode strings should fall back to selected");
}
if (
  config.sanitizeSettings({ presets: { reddit: "yes" } }).presets.reddit !==
  true
) {
  throw new Error("non-boolean preset values should be ignored");
}
const defaultPresets = config.sanitizeSettings({}).presets;
for (const optIn of ["github", "hackernews", "substack", "twitch"]) {
  if (defaultPresets[optIn] !== false) {
    throw new Error(`${optIn} should stay off by default`);
  }
}
if (defaultPresets.reddit !== true) {
  throw new Error("reddit should be on by default");
}
if (config.sanitizeSettings({ activeUntil: -5 }).activeUntil !== null) {
  throw new Error("non-positive activeUntil should become null");
}

const hostileCounts = config.sanitizeAnalytics({
  total: -3,
  bySite: { evil: 5 },
  byDomain: { "ok.example": 2, "bad domain": 4, "nope.example": -1 },
  lastAt: "nope",
});
if (
  hostileCounts.total !== 0 ||
  Object.keys(hostileCounts.bySite).length !== 0 ||
  hostileCounts.byDomain["ok.example"] !== 2 ||
  hostileCounts.byDomain["bad domain"] !== undefined ||
  hostileCounts.byDomain["nope.example"] !== undefined ||
  hostileCounts.lastAt !== null
) {
  throw new Error(
    `unexpected analytics sanitization: ${JSON.stringify(hostileCounts)}`,
  );
}

const parsedDomains = config.parseDomainList(
  "https://E.com/path, foo.bar  baz,,*.wild.org",
);
if (
  JSON.stringify(parsedDomains) !==
  JSON.stringify(["e.com", "foo.bar", "baz", "wild.org"])
) {
  throw new Error(
    `parseDomainList should split, normalize and drop junk, got ${JSON.stringify(parsedDomains)}`,
  );
}
const deduped = config.uniqueDomains([
  "X.com",
  "x.com",
  "https://www.x.com/about",
]);
if (deduped.length !== 1 || deduped[0] !== "x.com") {
  throw new Error(
    `uniqueDomains should dedupe aliases, got ${JSON.stringify(deduped)}`,
  );
}

const cases = [
  [baseSettings, "https://www.reddit.com/r/all", true, "reddit"],
  [baseSettings, "https://old.reddit.com/r/all", true, "reddit"],
  [baseSettings, "https://x.com/home", true, "x"],
  [baseSettings, "https://twitter.com/home", true, "x"],
  [
    baseSettings,
    "https://www.instagram.com/direct/inbox/",
    false,
    "messaging-page",
  ],
  [baseSettings, "https://news.ycombinator.com/news", true, "custom"],
  [baseSettings, "https://example.com/path", true, "custom"],
  [baseSettings, "https://bsky.app/", true, "bluesky"],
  [baseSettings, "https://www.threads.com/", true, "threads"],
  [baseSettings, "https://threads.net/", true, "threads"],
  [baseSettings, "https://m.youtube.com/shorts/abc123", true, "youtube"],
  [baseSettings, "https://youtu.be/abc123", true, "youtube"],
  [baseSettings, "https://github.com/", false, "not-blocked"],
  [baseSettings, "https://openai.com/", false, "not-blocked"],
  [baseSettings, "ftp://www.x.com/home", false, "unsupported-protocol"],
  [baseSettings, "about:blank", false, "unsupported-protocol"],
  [baseSettings, "::bad::", false, "invalid-url"],
  [pausedSettings, "https://www.reddit.com/", false, "paused"],
  [
    config.sanitizeSettings({ mode: config.MODES.DISABLED }),
    "https://www.reddit.com/r/all",
    false,
    "disabled",
  ],
  [
    config.sanitizeSettings({
      mode: config.MODES.DISABLED,
      pausedUntilByHost: { "reddit.com": future },
    }),
    "https://www.reddit.com/",
    false,
    "disabled",
  ],
  [
    config.sanitizeSettings({
      activeUntil: Date.now() - 1000,
      pausedUntilByHost: { "reddit.com": future },
    }),
    "https://www.reddit.com/",
    false,
    "timer-ended",
  ],
  [
    config.sanitizeSettings({ ...baseSettings, allowMessagingPages: false }),
    "https://x.com/messages",
    true,
    "x",
  ],
  [
    config.sanitizeSettings({ mode: config.MODES.ALL }),
    "https://openai.com/",
    true,
    "all",
  ],
  [
    config.sanitizeSettings({ activeUntil: Date.now() - 1000 }),
    "https://www.reddit.com/r/all",
    false,
    "timer-ended",
  ],
  [
    config.sanitizeSettings({
      mode: config.MODES.ALL,
      activeUntil: Date.now() + 60000,
    }),
    "https://openai.com/",
    true,
    "all",
  ],
];

const securityPathCases = [
  ["https://x.com/messages/../home", false],
  ["https://www.facebook.com/messages/../watch", false],
  ["https://www.instagram.com/direct/../explore/", false],
  ["https://www.linkedin.com/messaging/../feed/", false],
];

const feedCases = [
  ["https://www.reddit.com/", true],
  ["https://www.reddit.com/r/all/", true],
  ["https://www.reddit.com/r/webdev/comments/abc/post/", false],
  ["https://www.youtube.com/", true],
  ["https://www.youtube.com/shorts/abc123", true],
  ["https://m.youtube.com/shorts/abc123", true],
  ["https://www.youtube.com/feed/subscriptions", true],
  ["https://youtu.be/abc123", false],
  ["https://www.youtube.com/watch?v=abc123", false],
  ["https://www.instagram.com/", true],
  ["https://www.instagram.com/explore/", true],
  ["https://www.instagram.com/direct/inbox/", false],
  ["https://x.com/i/chat", false],
  ["https://www.tiktok.com/foryou", true],
  ["https://www.tiktok.com/@someone/video/123", false],
  ["https://www.tiktok.com/@creator", true],
  ["https://x.com/home", true],
  ["https://x.com/someone", true],
  ["https://x.com/messages", false],
  ["https://twitter.com/home", true],
  ["https://twitter.com/messages", false],
  ["https://old.reddit.com/r/all/", true],
  ["https://www.linkedin.com/feed/", true],
  ["https://www.linkedin.com/messaging/", false],
  ["https://www.linkedin.com/mynetwork/", true],
  ["https://www.facebook.com/watch", true],
  ["https://www.facebook.com/groups/123", true],
  ["https://www.facebook.com/messages", false],
  ["https://www.threads.com/@someone", true],
  ["https://threads.net/@someone", true],
  ["https://bsky.app/", true],
  ["https://bsky.app/profile/user", false],
  ["https://github.com/", false],
  ["https://github.com/", true, optInSettings],
  ["https://github.com/openai/codex", false, optInSettings],
  ["https://news.ycombinator.com/news", true, optInSettings],
  ["https://news.ycombinator.com/newest", true, optInSettings],
  ["https://substack.com/home", true, optInSettings],
  ["https://example.substack.com/p/post", false, optInSettings],
  ["https://www.twitch.tv/directory/following", true, optInSettings],
  ["https://www.twitch.tv/some-channel", false, optInSettings],
];

const shieldCases = [
  ["https://www.youtube.com/shorts/abc123", true, "feed"],
  ["https://m.youtube.com/shorts/abc123", true, "feed"],
  ["https://youtu.be/abc123", false, "not-feed-like"],
  ["https://www.youtube.com/watch?v=abc123", false, "not-feed-like"],
  ["https://www.linkedin.com/feed/", true, "feed"],
  ["https://www.linkedin.com/messaging/", false, "messaging-page"],
  ["https://bsky.app/", true, "feed"],
  [
    "https://x.com/home",
    false,
    "not-feed-shielded",
    config.sanitizeSettings({ ...baseSettings, strictFeeds: false }),
  ],
  ["https://github.com/", true, "feed", optInSettings],
  ["https://github.com/openai/codex", false, "not-feed-like", optInSettings],
  ["https://news.ycombinator.com/news", true, "feed", optInSettings],
  ["https://substack.com/home", true, "feed", optInSettings],
  ["https://www.twitch.tv/directory/following", true, "feed", optInSettings],
  ["https://news.ycombinator.com/news", true, "custom"],
  [
    "https://openai.com/",
    true,
    "all",
    config.sanitizeSettings({ mode: config.MODES.ALL }),
  ],
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

  if (
    active &&
    !["custom", "all"].includes(marker) &&
    match.presetId !== marker
  ) {
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
    throw new Error(
      `${url}: expected feed shield=${expected}, got ${shield.active}`,
    );
  }
}

for (const [url, expected, marker, settings = baseSettings] of shieldCases) {
  const shield = config.matchShield(url, settings);
  if (shield.active !== expected) {
    throw new Error(
      `${url}: expected shield=${expected}, got ${shield.active}`,
    );
  }

  if (expected && shield.type !== marker) {
    throw new Error(
      `${url}: expected shield type ${marker}, got ${shield.type}`,
    );
  }

  if (!expected && shield.reason !== marker) {
    throw new Error(
      `${url}: expected shield reason ${marker}, got ${shield.reason}`,
    );
  }
}

for (const [url, expected] of securityPathCases) {
  const match = config.matchUrl(url, baseSettings);
  if ((match.reason === "messaging-page") !== expected) {
    throw new Error(`${url}: unexpected messaging path allowlist result`);
  }
}

for (const manifestName of [
  "manifest.json",
  "manifest.chromium.json",
  "manifest.firefox.json",
]) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", manifestName), "utf8"),
  );
  const scriptMatches = manifest.content_scripts.flatMap(
    (script) => script.matches || [],
  );

  if (
    scriptMatches.includes("http://*/*") ||
    scriptMatches.includes("https://*/*")
  ) {
    throw new Error(
      `${manifestName}: content scripts should not match all sites`,
    );
  }
  if (scriptMatches.some((match) => !match.startsWith("https://"))) {
    throw new Error(
      `${manifestName}: static content-script matches should be HTTPS-only`,
    );
  }
  if (
    manifest.host_permissions.some(
      (permission) => !permission.startsWith("https://"),
    )
  ) {
    throw new Error(
      `${manifestName}: static host permissions should be HTTPS-only`,
    );
  }
  if (manifest.host_permissions.includes("http://*/*")) {
    throw new Error(
      `${manifestName}: http all-sites host permission should be optional`,
    );
  }
  if (manifest.host_permissions.includes("https://*/*")) {
    throw new Error(
      `${manifestName}: https all-sites host permission should be optional`,
    );
  }
  if (
    !manifest.optional_host_permissions?.includes("http://*/*") ||
    !manifest.optional_host_permissions.includes("https://*/*")
  ) {
    throw new Error(
      `${manifestName}: HTTP and HTTPS all-sites permissions should remain optional`,
    );
  }
  if (manifest.permissions.includes("tabs")) {
    throw new Error(
      `${manifestName}: tabs permission should be replaced by activeTab`,
    );
  }
  if (!manifest.permissions.includes("webNavigation")) {
    throw new Error(
      `${manifestName}: SPA navigation refresh needs webNavigation`,
    );
  }
}

const manifests = Object.fromEntries(
  ["manifest.json", "manifest.chromium.json", "manifest.firefox.json"].map(
    (manifestName) => [
      manifestName,
      JSON.parse(
        fs.readFileSync(path.join(__dirname, "..", manifestName), "utf8"),
      ),
    ],
  ),
);
for (const field of [
  "manifest_version",
  "name",
  "version",
  "description",
  "action",
  "content_scripts",
  "host_permissions",
  "optional_host_permissions",
  "permissions",
]) {
  const chromiumValue = JSON.stringify(
    manifests["manifest.chromium.json"][field],
  );
  for (const manifestName of ["manifest.json", "manifest.firefox.json"]) {
    if (JSON.stringify(manifests[manifestName][field]) !== chromiumValue) {
      throw new Error(`${manifestName} must share ${field} with Chromium`);
    }
  }
}

const pageLockSource = fs.readFileSync(
  path.join(__dirname, "..", "src", "page-lock.js"),
  "utf8",
);
if (!pageLockSource.includes("stateEvent.detail?.token !== token")) {
  throw new Error(
    "page-lock should reject lock-state events without the token",
  );
}
if (
  !pageLockSource.includes(
    'STATE_EVENT_PREFIX = "anti-scroll-main-lock-state:"',
  ) ||
  pageLockSource.includes(
    'const STATE_EVENT_NAME = "anti-scroll-main-lock-state"',
  )
) {
  throw new Error("page-lock should use a per-document state event name");
}
if (
  !pageLockSource.includes(
    "isValidChannelEventName(responseEventName, RESPONSE_EVENT_PREFIX)",
  ) ||
  !pageLockSource.includes(
    "isValidChannelEventName(stateEventName, STATE_EVENT_PREFIX)",
  )
) {
  throw new Error(
    "page-lock should validate handshake channel names before claiming them",
  );
}

const contentSource = fs.readFileSync(
  path.join(__dirname, "..", "src", "content.js"),
  "utf8",
);
if (
  !contentSource.includes("createMainLockChannelId") ||
  !contentSource.includes("mainLockStateEvent")
) {
  throw new Error(
    "content script should randomize main-lock bridge event names",
  );
}
if (
  !contentSource.includes('shieldMatch.type === "feed"') ||
  !contentSource.includes("Array.from(surfaceTargets)")
) {
  throw new Error(
    "feed shield media pausing should stay scoped to feed targets",
  );
}
if (
  !contentSource.includes("function refreshFeedTargets(addedRoots)") ||
  !contentSource.includes("getFeedTargetsWithin(root)") ||
  !contentSource.includes("pendingSurfaceRoots") ||
  contentSource.includes("applyFeedSurfaceShield();\n    }, 120);")
) {
  throw new Error(
    "feed surface mutations should use coalesced subtree refreshes, not full rescans",
  );
}
if (
  !contentSource.includes("dataset.antiScrollFeedSurface") ||
  !contentSource.includes("dataset.antiScrollFeedTarget")
) {
  throw new Error(
    "feed selector CSS markers should remain enabled for dynamic content",
  );
}
// extension-owned nodes must not feed the surface refresh loop
if (
  !contentSource.includes(
    "node instanceof Element && !isExtensionOwnedNode(node)",
  )
) {
  throw new Error(
    "surface refresh should skip extension-owned nodes like the placeholder",
  );
}
if (
  !contentSource.includes("unmarkStaleTargets(root)") ||
  !contentSource.includes("!root.isConnected")
) {
  throw new Error(
    "refresh should unmark stale targets and skip detached roots instead of rescanning",
  );
}
if (
  !contentSource.includes("event.persisted") ||
  !contentSource.includes('"pageshow"')
) {
  throw new Error("bfcache restores should re-evaluate shield state");
}
if (
  contentSource.includes("history.pushState =") ||
  contentSource.includes("patchedPushState")
) {
  throw new Error(
    "history methods should not be patched; navigation is covered by webNavigation and polling",
  );
}
if (!contentSource.includes("if (!mainLockToken)")) {
  throw new Error("main-lock handshake should have a delayed retry");
}
if (
  !contentSource.includes("registerScrollContainer(rootElement, false)") ||
  !contentSource.includes("registerScrollContainer(node, false)")
) {
  throw new Error(
    "authoritative scans should bypass the recent-non-scroller cache",
  );
}

const popupHtml = fs.readFileSync(
  path.join(__dirname, "..", "popup", "popup.html"),
  "utf8",
);
const popupSource = fs.readFileSync(
  path.join(__dirname, "..", "popup", "popup.js"),
  "utf8",
);
for (const requiredMarkup of ["analyticsLastAt", "analyticsBreakdown"]) {
  if (!popupHtml.includes(requiredMarkup)) {
    throw new Error(`popup analytics markup missing ${requiredMarkup}`);
  }
}
for (const requiredBehavior of [
  "function formatLastActivity",
  "function appendAnalyticsGroup",
  "No site activity yet.",
  "changes[config.ANALYTICS_KEY]",
  "renderStats();",
]) {
  if (!popupSource.includes(requiredBehavior)) {
    throw new Error(`popup analytics behavior missing ${requiredBehavior}`);
  }
}

console.log("matching smoke ok");
