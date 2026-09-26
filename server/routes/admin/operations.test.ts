import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import type {
  AdminOperationMetadata,
} from "../../../shared/adminOperations";
import type {
  AdminOperationMetadataStoreContract,
} from "../../services/AdminOperationMetadataStore";
import { createAdminOperationsRouter } from "./operations";

function metadata(operationId: string): AdminOperationMetadata {
  return {
    operationId,
    state: "open",
    assignee: null,
    createdAt: "2026-09-26T08:00:00.000Z",
    updatedAt: "2026-09-26T08:00:00.000Z",
    resolvedAt: null,
    resolvedBy: null,
    notes: [],
    audit: [],
  };
}

test("operations metadata routes are same-origin, admin-only, and dispatch safe writes", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const store: AdminOperationMetadataStoreContract = {
    list: async () => [metadata("operation-1")],
    update: async (operationId, patch) => {
      calls.push({ method: "update", operationId, patch });
      return {
        ...metadata(operationId),
        assignee: patch.assignee || null,
        state: patch.state || "open",
      };
    },
    addNote: async (operationId, body) => {
      calls.push({ method: "note", operationId, body });
      return {
        ...metadata(operationId),
        notes: [{
          id: "note-1",
          body,
          actor: "admin",
          createdAt: "2026-09-26T08:00:00.000Z",
        }],
      };
    },
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = req.get("x-test-admin") === "1"
      ? { isAdmin: true }
      : {};
    next();
  });
  app.use(createAdminOperationsRouter(store));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}/api/admin/operations`;
    const sameOriginAdminHeaders = {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      "x-test-admin": "1",
    };

    const anonymous = await fetch(`${baseUrl}/metadata`, {
      headers: { "sec-fetch-site": "same-origin" },
    });
    assert.equal(anonymous.status, 401);

    const crossOrigin = await fetch(`${baseUrl}/metadata`, {
      headers: {
        "sec-fetch-site": "cross-site",
        "x-test-admin": "1",
      },
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal(calls.length, 0);

    const listed = await fetch(`${baseUrl}/metadata`, {
      headers: sameOriginAdminHeaders,
    });
    assert.equal(listed.status, 200);
    assert.equal(listed.headers.get("cache-control"), "no-store, private");
    assert.deepEqual(await listed.json(), {
      metadata: [metadata("operation-1")],
    });

    const updated = await fetch(`${baseUrl}/operation%2F1`, {
      method: "PUT",
      headers: sameOriginAdminHeaders,
      body: JSON.stringify({ assignee: "المراجعة المالية", state: "resolved" }),
    });
    assert.equal(updated.status, 200);
    assert.deepEqual(calls[0], {
      method: "update",
      operationId: "operation/1",
      patch: { assignee: "المراجعة المالية", state: "resolved" },
    });

    const note = await fetch(`${baseUrl}/operation-1/notes`, {
      method: "POST",
      headers: sameOriginAdminHeaders,
      body: JSON.stringify({ body: "ملاحظة داخلية" }),
    });
    assert.equal(note.status, 201);
    assert.deepEqual(calls[1], {
      method: "note",
      operationId: "operation-1",
      body: "ملاحظة داخلية",
    });
  } finally {
    server.close();
  }
});
