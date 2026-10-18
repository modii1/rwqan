import assert from "node:assert/strict";
import test from "node:test";

import { firebaseService } from "./firebaseService";
import {
  downgradeExpiredSubscriptions,
  expireOldPendingPayments,
  runScheduledTaskSafely,
} from "./scheduler";
import { paymentService } from "./services/PaymentService";
import { DistributedScheduledJobLeaseLostError } from "./services/DistributedScheduledJob";

const providerPayment = (overrides: Record<string, unknown>) => ({
  id: "PAY-PROVIDER",
  propertyNumber: "PROP-1",
  packageId: "pkg-month",
  amount: 40,
  finalAmount: 40,
  discountAmount: 0,
  status: "قيد المراجعة",
  paymentMethod: "بطاقة",
  createdAt: "2026-07-27T15:00:00.000Z",
  intentionState: "created",
  merchantAttemptKey: "RWQN-ATTEMPT",
  paymentReference: "pi_live_1",
  transactionId: "pi_live_1",
  paymobOrderId: "ORDER-1",
  paymentCheckoutUrl:
    "https://ksa.paymob.com/unifiedcheckout/?publicKey=pk&clientSecret=secret",
  ...overrides,
});

test("scheduled task failures are observed instead of becoming unhandled rejections", async () => {
  const expectedError = new Error("scheduled task failed");
  const reportedErrors: unknown[] = [];

  runScheduledTaskSafely(
    async () => {
      throw expectedError;
    },
    (error) => reportedErrors.push(error),
  );

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(reportedErrors, [expectedError]);
});

test("payment expiry stops before mutations when its scheduler lease is lost", async () => {
  const originals = {
    getFeatureFlag: firebaseService.getFeatureFlag,
    getPayments: firebaseService.getPayments,
    claimReconciliation: firebaseService.claimPaymentProviderReconciliation,
    expirePending: firebaseService.expirePendingPaymentIfEligible,
  };
  const controller = new AbortController();
  let mutations = 0;

  try {
    (firebaseService as any).getFeatureFlag = async () => true;
    (firebaseService as any).getPayments = async () => {
      controller.abort();
      return [providerPayment({})];
    };
    (firebaseService as any).claimPaymentProviderReconciliation = async () => {
      mutations += 1;
      return { claimed: false };
    };
    (firebaseService as any).expirePendingPaymentIfEligible = async () => {
      mutations += 1;
      return true;
    };

    await assert.rejects(
      () => expireOldPendingPayments({
        signal: controller.signal,
        throwIfLeaseLost: () => {
          if (controller.signal.aborted) {
            throw new DistributedScheduledJobLeaseLostError();
          }
        },
      }),
      DistributedScheduledJobLeaseLostError,
    );
    assert.equal(mutations, 0);
  } finally {
    (firebaseService as any).getFeatureFlag = originals.getFeatureFlag;
    (firebaseService as any).getPayments = originals.getPayments;
    (firebaseService as any).claimPaymentProviderReconciliation =
      originals.claimReconciliation;
    (firebaseService as any).expirePendingPaymentIfEligible =
      originals.expirePending;
  }
});

test("subscription downgrade stops before writes when its scheduler lease is lost", async () => {
  const originals = {
    getSubscriptions: firebaseService.getSubscriptions,
    expireSubscription: firebaseService.expireSubscriptionIfNeeded,
  };
  const controller = new AbortController();
  let writes = 0;

  try {
    (firebaseService as any).getSubscriptions = async () => {
      controller.abort();
      return [{
        id: "SUB-1",
        propertyNumber: "PROP-1",
        subscriptionType: "ذهبية",
        status: "نشط",
        endDate: "2026-01-01",
      }];
    };
    (firebaseService as any).expireSubscriptionIfNeeded = async () => {
      writes += 1;
      return true;
    };

    await assert.rejects(
      () => downgradeExpiredSubscriptions({
        signal: controller.signal,
        throwIfLeaseLost: () => {
          if (controller.signal.aborted) {
            throw new DistributedScheduledJobLeaseLostError();
          }
        },
      }),
      DistributedScheduledJobLeaseLostError,
    );
    assert.equal(writes, 0);
  } finally {
    (firebaseService as any).getSubscriptions = originals.getSubscriptions;
    (firebaseService as any).expireSubscriptionIfNeeded =
      originals.expireSubscription;
  }
});

