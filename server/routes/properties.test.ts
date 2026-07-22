import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import propertiesRouter from "./properties";
import { propertyService, notificationService } from "../services";
import { googleDriveService } from "../integrations/googleDrive";

test("legacy property mutations require same-origin admin access", async (t) => {
  const originals = {
    getByNumber: propertyService.getByNumber,
    create: propertyService.create,
    update: propertyService.update,
    delete: propertyService.delete,
    createPropertyFolder: googleDriveService.createPropertyFolder,
    newProperty: notificationService.newProperty,
    propertyUpdated: notificationService.propertyUpdated,
  };

  const calls = {
    getByNumber: 0,
    create: 0,
    update: 0,
    delete: 0,
    createPropertyFolder: 0,
  };

  (propertyService as any).getByNumber = async () => {
    calls.getByNumber += 1;
    return null;
  };
  (propertyService as any).create = async (data: any) => {
    calls.create += 1;
    return { ...data, id: "created-property" };
  };
  (propertyService as any).update = async (propertyNumber: string, data: any) => {
    calls.update += 1;
    return { propertyNumber, name: data.name || "Updated property" };
  };
  (propertyService as any).delete = async () => {
    calls.delete += 1;
  };
  (googleDriveService as any).createPropertyFolder = async () => {
    calls.createPropertyFolder += 1;
    return "drive-folder";
  };
  (notificationService as any).newProperty = async () => undefined;
  (notificationService as any).propertyUpdated = async () => undefined;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = {
      isAdmin: req.get("x-test-admin") === "yes",
      propertyNumber: req.get("x-test-owner") || undefined,
    };
    next();
  });
  app.use(propertiesRouter);
  app.post("/api/properties/register", (_req, res) => {
    res.status(201).json({ publicRegistration: true });
  });
  app.put("/api/owner/property", (_req, res) => {
    res.json({ ownerUpdate: true });
  });

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  const mutationRequests: Array<{
    method: "POST" | "PUT" | "DELETE";
    path: string;
    body?: Record<string, string>;
  }> = [
    {
      method: "POST",
      path: "/api/properties",
      body: { propertyNumber: "P-1", name: "Test", whatsappNumber: "0500000000" },
    },
    { method: "PUT", path: "/api/properties/P-1", body: { name: "Updated" } },
    { method: "DELETE", path: "/api/properties/P-1" },
  ];

  try {
    await t.test("anonymous and owner-only sessions cannot mutate properties", async () => {
      const sessionHeaders: Array<Record<string, string>> = [
        {},
        { "x-test-owner": "P-1" },
      ];
      for (const headers of sessionHeaders) {
        for (const request of mutationRequests) {
          const response = await fetch(`${baseUrl}${request.path}`, {
            method: request.method,
            headers: { "content-type": "application/json", ...headers },
            body: request.body ? JSON.stringify(request.body) : undefined,
          });
          assert.equal(response.status, 401, `${request.method} ${request.path}`);
          assert.deepEqual(await response.json(), { error: "Admin Login Required" });
        }
      }
      assert.deepEqual(calls, {
        getByNumber: 0,
        create: 0,
        update: 0,
        delete: 0,
        createPropertyFolder: 0,
      });
    });

    await t.test("cross-origin admin requests cannot mutate properties", async () => {
      for (const request of mutationRequests) {
        const response = await fetch(`${baseUrl}${request.path}`, {
          method: request.method,
          headers: {
            "content-type": "application/json",
            "x-test-admin": "yes",
            origin: "https://evil.example",
          },
          body: request.body ? JSON.stringify(request.body) : undefined,
        });
        assert.equal(response.status, 403, `${request.method} ${request.path}`);
        assert.equal((await response.json()).code, "CROSS_ORIGIN_REQUEST");
      }
      assert.deepEqual(calls, {
        getByNumber: 0,
        create: 0,
        update: 0,
        delete: 0,
        createPropertyFolder: 0,
      });
    });

    await t.test("same-origin admins retain create, update, and delete access", async () => {
      for (const request of mutationRequests) {
        const response = await fetch(`${baseUrl}${request.path}`, {
          method: request.method,
          headers: {
            "content-type": "application/json",
            "x-test-admin": "yes",
            origin: baseUrl,
          },
          body: request.body ? JSON.stringify(request.body) : undefined,
        });
        assert.equal(response.status, 200, `${request.method} ${request.path}`);
      }
      assert.deepEqual(calls, {
        getByNumber: 1,
        create: 1,
        update: 1,
        delete: 1,
        createPropertyFolder: 1,
      });
    });

    await t.test("dedicated public-registration and owner routes remain reachable", async () => {
      const registration = await fetch(`${baseUrl}/api/properties/register`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: "{}",
      });
      assert.equal(registration.status, 201);
      assert.deepEqual(await registration.json(), { publicRegistration: true });

      const ownerUpdate = await fetch(`${baseUrl}/api/owner/property`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-test-owner": "P-1",
          origin: baseUrl,
        },
        body: "{}",
      });
      assert.equal(ownerUpdate.status, 200);
      assert.deepEqual(await ownerUpdate.json(), { ownerUpdate: true });
    });
  } finally {
    (propertyService as any).getByNumber = originals.getByNumber;
    (propertyService as any).create = originals.create;
    (propertyService as any).update = originals.update;
    (propertyService as any).delete = originals.delete;
    (googleDriveService as any).createPropertyFolder = originals.createPropertyFolder;
    (notificationService as any).newProperty = originals.newProperty;
    (notificationService as any).propertyUpdated = originals.propertyUpdated;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
