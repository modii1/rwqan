import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEnjazatikButtonPayload,
  createEnjazatikButtonSender,
  isValidSaudiMobile,
  normalizeSaudiWhatsAppNumber,
} from "./enjazatikButtons";

test("normalizeSaudiWhatsAppNumber formats local, 966 and 05 prefixes", () => {
  assert.equal(normalizeSaudiWhatsAppNumber("0501234567"), "966501234567");
  assert.equal(normalizeSaudiWhatsAppNumber("501234567"), "966501234567");
  assert.equal(normalizeSaudiWhatsAppNumber("966501234567"), "966501234567");
  assert.equal(
    normalizeSaudiWhatsAppNumber("+966 50 123 4567"),
    "966501234567",
  );
});

test("isValidSaudiMobile accepts Saudi mobile formats only", () => {
  assert.equal(isValidSaudiMobile("0501234567"), true);
  assert.equal(isValidSaudiMobile("966501234567"), true);
  assert.equal(isValidSaudiMobile("501234567"), true);
  assert.equal(isValidSaudiMobile("+966 50 123 4567"), true);
  assert.equal(isValidSaudiMobile("0123456789"), false);
  assert.equal(isValidSaudiMobile("966123456789"), false);
  assert.equal(isValidSaudiMobile("12345"), false);
});

test("buildEnjazatikButtonPayload uses the documented send-template shape", () => {
  const payload = buildEnjazatikButtonPayload({
    to: "0591005515",
    body: "اختبار الأزرار التفاعلية من روقان TEST",
    footer: "رسالة اختبار",
    buttons: [
      { type: "replyButton", title: "تأكيد" },
      {
        type: "urlButton",
        title: "فتح صفحة الاختبار",
        url: "https://rwqan.sa",
      },
      {
        type: "callButton",
        title: "اتصال",
        phoneNumber: "966591005515",
      },
    ],
  });

  assert.equal((payload as any).number, "966591005515");
  assert.equal((payload as any).type, "button-text");
  assert.equal(
    (payload as any).content.text,
    "اختبار الأزرار التفاعلية من روقان TEST",
  );
  assert.equal((payload as any).content.footerText, "رسالة اختبار");
  assert.deepEqual((payload as any).content.buttons, [
    { type: "replyButton", title: "تأكيد" },
    {
      type: "urlButton",
      title: "فتح صفحة الاختبار",
      url: "https://rwqan.sa",
    },
    {
      type: "callButton",
      title: "اتصال",
      phoneNumber: "966591005515",
    },
  ]);
});

test("button sender rejects missing credentials", async () => {
  const sender = createEnjazatikButtonSender({
    url: "",
    token: "",
    request: async () => new Response(),
    delay: async () => undefined,
  });
  const result = await sender({
    to: "0591005515",
    body: "test",
    buttons: [{ type: "replyButton", title: "تأكيد" }],
  });
  assert.equal(result.success, false);
  assert.match(result.error ?? "", /Missing Enjazatik/);
});

test("button sender rejects invalid recipient", async () => {
  const sender = createEnjazatikButtonSender({
    url: "https://business.enjazatik.com/api/v1/send-template",
    token: "secret-token",
    request: async () => new Response(),
    delay: async () => undefined,
  });
  const result = await sender({
    to: "0123456789",
    body: "test",
    buttons: [{ type: "replyButton", title: "تأكيد" }],
  });
  assert.equal(result.success, false);
  assert.match(result.error ?? "", /Invalid recipient/);
});

test("button sender rejects empty or excessive buttons", async () => {
  const sender = createEnjazatikButtonSender({
    url: "https://business.enjazatik.com/api/v1/send-template",
    token: "secret-token",
    request: async () => new Response(),
    delay: async () => undefined,
  });

  const empty = await sender({ to: "0591005515", body: "test", buttons: [] });
  assert.equal(empty.success, false);
  assert.match(empty.error ?? "", /At least one button/);

  const tooMany = await sender({
    to: "0591005515",
    body: "test",
    buttons: Array.from({ length: 4 }, (_, i) => ({
      type: "replyButton" as const,
      title: `B${i}`,
    })),
  });
  assert.equal(tooMany.success, false);
  assert.match(tooMany.error ?? "", /Maximum 3 buttons/);
});

test("button sender includes Bearer token but never exposes it in result", async () => {
  let capturedAuth: string | null = null;
  const sender = createEnjazatikButtonSender({
    url: "https://business.enjazatik.com/api/v1/send-template",
    token: "super-secret-token-12345",
    request: async (_url, init) => {
      const headers = init.headers as Record<string, string>;
      capturedAuth = headers.Authorization;
      return new Response(
        JSON.stringify({ success: true, message_id: "wamid.buttons-1" }),
        { status: 200 },
      );
    },
    delay: async () => undefined,
  });

  const result = await sender({
    to: "0591005515",
    body: "اختبار الأزرار",
    buttons: [{ type: "replyButton", title: "تأكيد" }],
  });

  assert.equal(result.success, true);
  assert.equal(capturedAuth, "Bearer super-secret-token-12345");
  assert.equal((result as any).token, undefined);
  assert.equal(result.providerMessageId, "wamid.buttons-1");
});

test("button sender does not retry by default", async () => {
  let requests = 0;
  const sender = createEnjazatikButtonSender({
    url: "https://business.enjazatik.com/api/v1/send-template",
    token: "token",
    request: async () => {
      requests += 1;
      return new Response(JSON.stringify({ error: "rate limit" }), {
        status: 429,
      });
    },
    delay: async () => {
      throw new Error("delay must not be called when retries=0");
    },
  });

  const result = await sender(
    {
      to: "0591005515",
      body: "test",
      buttons: [{ type: "replyButton", title: "تأكيد" }],
    },
    0,
  );

  assert.equal(result.success, false);
  assert.equal(requests, 1);
});

test("senders handle network failure gracefully", async () => {
  const sender = createEnjazatikButtonSender({
    url: "https://business.enjazatik.com/api/v1/send-template",
    token: "token",
    request: async () => {
      throw new Error("ECONNREFUSED");
    },
    delay: async () => undefined,
  });

  const result = await sender(
    {
      to: "0591005515",
      body: "test",
      buttons: [{ type: "replyButton", title: "تأكيد" }],
    },
    0,
  );

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /ECONNREFUSED/);
});

test("button sender result includes HTTP status and raw response", async () => {
  const sender = createEnjazatikButtonSender({
    url: "https://business.enjazatik.com/api/v1/send-template",
    token: "token",
    request: async () =>
      new Response(JSON.stringify({ status: "sent", id: "msg-123" }), {
        status: 202,
      }),
    delay: async () => undefined,
  });

  const result = await sender({
    to: "0591005515",
    body: "test",
    buttons: [{ type: "replyButton", title: "تأكيد" }],
  });

  assert.equal(result.success, true);
  assert.equal(result.httpStatus, 202);
  assert.equal(result.providerMessageId, "msg-123");
  assert.match(result.rawResponse ?? "", /status/);
});
