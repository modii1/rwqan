const { readdirSync } = require("node:fs");
const { resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = resolve(__dirname, "..");
const ignoredDirectories = new Set([".git", ".next", "backups", "dist", "node_modules"]);

function findTests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name) ? [] : findTests(path);
    }

    return entry.isFile() && entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

const testFiles = findTests(projectRoot).sort();

if (testFiles.length === 0) {
  console.error("No TypeScript test files found.");
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [require.resolve("tsx/cli"), "--test", ...testFiles],
  { cwd: projectRoot, stdio: "inherit" },
);

process.exit(result.status ?? 1);
