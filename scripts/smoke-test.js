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

console.log("matching smoke ok");
