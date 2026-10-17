/**
 * Paymob DEV genuine-activation test.
 *
 * Unlike paymob-webhook-local-test.ts (which only checks HMAC acceptance and
 * idempotency against isolated payment records), this harness proves the FULL
 * activation path against the real DEV Firebase + R2:
 *   1. seed a complete, approved synthetic property with 3 real R2 images,
 *   2. seed a pending payment linked to a Paymob order/attempt,
 *   3. post a signed callback whose provider order does not match and assert
 *      it is rejected without activation,
 *   4. post an HMAC-signed success webhook and assert exactly one active
 *      subscription is created and the payment is fulfilled,
 *   5. replay the identical callback and assert it stays idempotent,
 *   6. remove every seeded property, subscription, payment and R2 object.
 *
 * It never touches production data, never uses live keys, and never contacts
 * the Paymob API (the signed callback is generated locally from the DEV HMAC
 * secret). Run a DEV server on localhost:5001 first.
 */
import { createHmac } from "node:crypto";

type AnyObj = Record<string, any>;

const BASE =
  process.env.PAYMOB_WEBHOOK_URL || "http://localhost:5001/api/paymob/webhook";

function buildPayload(obj: AnyObj): string {
  const orderId = obj.order?.id ?? obj.order_id;
  const sd = obj.source_data ?? {};
  const values = [
    obj.amount_cents,
    obj.created_at,
    obj.currency,
    obj.error_occured,
    obj.has_parent_transaction,
    obj.id,
    obj.integration_id,
    obj.is_3d_secure,
    obj.is_auth,
    obj.is_capture,
    obj.is_refunded,
    obj.is_standalone_payment,
    obj.is_voided,
    orderId,
    obj.owner,
    obj.pending,
    sd.pan,
    sd.sub_type,
    sd.type,
    obj.success,
  ];
  return values.map((v) => String(v)).join("");
}

function sign(obj: AnyObj, secret: string): string {
  return createHmac("sha512", secret).update(buildPayload(obj)).digest("hex");
}

