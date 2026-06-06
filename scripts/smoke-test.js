require("../src/constants.js");

const config = globalThis.AntiScrollConfig;
const baseSettings = config.sanitizeSettings({
  customDomains: ["news.ycombinator.com", "https://example.com/path"],
  showNotice: true
});

if (baseSettings.showNotice !== false) {
  throw new Error("showNotice should remain disabled");
}

const cases = [
  [baseSettings, "https://www.reddit.com/r/all", true, "reddit"],
  [baseSettings, "https://x.com/home", true, "x"],
  [
    baseSettings,
    "https://www.instagram.com/direct/inbox/",
    false,
    "messaging-page"
  ],
  [baseSettings, "https://news.ycombinator.com/news", true, "custom"],
  [baseSettings, "https://example.com/path", true, "custom"],
  [baseSettings, "https://openai.com/", false, "not-blocked"],
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
  ["https://www.linkedin.com/feed/", true],
  ["https://www.linkedin.com/messaging/", false],
  ["https://www.facebook.com/watch", true],
  ["https://www.facebook.com/messages", false],
  ["https://www.threads.net/@someone", true]
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

for (const [url, expected] of feedCases) {
  const match = config.matchUrl(url, baseSettings);
  const shield = config.matchFeedShield(url, match, baseSettings);
  if (shield.active !== expected) {
    throw new Error(`${url}: expected feed shield=${expected}, got ${shield.active}`);
  }
}

console.log("matching smoke ok");
