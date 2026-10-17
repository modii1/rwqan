import { config } from "dotenv";
import fs from "node:fs";
import path from "node:path";

const DEV_LOCAL_ENV_FILE = ".env.development.local";
const BASE_ENV_FILE = ".env";

if (process.env.NODE_ENV !== "production") {
  const devLocalPath = path.join(process.cwd(), DEV_LOCAL_ENV_FILE);
  if (fs.existsSync(devLocalPath)) {
    config({ path: devLocalPath });
  }
}

config({ path: path.join(process.cwd(), BASE_ENV_FILE) });