async function post(obj: AnyObj, sig: string) {
  const res = await fetch(`${BASE}?hmac=${encodeURIComponent(sig)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ obj }),
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* ignore */
  }
  return { status: res.status, body };
}

const ok = (c: boolean) => (c ? "PASS" : "FAIL");

async function main() {
  await import("../../server/config/loadEnv");

  const SECRET = process.env.PAYMOB_HMAC_SECRET || "";
  if (!SECRET) {
    console.log("BLOCKED: PAYMOB_HMAC_SECRET is not set for the running server");
    process.exit(3);
  }

  const adminModule: any = await import("firebase-admin");
  const admin = adminModule.default ?? adminModule;
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT || "";
    if (!raw) {
      console.log("BLOCKED: FIREBASE_SERVICE_ACCOUNT not set");
      process.exit(3);
    }
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  const db = admin.firestore();
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch {
    /* already configured */
  }

  const { PutObjectCommand, DeleteObjectsCommand, S3Client } = await import(
    "@aws-sdk/client-s3"
  );
  const r2 = new S3Client({
    region: process.env.R2_REGION,
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    },
  });
  const BUCKET = process.env.R2_BUCKET_NAME || "";

  const tag = Date.now().toString().slice(-9);
  const PROP = `ACTTEST${tag}`;
  const PAY_ID = `PAY-ACT-${tag}`;
  const ORD = `92${tag}`;
  const INTENT = `INT-ACT-${tag}`;
  const ATTEMPT = `RWQN-ACT-${tag}`;
  const imageKeys = [`${PROP}/1.jpg`, `${PROP}/2.jpg`, `${PROP}/3.jpg`];
  const jpegBytes = Buffer.from(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AJQAB/9k=",
    "base64",
  );

  const cleanup = async () => {
    const subSnap = await db
      .collection("subscriptions")
      .where("propertyNumber", "==", PROP)
      .get()
      .catch(() => null);
    if (subSnap) for (const d of subSnap.docs) await d.ref.delete().catch(() => {});
    await db.collection("payments").doc(PAY_ID).delete().catch(() => {});
    await db.collection("properties").doc(PROP).delete().catch(() => {});
    try {
      await r2.send(
        new DeleteObjectsCommand({
          Bucket: BUCKET,
          Delete: { Objects: imageKeys.map((k) => ({ Key: k })) },
        }),
      );
    } catch {
      /* ignore */
    }
  };

  const results: Array<{
    name: string;
    expected: string;
    actual: string;
    verdict: string;
  }> = [];

  try {
    await db.collection("properties").doc(PROP).set({
      propertyNumber: PROP,
      name: `عقار اختبار التفعيل ${tag}`,
      location: "الرياض",
      city: "الرياض",
      type: "شقة",
      facilities: ["واي فاي"],
      verificationStatus: "approved",
      createdAt: new Date().toISOString(),
    });

    for (const key of imageKeys) {
      await r2.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: jpegBytes,
          ContentType: "image/jpeg",
        }),
      );
    }

    await db.collection("payments").doc(PAY_ID).set({
      id: PAY_ID,
      propertyNumber: PROP,
      action: "new",
      packageId: "E2E_TEST_PKG_1PROP",
      packageName: "activation-local-test",
      amount: 50,
      finalAmount: 50,
      status: "قيد المراجعة",
      paymobOrderId: ORD,
      paymentReference: INTENT,
      transactionId: INTENT,
      merchantAttemptKey: ATTEMPT,
      createdAt: new Date().toISOString(),
    });

    const makeObj = (txnId: string, orderId = ORD): AnyObj => ({
      amount_cents: 5000,
      created_at: "2026-10-13T00:00:00.000000",
      currency: "SAR",
      error_occured: false,
      has_parent_transaction: false,
      id: txnId,
      integration_id: 15494,
      is_3d_secure: true,
      is_auth: false,
      is_capture: false,
      is_refunded: false,
      is_standalone_payment: true,
      is_voided: false,
      order: {
        id: orderId,
        merchant_order_id: ATTEMPT,
        special_reference: ATTEMPT,
        extras: {
          creation_extras: { merchantAttemptKey: ATTEMPT, paymentId: PAY_ID },
        },
      },
      merchant_order_id: ATTEMPT,
      owner: 1,
      pending: false,
      source_data: { pan: "2346", sub_type: "visa", type: "card" },
      success: true,
    });

    // 0) a signed callback whose provider order does not match the reserved
    //    order must be rejected without activating anything.
    const mismatchObj = makeObj(`TX-MIS-${tag}`, `99${tag}`);
    const mismatch = await post(mismatchObj, sign(mismatchObj, SECRET));
    const subSnap0 = await db
      .collection("subscriptions")
      .where("propertyNumber", "==", PROP)
      .get();
    const payAfter0 = (await db.collection("payments").doc(PAY_ID).get()).data() as
      | AnyObj
      | undefined;
    results.push({
      name: "0) Provider-order mismatch is rejected without activation",
      expected: "409 + 0 subscriptions + reserved order unchanged",
      actual: `status=${mismatch.status} body=${mismatch.body?.status ?? mismatch.body?.reason} subs=${subSnap0.size} ord=${payAfter0?.paymobOrderId}`,
      verdict: ok(
        mismatch.status === 409 &&
          subSnap0.size === 0 &&
          String(payAfter0?.paymobOrderId) === String(ORD),
      ),
    });

    const firstObj = makeObj(`TX-ACT-${tag}`);
    const first = await post(firstObj, sign(firstObj, SECRET));
    const subSnap1 = await db
      .collection("subscriptions")
      .where("propertyNumber", "==", PROP)
      .get();
    const payAfter1 = (
      await db.collection("payments").doc(PAY_ID).get()
    ).data() as AnyObj | undefined;
    const activatedOnce =
      first.status === 200 &&
      ["activated", "activation_resumed"].includes(first.body?.status) &&
      subSnap1.size === 1 &&
      (payAfter1?.status === "مكتمل" ||
        payAfter1?.fulfillmentState === "fulfilled");
    results.push({
      name: "1) Genuine verified success activates subscription",
      expected: "200 activated + exactly 1 subscription + payment fulfilled",
      actual: `status=${first.status} body=${first.body?.status} subs=${subSnap1.size} payStatus=${payAfter1?.status} fulfill=${payAfter1?.fulfillmentState}`,
      verdict: ok(activatedOnce),
    });

    const replayObj = makeObj(`TX-ACT-${tag}`);
    const replay = await post(replayObj, sign(replayObj, SECRET));
    const subSnap2 = await db
      .collection("subscriptions")
      .where("propertyNumber", "==", PROP)
      .get();
    const replayOk =
      replay.status === 200 &&
      ["already_processed", "activation_resumed"].includes(replay.body?.status) &&
      subSnap2.size === 1;
    results.push({
      name: "2) Duplicate success replay is idempotent",
      expected:
        "200 already_processed/activation_resumed + still exactly 1 subscription",
      actual: `status=${replay.status} body=${replay.body?.status} subs=${subSnap2.size}`,
      verdict: ok(replayOk),
    });
  } finally {
    await cleanup();
  }

  console.log(
    "\n=== Paymob DEV genuine activation (real Firebase + real R2) ===",
  );
  for (const r of results) {
    console.log(
      `  [${r.verdict}] ${r.name} -> expected ${r.expected}, got ${r.actual}`,
    );
  }
  const allPass = results.every((r) => r.verdict === "PASS");
  console.log(`\nRESULT: ${allPass ? "PASS" : "FAIL"}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error("harness error:", e?.message || e);
  process.exit(2);
});
