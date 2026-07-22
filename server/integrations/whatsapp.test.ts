import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import { firebaseService } from "../firebaseService";
import whatsappRouter from "./whatsapp";

test("WhatsApp HTTP routes require same-origin admin access without intercepting unrelated routes", async () => {
  const originalGetRequests = firebaseService.getRequests;
  let requestReads = 0;
  (firebaseService as any).getRequests = async () => {
    requestReads += 1;
    return [{ id: "request-1" }];
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = {
      isAdmin: req.get("x-test-admin") === "yes",
    };
    next();
  });
  app.use("/api/whatsapp", whatsappRouter);
  app.get("/public-after-whatsapp", (_req, res) => res.json({ ok: true }));

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const privilegedRoutes = [
      ["GET", "/api/whatsapp/logs"],
      ["GET", "/api/whatsapp/stats"],
      ["GET", "/api/whatsapp/requests"],
      ["POST", "/api/whatsapp/send"],
      ["POST", "/api/whatsapp/send-admin"],
    ] as const;

    for (const [method, path] of privilegedRoutes) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(method === "POST" ? { body: JSON.stringify({ message: "test", text: "test" }) } : {}),
      });
      assert.equal(response.status, 401, `${method} ${path} must reject a missing admin session`);
    }
    assert.equal(requestReads, 0, "unauthorized requests must not reach Firebase");

    const crossOrigin = await fetch(`${baseUrl}/api/whatsapp/requests`, {
      headers: {
        "x-test-admin": "yes",
        origin: "https://evil.example",
      },
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal(requestReads, 0, "cross-origin requests must not reach Firebase");

    const authorized = await fetch(`${baseUrl}/api/whatsapp/requests`, {
      headers: { "x-test-admin": "yes" },
    });
    assert.equal(authorized.status, 200);
    assert.deepEqual(await authorized.json(), [{ id: "request-1" }]);
    assert.equal(requestReads, 1);

    const publicRoute = await fetch(`${baseUrl}/public-after-whatsapp`);
    assert.equal(publicRoute.status, 200);
    assert.deepEqual(await publicRoute.json(), { ok: true });
  } finally {
    firebaseService.getRequests = originalGetRequests;
    await new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => (error ? reject(error) : resolve()));
    });
  }
});
