import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

import {
  arePropertySearchQueryKeysEqual,
  buildPropertySearchQueryKey,
  buildPropertySearchQueryString,
  normalizePropertyFacilityFilters,
  normalizePropertyFilterChoice,
  parseStoredPropertyFilters,
} from "./property-search";

const cityFilters = {
  searchQuery: "",
  selectedCity: "بريدة",
  selectedDirection: "",
  selectedType: "",
  selectedFacilities: [] as string[],
  maxPrice: 1_000,
  maxPriceCeiling: 1_000,
};

test("city initial data is seeded only for the exact initial filter key", () => {
  const initialKey = buildPropertySearchQueryKey(cityFilters);
  const searchedKey = buildPropertySearchQueryKey({
    ...cityFilters,
    searchQuery: "14006",
  });
  const filteredKey = buildPropertySearchQueryKey({
    ...cityFilters,
    selectedDirection: "شمال",
  });

  assert.equal(arePropertySearchQueryKeysEqual(initialKey, initialKey), true);
  assert.equal(arePropertySearchQueryKeysEqual(initialKey, searchedKey), false);
  assert.equal(arePropertySearchQueryKeysEqual(initialKey, filteredKey), false);
});

test("query strings combine city, search, type, facilities, direction, and price", () => {
  const query = buildPropertySearchQueryString({
    searchQuery: " 14006 ",
    selectedCity: "بريدة",
    selectedDirection: "شمال",
    selectedType: "قسمين",
    selectedFacilities: ["مسبح", "مبيت", "مسبح"],
    maxPrice: 650,
    maxPriceCeiling: 1_000,
  });
  const params = new URLSearchParams(query);

  assert.deepEqual(Object.fromEntries(params), {
    search: "14006",
    city: "بريدة",
    direction: "شمال",
    type: "قسمين",
    facilities: "مبيت,مسبح",
    maxPrice: "650",
  });
});

test("All selections and the slider ceiling do not create active filters", () => {
  assert.equal(normalizePropertyFilterChoice("all"), "");
  assert.equal(normalizePropertyFilterChoice(null), "");
  assert.equal(
    buildPropertySearchQueryString({
      ...cityFilters,
      selectedCity: "all",
      selectedDirection: "all",
      selectedType: "all",
    }),
    "",
  );
});

test("normalizes duplicate and legacy facility URL/session values", () => {
  assert.deepEqual(
    normalizePropertyFacilityFilters([" مسبح ", "مسبح", "all", "", null]),
    ["مسبح"],
  );
  assert.deepEqual(normalizePropertyFacilityFilters("مسبح"), []);
});

test("saved filters are safely parsed and normalized", () => {
  const pool = "\u0645\u0633\u0628\u062d";
  const north = "\u0634\u0645\u0627\u0644";
  assert.equal(parseStoredPropertyFilters("{broken"), null);
  assert.equal(parseStoredPropertyFilters(JSON.stringify([])), null);
  assert.deepEqual(
    parseStoredPropertyFilters(JSON.stringify({
      searchQuery: "14006",
      selectedCity: " all ",
      selectedDirection: north,
      selectedFacilities: [pool, ` ${pool} `, "all"],
      maxPrice: 600,
      visibleCount: 42.8,
      occasionFilter: " summer ",
      selectedDay: 7,
    })),
    {
      searchQuery: "14006",
      selectedCity: "",
      selectedDirection: north,
      selectedType: "",
      selectedFacilities: [pool],
      maxPrice: 600,
      visibleCount: 42,
      occasionFilter: "summer",
      selectedDay: "",
    },
  );
});

test("changing filters after seeded city results executes a new query", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: 5 * 60 * 1000, retry: false } },
  });
  const initialKey = buildPropertySearchQueryKey(cityFilters);
  let calls = 0;
  const queryFn = async () => {
    calls += 1;
    return [`response-${calls}`];
  };
  let availableInitialData: string[] | undefined = ["seeded-city-results"];
  const optionsFor = (key: ReturnType<typeof buildPropertySearchQueryKey>) => ({
    queryKey: key,
    queryFn,
    initialData: () => {
      if (!arePropertySearchQueryKeysEqual(key, initialKey)) return undefined;
      const initialData = availableInitialData;
      availableInitialData = undefined;
      return initialData;
    },
  });
  const observer = new QueryObserver(client, optionsFor(initialKey));
  const unsubscribe = observer.subscribe(() => undefined);

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 0);
  assert.deepEqual(observer.getCurrentResult().data, ["seeded-city-results"]);

  const directionKey = buildPropertySearchQueryKey({
    ...cityFilters,
    selectedDirection: "شمال",
  });
  observer.setOptions(optionsFor(directionKey));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 1);
  assert.deepEqual(observer.getCurrentResult().data, ["response-1"]);

  const searchKey = buildPropertySearchQueryKey({
    ...cityFilters,
    searchQuery: "14006",
  });
  observer.setOptions(optionsFor(searchKey));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 2);
  assert.deepEqual(observer.getCurrentResult().data, ["response-2"]);

  client.removeQueries({ queryKey: initialKey, exact: true });
  observer.setOptions(optionsFor(initialKey));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 3);
  assert.deepEqual(observer.getCurrentResult().data, ["response-3"]);

  unsubscribe();
  client.clear();
});
