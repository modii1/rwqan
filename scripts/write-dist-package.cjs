const { mkdirSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");

const distDirectory = resolve(process.cwd(), "dist");

mkdirSync(distDirectory, { recursive: true });
writeFileSync(
  resolve(distDirectory, "package.json"),
  `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
  "utf8",
);
