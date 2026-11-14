import assert from "node:assert/strict";
import test from "node:test";

import { sendOwnerWhatsApp } from "../integrations/whatsapp";
import {
  getOwnerAccountOtpSender,
  setOwnerAccountOtpSender,
} from "../routes/owner-accounts";
import {
  createOwnerOtpSender,
  installLocalOwnerOtpSink,
} from "./localOwnerOtpSink";

test("LOCAL owner OTP console sink logs the code only when enabled and never calls the provider", async () => {
  const logs: string[] = [];
  const sent: Array<{ phone: string; message: string }> = [];
  const send = async (phone: string, message: string) => {
    sent.push({ phone, message });
    return { success: true };
  };

  const sinkOn = createOwnerOtpSender({
    sinkEnabled: () => true,
    send,
    log: (line) => logs.push(line),
  });
  const sinkResult = await sinkOn("551234567", "رمز التحقق: 123456", 2);
  assert.deepEqual(sinkResult, { success: true });
  assert.equal(sent.length, 0);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^\[DEV OWNER OTP\] to=05••••4567 :: /);
  assert.match(logs[0], /123456/);

  const sinkOff = createOwnerOtpSender({
    sinkEnabled: () => false,
    send,
    log: (line) => logs.push(line),
  });
  const providerResult = await sinkOff("551234567", "رمز التحقق: 654321", 2);
  assert.deepEqual(providerResult, { success: true });
  assert.deepEqual(sent, [
    { phone: "551234567", message: "رمز التحقق: 654321" },
  ]);
  assert.equal(logs.length, 1);
});

test("LOCAL owner OTP console sink installs only when every LOCAL condition holds", () => {
  const env = process.env as Record<string, string | undefined>;
  const originalSender = getOwnerAccountOtpSender();
  const originalNodeEnv = env.NODE_ENV;
  const originalSinkFlag = env.DEV_OWNER_OTP_SINK;
  const originalServiceAccount = env.FIREBASE_SERVICE_ACCOUNT;

  try {
    env.NODE_ENV = "development";
    env.DEV_OWNER_OTP_SINK = "console";
    env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
      project_id: "rwqan-sa-dev",
    });

    installLocalOwnerOtpSink();
    assert.notEqual(getOwnerAccountOtpSender(), sendOwnerWhatsApp);

    setOwnerAccountOtpSender(originalSender);
    env.NODE_ENV = "production";
    installLocalOwnerOtpSink();
    assert.equal(getOwnerAccountOtpSender(), originalSender);

    setOwnerAccountOtpSender(originalSender);
    env.NODE_ENV = "development";
    delete env.DEV_OWNER_OTP_SINK;
    installLocalOwnerOtpSink();
    assert.equal(getOwnerAccountOtpSender(), originalSender);
  } finally {
    setOwnerAccountOtpSender(originalSender);
    if (originalNodeEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = originalNodeEnv;
    if (originalSinkFlag === undefined) delete env.DEV_OWNER_OTP_SINK;
    else env.DEV_OWNER_OTP_SINK = originalSinkFlag;
    if (originalServiceAccount === undefined) delete env.FIREBASE_SERVICE_ACCOUNT;
    else env.FIREBASE_SERVICE_ACCOUNT = originalServiceAccount;
  }
});
