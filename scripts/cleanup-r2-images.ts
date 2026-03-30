import 'dotenv/config';
import { S3Client, ListObjectsV2Command, ListObjectsV2CommandOutput, DeleteObjectsCommand, ObjectIdentifier } from '@aws-sdk/client-s3';
import admin from 'firebase-admin';

// ─── Configuration ────────────────────────────────────────────────────────────────

const MAX_IMAGES_PER_PROPERTY = 15;
const BATCH_SIZE = 400;
const R2_DELETE_BATCH_SIZE = 100;

const R2_REGION = process.env.R2_REGION || 'auto';
const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://pub-e2fc1c0a598f4f0e91e47af63219848e.r2.dev';

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');

// ─── Initialize Clients ──────────────────────────────────────────────────────────

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

const r2 = new S3Client({
  region: R2_REGION,
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID!,
    secretAccessKey: R2_SECRET_ACCESS_KEY!,
  },
});

console.log('\n✅ Clients initialized');
console.log(`   R2 Bucket: ${R2_BUCKET_NAME}`);
console.log(`   R2 Public URL: ${R2_PUBLIC_URL}`);

// ─── Types ────────────────────────────────────────────────────────────────────────

interface R2Object {
  Key: string;
  LastModified: Date;
  Size: number;
}

interface FolderResult {
  folderName: string;
  totalImages: number;
  deletedImages: R2Object[];
  keptImages: R2Object[];
  firestoreUpdated: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(date: Date): string {
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, 'Z');
}

function buildR2Url(key: string): string {
  return `${R2_PUBLIC_URL}/${key}`;
}

function isR2Url(url: string): boolean {
  return url.startsWith(R2_PUBLIC_URL) || url.includes('.r2.');
}

