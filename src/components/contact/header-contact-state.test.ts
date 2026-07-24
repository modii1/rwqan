import assert from "node:assert/strict";
import test from "node:test";
import { deriveHeaderAccountMode } from "./header-contact-state";

test("remembered clients replace the guest header state immediately", () => {
  assert.equal(
    deriveHeaderAccountMode({
      contactIdentityKind: "client",
      contactIdentityPending: false,
      ownerLoggedIn: false,
      adminLoggedIn: false,
    }),
    "client",
  );
});

test("owner and admin identities never render the public client state", () => {
  assert.equal(
    deriveHeaderAccountMode({
      contactIdentityKind: "owner",
      contactIdentityPending: false,
      ownerLoggedIn: false,
      adminLoggedIn: false,
    }),
    "owner",
  );
  assert.equal(
    deriveHeaderAccountMode({
      contactIdentityKind: "admin",
      contactIdentityPending: false,
      ownerLoggedIn: false,
      adminLoggedIn: false,
    }),
    "admin",
  );
  assert.equal(
    deriveHeaderAccountMode({
      contactIdentityKind: "client",
      contactIdentityPending: false,
      ownerLoggedIn: true,
      adminLoggedIn: false,
    }),
    "owner",
  );
  assert.equal(
    deriveHeaderAccountMode({
      contactIdentityKind: "client",
      contactIdentityPending: false,
      ownerLoggedIn: false,
      adminLoggedIn: true,
    }),
    "admin",
  );
});

test("an unresolved identity uses a neutral loading state instead of flashing guest login", () => {
  assert.equal(
    deriveHeaderAccountMode({
      contactIdentityKind: undefined,
      contactIdentityPending: true,
      ownerLoggedIn: false,
      adminLoggedIn: false,
    }),
    "loading",
  );
});

test("a settled missing or forgotten contact identity renders the guest state", () => {
  assert.equal(
    deriveHeaderAccountMode({
      contactIdentityKind: undefined,
      contactIdentityPending: false,
      ownerLoggedIn: false,
      adminLoggedIn: false,
    }),
    "guest",
  );
  assert.equal(
    deriveHeaderAccountMode({
      contactIdentityKind: "none",
      contactIdentityPending: false,
      ownerLoggedIn: false,
      adminLoggedIn: false,
    }),
    "guest",
  );
});

test("known owner and admin sessions take precedence while identity status is loading", () => {
  assert.equal(
    deriveHeaderAccountMode({
      contactIdentityKind: undefined,
      contactIdentityPending: true,
      ownerLoggedIn: true,
      adminLoggedIn: false,
    }),
    "owner",
  );
  assert.equal(
    deriveHeaderAccountMode({
      contactIdentityKind: undefined,
      contactIdentityPending: true,
      ownerLoggedIn: false,
      adminLoggedIn: true,
    }),
    "admin",
  );
  assert.equal(
    deriveHeaderAccountMode({
      contactIdentityKind: undefined,
      contactIdentityPending: true,
      ownerLoggedIn: true,
      adminLoggedIn: true,
    }),
    "owner",
  );
});
