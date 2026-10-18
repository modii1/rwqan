import { createHmac } from "node:crypto";

type AnyObj = Record<string, any>;

const BASE =
  process.env.PAYMOB_WEBHOOK_URL || "http://localhost:5001/api/paymob/webhook";

function buildPayload(obj: AnyObj): string | null {
  const first = (...v: any[]) => v.find((x) => x !== undefined && x !== null);
  const orderId = first(
    obj.order?.id,
    obj.order_id,
    typeof obj.order === "object" ? undefined : obj.order,
  );
  const sourcePan = first(obj.source_data?.pan, obj.source_data_pan, obj["source_data.pan"]);
  const sourceSubType = first(
    obj.source_data?.sub_type,
    obj.source_data_sub_type,
    obj["source_data.sub_type"],
  );
  const sourceType = first(obj.source_data?.type, obj.source_data_type, obj["source_data.type"]);
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
    sourcePan,
    sourceSubType,
    sourceType,
    obj.success,
  ];
  if (values.some((v) => v === undefined || v === null)) return null;
  return values.map((v) => String(v)).join("");
}

function sign(obj: AnyObj, secret: string): string {
  const payload = buildPayload(obj);
  if (!payload) throw new Error("incomplete HMAC payload");
  return createHmac("sha512", secret).update(payload).digest("hex");
}

function makeObj(opts: {
  txnId: string;
  orderId: string;
  amountCents?: number;
  success?: boolean;
  subType?: string;
}): AnyObj {
  return {
    amount_cents: opts.amountCents ?? 5000,
    created_at: "2026-10-13T00:00:00.000000",
    currency: "SAR",
    error_occured: false,
    has_parent_transaction: false,
    id: opts.txnId,
    integration_id: 15494,
    is_3d_secure: true,
    is_auth: false,
    is_capture: false,
    is_refunded: false,
    is_standalone_payment: true,
    is_voided: false,
    order: { id: opts.orderId },
    owner: 1,
    pending: false,
    source_data: { pan: "0000", sub_type: opts.subType ?? "mada", type: "card" },
    success: opts.success ?? true,
  };
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

const ok = (cond: boolean) => (cond ? "PASS" : "FAIL");

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

  const tag = `LOCALTEST${Date.now()}`;
  const PROP = tag.slice(0, 12);
  const payments = db.collection("payments");
  const seeded: string[] = [];
  const results: Array<{
    name: string;
    expected: string;
    actual: string;
    verdict: string;
  }> = [];

  const seed = async (id: string, data: AnyObj) => {
    await payments.doc(id).set({ createdAt: new Date().toISOString(), ...data });
    seeded.push(id);
  };
  const cleanup = async () => {
    for (const id of seeded) {
      try {
        await payments.doc(id).delete();
      } catch {
        /* ignore */
      }
    }
  };

  const P1 = `${tag}-amt`;
  const P2 = `${tag}-rej`;
  const P3 = `${tag}-dup`;
  const ORD1 = "9100001";
  const ORD2 = "9100002";
  const ORD3 = "9100003";
  const ORD4 = "9100004";

  try {
    {
      const obj = makeObj({ txnId: `${tag}-T1`, orderId: ORD1 });
      const r = await post(obj, sign(obj, `${SECRET}-tampered`));
      results.push({
        name: "1) Invalid signature",
        expected: "401",
        actual: `${r.status} ${r.body?.error ?? ""}`.trim(),
        verdict: ok(r.status === 401),
      });
    }
    {
      const obj = makeObj({ txnId: `${tag}-T2`, orderId: ORD1 });
      const r = await post(obj, sign(obj, SECRET));
      results.push({
        name: "2) Valid signature (unknown payment)",
        expected: "404 (signature accepted)",
        actual: `${r.status} ${r.body?.error ?? ""}`.trim(),
        verdict: ok(r.status === 404),
      });
    }
    {
      await seed(P1, {
        id: P1,
        propertyNumber: PROP,
        action: "subscription",
        packageId: "E2E_TEST_PKG_1PROP",
        packageName: "local-test",
        amount: 50,
        finalAmount: 50,
        status: "قيد المراجعة",
        paymobOrderId: ORD2,
        merchantAttemptKey: `${tag}-MK-amt`,
        paymentReference: `${tag}-INT-amt`,
      });
      const obj = makeObj({ txnId: `${tag}-T3`, orderId: ORD2, amountCents: 9900 });
      const r = await post(obj, sign(obj, SECRET));
      results.push({
        name: "3) Amount mismatch",
        expected: "422",
        actual: `${r.status} ${r.body?.error ?? ""}`.trim(),
        verdict: ok(r.status === 422),
      });
    }
    {
      await seed(P2, {
        id: P2,
        propertyNumber: PROP,
        action: "subscription",
        packageId: "E2E_TEST_PKG_1PROP",
        packageName: "local-test",
        amount: 50,
        finalAmount: 50,
        status: "قيد المراجعة",
        paymobOrderId: ORD3,
        merchantAttemptKey: `${tag}-MK-rej`,
        paymentReference: `${tag}-INT-rej`,
      });
      const obj = makeObj({ txnId: `${tag}-T4`, orderId: ORD3, success: false });
      const r = await post(obj, sign(obj, SECRET));
      results.push({
        name: "4) Rejected/declined payment",
        expected: "200 recorded_failure",
        actual: `${r.status} ${r.body?.status ?? ""}`.trim(),
        verdict: ok(r.status === 200 && r.body?.status === "recorded_failure"),
      });
    }
    {
      await seed(P3, {
        id: P3,
        propertyNumber: PROP,
        action: "subscription",
        packageId: "E2E_TEST_PKG_1PROP",
        packageName: "local-test",
        amount: 50,
        finalAmount: 50,
        status: "مكتمل",
        completedAt: new Date().toISOString(),
        fulfilledAt: new Date().toISOString(),
        fulfillmentState: "fulfilled",
        transactionId: `${tag}-TX5`,
        paymobOrderId: ORD4,
        merchantAttemptKey: `${tag}-MK-dup`,
        paymentReference: `${tag}-INT-dup`,
      });
      const obj = makeObj({ txnId: `${tag}-T5`, orderId: ORD4 });
      const r1 = await post(obj, sign(obj, SECRET));
      const r2 = await post(obj, sign(obj, SECRET));
      const good =
        r1.status === 200 &&
        ["already_processed", "ignored_late_success"].includes(r1.body?.status) &&
        r2.status === 200 &&
        ["already_processed", "ignored_late_success"].includes(r2.body?.status);
      results.push({
        name: "5) Duplicate callback (replay x2)",
        expected: "200 already_processed / ignored (no double processing)",
        actual: `#1=${r1.status} ${r1.body?.status}; #2=${r2.status} ${r2.body?.status}`,
        verdict: ok(good),
      });
    }
  } finally {
    await cleanup();
  }

  const subs = await db
    .collection("subscriptions")
    .where("propertyNumber", "==", PROP)
    .get();
  const activationFree = subs.empty;

  console.log(
    "\n=== Paymob DEV webhook local HMAC tests (isolated payments, no activation) ===",
  );
  for (const r of results) {
    console.log(`  [${r.verdict}] ${r.name} -> expected ${r.expected}, got ${r.actual}`);
  }
  console.log(
    `  [${ok(activationFree)}] No subscription activation for synthetic property '${PROP}'`,
  );

  const allPass = results.every((r) => r.verdict === "PASS") && activationFree;
  console.log(`\nRESULT: ${allPass ? "PASS" : "FAIL"}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error("harness error:", e?.message || e);
  process.exit(2);
});