function getFileKeyFromUrl(url: string): string | null {
  if (url.startsWith(R2_PUBLIC_URL + '/')) {
    return url.replace(R2_PUBLIC_URL + '/', '');
  }
  const urlObj = new URL(url);
  return urlObj.pathname.replace(/^\//, '');
}

// ─── R2 Operations ───────────────────────────────────────────────────────────────

async function listTopLevelFolders(): Promise<string[]> {
  const command = new ListObjectsV2Command({
    Bucket: R2_BUCKET_NAME,
    Delimiter: '/',
  });

  const response = await r2.send(command);
  const prefixes = response.CommonPrefixes?.map(cp => 
    cp.Prefix?.replace('/', '').replace('/', '')
  ).filter(Boolean) as string[] | undefined;

  return prefixes || [];
}

async function listObjectsInFolder(folderName: string): Promise<R2Object[]> {
  const objects: R2Object[] = [];
  let continuationToken: string | undefined;

  do {
    const command = new ListObjectsV2Command({
      Bucket: R2_BUCKET_NAME,
      Prefix: `${folderName}/`,
      ContinuationToken: continuationToken,
    });

    const response: ListObjectsV2CommandOutput = await r2.send(command);
    
    if (response.Contents) {
      for (const obj of response.Contents) {
        if (obj.Key && obj.LastModified !== undefined) {
          objects.push({
            Key: obj.Key,
            LastModified: obj.LastModified,
            Size: obj.Size || 0,
          });
        }
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return objects;
}

async function deleteObjectsFromR2(objects: R2Object[]): Promise<void> {
  for (let i = 0; i < objects.length; i += R2_DELETE_BATCH_SIZE) {
    const batch = objects.slice(i, i + R2_DELETE_BATCH_SIZE);
    
    const deleteObjects: ObjectIdentifier[] = batch.map(obj => ({
      Key: obj.Key,
    }));

    const command = new DeleteObjectsCommand({
      Bucket: R2_BUCKET_NAME,
      Delete: {
        Objects: deleteObjects,
        Quiet: true,
      },
    });

    await r2.send(command);
  }
}

// ─── Firestore Operations ────────────────────────────────────────────────────────

async function updateFirestoreImageUrls(propertyNumber: string, deletedImages: R2Object[]): Promise<boolean> {
  if (deletedImages.length === 0) return true;

  const deletedUrls = new Set(
    deletedImages.map(img => buildR2Url(img.Key))
  );

  try {
    const propertyRef = db.collection('properties').doc(propertyNumber);
    const propertyDoc = await propertyRef.get();

    if (!propertyDoc.exists) {
      console.log(`   ⚠️  No Firestore document found for property ${propertyNumber}`);
      return false;
    }

    const propertyData = propertyDoc.data();
    if (!propertyData) return false;

    const fieldsToCheck = ['imageUrls', 'images', 'imagesLink'];
    const updates: Record<string, any> = {};
    let hasUpdates = false;

    for (const field of fieldsToCheck) {
      const fieldValue = propertyData[field];
      
      if (!fieldValue) continue;

      if (Array.isArray(fieldValue)) {
        const filtered = fieldValue.filter((url: string) => {
          if (!isR2Url(url)) return true;
          return !deletedUrls.has(url);
        });
        
        if (filtered.length !== fieldValue.length) {
          updates[field] = filtered;
          hasUpdates = true;
        }
      } else if (typeof fieldValue === 'string') {
        if (isR2Url(fieldValue) && deletedUrls.has(fieldValue)) {
          updates[field] = admin.firestore.FieldValue.delete();
          hasUpdates = true;
        }
      }
    }

    if (hasUpdates) {
      await propertyRef.update(updates);
      return true;
    }

    return true;
  } catch (error) {
    console.error(`   ❌ Error updating Firestore for ${propertyNumber}:`, error);
    return false;
  }
}

// ─── Main Processing ─────────────────────────────────────────────────────────────

async function processFolder(folderName: string): Promise<FolderResult> {
  console.log(`\n📁 Folder: ${folderName}`);

  const objects = await listObjectsInFolder(folderName);
  const images = objects.filter(obj => {
    const ext = obj.Key.toLowerCase().split('.').pop();
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext || '');
  });

  console.log(`   📷 Found ${images.length} images`);

  if (images.length <= MAX_IMAGES_PER_PROPERTY) {
    console.log(`   ℹ️  Within limit (${MAX_IMAGES_PER_PROPERTY}), no action needed`);
    return {
      folderName,
      totalImages: images.length,
      deletedImages: [],
      keptImages: images,
      firestoreUpdated: false,
    };
  }

  images.sort((a, b) => {
    const dateA = a.LastModified.getTime();
    const dateB = b.LastModified.getTime();
    return dateA - dateB;
  });

  const keptImages = images.slice(-MAX_IMAGES_PER_PROPERTY);
  const deletedImages = images.slice(0, -MAX_IMAGES_PER_PROPERTY);

  console.log(`   🗑️  Deleting ${deletedImages.length} oldest images:`);
  for (const img of deletedImages) {
    console.log(`       - ${img.Key} | ${formatDate(img.LastModified)} | ${formatBytes(img.Size)}`);
  }
  console.log(`   ✅ Keeping ${keptImages.length} newest images`);

  console.log(`   🔄 Deleting from R2...`);
  await deleteObjectsFromR2(deletedImages);
  console.log(`   ✅ R2 deletion complete`);

  console.log(`   🔄 Updating Firestore...`);
  const firestoreUpdated = await updateFirestoreImageUrls(folderName, deletedImages);
  
  if (firestoreUpdated) {
    console.log(`   ✅ Firestore updated`);
  }

  return {
    folderName,
    totalImages: images.length,
    deletedImages,
    keptImages,
    firestoreUpdated,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=======================================');
  console.log('🧹 R2 Image Cleanup Script');
  console.log(`   Max images per property: ${MAX_IMAGES_PER_PROPERTY}`);
  console.log('=======================================\n');

  const folders = await listTopLevelFolders();
  
  const propertyFolders = folders.filter(folder => /^\d+$/.test(folder));
  
  console.log(`📂 Found ${folders.length} top-level folders`);
  console.log(`📂 Filtered to ${propertyFolders.length} property folders (numeric only)`);

  const results: FolderResult[] = [];
  let totalImagesDeleted = 0;
  let firestoreUpdatedCount = 0;

  for (const folder of propertyFolders) {
    try {
      const result = await processFolder(folder);
      results.push(result);
      totalImagesDeleted += result.deletedImages.length;
      if (result.firestoreUpdated && result.deletedImages.length > 0) {
        firestoreUpdatedCount++;
      }
    } catch (error) {
      console.error(`\n❌ Error processing folder ${folder}:`, error);
      continue;
    }
  }

  console.log('\n=======================================');
  console.log('📊 Summary:');
  console.log(`   Folders processed: ${results.length}`);
  console.log(`   Folders with excess images: ${results.filter(r => r.deletedImages.length > 0).length}`);
  console.log(`   Total images deleted: ${totalImagesDeleted}`);
  console.log(`   Firestore documents updated: ${firestoreUpdatedCount}`);
  console.log('=======================================\n');

  console.log('✅ Cleanup complete!');
  process.exit(0);
}

main().catch((error) => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
