import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";

import { propertyService, subscriptionService } from "../services";
import propertiesRouter from "./properties";

test("only active, unexpired premium properties expose or match their name", async () => {
  const originalGetAll = propertyService.getAll;
  const originalGetByNumber = propertyService.getByNumber;
  const originalGetSubscription = subscriptionService.getByProperty;

  const properties = [
    {
      propertyNumber: "ACTIVE-1",
      name: "Visible Premium Name",
      city: "بريدة",
      verificationStatus: "approved",
      prices: { weekday: "100", weekend: "120" },
    },
    {
      propertyNumber: "EXPIRED-STATUS",
      name: "Hidden Expired Status Name",
      city: "بريدة",
      verificationStatus: "approved",
      prices: { weekday: "80", weekend: "90" },
    },
    {
      propertyNumber: "PAST-END",
      name: "Hidden Past End Name",
      city: "بريدة",
      verificationStatus: "approved",
      prices: { weekday: "80", weekend: "90" },
    },
    {
      propertyNumber: "ORDINARY-1",
      name: "Hidden Ordinary Name",
      city: "بريدة",
      verificationStatus: "approved",
      prices: { weekday: "70", weekend: "75" },
    },
    {
      propertyNumber: "HELD-1",
      name: "Held Premium Name",
      city: "بريدة",
      verificationStatus: "approved",
      commissionHold: { active: true, obligationIds: ["BOOK-HELD-1"] },
      prices: { weekday: "90", weekend: "100" },
    },
  ];

  (propertyService as any).getAll = async () => properties;
  (propertyService as any).getByNumber = async (propertyNumber: string) =>
    properties.find((property) => property.propertyNumber === propertyNumber) ||
    null;
  (subscriptionService as any).getByProperty = async (
    propertyNumber: string,
  ) => {
    const isExpiredStatus = propertyNumber === "EXPIRED-STATUS";
    const hasPastEnd = propertyNumber === "PAST-END";
    const isOrdinary = propertyNumber === "ORDINARY-1";
    return {
      id: `SUB-${propertyNumber}`,
      propertyNumber,
      packageId: isOrdinary ? "ordinary" : "premium",
      startDate: "2026-07-01T00:00:00.000Z",
      endDate: hasPastEnd
        ? "2026-07-10T00:00:00.000Z"
        : "2099-12-31T00:00:00.000Z",
      status: isExpiredStatus ? "منتهي" : "ساري",
      subscriptionType: isOrdinary ? "عادي" : "مميز",
    };
  };

  const app = express();
  app.use(propertiesRouter);
  const server = app.listen(0, "127.0.0.1");

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    const listResponse = await fetch(`${baseUrl}/api/properties`);
    const list = await listResponse.json();
    assert.equal(listResponse.status, 200);
    assert.equal(
      list.find((property: any) => property.propertyNumber === "ACTIVE-1")
        ?.name,
      "Visible Premium Name",
    );
    for (const propertyNumber of [
      "EXPIRED-STATUS",
      "PAST-END",
      "ORDINARY-1",
    ]) {
      const hidden = list.find(
        (property: any) => property.propertyNumber === propertyNumber,
      );
      assert.equal(hidden?.name, "", propertyNumber);
      assert.equal(hidden?.isPremiumActive, false, propertyNumber);
    }
    assert.equal(
      list.find((property: any) => property.propertyNumber === "EXPIRED-STATUS")
        ?.isSubscriptionExpired,
      true,
    );
    assert.equal(
      list.find((property: any) => property.propertyNumber === "PAST-END")
        ?.isSubscriptionExpired,
      true,
    );
    assert.equal(
      list.some((property: any) => property.propertyNumber === "HELD-1"),
      false,
      "a held property must be removed before its private hold marker is stripped",
    );

    const heldDetailResponse = await fetch(`${baseUrl}/api/properties/HELD-1`);
    assert.equal(heldDetailResponse.status, 423);

    const heldSearchResponse = await fetch(
      `${baseUrl}/api/search?search=${encodeURIComponent("Held Premium Name")}`,
    );
    assert.equal(heldSearchResponse.status, 200);
    assert.deepEqual(await heldSearchResponse.json(), []);

    const detailResponse = await fetch(
      `${baseUrl}/api/properties/EXPIRED-STATUS`,
    );
    assert.equal(detailResponse.status, 200);
    assert.equal((await detailResponse.json()).name, "");

    for (const hiddenName of [
      "Hidden Expired Status Name",
      "Hidden Past End Name",
      "Hidden Ordinary Name",
    ]) {
      const nameSearchResponse = await fetch(
        `${baseUrl}/api/search?search=${encodeURIComponent(hiddenName)}`,
      );
      assert.equal(nameSearchResponse.status, 200, hiddenName);
      assert.deepEqual(await nameSearchResponse.json(), [], hiddenName);
    }

    const premiumNameSearchResponse = await fetch(
      `${baseUrl}/api/search?search=${encodeURIComponent("Visible Premium Name")}`,
    );
    const premiumNameResults = await premiumNameSearchResponse.json();
    assert.equal(premiumNameSearchResponse.status, 200);
    assert.equal(premiumNameResults.length, 1);
    assert.equal(premiumNameResults[0].propertyNumber, "ACTIVE-1");
    assert.equal(premiumNameResults[0].name, "Visible Premium Name");

    const numberSearchResponse = await fetch(
      `${baseUrl}/api/search?search=EXPIRED-STATUS`,
    );
    const numberResults = await numberSearchResponse.json();
    assert.equal(numberSearchResponse.status, 200);
    assert.equal(numberResults.length, 1);
    assert.equal(numberResults[0].propertyNumber, "EXPIRED-STATUS");
    assert.equal(numberResults[0].name, "");
  } finally {
    propertyService.getAll = originalGetAll;
    propertyService.getByNumber = originalGetByNumber;
    subscriptionService.getByProperty = originalGetSubscription;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