test("payment expiry reconciles Paymob atomically, throttles polling, and keeps late success recoverable", async () => {
  const originals = {
    now: Date.now,
    getFeatureFlag: firebaseService.getFeatureFlag,
    getPayments: firebaseService.getPayments,
    claimReconciliation: firebaseService.claimPaymentProviderReconciliation,
    expirePending: firebaseService.expirePendingPaymentIfEligible,
    updatePaymentStatus: firebaseService.updatePaymentStatus,
    reconcilePaymob: paymentService.reconcilePaymobIntention,
  };
  const now = Date.parse("2026-07-27T16:00:00.000Z");
  const expiryCalls: Array<{
    id: string;
    kind: "card" | "bank";
    cutoff: number;
    token?: string;
  }> = [];
  const claimCalls: Array<{ id: string; createdAfterMs: number }> = [];
  const reconciliations: string[] = [];

  try {
    Date.now = () => now;
    (firebaseService as any).getFeatureFlag = async () => true;
    (firebaseService as any).getPayments = async () => [
      providerPayment({ id: "PAY-PROVIDER-PENDING" }),
      providerPayment({
        id: "PAY-PROVIDER-VISA",
        status: "نجح - قيد التحقق",
        paymentMethod: "VISA",
        merchantAttemptKey: "RWQN-VISA",
        paymentReference: "pi_live_visa",
        transactionId: "TX-VISA",
        paymobOrderId: "ORDER-VISA",
      }),
      providerPayment({
        id: "PAY-PROVIDER-MADA",
        status: "نجح - قيد التحقق",
        paymentMethod: "MADA",
        merchantAttemptKey: "RWQN-MADA",
        paymentReference: "pi_live_mada",
        transactionId: "TX-MADA",
        paymobOrderId: "ORDER-MADA",
      }),
      providerPayment({
        id: "PAY-PROVIDER-MISLABELED-BANK",
        status: "نجح - قيد التحقق",
        paymentMethod: "تحويل بنكي",
        merchantAttemptKey: "RWQN-MISLABELED-BANK",
        paymentReference: "pi_live_mislabeled_bank",
        transactionId: "TX-MISLABELED-BANK",
        paymobOrderId: "ORDER-MISLABELED-BANK",
      }),
      providerPayment({
        id: "PAY-PROVIDER-TIMEOUT",
        status: "ملغي - انتهت المهلة",
        merchantAttemptKey: "RWQN-TIMEOUT",
        paymentReference: "pi_live_timeout",
        transactionId: "pi_live_timeout",
        paymobOrderId: "ORDER-TIMEOUT",
      }),
      providerPayment({
        id: "PAY-PROVIDER-THROTTLED",
        merchantAttemptKey: "RWQN-THROTTLED",
        paymentReference: "pi_live_throttled",
        transactionId: "pi_live_throttled",
        paymobOrderId: "ORDER-THROTTLED",
        providerLastCheckedAt: "2026-07-27T15:30:00.000Z",
      }),
      providerPayment({
        id: "PAY-OLD-CATCHUP",
        createdAt: "2026-07-10T15:00:00.000Z",
        merchantAttemptKey: "RWQN-OLD-CATCHUP",
        paymentReference: "pi_live_old_catchup",
        transactionId: "pi_live_old_catchup",
        paymobOrderId: "ORDER-OLD-CATCHUP",
      }),
      providerPayment({
        id: "PAY-OLD-STOPPED",
        createdAt: "2026-07-10T15:00:00.000Z",
        merchantAttemptKey: "RWQN-OLD-STOPPED",
        paymentReference: "pi_live_old_stopped",
        transactionId: "pi_live_old_stopped",
        paymobOrderId: "ORDER-OLD-STOPPED",
        providerLastCheckedAt: "2026-07-20T15:00:00.000Z",
        providerReconciliationStartedAt: "2026-07-20T15:00:00.000Z",
      }),
      {
        id: "PAY-LEGACY-CARD",
        propertyNumber: "PROP-2",
        packageId: "pkg-month",
        amount: 40,
        finalAmount: 40,
        discountAmount: 0,
        status: "قيد المراجعة",
        paymentMethod: "APPLE_PAY",
        createdAt: "2026-07-27T15:00:00.000Z",
      },
      {
        id: "PAY-OLD-BANK",
        propertyNumber: "PROP-3",
        packageId: "pkg-month",
        amount: 40,
        finalAmount: 40,
        discountAmount: 0,
        status: "قيد التحقق",
        paymentMethod: "تحويل بنكي",
        createdAt: "2026-07-24T15:00:00.000Z",
      },
      {
        id: "PAY-COMPLETE",
        propertyNumber: "PROP-4",
        packageId: "pkg-month",
        amount: 40,
        finalAmount: 40,
        discountAmount: 0,
        status: "مكتمل",
        paymentMethod: "بطاقة",
        createdAt: "2026-07-24T15:00:00.000Z",
      },
    ];
    (firebaseService as any).claimPaymentProviderReconciliation = async (
      payment: any,
      options: any,
    ) => {
      claimCalls.push({
        id: payment.id,
        createdAfterMs: options.createdAfterMs,
      });
      if (payment.id === "PAY-PROVIDER-THROTTLED") {
        return { claimed: false };
      }
      const token = `CLAIM-${payment.id}`;
      return {
        claimed: true,
        token,
        payment: {
          ...payment,
          providerLastCheckedAt: options.checkedAt,
          providerReconciliationClaimToken: token,
        },
      };
    };
    (firebaseService as any).expirePendingPaymentIfEligible = async (
      payment: { id: string },
      kind: "card" | "bank",
      cutoff: number,
      options?: { providerUnpaidClaimToken?: string },
    ) => {
      expiryCalls.push({
        id: payment.id,
        kind,
        cutoff,
        token: options?.providerUnpaidClaimToken,
      });
      return true;
    };
    (firebaseService as any).updatePaymentStatus = async () => {
      throw new Error("scheduler must not use the unguarded status writer");
    };
    (paymentService as any).reconcilePaymobIntention = async (id: string) => {
      reconciliations.push(id);
      return [
        "PAY-PROVIDER-TIMEOUT",
        "PAY-PROVIDER-VISA",
        "PAY-PROVIDER-MADA",
        "PAY-PROVIDER-MISLABELED-BANK",
      ].includes(id)
        ? { status: "paid", activation: "activated" }
        : { status: "unpaid" };
    };

    assert.equal(await expireOldPendingPayments(), 4);
    assert.deepEqual(reconciliations, [
      "PAY-PROVIDER-PENDING",
      "PAY-PROVIDER-VISA",
      "PAY-PROVIDER-MADA",
      "PAY-PROVIDER-MISLABELED-BANK",
      "PAY-PROVIDER-TIMEOUT",
      "PAY-OLD-CATCHUP",
    ]);
    assert.deepEqual(
      claimCalls.map(({ id }) => id),
      [
        "PAY-PROVIDER-PENDING",
        "PAY-PROVIDER-VISA",
        "PAY-PROVIDER-MADA",
        "PAY-PROVIDER-MISLABELED-BANK",
        "PAY-PROVIDER-TIMEOUT",
        "PAY-PROVIDER-THROTTLED",
        "PAY-OLD-CATCHUP",
      ],
    );
    assert.equal(
      claimCalls.find(({ id }) => id === "PAY-OLD-CATCHUP")?.createdAfterMs,
      0,
    );
    assert.deepEqual(
      expiryCalls.map(({ id, kind, token }) => ({ id, kind, token })),
      [
        {
          id: "PAY-PROVIDER-PENDING",
          kind: "card",
          token: "CLAIM-PAY-PROVIDER-PENDING",
        },
        {
          id: "PAY-OLD-CATCHUP",
          kind: "card",
          token: "CLAIM-PAY-OLD-CATCHUP",
        },
        { id: "PAY-LEGACY-CARD", kind: "card", token: undefined },
        { id: "PAY-OLD-BANK", kind: "bank", token: undefined },
      ],
    );
    assert.equal(expiryCalls[0].cutoff, now - 30 * 60 * 1000);
    assert.equal(expiryCalls[3].cutoff, now - 72 * 60 * 60 * 1000);
  } finally {
    Date.now = originals.now;
    (firebaseService as any).getFeatureFlag = originals.getFeatureFlag;
    (firebaseService as any).getPayments = originals.getPayments;
    (firebaseService as any).claimPaymentProviderReconciliation =
      originals.claimReconciliation;
    (firebaseService as any).expirePendingPaymentIfEligible =
      originals.expirePending;
    (firebaseService as any).updatePaymentStatus = originals.updatePaymentStatus;
    (paymentService as any).reconcilePaymobIntention = originals.reconcilePaymob;
  }
});

