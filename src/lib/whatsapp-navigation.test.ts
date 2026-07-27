import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWhatsAppReturnUrl,
  buildWhatsAppUrl,
  closeReservedWhatsAppTab,
  getCleanWhatsAppReturnUrl,
  navigatePropertyWhatsAppTab,
  navigateReservedWhatsAppTab,
  reservePropertyWhatsAppTab,
  reserveWhatsAppTab,
  type ReservedWhatsAppTab,
} from "./whatsapp-navigation";

function createFakeTab(readyState: Document["readyState"] = "complete") {
  const navigations: string[] = [];
  let closeCount = 0;
  const documentWrites: string[] = [];
  const document = {
    readyState,
    open() { return this as unknown as Document; },
    write(...content: string[]) { documentWrites.push(content.join("")); },
    close() {},
  };
  const tab: ReservedWhatsAppTab = {
    closed: false,
    opener: { unsafe: true },
    document,
    location: {
      assign(url: string) {
        navigations.push(url);
      },
      replace(url: string) {
        navigations.push(url);
      },
    },
    close() {
      closeCount += 1;
    },
  };
  return {
    tab,
    document,
    documentWrites,
    navigations,
    get closeCount() { return closeCount; },
  };
}

test("reserves an isolated property return tab instead of a blank/loading page", () => {
  const fake = createFakeTab();
  const calls: Array<[string, string]> = [];
  const reserved = reservePropertyWhatsAppTab("14006", (url, target) => {
    calls.push([url, target]);
    return fake.tab;
  });

  assert.equal(reserved, fake.tab);
  assert.deepEqual(calls, [["/property/14006?contactReturn=1", "_blank"]]);
  assert.equal(fake.tab.opener, null);
  assert.equal(calls[0][0].includes("about:blank"), false);
  assert.equal(calls[0][0].includes("loader"), false);
  assert.equal(buildWhatsAppReturnUrl("14/006"), "/property/14%2F006?contactReturn=1");
  assert.equal(
    getCleanWhatsAppReturnUrl("https://rwqan.sa/property/14006?contactReturn=1"),
    "/property/14006",
  );
  assert.equal(
    getCleanWhatsAppReturnUrl("https://rwqan.sa/property/14006?source=home"),
    null,
  );
});

test("waits for the property history entry before assigning the WhatsApp URL", async () => {
  const fake = createFakeTab("loading");
  const waits: number[] = [];
  let now = 0;
  const url = buildWhatsAppUrl("+966 51 234 5678", "مرحبا\nREQ-123");

  const navigated = await navigatePropertyWhatsAppTab(fake.tab, url, {
    timeoutMs: 100,
    pollIntervalMs: 10,
    now: () => now,
    wait: async (milliseconds) => {
      waits.push(milliseconds);
      now += milliseconds;
      fake.document.readyState = "complete";
    },
  });

  assert.equal(navigated, true);
  assert.deepEqual(waits, [10]);
  assert.deepEqual(fake.navigations, [url]);
  assert.equal(
    url,
    `https://wa.me/966512345678?text=${encodeURIComponent("مرحبا\nREQ-123")}`,
  );
});

test("blocked, closed, and failed tabs never navigate the current property page", async () => {
  assert.equal(reservePropertyWhatsAppTab("14006", () => null), null);
  assert.equal(
    reservePropertyWhatsAppTab("14006", () => {
      throw new Error("popup API unavailable");
    }),
    null,
  );

  const unsafe = createFakeTab();
  Object.defineProperty(unsafe.tab, "opener", {
    configurable: true,
    set() {
      throw new Error("opener cannot be isolated");
    },
  });
  assert.equal(reservePropertyWhatsAppTab("14006", () => unsafe.tab), null);
  assert.equal(unsafe.closeCount, 1);

  const closed = createFakeTab();
  Object.defineProperty(closed.tab, "closed", { value: true });
  assert.equal(await navigatePropertyWhatsAppTab(closed.tab, "https://wa.me/1"), false);

  const failing = createFakeTab();
  failing.tab.location.assign = () => {
    throw new Error("closed by user");
  };
  assert.equal(await navigatePropertyWhatsAppTab(failing.tab, "https://wa.me/1"), false);
  assert.equal(failing.closeCount, 1);

  closeReservedWhatsAppTab(failing.tab);
  assert.equal(failing.closeCount, 2);
});

test("does not cancel a slow property history entry when readiness times out", async () => {
  const slow = createFakeTab("loading");
  let now = 0;
  const navigated = await navigatePropertyWhatsAppTab(
    slow.tab,
    "https://wa.me/966500000000",
    {
      timeoutMs: 20,
      pollIntervalMs: 10,
      now: () => now,
      wait: async (milliseconds) => { now += milliseconds; },
    },
  );

  assert.equal(navigated, false);
  assert.deepEqual(slow.navigations, []);
  assert.equal(slow.closeCount, 1);
});

test("generic admin reservations keep their existing synchronous handoff", () => {
  const fake = createFakeTab();
  const calls: Array<[string, string]> = [];
  const reserved = reserveWhatsAppTab((url, target) => {
    calls.push([url, target]);
    return fake.tab;
  });

  assert.equal(reserved, fake.tab);
  assert.deepEqual(calls, [["about:blank", "_blank"]]);
  assert.match(fake.documentWrites[0], /جارٍ فتح واتساب/);
  assert.equal(navigateReservedWhatsAppTab(fake.tab, "https://wa.me/1"), true);
  assert.deepEqual(fake.navigations, ["https://wa.me/1"]);
});
