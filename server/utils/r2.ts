/**
 * Cloudflare R2 client configuration — environment-aware.
 *
 * The exported `r2`, `R2_BUCKET`, and `R2_PUBLIC_URL` are LIVE BINDINGS: a
 * single `syncR2Environment()` call (driven by the RWQAN DEPLOY environment
 * toggle) repoints every importer at once between the isolated DEV image store
 * (TEST) and the dedicated production image store (LIVE, from `LIVE_R2_*`).
 *
 * Safety:
 *   - TEST uses the DEV `R2_*` variables only.
 *   - LIVE fails CLOSED: when no safe production image store is configured the
 *     bindings become empty/null so image routes report "unavailable" rather
 *     than reading or writing the wrong bucket.
 */
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { dataEnvironmentStore } from "../services/LiveDataEnvironmentStore";
import { readLiveDataConfig } from "../config/liveDataEnvironment";

const DEFAULT_R2_PUBLIC_URL = "https://pub-e2fc1c0a598f4f0e91e47af63219848e.r2.dev";

function normalizeHttpUrl(value?: string | null): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "/" || trimmed === "#") return "";
  if (!/^https?:\/\//i.test(trimmed)) return "";

  try {
    const parsed = new URL(trimmed);
    if (!parsed.hostname) return "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

// ── DEV image store (computed once from the DEV `R2_*` variables) ───────────

const devEndpoint = normalizeHttpUrl(process.env.R2_ENDPOINT);
const devBucket = process.env.R2_BUCKET_NAME;
const devPublicUrl = normalizeHttpUrl(process.env.R2_PUBLIC_URL) || DEFAULT_R2_PUBLIC_URL;

const devClient =
  process.env.R2_REGION &&
  devEndpoint &&
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY &&
  devBucket
    ? new S3Client({
        region: process.env.R2_REGION,
        endpoint: devEndpoint,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
      })
    : null;

// ── LIVE image store (built lazily from `LIVE_R2_*`) ────────────────────────

let liveClient: S3Client | null = null;
let liveEndpoint = "";

function resolveLiveClient(
  endpoint: string,
  region: string,
  accessKeyId: string,
  secretAccessKey: string,
): S3Client {
  if (!liveClient || liveEndpoint !== endpoint) {
    liveClient = new S3Client({
      region,
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    });
    liveEndpoint = endpoint;
  }
  return liveClient;
}

// ── Active bindings (switched by `syncR2Environment`) ───────────────────────

export let R2_BUCKET: string | undefined = devBucket;
export let R2_PUBLIC_URL: string = devPublicUrl;
export let r2: S3Client | null = devClient;

/**
 * Repoint the exported bindings at the active environment. Called after the
 * environment toggle changes (and once at startup by the caller below).
 */
export function syncR2Environment(): void {
  if (dataEnvironmentStore.get() === "LIVE") {
    const { config } = readLiveDataConfig(process.env);
    if (!config?.r2) {
      R2_BUCKET = undefined;
      R2_PUBLIC_URL = "";
      r2 = null;
      return;
    }
    r2 = resolveLiveClient(
      config.r2.endpoint,
      config.r2.region,
      config.r2.accessKeyId,
      config.r2.secretAccessKey,
    );
    R2_BUCKET = config.r2.bucketName;
    R2_PUBLIC_URL = config.r2.publicUrl;
    return;
  }

  R2_BUCKET = devBucket;
  R2_PUBLIC_URL = devPublicUrl;
  r2 = devClient;
}

// ── Startup diagnostics ─────────────────────────────────────────────────────

const R2_REQUIRED_VARS = [
  "R2_REGION",
  "R2_ENDPOINT",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
] as const;

const invalidR2Vars = [
  process.env.R2_ENDPOINT && !devEndpoint ? "R2_ENDPOINT" : "",
  process.env.R2_PUBLIC_URL && !normalizeHttpUrl(process.env.R2_PUBLIC_URL) ? "R2_PUBLIC_URL" : "",
].filter(Boolean);

const missingR2Vars = R2_REQUIRED_VARS.filter((v) => !process.env[v]);

if (invalidR2Vars.length > 0) {
  console.warn(`[R2] Invalid URL env vars ignored: ${invalidR2Vars.join(", ")}`);
}

if (missingR2Vars.length > 0 || invalidR2Vars.length > 0) {
  console.warn(
    `[R2] Client NOT initialized - missing env vars: ${missingR2Vars.join(", ") || "none"}; invalid env vars: ${invalidR2Vars.join(", ") || "none"}\n` +
    `    Image storage endpoints will remain unavailable until these are set.\n` +
    `    Required env vars:\n` +
    `      R2_REGION           = auto  (or your bucket region)\n` +
    `      R2_ENDPOINT         = https://<ACCOUNT_ID>.r2.cloudflarestorage.com\n` +
    `      R2_ACCESS_KEY_ID    = from Cloudflare R2 → Manage R2 API Tokens\n` +
    `      R2_SECRET_ACCESS_KEY= from Cloudflare R2 → Manage R2 API Tokens\n` +
    `      R2_BUCKET_NAME      = your bucket name (e.g. rwqan-images)\n` +
    `      R2_PUBLIC_URL       = https://pub-XXXX.r2.dev  (optional, has default)`
  );
} else {
  console.log(
    `✅ [R2] Client initialized — bucket: ${R2_BUCKET}, public URL: ${R2_PUBLIC_URL}`
  );
}

export type R2ImageCountClient = {
  send(command: ListObjectsV2Command): Promise<{
    Contents?: Array<{ Key?: string }>;
  }>;
};

export type R2ImageCountDependencies = {
  client: R2ImageCountClient | null;
  bucket: string | undefined;
};

export type R2PropertyImageListDependencies = R2ImageCountDependencies & {
  publicUrl: string | undefined;
};

export class R2ImageStorageUnavailableError extends Error {
  constructor() {
    super("R2 image storage is unavailable");
    this.name = "R2ImageStorageUnavailableError";
  }
}

export async function countR2ImagesStrict(
  propertyNumber: string,
  dependencies: R2ImageCountDependencies = {
    client: r2,
    bucket: R2_BUCKET,
  },
): Promise<number> {
  const { client, bucket } = dependencies;
  if (!client || !bucket) throw new R2ImageStorageUnavailableError();

  try {
    const list = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `${propertyNumber}/`,
        MaxKeys: 200,
      })
    );
    return (list.Contents || []).filter(
      (obj) => obj.Key && /\.(jpg|jpeg|png|webp)$/i.test(obj.Key)
    ).length;
  } catch (error) {
    if (error instanceof R2ImageStorageUnavailableError) throw error;
    throw new R2ImageStorageUnavailableError();
  }
}