test("scheduler routes initial and failed add-ons only through exact add-on reconciliation", async () => {
  const originals = {
    now: Date.now,
    getFeatureFlag: firebaseService.getFeatureFlag,
    getPayments: firebaseService.getPayments,
    claimReconciliation: firebaseService.claimPaymentProviderReconciliation,
    expirePending: firebaseService.expirePendingPaymentIfEligible,
    reconcileSubscription: paymentService.reconcilePaymobIntention,
    reconcileAddon: paymentService.reconcilePaymobAddonIntention,
  };
  const now = Date.parse("2026-07-27T16:00:00.000Z");
  const addonCalls: string[] = [];
  const subscriptionCalls: string[] = [];
  const claimed: string[] = [];
  let expirations = 0;

  try {
    Date.now = () => now;
    (firebaseService as any).getFeatureFlag = async () => true;
    (firebaseService as any).getPayments = async () => [
      providerPayment({
        id: "PAY-ADDON-INITIAL",
        action: "addon",
        status: "قيد الدفع",
        paymentMethod: "paymob",
      }),
      providerPayment({
        id: "PAY-ADDON-AFTER-FAILURE",
        action: "addon",
        status: "فشل",
        paymentMethod: "paymob",
      }),
      providerPayment({
        id: "PAY-ADDON-UNBOUND",
        action: "addon",
        status: "قيد الدفع",
        paymentMethod: "paymob",
        paymobOrderId: undefined,
      }),
      providerPayment({
        id: "PAY-ADDON-COMPLETED",
        action: "addon",
        status: "نجح - قيد التحقق",
        paymentMethod: "paymob",
        completedAt: "2026-07-27T15:30:00.000Z",
      }),
      providerPayment({
        id: "PAY-SUBSCRIPTION-FAILED",
        action: "extend",
        status: "فشل",
      }),
    ];
    (firebaseService as any).claimPaymentProviderReconciliation = async (
      payment: any,
    ) => {
      claimed.push(payment.id);
      return { claimed: true, token: `CLAIM-${payment.id}`, payment };
    };
    (firebaseService as any).expirePendingPaymentIfEligible = async () => {
      expirations += 1;
      return true;
    };
    (paymentService as any).reconcilePaymobAddonIntention = async (
      id: string,
    ) => {
      addonCalls.push(id);
      return id === "PAY-ADDON-INITIAL"
        ? { status: "paid", review: "pending" }
        : { status: "unpaid" };
    };
    (paymentService as any).reconcilePaymobIntention = async (id: string) => {
      subscriptionCalls.push(id);
      return { status: "unpaid" };
    };

    assert.equal(await expireOldPendingPayments(), 0);
    assert.deepEqual(addonCalls, [
      "PAY-ADDON-INITIAL",
      "PAY-ADDON-AFTER-FAILURE",
    ]);
    assert.deepEqual(subscriptionCalls, ["PAY-SUBSCRIPTION-FAILED"]);
    assert.deepEqual(claimed, [
      "PAY-ADDON-INITIAL",
      "PAY-ADDON-AFTER-FAILURE",
      "PAY-SUBSCRIPTION-FAILED",
    ]);
    assert.equal(expirations, 0);
  } finally {
    Date.now = originals.now;
    (firebaseService as any).getFeatureFlag = originals.getFeatureFlag;
    (firebaseService as any).getPayments = originals.getPayments;
    (firebaseService as any).claimPaymentProviderReconciliation =
      originals.claimReconciliation;
    (firebaseService as any).expirePendingPaymentIfEligible =
      originals.expirePending;
    (paymentService as any).reconcilePaymobIntention =
      originals.reconcileSubscription;
    (paymentService as any).reconcilePaymobAddonIntention =
      originals.reconcileAddon;
  }
});

