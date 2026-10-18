import assert from "node:assert/strict";
import test from "node:test";
import {
  getOwnerLoginUrl,
  getSafeOwnerLoginDestination,
} from "./owner-login-redirect";

test("owner login preserves the subscription upgrade destination", () => {
  assert.equal(
    getOwnerLoginUrl("/owner/subscription"),
    "/owner/login?next=%2Fowner%2Fsubscription",
  );
  assert.equal(
    getSafeOwnerLoginDestination("?next=%2Fowner%2Fsubscription"),
    "/owner/subscription",
  );
  assert.equal(
    getOwnerLoginUrl("/owner/requests"),
    "/owner/login?next=%2Fowner%2Frequests",
  );
  assert.equal(
    getSafeOwnerLoginDestination("?next=%2Fowner%2Frequests"),
    "/owner/requests",
  );
});

test("owner login rejects unapproved and external destinations", () => {
  assert.equal(getSafeOwnerLoginDestination(""), "/owner/dashboard");
  assert.equal(
    getSafeOwnerLoginDestination("?next=https%3A%2F%2Fevil.example"),
    "/owner/dashboard",
  );
  assert.equal(getOwnerLoginUrl("//evil.example"), "/owner/login");
});
