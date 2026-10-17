const { spawn } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");
const { createConnection, createServer } = require("node:net");
const { resolve } = require("node:path");
const { parse } = require("dotenv");

const STARTUP_TIMEOUT_MS = 30_000;
const EXTERNAL_SERVICE_VARIABLES = [
  "DATABASE_URL",
  "FIREBASE_DATABASE_URL",
  "FIREBASE_SERVICE_ACCOUNT",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "R2_ACCESS_KEY_ID",
  "R2_BUCKET_NAME",
  "R2_ENDPOINT",
  "R2_REGION",
  "R2_SECRET_ACCESS_KEY",
];

function reserveLocalPort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error("Could not reserve a local port"));
        else resolvePort(port);
      });
    });
  });
}

function waitForPort(child, port, getOutput) {
  return new Promise((resolveReady, reject) => {
    const startedAt = Date.now();
    let settled = false;
    let interval;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearInterval(interval);
      child.off("exit", handleExit);
      if (error) reject(error);
      else resolveReady();
    };
    const handleExit = (code, signal) => {
      finish(
        new Error(
          `Built server exited before listening (code=${code}, signal=${signal}).\n${getOutput()}`,
        ),
      );
    };
    const probe = () => {
      if (Date.now() - startedAt > STARTUP_TIMEOUT_MS) {
        finish(
          new Error(
            `Built server did not listen within ${STARTUP_TIMEOUT_MS}ms.\n${getOutput()}`,
          ),
        );
        return;
      }

      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        finish();
      });
      socket.once("error", () => socket.destroy());
    };

    child.once("exit", handleExit);
    interval = setInterval(probe, 100);
    probe();
  });
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await new Promise((resolveExit) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolveExit();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolveExit();
    });
  });
}

async function main() {
  const requestedPort = process.env.SMOKE_PORT
    ? Number(process.env.SMOKE_PORT)
    : undefined;
  if (
    requestedPort !== undefined &&
    (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65_535)
  ) {
    throw new Error("SMOKE_PORT must be an integer between 1 and 65535");
  }
  const port = requestedPort ?? (await reserveLocalPort());
  const env = { ...process.env };
  for (const filename of [".env", ".env.local"]) {
    if (!existsSync(filename)) continue;
    for (const variable of Object.keys(parse(readFileSync(filename)))) {
      env[variable] = "";
    }
  }
  for (const variable of EXTERNAL_SERVICE_VARIABLES) env[variable] = "";
  Object.assign(env, {
    ADMIN_CODE: "startup-smoke-admin",
    ADMIN_PASSWORD: "startup-smoke-password",
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_ENV: "production",
    PAYMOB_HMAC_SECRET: "startup-smoke-paymob-hmac-secret",
    PORT: String(port),
    SESSION_SECRET: "startup-smoke-session-secret",
  });

  const child = spawn(process.execPath, [resolve("dist/server/index.js")], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  const collect = (chunk) => {
    output = `${output}${chunk.toString("utf8")}`.slice(-20_000);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);

  try {
    await waitForPort(child, port, () => output);
    process.stdout.write(`Built server listened successfully on port ${port}.\n`);
  } finally {
    await stopChild(child);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
});
