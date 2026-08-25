import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import express from "express";

import { firebaseService } from "../../firebaseService";
import {
  MAX_ACTIVE_SUBSCRIPTION_PACKAGE_DAYS,
  isSubscriptionPackageDurationAllowed,
} from "../../../shared/subscriptionPackagePolicy";
import packagesRouter from "./packages";

test("admin package writes accept 90 active days and reject longer active durations", async () => {
  const originals = {
    createPackage: firebaseService.createPackage,
    updatePackage: firebaseService.updatePackage,
  };
  const creates: any[] = [];
  const updates: Array<{ id: string; updates: any }> = [];

  (firebaseService as any).createPackage = async (pkg: any) => {
    creates.push(pkg);
    return { id: "PKG-90", ...pkg };
  };
  (firebaseService as any).updatePackage = async (id: string, packageUpdates: any) => {
    if (
      !isSubscriptionPackageDurationAllowed(
        packageUpdates.duration ?? packageUpdates.durationDays,
        packageUpdates.isActive !== false,
      )
    ) {
      throw new RangeError(
        `Active subscription package duration cannot exceed ${MAX_ACTIVE_SUBSCRIPTION_PACKAGE_DAYS} days`,
      );
    }
    updates.push({ id, updates: packageUpdates });
    return { id, ...packageUpdates };
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = { isAdmin: true };
    next();
  });
  app.use(packagesRouter);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  const request = (path: string, method: "POST" | "PUT", durationDays: number) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Package",
        durationDays,
        price: 100,
        isActive: true,
      }),
    });

  try {
    const created = await request("/api/admin/packages", "POST", 90);
    assert.equal(created.status, 200);
    assert.equal(creates.length, 1);
    assert.equal(creates[0].duration, 90);
    assert.equal(creates[0].durationDays, 90);

    const rejectedCreate = await request("/api/admin/packages", "POST", 91);
    const rejectedCreateBody = await rejectedCreate.json();
    assert.equal(rejectedCreate.status, 400);
    assert.match(rejectedCreateBody.error, /90/);
    assert.equal(creates.length, 1);

    const updated = await request("/api/admin/packages/PKG-90", "PUT", 90);
    assert.equal(updated.status, 200);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].updates.duration, 90);
    assert.equal(updates[0].updates.durationDays, 90);

    const rejectedUpdate = await request(
      "/api/admin/packages/PKG-90",
      "PUT",
      91,
    );
    const rejectedUpdateBody = await rejectedUpdate.json();
    assert.equal(rejectedUpdate.status, 400);
    assert.match(rejectedUpdateBody.error, /90/);
    assert.equal(updates.length, 1);
  } finally {
    firebaseService.createPackage = originals.createPackage;
    firebaseService.updatePackage = originals.updatePackage;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
