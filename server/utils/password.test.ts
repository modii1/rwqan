import assert from "node:assert/strict";
import test from "node:test";
import {
  ARGON2ID_HASH_PREFIX,
  detectPasswordFormat,
  hashPassword,
  isArgon2idHash,
  verifyPassword,
} from "./password";

test("detectPasswordFormat classifies missing, plaintext, and hashed values", () => {
  assert.equal(detectPasswordFormat(undefined), "missing");
  assert.equal(detectPasswordFormat(null), "missing");
  assert.equal(detectPasswordFormat(123), "missing");
  assert.equal(detectPasswordFormat(""), "missing");
  assert.equal(detectPasswordFormat("   "), "missing");
  assert.equal(detectPasswordFormat("1234"), "plaintext");
  assert.equal(detectPasswordFormat(`  ${ARGON2ID_HASH_PREFIX}abc `), "hashed");
});

test("isArgon2idHash requires the exact argon2id prefix", () => {
  assert.equal(isArgon2idHash(`${ARGON2ID_HASH_PREFIX}abc`), true);
  assert.equal(isArgon2idHash("$argon2$abc"), false);
  assert.equal(isArgon2idHash("$"), false);
  assert.equal(isArgon2idHash(""), false);
});

test("hashPassword produces an argon2id hash that is not the plaintext", async () => {
  const pin = "4821";
  const digest = await hashPassword(pin);
  assert.equal(isArgon2idHash(digest), true);
  assert.notEqual(digest, pin);
  assert.doesNotMatch(digest, new RegExp(pin));
});

test("hashPassword rejects non-string input", async () => {
  await assert.rejects(() => hashPassword(123 as unknown as string), TypeError);
});

test("verifyPassword round-trips a fresh hash", async () => {
  const pin = "7719";
  const digest = await hashPassword(pin);
  assert.equal(await verifyPassword(digest, pin), true);
  assert.equal(await verifyPassword(digest, "wrong"), false);
});

test("verifyPassword treats legacy plaintext as direct comparison", async () => {
  assert.equal(await verifyPassword("1234", "1234"), true);
  assert.equal(await verifyPassword("1234", "0000"), false);
  assert.equal(await verifyPassword("", "1234"), false);
});

test("verifyPassword tolerates malformed stored hashes without throwing", async () => {
  assert.equal(await verifyPassword("not-a-hash", "anything"), false);
  assert.equal(await verifyPassword(null as unknown as string, "x"), false);
});