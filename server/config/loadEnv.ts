import { config } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { LIVE_DATA_ACK_KEY } from "./liveDataEnvironment";
import { hydrateLiveServiceAccount } from "./liveServiceAccountSource";

const DEV_LOCAL_ENV_FILE = ".env.development.local";
const BASE_ENV_FILE = ".env";

if (process.env.NODE_ENV !== "production") {
  const devLocalPath = path.join(process.cwd(), DEV_LOCAL_ENV_FILE);
  if (fs.existsSync(devLocalPath)) {
    config({ path: devLocalPath });
  }
}

config({ path: path.join(process.cwd(), BASE_ENV_FILE) });

if (process.env.NODE_ENV !== "production") {
  const liveKeyRequested =
    !!process.env.LIVE_FIREBASE_READONLY_SERVICE_ACCOUNT?.trim() ||
    !!process.env[LIVE_DATA_ACK_KEY]?.trim();
  const resolution = hydrateLiveServiceAccount(process.env);
  if (!resolution.serviceAccountJson && resolution.reason && liveKeyRequested) {
    console.warn(`[env] ${resolution.reason}`);
  }
}