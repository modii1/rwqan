import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";

import { propertyService, subscriptionService } from "../services";
import propertiesRouter from "./properties";

test("property search combines every filter after entering through a city", async () => {
  const originalGetAll = propertyService.getAll;
  const originalGetSubscription = subscriptionService.getByProperty;
  const properties = [
    {
      propertyNumber: "P-BUR-NORTH-ONE",
      name: "North one",
      city: "بريدة",
      direction: "شمال",
      type: "قسم",
      facilities: ["مسبح", "بدون مسبح"],
      prices: { weekday: "250", weekend: "800", overnight: "450" },
      verificationStatus: "approved",
    },
    {
      propertyNumber: "P-BUR-SOUTH-TWO",
      name: "South two",
      city: "بريدة",
      direction: "جنوب",
      type: "قسمين",
      facilities: ["ملعب", "بدون مسبح", "خيمة شتوية", "إنترنت Wi-Fi"],
      prices: { weekday: "700", weekend: "800", overnight: "" },
      verificationStatus: "approved",
    },
    {
      propertyNumber: "P-BUR-NORTH-TWO",
      name: "North two",
      city: "بريدة",
      direction: "شمال",
      type: "قسمين",
      facilities: ["مسبح", "مبيت"],
      prices: { weekday: "550", weekend: "600", overnight: "700" },
      verificationStatus: "approved",
    },
    {
      propertyNumber: "P-UNA-NORTH-ONE",
      name: "Unaizah one",
      city: "عنيزة",
      direction: "شمال",
      type: "قسم",
      facilities: ["مسبح"],
      prices: { weekday: "200", weekend: "250", overnight: "" },
      verificationStatus: "approved",
    },
    {
      propertyNumber: "P-ASYAH",
      name: "Asyah one",
      city: "الأسياح",
      direction: "شرق",
      type: "قسم",
      facilities: ["بدون مسبح"],
      prices: { weekday: "300", weekend: "400", overnight: "" },
      verificationStatus: "approved",
    },
    {
      propertyNumber: "P-NO-PRICE",
      name: "Missing price",
      city: "\u0627\u0644\u0631\u0633",
      direction: "\u063a\u0631\u0628",
      type: "\u0642\u0633\u0645",
      facilities: [],
      prices: { weekday: "", weekend: "bad", overnight: "" },
      verificationStatus: "approved",
    },
  ];

  (propertyService as any).getAll = async () => properties;
  (subscriptionService as any).getByProperty = async (propertyNumber: string) => ({
    id: `SUB-${propertyNumber}`,
    propertyNumber,
    subscriptionType: "عادي",
    status: "ساري",
    endDate: "2099-12-31T00:00:00.000Z",
  });

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

    const search = async (query: string) => {
      const response = await fetch(`${baseUrl}/api/search?${query}`);
      assert.equal(response.status, 200, query);
      return (await response.json() as Array<{ propertyNumber: string }>).map(
        (property) => property.propertyNumber,
      );
    };

    assert.deepEqual(await search("city=%D8%A8%D8%B1%D9%8A%D8%AF%D8%A9"), [
      "P-BUR-NORTH-ONE",
      "P-BUR-SOUTH-TWO",
      "P-BUR-NORTH-TWO",
    ]);
    assert.deepEqual(
      await search("city=%D8%A8%D8%B1%D9%8A%D8%AF%D8%A9&direction=%D8%B4%D9%85%D8%A7%D9%84"),
      ["P-BUR-NORTH-ONE", "P-BUR-NORTH-TWO"],
    );
    assert.deepEqual(
      await search("city=%D8%A8%D8%B1%D9%8A%D8%AF%D8%A9&search=P-BUR-NORTH-TWO"),
      ["P-BUR-NORTH-TWO"],
    );
    assert.deepEqual(
      await search("city=%D8%A8%D8%B1%D9%8A%D8%AF%D8%A9&facilities=%D9%85%D8%A8%D9%8A%D8%AA"),
      ["P-BUR-NORTH-ONE", "P-BUR-NORTH-TWO"],
    );
    assert.deepEqual(
      await search("city=%D8%A8%D8%B1%D9%8A%D8%AF%D8%A9&facilities=%D9%85%D8%B3%D8%A8%D8%AD"),
      ["P-BUR-NORTH-ONE", "P-BUR-NORTH-TWO"],
    );
    assert.deepEqual(
      await search("city=%D8%A8%D8%B1%D9%8A%D8%AF%D8%A9&facilities=%D8%A8%D8%AF%D9%88%D9%86%20%D9%85%D8%B3%D8%A8%D8%AD"),
      ["P-BUR-SOUTH-TWO"],
    );
    assert.deepEqual(
      await search("city=%D8%A8%D8%B1%D9%8A%D8%AF%D8%A9&facilities=%D9%85%D8%B3%D8%A8%D8%AD,%D8%A8%D8%AF%D9%88%D9%86%20%D9%85%D8%B3%D8%A8%D8%AD"),
      [],
    );
    assert.deepEqual(
      await search("city=%D8%A8%D8%B1%D9%8A%D8%AF%D8%A9&facilities=%D8%B4%D8%AA%D8%A7%D8%A1"),
      ["P-BUR-SOUTH-TWO"],
    );
    assert.deepEqual(
      await search("city=%D8%A8%D8%B1%D9%8A%D8%AF%D8%A9&facilities=%D9%88%D8%A7%D9%8A%20%D9%81%D8%A7%D9%8A"),
      ["P-BUR-SOUTH-TWO"],
    );
    assert.deepEqual(
      await search("city=%D8%A8%D8%B1%D9%8A%D8%AF%D8%A9&maxPrice=500"),
      ["P-BUR-NORTH-ONE"],
    );
    assert.deepEqual(
      await search("city=%D8%A8%D8%B1%D9%8A%D8%AF%D8%A9&type=%D9%82%D8%B3%D9%85%D9%8A%D9%86"),
      ["P-BUR-SOUTH-TWO", "P-BUR-NORTH-TWO"],
    );
    assert.deepEqual(
      await search(
        "city=%D8%A8%D8%B1%D9%8A%D8%AF%D8%A9&direction=%D8%B4%D9%85%D8%A7%D9%84&type=%D9%82%D8%B3%D9%85%D9%8A%D9%86&facilities=%D9%85%D8%B3%D8%A8%D8%AD&maxPrice=650&search=P-BUR-NORTH-TWO",
      ),
      ["P-BUR-NORTH-TWO"],
    );
    assert.deepEqual(await search("city=all&direction=all&type=all"), [
      "P-BUR-NORTH-ONE",
      "P-BUR-SOUTH-TWO",
      "P-BUR-NORTH-TWO",
      "P-UNA-NORTH-ONE",
      "P-ASYAH",
      "P-NO-PRICE",
    ]);
    assert.deepEqual(
      await search("city=%D8%A7%D9%84%D8%A7%D8%B3%D9%8A%D8%A7%D8%AD"),
      ["P-ASYAH"],
    );
    assert.deepEqual(await search("maxPrice=1000"), [
      "P-BUR-NORTH-ONE",
      "P-BUR-SOUTH-TWO",
      "P-BUR-NORTH-TWO",
      "P-UNA-NORTH-ONE",
      "P-ASYAH",
      "P-NO-PRICE",
    ]);
    assert.deepEqual(await search("maxPrice=650"), [
      "P-BUR-NORTH-ONE",
      "P-BUR-NORTH-TWO",
      "P-UNA-NORTH-ONE",
      "P-ASYAH",
    ]);
    assert.deepEqual(await search("maxPrice=-1"), [
      "P-BUR-NORTH-ONE",
      "P-BUR-SOUTH-TWO",
      "P-BUR-NORTH-TWO",
      "P-UNA-NORTH-ONE",
      "P-ASYAH",
      "P-NO-PRICE",
    ]);
    assert.deepEqual(await search("maxPrice=not-a-number"), [
      "P-BUR-NORTH-ONE",
      "P-BUR-SOUTH-TWO",
      "P-BUR-NORTH-TWO",
      "P-UNA-NORTH-ONE",
      "P-ASYAH",
      "P-NO-PRICE",
    ]);
  } finally {
    propertyService.getAll = originalGetAll;
    subscriptionService.getByProperty = originalGetSubscription;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
