/**
 * DEV-ONLY schema-parity seeder.
 *
 * Creates the production collections that are missing from the DEV project so
 * TEST exercises the same structure as production. Only `parity: "seeded"`
 * collections receive documents; `e2e` collections are handled by
 * scripts/dev/e2e-test-data.ts and `runtime` collections are created on demand
 * by the application.
 *
 * Safety:
 *  - Reuses the same runtime isolation guards as the E2E seed
 *    (NODE_ENV=development, project exactly `rwqan-sa-dev`, R2 exactly
 *    `rwqan-sa-dev`, external services disabled).
 *  - Idempotent: fixed document ids, deterministic content.
 *  - Every document is marked `testData: true` + `schemaParitySeed: true`.
 *  - Never reads or writes production.
 *
 * Usage:
 *   npx tsx scripts/dev/seed-schema-parity.ts            # seed + report
 *   npx tsx scripts/dev/seed-schema-parity.ts --verify   # report only
 *   npx tsx scripts/dev/seed-schema-parity.ts --cleanup  # remove seeded docs
 */
import "../../server/config/loadEnv";
import { db } from "../../server/config/firebase";
import { assertDevTestTarget } from "./e2e-test-data";
import {
  PROD_SCHEMA,
  SEEDED_COLLECTIONS,
  type ProdCollectionSchema,
} from "./prodSchemaCatalog";

function getDb(): FirebaseFirestore.Firestore {
  if (!db) throw new Error("Firestore is not initialized");
  return db;
}

type Firestore = FirebaseFirestore.Firestore;

function seededEntries(): ProdCollectionSchema[] {
  return PROD_SCHEMA.filter(
    (entry) => entry.parity === "seeded" && (entry.sampleDocs?.length ?? 0) > 0,
  );
}

async function listDevCollections(firestore: Firestore): Promise<string[]> {
  const collections = await firestore.listCollections();
  return collections.map((collection) => collection.id).sort();
}

function reportCoverage(devCollections: string[]): { missing: string[]; present: string[] } {
  const expected = PROD_SCHEMA.map((entry) => entry.collection);
  const present: string[] = [];
  const missing: string[] = [];
  for (const name of expected) {
    if (devCollections.includes(name)) present.push(name);
    else missing.push(name);
  }
  return { missing, present };
}

async function seed(firestore: Firestore): Promise<string[]> {
  const written: string[] = [];
  for (const entry of seededEntries()) {
    for (const doc of entry.sampleDocs ?? []) {
      await firestore
        .collection(entry.collection)
        .doc(doc.id)
        .set(
          { ...doc.data, id: doc.data.id ?? doc.id, schemaParitySeed: true, testData: true },
          { merge: true },
        );
      written.push(`${entry.collection}/${doc.id}`);
    }
  }
  return written;
}

async function cleanup(firestore: Firestore): Promise<number> {
  let deleted = 0;
  for (const collection of SEEDED_COLLECTIONS) {
    const snapshot = await firestore
      .collection(collection)
      .where("schemaParitySeed", "==", true)
      .get();
    for (const doc of snapshot.docs) {
      await doc.ref.delete();
      deleted += 1;
    }
  }
  return deleted;
}

async function main(): Promise<void> {
  const mode = process.argv.includes("--cleanup")
    ? "cleanup"
    : process.argv.includes("--verify")
      ? "verify"
      : "seed";

  const target = assertDevTestTarget();
  const firestore = getDb();

  if (mode === "cleanup") {
    const deleted = await cleanup(firestore);
    console.log(`[SCHEMA PARITY] target=${target.projectId} mode=cleanup deleted=${deleted}`);
    return;
  }

  if (mode === "seed") {
    const written = await seed(firestore);
    console.log(`[SCHEMA PARITY] seeded ${written.length} documents: ${written.join(", ")}`);
  }

  const devCollections = await listDevCollections(firestore);
  const { missing, present } = reportCoverage(devCollections);
  console.log(`[SCHEMA PARITY] target=${target.projectId} expected=${PROD_SCHEMA.length} present=${present.length}`);
  console.log(`[SCHEMA PARITY] present: ${present.join(", ")}`);
  console.log(`[SCHEMA PARITY] missing: ${missing.join(", ") || "(none)"}`);
}

await main();
