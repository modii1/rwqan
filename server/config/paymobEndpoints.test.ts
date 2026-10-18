import assert from "node:assert/strict";
import test from "node:test";

import {
  assertDevPaymobEndpointsAreIsolated,
  DEV_PAYMOB_NOTIFICATION_URL_KEY,
  DEV_PAYMOB_REDIRECT_URL_KEY,
  isProductionPaymobUrl,
  PRODUCTION_PAYMOB_NOTIFICATION_URL,
  PRODUCTION_PAYMOB_REDIRECT_URL,
  resolvePaymobEndpoints,
} from "./paymobEndpoints";

const DEV_CALLBACK = "https://dev-tunnel.example.test/api/paymob/webhook";

function isolatedEnv(
  extra: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "development",
    [DEV_PAYMOB_NOTIFICATION_URL_KEY]: DEV_CALLBACK,
    [DEV_PAYMOB_REDIRECT_URL_KEY]: DEV_CALLBACK,
    ...extra,
  } as unknown as NodeJS.ProcessEnv;
}

test("production always resolves to the canonical rwqan.sa endpoints", () => {
  const endpoints = resolvePaymobEndpoints({
    NODE_ENV: "production",
    [DEV_PAYMOB_NOTIFICATION_URL_KEY]: DEV_CALLBACK,
    [DEV_PAYMOB_REDIRECT_URL_KEY]: DEV_CALLBACK,
  } as NodeJS.ProcessEnv);
  assert.equal(endpoints.notificationUrl, PRODUCTION_PAYMOB_NOTIFICATION_URL);
  assert.equal(endpoints.redirectUrl, PRODUCTION_PAYMOB_REDIRECT_URL);
});

test("production ignores invalid overrides and never fails", () => {
  assert.doesNotThrow(() =>
    assertDevPaymobEndpointsAreIsolated({
      NODE_ENV: "production",
      [DEV_PAYMOB_NOTIFICATION_URL_KEY]: "not a url",
      [DEV_PAYMOB_REDIRECT_URL_KEY]: "http://rwqan.sa/insecure",
    } as NodeJS.ProcessEnv)
  );
  const endpoints = resolvePaymobEndpoints({
    NODE_ENV: "production",
    [DEV_PAYMOB_NOTIFICATION_URL_KEY]: "not a url",
  } as NodeJS.ProcessEnv);
  assert.equal(endpoints.notificationUrl, PRODUCTION_PAYMOB_NOTIFICATION_URL);
  assert.equal(endpoints.redirectUrl, PRODUCTION_PAYMOB_REDIRECT_URL);
});

test("development resolves explicit callback overrides", () => {
  const endpoints = resolvePaymobEndpoints(isolatedEnv());
  assert.equal(endpoints.notificationUrl, DEV_CALLBACK);
  assert.equal(endpoints.redirectUrl, DEV_CALLBACK);
});

test("development without overrides refuses to resolve (no production fallback)", () => {
  assert.throws(
    () => resolvePaymobEndpoints({ NODE_ENV: "development" } as NodeJS.ProcessEnv),
    /Refusing to start a Paymob payment in development/,
  );
});

test("development refuses to start a payment without isolated endpoints", () => {
  assert.throws(
    () => assertDevPaymobEndpointsAreIsolated({
      NODE_ENV: "development",
    } as NodeJS.ProcessEnv),
    /Refusing to start a Paymob payment in development/,
  );
});

test("development allows an isolated non-production callback endpoint", () => {
  assert.doesNotThrow(() => assertDevPaymobEndpointsAreIsolated(isolatedEnv()));
});

test("development rejects a non-HTTPS callback endpoint", () => {
  assert.throws(
    () => assertDevPaymobEndpointsAreIsolated(
      isolatedEnv({
        [DEV_PAYMOB_NOTIFICATION_URL_KEY]: "http://dev-tunnel.example.test/hook",
      }),
    ),
    /must use HTTPS/,
  );
});

test("development rejects an invalid callback endpoint", () => {
  assert.throws(
    () => assertDevPaymobEndpointsAreIsolated(
      isolatedEnv({
        [DEV_PAYMOB_REDIRECT_URL_KEY]: "not a url",
      }),
    ),
    /is not a valid absolute URL/,
  );
});

test("development rejects a production callback endpoint", () => {
  assert.throws(
    () => assertDevPaymobEndpointsAreIsolated(
      isolatedEnv({
        [DEV_PAYMOB_NOTIFICATION_URL_KEY]: "https://rwqan.sa/api/paymob/webhook",
      }),
    ),
    /must not point at a production address/,
  );
  assert.throws(
    () => assertDevPaymobEndpointsAreIsolated(
      isolatedEnv({
        [DEV_PAYMOB_REDIRECT_URL_KEY]: "https://pay.rwqan.sa/api/paymob/webhook",
      }),
    ),
    /must not point at a production address/,
  );
});

test("a missing NODE_ENV is treated as non-production and blocked", () => {
  assert.throws(
    () => assertDevPaymobEndpointsAreIsolated({} as unknown as NodeJS.ProcessEnv),
    /Refusing to start a Paymob payment in development/,
  );
});

test("an unexpected NODE_ENV is blocked rather than allowed", () => {
  assert.throws(
    () => assertDevPaymobEndpointsAreIsolated({
      NODE_ENV: "staging",
    } as unknown as NodeJS.ProcessEnv),
    /Refusing to start a Paymob payment in development/,
  );
  assert.throws(
    () => assertDevPaymobEndpointsAreIsolated({
      NODE_ENV: "test",
    } as NodeJS.ProcessEnv),
    /Refusing to start a Paymob payment in development/,
  );
});

test("the isolation guard is a no-op only in production", () => {
  assert.doesNotThrow(() =>
    assertDevPaymobEndpointsAreIsolated({
      NODE_ENV: "production",
    } as NodeJS.ProcessEnv)
  );
});

test("production URL detection covers the domain and its subdomains", () => {
  assert.equal(isProductionPaymobUrl("https://rwqan.sa/api/paymob/webhook"), true);
  assert.equal(isProductionPaymobUrl("https://www.rwqan.sa/api/paymob/webhook"), true);
  assert.equal(isProductionPaymobUrl("https://pay.rwqan.sa/x"), true);
  assert.equal(isProductionPaymobUrl("http://localhost:5001/api/paymob/webhook"), false);
  assert.equal(isProductionPaymobUrl(DEV_CALLBACK), false);
  assert.equal(isProductionPaymobUrl(""), false);
  assert.equal(isProductionPaymobUrl("not a url"), false);
  assert.equal(isProductionPaymobUrl(undefined), false);
});
