/**
 * Cloudflare R2 client configuration
 */
import { S3Client } from "@aws-sdk/client-s3";

export const R2_BUCKET = process.env.R2_BUCKET_NAME;
export const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || "https://pub-e2fc1c0a598f4f0e91e47af63219848e.r2.dev";

// ── Startup diagnostics ─────────────────────────────────────────────────────
const R2_REQUIRED_VARS = [
  "R2_REGION",
  "R2_ENDPOINT",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
] as const;

const missingR2Vars = R2_REQUIRED_VARS.filter((v) => !process.env[v]);

if (missingR2Vars.length > 0) {
  console.warn(
    `⚠️  [R2] Client NOT initialized — missing env vars: ${missingR2Vars.join(", ")}\n` +
    `    Image endpoints will return empty arrays until these are set.\n` +
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

export const r2 = process.env.R2_REGION && process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY
  ? new S3Client({
    region: process.env.R2_REGION,
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  })
  : null;

import { ListObjectsV2Command } from "@aws-sdk/client-s3";

export async function countR2Images(propertyNumber: string): Promise<number> {
  if (!r2 || !R2_BUCKET) return 0;
  try {
    const list = await r2.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: `${propertyNumber}/`,
        MaxKeys: 200,
      })
    );
    return (list.Contents || []).filter(
      (obj) => obj.Key && /\.(jpg|jpeg|png|webp|gif)$/i.test(obj.Key)
    ).length;
  } catch {
    return 0;
  }
}
