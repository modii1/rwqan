import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {
  LIVE_FIREBASE_PROJECT_ID_KEY,
  LIVE_FIREBASE_SERVICE_ACCOUNT_KEY,
} from "./liveDataEnvironment";
import {
  LIVE_SERVICE_ACCOUNT_DIR_KEY,
  hydrateLiveServiceAccount,
  resolveLiveServiceAccount,
} from "./liveServiceAccountSource";
import type { LiveServiceAccountSourceDeps } from "./liveServiceAccountSource";

const KEY = LIVE_FIREBASE_SERVICE_ACCOUNT_KEY;
const PROJECT_KEY = LIVE_FIREBASE_PROJECT_ID_KEY;
const HOME = path.join("C:", "Users", "tester");
const DOWNLOADS = path.join(HOME, "Downloads");

function env(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return { NODE_ENV: "development", ...overrides } as NodeJS.ProcessEnv;
}

function serviceAccount(projectId: string): string {
  return JSON.stringify({
    type: "service_account",
    project_id: projectId,
    private_key: "SUPER-SECRET-PRIVATE-KEY",
  });
}

function memFs(
  files: Record<string, string>,
  homedir: string = HOME,
): LiveServiceAccountSourceDeps {
  const map = new Map<string, string>(
    Object.entries(files).map(([filePath, body]) => [path.normalize(filePath), body]),
  );
  return {
    homedir: () => homedir,
    existsSync: (filePath) => map.has(path.normalize(filePath)),
    readFileSync: (filePath) => {
      const body = map.get(path.normalize(filePath));
      if (body === undefined) throw new Error("ENOENT");
      return body;
    },
    readdirSync: (dirPath) => {
      const prefix = path.normalize(dirPath) + path.sep;
      const names = new Set<string>();
      for (const filePath of map.keys()) {
        if (filePath.startsWith(prefix)) {
          names.add(filePath.slice(prefix.length).split(path.sep)[0]);
        }
      }
      return [...names];
    },
  };
}

test("an inline service-account JSON is passed through untouched", () => {
  const inline = serviceAccount("rwqan-757");
  const resolution = resolveLiveServiceAccount(env({ [KEY]: inline }), memFs({}));
  assert.equal(resolution.serviceAccountJson, inline);
  assert.equal(resolution.resolvedPath, null);
  assert.equal(resolution.reason, "");
});

test("an absolute key path is read directly", () => {
  const filePath = path.join(DOWNLOADS, "key.json");
  const resolution = resolveLiveServiceAccount(
    env({ [KEY]: filePath, [PROJECT_KEY]: "rwqan-757" }),
    memFs({ [filePath]: serviceAccount("rwqan-757") }),
  );
  assert.ok(resolution.serviceAccountJson);
  assert.equal(resolution.resolvedPath, filePath);
  assert.equal(resolution.reason, "");
});

test("a bare filename is resolved inside the current user's Downloads", () => {
  const filePath = path.join(DOWNLOADS, "rwqan-757-key.json");
  const resolution = resolveLiveServiceAccount(
    env({ [KEY]: "rwqan-757-key.json" }),
    memFs({ [filePath]: serviceAccount("rwqan-757") }),
  );
  assert.ok(resolution.serviceAccountJson);
  assert.equal(resolution.resolvedPath, filePath);
});

test("a bare filename resolves against the configured key directory", () => {
  const dir = path.join("D:", "keys");
  const filePath = path.join(dir, "rwqan-757.json");
  const resolution = resolveLiveServiceAccount(
    env({ [KEY]: "rwqan-757.json", [LIVE_SERVICE_ACCOUNT_DIR_KEY]: dir }),
    memFs({ [filePath]: serviceAccount("rwqan-757") }),
  );
  assert.ok(resolution.serviceAccountJson);
  assert.equal(resolution.resolvedPath, filePath);
});

test("a missing named key fails closed and names the required path", () => {
  const filePath = path.join(DOWNLOADS, "nope.json");
  const resolution = resolveLiveServiceAccount(env({ [KEY]: "nope.json" }), memFs({}));
  assert.equal(resolution.serviceAccountJson, null);
  assert.equal(resolution.resolvedPath, filePath);
  assert.ok(resolution.reason.includes(filePath));
  assert.ok(!resolution.reason.includes("SUPER-SECRET-PRIVATE-KEY"));
});

test("an empty value discovers a single matching key in Downloads", () => {
  const filePath = path.join(DOWNLOADS, "only.json");
  const resolution = resolveLiveServiceAccount(
    env({ [PROJECT_KEY]: "rwqan-757" }),
    memFs({
      [filePath]: serviceAccount("rwqan-757"),
      [path.join(DOWNLOADS, "other.json")]: serviceAccount("some-other-project"),
      [path.join(DOWNLOADS, "notes.txt")]: "{}",
    }),
  );
  assert.ok(resolution.serviceAccountJson);
  assert.equal(resolution.resolvedPath, filePath);
});

test("several candidate keys fail closed and list them without guessing", () => {
  const first = path.join(DOWNLOADS, "a.json");
  const second = path.join(DOWNLOADS, "b.json");
  const resolution = resolveLiveServiceAccount(
    env({ [PROJECT_KEY]: "rwqan-757" }),
    memFs({
      [first]: serviceAccount("rwqan-757"),
      [second]: serviceAccount("rwqan-757"),
    }),
  );
  assert.equal(resolution.serviceAccountJson, null);
  assert.ok(resolution.reason.includes("a.json"));
  assert.ok(resolution.reason.includes("b.json"));
  assert.ok(!resolution.reason.includes("SUPER-SECRET-PRIVATE-KEY"));
});

test("no candidate key fails closed with the searched folder", () => {
  const resolution = resolveLiveServiceAccount(
    env({ [PROJECT_KEY]: "rwqan-757" }),
    memFs({ [path.join(DOWNLOADS, "other.json")]: serviceAccount("another") }),
  );
  assert.equal(resolution.serviceAccountJson, null);
  assert.ok(resolution.reason.includes(DOWNLOADS));
});

test("a missing Downloads folder fails closed with the expected path", () => {
  const resolution = resolveLiveServiceAccount(env({ [PROJECT_KEY]: "rwqan-757" }), memFs({}));
  assert.equal(resolution.serviceAccountJson, null);
  assert.ok(resolution.reason.includes(DOWNLOADS));
});

test("hydration replaces the path with the resolved JSON in the environment", () => {
  const filePath = path.join(DOWNLOADS, "rwqan-757.json");
  const environment = env({ [KEY]: filePath, [PROJECT_KEY]: "rwqan-757" });
  const resolution = hydrateLiveServiceAccount(
    environment,
    memFs({ [filePath]: serviceAccount("rwqan-757") }),
  );
  assert.ok(resolution.serviceAccountJson);
  assert.equal(environment[KEY], resolution.serviceAccountJson);
  assert.ok(environment[KEY]!.startsWith("{"));
});
