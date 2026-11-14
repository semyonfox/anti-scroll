const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

function run(args) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
for (const directory of ["src", "popup", "scripts"]) {
  for (const file of fs.readdirSync(directory).filter((file) => file.endsWith(".js"))) {
    run(["--check", `${directory}/${file}`]);
  }
}
run(["scripts/generate-manifests.js", "--check"]);
for (const file of fs.readdirSync("scripts").filter((file) => file.endsWith("-test.js"))) {
  run([`scripts/${file}`]);
}
