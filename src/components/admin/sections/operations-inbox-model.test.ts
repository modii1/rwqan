import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildOperationsInbox,
  countOperationsByCategory,
  mergeOperationsMetadata,
} from "./operations-inbox-model";

test("aggregates actionable records without duplicating additional-property verification", () => {
  const items = buildOperationsInbox({
    properties: [
      {
        propertyNumber: "P-1",
        name: "العقار الأول",
        verificationStatus: "pending",
        pendingApprovalFrom: "P-0",
      },
      {
        propertyNumber: "P-2",
        name: "العقار الثاني",
        verificationStatus: "pending",
      },
    ],
    additionalProperties: {
      pendingRequests: [{
        propertyNumber: "P-1",
        name: "العقار الأول",
        mainPropertyName: "العقار الرئيسي",
        requestedAt: "2026-09-20T10:00:00.000Z",
      }],
    },
    bookingDashboard: {
      bookings: [{
        id: "B-1",
        propertyNumber: "P-2",
        propertyName: "العقار الثاني",
        commissionStatus: "overdue",
        disputeStatus: "pending",
        notificationJobs: [{
          id: "J-1",
          status: "failed",
          recipientRole: "customer",
          failedAt: "2026-09-21T10:00:00.000Z",
        }],
        paymentAttempt: {
          id: "A-1",
          paymentMethod: "bank_transfer",
          status: "pending_review",
          receiptUrl: "https://example.test/receipt",
        },
      }],
    },
  });

  const counts = countOperationsByCategory(items);
  assert.equal(counts.property_approval, 2);
  assert.equal(counts.whatsapp_failure, 1);
  assert.equal(counts.bank_receipt, 1);
  assert.equal(counts.dispute, 1);
  assert.equal(counts.overdue_commission, 1);
  assert.equal(items.filter((item) => item.id.includes("P-1")).length, 1);
});

test("includes both subscription and commission receipts and ignores reviewed receipts", () => {
  const items = buildOperationsInbox({
    payments: [{
      id: "PAY-1",
      propertyNumber: "P-1",
      paymentMethod: "bank_transfer",
      status: "pending",
      receiptUrl: "https://example.test/subscription-receipt",
    }],
    bookingDashboard: {
      bookings: [{
        id: "B-1",
        propertyNumber: "P-1",
        paymentAttempts: [
          {
            id: "A-1",
            paymentMethod: "bank_transfer",
            status: "pending_review",
            receiptUrl: "https://example.test/commission-receipt",
          },
          {
            id: "A-2",
            paymentMethod: "bank_transfer",
            status: "pending_review",
            receiptUrl: "https://example.test/reviewed-receipt",
            bankReviewDecision: "approved",
          },
          {
            id: "A-3",
            paymentMethod: "bank_transfer",
            status: "review_required",
            receiptUrl: "https://example.test/refund-review-receipt",
            bankReviewDecision: "refund_review",
          },
        ],
      }],
    },
  });

  assert.deepEqual(
    items.filter((item) => item.category === "bank_receipt").map((item) => item.id).sort(),
    [
      "booking-bank-receipt-A-1",
      "booking-bank-receipt-A-3",
      "subscription-bank-receipt-PAY-1",
    ],
  );
});

test("recognizes Arabic subscription bank-transfer review states", () => {
  const items = buildOperationsInbox({
    payments: [{
      id: "PAY-AR-1",
      propertyNumber: "P-AR-1",
      paymentMethod: "تحويل بنكي",
      status: "قيد التحقق",
      receiptUrl: "https://example.test/subscription-receipt-ar",
    }],
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].id, "subscription-bank-receipt-PAY-AR-1");
});

test("surfaces provider delivery failures even after transport acceptance", () => {
  const items = buildOperationsInbox({
    bookingDashboard: {
      bookings: [{
        id: "B-DELIVERY",
        propertyNumber: "P-DELIVERY",
        notificationJobs: [{
          id: "J-DELIVERY",
          status: "sent",
          providerDeliveryStatus: "failed",
          providerDeliveryError: "recipient_unavailable",
          providerFailedAt: "2026-09-26T12:00:00.000Z",
          recipientRole: "customer",
        }],
      }],
    },
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].category, "whatsapp_failure");
  assert.match(items[0].description, /فشل تسليمها/);
  assert.equal(items[0].occurredAt, "2026-09-26T12:00:00.000Z");
});

