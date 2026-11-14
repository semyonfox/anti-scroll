const fs = require("node:fs");
const path = require("node:path");
require("../src/constants.js");

const root = path.resolve(__dirname, "..");
const config = globalThis.AntiScrollConfig;
const domains = [...new Set(config.PRESETS.flatMap((preset) => preset.domains))];
const matches = domains
  .filter((domain) => !domains.some((other) => other !== domain && domain.endsWith(`.${other}`)))
  .flatMap(config.getDomainMatchPatterns)
  .filter((pattern) => pattern.startsWith("https://"));
const template = require("./manifest-template.json");
const firefox = require("./manifest-firefox.json");
let stale = false;
for (const target of ["chromium", "firefox", ""]) {
  const manifest = {
    ...template,
    ...(target === "firefox" ? firefox : {}),
    content_scripts: template.content_scripts.map((script) => ({
      matches,
      ...script,
    })),
    host_permissions: matches,
  };
  const file = path.join(root, target ? `manifest.${target}.json` : "manifest.json");
  const output = JSON.stringify(manifest, null, 2) + "\n";
  if (process.argv.includes("--check")) {
    if (fs.readFileSync(file, "utf8") !== output) {
      console.error(`Stale ${path.basename(file)}: run node scripts/generate-manifests.js`);
      stale = true;
    }
  } else {
    fs.writeFileSync(file, output);
  }
}
if (stale) process.exitCode = 1;
