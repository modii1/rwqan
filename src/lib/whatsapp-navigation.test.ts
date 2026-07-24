import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWhatsAppUrl,
  closeReservedWhatsAppTab,
  navigateReservedWhatsAppTab,
  reserveWhatsAppTab,
  type ReservedWhatsAppTab,
} from "./whatsapp-navigation";

function createFakeTab() {
  const navigations: string[] = [];
  let closeCount = 0;
  const tab: ReservedWhatsAppTab = {
    closed: false,
    opener: { unsafe: true },
    location: {
      replace(url: string) {
        navigations.push(url);
      },
    },
    close() {
      closeCount += 1;
    },
  };
  return { tab, navigations, get closeCount() { return closeCount; } };
}

test("reserves an isolated blank tab before asynchronous contact work", () => {
  const fake = createFakeTab();
  const calls: Array<[string, string]> = [];
  const reserved = reserveWhatsAppTab((url, target) => {
    calls.push([url, target]);
    return fake.tab;
  });

  assert.equal(reserved, fake.tab);
  assert.deepEqual(calls, [["about:blank", "_blank"]]);
  assert.equal(fake.tab.opener, null);
});

test("navigates only the reserved tab to an encoded universal WhatsApp URL", () => {
  const fake = createFakeTab();
  const url = buildWhatsAppUrl("+966 51 234 5678", "مرحبا\nREQ-123");

  assert.equal(
    url,
    `https://wa.me/966512345678?text=${encodeURIComponent("مرحبا\nREQ-123")}`,
  );
  assert.equal(navigateReservedWhatsAppTab(fake.tab, url), true);
  assert.deepEqual(fake.navigations, [url]);
});

test("blocked, closed, and failed tabs are handled without changing the current page", () => {
  assert.equal(reserveWhatsAppTab(() => null), null);
  assert.equal(
    reserveWhatsAppTab(() => {
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
  assert.equal(reserveWhatsAppTab(() => unsafe.tab), null);
  assert.equal(unsafe.closeCount, 1);

  const closedTab = createFakeTab().tab;
  Object.defineProperty(closedTab, "closed", { value: true });
  assert.equal(navigateReservedWhatsAppTab(closedTab, "https://wa.me/1"), false);

  const failing = createFakeTab();
  failing.tab.location.replace = () => {
    throw new Error("closed by user");
  };
  assert.equal(navigateReservedWhatsAppTab(failing.tab, "https://wa.me/1"), false);
  assert.equal(failing.closeCount, 1);

  closeReservedWhatsAppTab(failing.tab);
  assert.equal(failing.closeCount, 2);
});