test("surfaces a customer report that the owner did not respond", () => {
  const items = buildOperationsInbox({
    bookingDashboard: {
      bookings: [{
        id: "B-NO-RESPONSE",
        requestCode: "REQ-NO-RESPONSE",
        propertyNumber: "P-NO-RESPONSE",
        customerOwnerNoResponseReportedAt: "2026-09-26T12:00:00.000Z",
      }],
    },
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].category, "dispute");
  assert.equal(items[0].reference, "REQ-NO-RESPONSE");
});

test("WhatsApp transport failures deep-link to the exact activity record", () => {
  const items = buildOperationsInbox({
    whatsappLogs: [{
      id: "LOG / 42",
      status: "failed",
      createdAt: "2026-09-26T12:00:00.000Z",
    }],
  });

  assert.equal(items.length, 1);
  assert.equal(
    items[0].href,
    "/admin/whatsapp?tab=activity&log=LOG%20%2F%2042",
  );
});

test("general WhatsApp logs surface provider delivery failures after acceptance", () => {
  const items = buildOperationsInbox({
    whatsappLogs: [{
      id: "WA-DELIVERY-1",
      type: "owner_subscription_activated",
      status: "success",
      providerDeliveryStatus: "failed",
      providerDeliveryError: "recipient_unavailable",
      providerFailedAt: "2026-09-26T15:00:00.000Z",
      createdAt: "2026-09-26T14:59:00.000Z",
    }],
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].statusLabel, "فشل التسليم");
  assert.equal(items[0].occurredAt, "2026-09-26T15:00:00.000Z");
});

test("keeps suspended and expiring records linked to their existing admin tools", () => {
  const items = buildOperationsInbox({
    availability: {
      holds: [{
        propertyNumber: "P-3",
        name: "العقار الثالث",
        commissionHold: true,
        manualHold: false,
        commissionObligationCount: 2,
      }],
    },
    subscriptions: [
      {
        id: "S-1",
        propertyNumber: "P-4",
        name: "العقار الرابع",
        status: "قريب الانتهاء",
        remainingDays: 2,
      },
      {
        id: "S-2",
        propertyNumber: "P-5",
        status: "ساري",
        remainingDays: 2,
      },
    ],
  });

  assert.equal(items.find((item) => item.category === "suspended_property")?.href,
    "/admin/suspended-subscriptions?property=P-3");
  assert.equal(items.find((item) => item.category === "expiring_subscription")?.href,
    "/admin/subscriptions?property=P-4");
});

test("keeps an expiring subscription resolved during one warning window and reopens a renewed term", () => {
  const currentTerm = buildOperationsInbox({
    subscriptions: [{
      id: "S-STABLE",
      propertyNumber: "P-STABLE",
      status: "قريب الانتهاء",
      remainingDays: 7,
      endDate: "2026-10-03T08:00:00.000Z",
    }],
  })[0];
  assert.equal(currentTerm.occurredAt, "2026-09-25T21:00:00.000Z");

  const resolvedWorkflow = {
    operationId: currentTerm.id,
    state: "resolved" as const,
    assignee: null,
    createdAt: "2026-09-26T09:00:00.000Z",
    updatedAt: "2026-09-27T08:00:00.000Z",
    resolvedAt: "2026-09-27T08:00:00.000Z",
    resolvedBy: "admin" as const,
    notes: [],
    audit: [],
  };
  assert.equal(
    mergeOperationsMetadata([currentTerm], [resolvedWorkflow])[0].workflow.state,
    "resolved",
  );

  const laterInSameTerm = buildOperationsInbox({
    subscriptions: [{
      id: "S-STABLE",
      propertyNumber: "P-STABLE",
      status: "قريب الانتهاء",
      remainingDays: 2,
      endDate: "2026-10-03T08:00:00.000Z",
    }],
  })[0];
  assert.equal(
    mergeOperationsMetadata([laterInSameTerm], [resolvedWorkflow])[0].workflow.state,
    "resolved",
  );

  const renewedTerm = buildOperationsInbox({
    subscriptions: [{
      id: "S-STABLE",
      propertyNumber: "P-STABLE",
      status: "قريب الانتهاء",
      remainingDays: 7,
      endDate: "2026-11-03T08:00:00.000Z",
    }],
  })[0];
  assert.equal(renewedTerm.occurredAt, "2026-10-26T21:00:00.000Z");
  assert.equal(
    mergeOperationsMetadata([renewedTerm], [resolvedWorkflow])[0].workflow.state,
    "open",
  );
});

