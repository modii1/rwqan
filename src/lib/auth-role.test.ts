import assert from "node:assert/strict";
import test from "node:test";
import { ownerLoginRoleHref, parseAuthRole } from "./auth-role";

test("auth role routing accepts the three account types and defaults safely", () => {
  assert.equal(parseAuthRole("customer"), "customer");
  assert.equal(parseAuthRole("owner"), "owner");
  assert.equal(parseAuthRole("admin"), "admin");
  assert.equal(parseAuthRole("unknown"), "owner");
  assert.equal(parseAuthRole(undefined), "owner");
  assert.equal(parseAuthRole(["admin", "customer"]), "admin");
});

test("unified login role links stay on the local owner login page", () => {
  assert.equal(ownerLoginRoleHref("customer"), "/owner/login?mode=customer");
  assert.equal(ownerLoginRoleHref("owner"), "/owner/login?mode=owner");
  assert.equal(ownerLoginRoleHref("admin"), "/owner/login?mode=admin");
  assert.equal(
    ownerLoginRoleHref("owner", "returnTo=%2Fproperty%2F123&favorite=123"),
    "/owner/login?returnTo=%2Fproperty%2F123&favorite=123&mode=owner",
  );
  assert.equal(
    ownerLoginRoleHref("customer", new URLSearchParams("next=%2Fowner%2Fsubscription")),
    "/owner/login?next=%2Fowner%2Fsubscription&mode=customer",
  );
});