test("disabling display timeouts never disables paid Paymob reconciliation", async () => {
  const originals = {
    now: Date.now,
    getFeatureFlag: firebaseService.getFeatureFlag,
    getPayments: firebaseService.getPayments,
    claimReconciliation: firebaseService.claimPaymentProviderReconciliation,
    expirePending: firebaseService.expirePendingPaymentIfEligible,
    reconcilePaymob: paymentService.reconcilePaymobIntention,
  };
  const now = Date.parse("2026-07-27T16:00:00.000Z");
  let reconciliations = 0;
  let expirations = 0;
  const payment = providerPayment({
    id: "PAY-TIMEOUTS-DISABLED",
    createdAt: "2026-07-27T15:00:00.000Z",
  }) as any;

  Date.now = () => now;
  (firebaseService as any).getFeatureFlag = async () => false;
  (firebaseService as any).getPayments = async () => [payment];
  (firebaseService as any).claimPaymentProviderReconciliation = async () => ({
    claimed: true,
    token: "CLAIM-TIMEOUTS-DISABLED",
    payment,
  });
  (firebaseService as any).expirePendingPaymentIfEligible = async () => {
    expirations += 1;
    return true;
  };
  (paymentService as any).reconcilePaymobIntention = async () => {
    reconciliations += 1;
    return { status: "paid", activation: "activated" };
  };

  try {
    assert.equal(await expireOldPendingPayments(), 0);
    assert.equal(reconciliations, 1);
    assert.equal(expirations, 0);
  } finally {
    Date.now = originals.now;
    (firebaseService as any).getFeatureFlag = originals.getFeatureFlag;
    (firebaseService as any).getPayments = originals.getPayments;
    (firebaseService as any).claimPaymentProviderReconciliation =
      originals.claimReconciliation;
    (firebaseService as any).expirePendingPaymentIfEligible =
      originals.expirePending;
    (paymentService as any).reconcilePaymobIntention = originals.reconcilePaymob;
  }
});