test("operations inbox is routed and keeps its queue usable on narrow screens", () => {
  const source = readFileSync(
    new URL("./operations-inbox.tsx", import.meta.url),
    "utf8",
  );
  const dashboardSource = readFileSync(
    new URL("../admin-dashboard.tsx", import.meta.url),
    "utf8",
  );
  const routeSource = readFileSync(
    new URL("../../../app/admin/[...section]/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /min-w-0 max-w-full space-y-5/);
  assert.match(source, /max-w-full overflow-x-auto/);
  assert.match(source, /flex min-w-0 flex-col gap-3 lg:flex-row/);
  assert.match(source, /w-full shrink-0 gap-2 lg:w-auto/);
  assert.match(dashboardSource, /activeSection === "operations"/);
  assert.match(routeSource, /"operations"/);
});

test("merges persistent workflow metadata by the stable operation identifier", () => {
  const sourceItem = buildOperationsInbox({
    properties: [{
      propertyNumber: "P-2",
      name: "العقار الثاني",
      verificationStatus: "pending",
    }],
  })[0];
  const managed = mergeOperationsMetadata([sourceItem], [{
    operationId: sourceItem.id,
    state: "resolved",
    assignee: "فريق الاعتماد",
    createdAt: "2026-09-26T08:00:00.000Z",
    updatedAt: "2026-09-26T08:05:00.000Z",
    resolvedAt: "2026-09-26T08:05:00.000Z",
    resolvedBy: "admin",
    notes: [{
      id: "note-1",
      body: "تمت المراجعة",
      actor: "admin",
      createdAt: "2026-09-26T08:04:00.000Z",
    }],
    audit: [],
  }]);

  assert.equal(managed[0].id, sourceItem.id);
  assert.equal(managed[0].workflow.state, "resolved");
  assert.equal(managed[0].workflow.assignee, "فريق الاعتماد");
  assert.equal(managed[0].workflow.notes[0].body, "تمت المراجعة");

  const untouched = mergeOperationsMetadata([
    { ...sourceItem, id: "another-operation" },
  ], []);
  assert.equal(untouched[0].workflow.state, "open");
  assert.equal(untouched[0].workflow.assignee, null);
});

test("retains managed completed work and reopens a newer recurrence", () => {
  const sourceItem = buildOperationsInbox({
    properties: [{
      propertyNumber: "P-9",
      name: "العقار التاسع",
      verificationStatus: "pending",
      updatedAt: "2026-09-26T10:00:00.000Z",
    }],
  })[0];
  const workflow = {
    operationId: sourceItem.id,
    state: "resolved" as const,
    assignee: null,
    createdAt: "2026-09-26T08:00:00.000Z",
    updatedAt: "2026-09-26T09:00:00.000Z",
    resolvedAt: "2026-09-26T09:00:00.000Z",
    resolvedBy: "admin" as const,
    notes: [],
    audit: [],
    snapshot: {
      category: sourceItem.category,
      priority: sourceItem.priority,
      title: sourceItem.title,
      description: sourceItem.description,
      reference: sourceItem.reference,
      propertyNumber: sourceItem.propertyNumber,
      propertyName: sourceItem.propertyName,
      occurredAt: "2026-09-26T08:30:00.000Z",
      statusLabel: sourceItem.statusLabel,
      href: sourceItem.href,
      actionLabel: sourceItem.actionLabel,
    },
  };

  const recurrent = mergeOperationsMetadata([sourceItem], [workflow]);
  assert.equal(recurrent[0].workflow.state, "open");

  const retained = mergeOperationsMetadata([], [workflow]);
  assert.equal(retained.length, 1);
  assert.equal(retained[0].workflow.state, "resolved");
  assert.equal(retained[0].title, sourceItem.title);
});

test("drops stale open metadata snapshots when the source condition disappears", () => {
  const staleOpen = {
    operationId: "whatsapp-log-stale",
    state: "open" as const,
    assignee: "فريق الدعم",
    createdAt: "2026-09-26T08:00:00.000Z",
    updatedAt: "2026-09-26T09:00:00.000Z",
    resolvedAt: null,
    resolvedBy: null,
    notes: [],
    audit: [],
    snapshot: {
      category: "whatsapp_failure" as const,
      priority: "critical" as const,
      title: "رسالة واتساب",
      description: "تعذر إرسال رسالة واتساب",
      reference: "stale",
      propertyNumber: "P-1",
      propertyName: null,
      occurredAt: "2026-09-26T08:00:00.000Z",
      statusLabel: "فشل الإرسال",
      href: "/admin/whatsapp?tab=activity&log=stale",
      actionLabel: "فتح سجل الواتساب",
    },
  };

  assert.deepEqual(mergeOperationsMetadata([], [staleOpen]), []);
});