export async function countR2Images(propertyNumber: string): Promise<number> {
  try {
    return await countR2ImagesStrict(propertyNumber);
  } catch {
    return 0;
  }
}

export async function listR2PropertyImagesStrict(
  propertyNumber: string,
  dependencies: R2PropertyImageListDependencies = {
    client: r2,
    bucket: R2_BUCKET,
    publicUrl: R2_PUBLIC_URL,
  },
): Promise<string[]> {
  const { client, bucket } = dependencies;
  const publicUrl = normalizeHttpUrl(dependencies.publicUrl);
  if (!client || !bucket || !publicUrl) {
    throw new R2ImageStorageUnavailableError();
  }

  try {
    const list = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `${propertyNumber}/`,
      })
    );
    return (list.Contents || [])
      .filter((obj) => obj.Key && /\.(jpg|jpeg|png|webp)$/i.test(obj.Key))
      .sort((left, right) => {
        const leftIndex = Number.parseInt(left.Key?.match(/(\d+)\./)?.[1] || "0", 10);
        const rightIndex = Number.parseInt(right.Key?.match(/(\d+)\./)?.[1] || "0", 10);
        return leftIndex - rightIndex || (left.Key || "").localeCompare(right.Key || "");
      })
      .map((object) => `${publicUrl}/${object.Key}`);
  } catch (error) {
    if (error instanceof R2ImageStorageUnavailableError) throw error;
    throw new R2ImageStorageUnavailableError();
  }
}

export function assertR2DevIsolation(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (environment.NODE_ENV === "production") return;

  const hasAnyR2Credential =
    Boolean(environment.R2_REGION) ||
    Boolean(environment.R2_ENDPOINT) ||
    Boolean(environment.R2_ACCESS_KEY_ID) ||
    Boolean(environment.R2_SECRET_ACCESS_KEY);

  if (!hasAnyR2Credential) return;

  const bucket = environment.R2_BUCKET_NAME?.trim();
  if (!bucket) {
    throw new Error("R2_BUCKET_NAME is required when R2 credentials are present in development");
  }

  const publicUrl = normalizeHttpUrl(environment.R2_PUBLIC_URL);
  if (!publicUrl) {
    throw new Error("R2_PUBLIC_URL is required when R2 credentials are present in development");
  }

  if (publicUrl === DEFAULT_R2_PUBLIC_URL) {
    throw new Error(
      "R2_PUBLIC_URL must not be the default public URL in development (use a private DEV bucket)"
    );
  }
}
