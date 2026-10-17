import assert from "node:assert/strict";
import test from "node:test";
import {
  customerLoginHref,
  safeCustomerReturnPath,
  safePendingFavorite,
} from "./customer-login-redirect";

test("customer return paths stay on the Rwqan origin", () => {
  assert.equal(safeCustomerReturnPath("/property/123?photo=2#gallery"), "/property/123?photo=2#gallery");
  assert.equal(safeCustomerReturnPath("https://evil.example"), "/profile");
  assert.equal(safeCustomerReturnPath("//evil.example/path"), "/profile");
  assert.equal(safeCustomerReturnPath("/\\evil.example"), "/profile");
});

test("pending favorite identifiers accept only opaque path-safe property numbers", () => {
  assert.equal(safePendingFavorite("12345"), "12345");
  assert.equal(safePendingFavorite("PROP_12-A"), "PROP_12-A");
  assert.equal(safePendingFavorite("../../admin"), null);
  assert.equal(safePendingFavorite("property/12"), null);
});

test("login href carries a sanitized return path and optional favorite", () => {
  assert.equal(
    customerLoginHref("/property/12345", "12345"),
    "/customer/login?returnTo=%2Fproperty%2F12345&favorite=12345",
  );
});
