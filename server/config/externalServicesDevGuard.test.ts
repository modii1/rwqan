import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDevelopmentIsolation,
  assertFirebaseDevIsolation,
  assertProductionSecurityEnvironment,
  externalServicesEnabled,
} from "./runtimeEnvironment";
import { assertR2DevIsolation } from "../utils/r2";
import { paymobService } from "../integrations/paymob";
import {
  resolveAdminWhatsAppNumber,
  sendOwnerWhatsApp,
  sendWhatsAppNotification,
} from "../integrations/whatsapp";
import { scanReceiptWithAI } from "../integrations/aiReceiptScanner";
import { googleDriveService } from "../integrations/googleDrive";

async function withEnv(
  env: Record<string, string | undefined>,
  fn: () => Promise<void>,
): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    previous[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    for (const key of Object.keys(env)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

function installFetchCounter(): { fetchCalled: boolean; restore: () => void } {
  const counter = { fetchCalled: false, restore: () => {} };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: any, _init?: RequestInit) => {
    counter.fetchCalled = true;
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  counter.restore = () => { globalThis.fetch = originalFetch; };
  return counter;
}

test("A: Paymob intention creation is blocked in DEV before any network attempt", async () => {
  await withEnv(
    { NODE_ENV: "development", PAYMOB_API_KEY: "dev-fake-key" },
    async () => {
      const counter = installFetchCounter();
      try {
        await assert.rejects(
          paymobService.createIntention(
            100,
            "P-1",
            "Prop",
            "0500000000",
            "Pkg",
            30,
          ),
          /disabled in development/,
        );
        assert.equal(counter.fetchCalled, false);
      } finally {
        counter.restore();
      }
    },
  );
});

test("A2: Paymob inquiry/reconciliation is blocked in DEV before any network attempt", async () => {
  await withEnv(
    { NODE_ENV: "development", PAYMOB_LEGACY_API_KEY: "dev-fake-key" },
    async () => {
      const counter = installFetchCounter();
      try {
        await assert.rejects(
          paymobService.inquiryTransaction({ order_id: "ORDER-1" }),
          /disabled in development/,
        );
        assert.equal(counter.fetchCalled, false);
      } finally {
        counter.restore();
      }
    },
  );
});

test("A3: PAYMOB_ALLOW_IN_DEVELOPMENT does not enable WhatsApp, Gemini, or OCR", async () => {
  await withEnv(
    {
      NODE_ENV: "development",
      PAYMOB_ALLOW_IN_DEVELOPMENT: "true",
      META_WHATSAPP_TOKEN: "dev-fake-token",
      GEMINI_API_KEY: "dev-fake-key",
      OCR_API_KEY: "dev-fake-key",
    },
    async () => {
      const counter = installFetchCounter();
      try {
        const whatsapp = await sendWhatsAppNotification("test alert");
        assert.equal(whatsapp.status, "disabled");

        const scanned = await scanReceiptWithAI(
          "http://localhost/receipt.jpg",
          "PAY-A3-1",
        );
        assert.equal(scanned, null);

        assert.equal(counter.fetchCalled, false);

        assert.throws(
          () =>
            assertDevelopmentIsolation({
              NODE_ENV: "development",
              PAYMOB_ALLOW_IN_DEVELOPMENT: "true",
              PAYMOB_API_KEY: "dev-fake-key",
              META_WHATSAPP_TOKEN: "dev-fake-token",
              GEMINI_API_KEY: "dev-fake-key",
              OCR_API_KEY: "dev-fake-key",
            }),
          /META_WHATSAPP_TOKEN/,
        );
      } finally {
        counter.restore();
      }
    },
  );
});

test("A4: DEV Paymob opt-in refuses a production callback before any network attempt", async () => {
  await withEnv(
    {
      NODE_ENV: "development",
      PAYMOB_ALLOW_IN_DEVELOPMENT: "true",
      PAYMOB_API_KEY: "dev-fake-key",
      PAYMOB_DEV_NOTIFICATION_URL: undefined,
      PAYMOB_DEV_REDIRECT_URL: undefined,
    },
    async () => {
      const counter = installFetchCounter();
      try {
        await assert.rejects(
          paymobService.createIntention(
            100,
            "P-1",
            "Prop",
            "0500000000",
            "Pkg",
            30,
          ),
          /Refusing to start a Paymob payment in development/,
        );
        assert.equal(counter.fetchCalled, false);
      } finally {
        counter.restore();
      }
    },
  );
});

test("B: WhatsApp admin notifications are a no-op in DEV without opt-in", async () => {
  await withEnv(
    { NODE_ENV: "development", META_WHATSAPP_TOKEN: "dev-fake-token" },
    async () => {
      const counter = installFetchCounter();
      try {
        const result = await sendWhatsAppNotification("test alert");
        assert.equal(result.status, "disabled");
        assert.equal(counter.fetchCalled, false);
      } finally {
        counter.restore();
      }
    },
  );
});

test("C: Owner WhatsApp (Enjazatik) is a no-op in DEV without opt-in", async () => {
  await withEnv(
    {
      NODE_ENV: "development",
      ENJAZATIK_URL: "https://fake-enjazatik.example",
      ENJAZATIK_TOKEN: "dev-fake-token",
    },
    async () => {
      const counter = installFetchCounter();
      try {
        const result = await sendOwnerWhatsApp("966500000000", "test");
        assert.equal(result.success, false);
        assert.equal(counter.fetchCalled, false);
      } finally {
        counter.restore();
      }
    },
  );
});

test("D: Gemini receipt scanning is blocked in DEV before any network attempt", async () => {
  await withEnv(
    { NODE_ENV: "development", GEMINI_API_KEY: "dev-fake-key" },
    async () => {
      const counter = installFetchCounter();
      try {
        const result = await scanReceiptWithAI(
          "http://localhost/receipt.jpg",
          "PAY-D-1",
        );
        assert.equal(result, null);
        assert.equal(counter.fetchCalled, false);
      } finally {
        counter.restore();
      }
    },
  );
});

test("E: DEV without credentials starts cleanly through every isolation guard", () => {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "development",
    SESSION_SECRET: "local-only-secret",
  };
  assert.doesNotThrow(() => assertProductionSecurityEnvironment(env));
  assert.doesNotThrow(() => assertDevelopmentIsolation(env));
  assert.doesNotThrow(() => assertFirebaseDevIsolation(env));
  assert.doesNotThrow(() => assertR2DevIsolation(env));
});

test("E2: DEV with Firebase and R2 DEV credentials still starts cleanly", () => {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "development",
    FIREBASE_SERVICE_ACCOUNT: JSON.stringify({
      type: "service_account",
      project_id: "rwqan-sa-dev",
      private_key: "not-a-real-key",
    }),
    FIREBASE_DEV_PROJECT_ID: "rwqan-sa-dev",
    R2_REGION: "auto",
    R2_ENDPOINT: "https://fake-dev-account.r2.cloudflarestorage.com",
    R2_ACCESS_KEY_ID: "dev-fake-access-key",
    R2_SECRET_ACCESS_KEY: "dev-fake-secret-key",
    R2_BUCKET_NAME: "rwqan-sa-dev",
    R2_PUBLIC_URL: "https://pub-dev-fake.r2.dev",
  };
  assert.doesNotThrow(() => assertDevelopmentIsolation(env));
  assert.doesNotThrow(() => assertFirebaseDevIsolation(env));
  assert.doesNotThrow(() => assertR2DevIsolation(env));
});

