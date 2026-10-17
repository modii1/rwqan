import assert from "node:assert/strict";
import test from "node:test";
import type { Request } from "express";
import { isSameOriginRequest } from "./requestOrigin";

function requestWith(
  headers: Record<string, string> = {},
  protocol = "https",
): Request {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    protocol,
    get(name: string) {
      return normalizedHeaders[name.toLowerCase()];
    },
  } as Request;
}

test("same-origin validation accepts direct and non-browser requests", () => {
  assert.equal(isSameOriginRequest(requestWith()), true);
  assert.equal(
    isSameOriginRequest(requestWith({ host: "rwqan.example", origin: "https://rwqan.example" })),
    true,
  );
});

test("browser same-origin metadata survives a managed proxy with an internal Host", () => {
  assert.equal(
    isSameOriginRequest(requestWith({
      host: "internal-service.local",
      origin: "https://rwqan.example",
      "sec-fetch-site": "same-origin",
    }, "http")),
    true,
  );
});

test("same-origin validation rejects explicit cross-site and malformed origins", () => {
  assert.equal(
    isSameOriginRequest(requestWith({ host: "rwqan.example", origin: "https://evil.example" })),
    false,
  );
  assert.equal(
    isSameOriginRequest(requestWith({ host: "rwqan.example", origin: "not-an-origin" })),
    false,
  );
  assert.equal(
    isSameOriginRequest(requestWith({
      host: "rwqan.example",
      origin: "https://rwqan.example",
      "sec-fetch-site": "cross-site",
    })),
    false,
  );
});

test("forwarded host cannot authorize an attacker-controlled origin", () => {
  assert.equal(
    isSameOriginRequest(requestWith({
      host: "rwqan.example",
      origin: "https://evil.example",
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "https",
    })),
    false,
  );
});

test("same-site metadata alone does not authorize an unconfigured origin", () => {
  assert.equal(
    isSameOriginRequest(requestWith({
      host: "rwqan.example",
      origin: "https://sibling.example",
      "sec-fetch-site": "same-site",
    })),
    false,
  );
});

test("configured canonical origin supports a proxy with an internal Host", () => {
  const previousBaseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  process.env.NEXT_PUBLIC_BASE_URL = "https://rwqan.example/app";
  try {
    assert.equal(
      isSameOriginRequest(requestWith({
        host: "internal-service.local",
        origin: "https://rwqan.example",
      }, "http")),
      true,
    );
  } finally {
    if (previousBaseUrl === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
    else process.env.NEXT_PUBLIC_BASE_URL = previousBaseUrl;
  }
});