test("F: Production preserves the Paymob provider call", async () => {
  await withEnv(
    { NODE_ENV: "production", PAYMOB_API_KEY: "prod-fake-key" },
    async () => {
      let requestedUrl = "";
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input: any, _init?: RequestInit) => {
        requestedUrl = String(input);
        return new Response(
          JSON.stringify({ id: "INT-1", client_secret: "sec-1" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch;
      try {
        const result = await paymobService.createIntention(
          100,
          "P-1",
          "Prop",
          "0500000000",
          "Pkg",
          30,
        );
        assert.equal(result.intentionId, "INT-1");
        assert.match(requestedUrl, /^https:\/\/ksa\.paymob\.com\//);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});

test("F2: Production preserves the WhatsApp admin send path", async () => {
  await withEnv({ NODE_ENV: "production" }, async () => {
    const counter = installFetchCounter();
    try {
      const result = await sendWhatsAppNotification("prod test");
      assert.equal(result.status, "success");
      assert.equal(counter.fetchCalled, true);
    } finally {
      counter.restore();
    }
  });
});

test("F3: Production bypasses the development isolation switch", () => {
  assert.doesNotThrow(() =>
    assertDevelopmentIsolation({
      NODE_ENV: "production",
      PAYMOB_API_KEY: "prod-fake-key",
      META_WHATSAPP_TOKEN: "prod-fake-token",
      ENJAZATIK_URL: "https://fake",
      ENJAZATIK_TOKEN: "prod-fake-token",
      GEMINI_API_KEY: "prod-fake-key",
    }),
  );
});

test("G: WhatsApp DEV never resolves the hardcoded production fallback number", () => {
  assert.equal(resolveAdminWhatsAppNumber({ NODE_ENV: "development" }), "");
  assert.equal(resolveAdminWhatsAppNumber({ NODE_ENV: "test" }), "");
  assert.equal(resolveAdminWhatsAppNumber({} as NodeJS.ProcessEnv), "");
});

test("G2: explicit numbers win in DEV, and production preserves the fallback", () => {
  assert.equal(
    resolveAdminWhatsAppNumber({
      NODE_ENV: "development",
      ADMIN_WHATSAPP: "966500000000",
    }),
    "966500000000",
  );
  assert.equal(
    resolveAdminWhatsAppNumber({
      NODE_ENV: "development",
      META_NOTIFY_NUMBER: "966500000001",
    }),
    "966500000001",
  );
  assert.equal(
    resolveAdminWhatsAppNumber({ NODE_ENV: "production" }),
    "966533220646",
  );
  assert.equal(
    resolveAdminWhatsAppNumber({
      NODE_ENV: "production",
      ADMIN_WHATSAPP: "966500000002",
    }),
    "966500000002",
  );
});

test("Google Drive without a service account fails locally before any network", async () => {
  await withEnv({ GOOGLE_SERVICE_ACCOUNT_KEY: undefined }, async () => {
    await assert.rejects(
      googleDriveService.createPropertyFolder("P-1", "Prop"),
      /GOOGLE_SERVICE_ACCOUNT_KEY not found/,
    );
  });
});

test("explicit Paymob opt-in allows Paymob in DEV (gate semantics, stubbed fetch)", async () => {
  await withEnv(
    {
      NODE_ENV: "development",
      PAYMOB_ALLOW_IN_DEVELOPMENT: "true",
      PAYMOB_API_KEY: "dev-fake-key",
      PAYMOB_DEV_NOTIFICATION_URL:
        "https://dev-tunnel.example.test/api/paymob/webhook",
      PAYMOB_DEV_REDIRECT_URL:
        "https://dev-tunnel.example.test/api/paymob/webhook",
    },
    async () => {
      let requestedUrl = "";
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input: any, _init?: RequestInit) => {
        requestedUrl = String(input);
        return new Response(
          JSON.stringify({ id: "INT-1", client_secret: "sec-1" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch;
      try {
        assert.equal(
          externalServicesEnabled({
            NODE_ENV: "development",
            ALLOW_EXTERNAL_SERVICES_IN_DEVELOPMENT: "true",
          }),
          true,
        );
        const result = await paymobService.createIntention(
          100,
          "P-1",
          "Prop",
          "0500000000",
          "Pkg",
          30,
        );
        assert.equal(result.intentionId, "INT-1");
        assert.match(requestedUrl, /^https:\/\/ksa\.paymob\.com\//);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});