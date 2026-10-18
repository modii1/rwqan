import { TestSuiteDefinition } from '../src/runner';
import {
  MAX_ACTIVE_SUBSCRIPTION_PACKAGE_DAYS,
  SUBSCRIPTION_RENEWAL_WINDOW_DAYS,
  MAX_SUBSCRIPTION_REMAINING_DAYS,
  normalizeSubscriptionPackageDuration,
  isSubscriptionPackageDurationAllowed,
  isPurchasableSubscriptionPackage,
} from '../../shared/subscriptionPackagePolicy';
import {
  calculateSubscriptionPrice,
  getIncludedPropertyCount,
  getPackageBasePrice,
  getAdditionalPropertyPrice,
} from '../../shared/subscriptionPricing';
import { isActiveSubscription } from '../../server/utils/paymentScenarioFlow';
import { calculateRemainingDays, calculateSubscriptionEndDate, capAtMaxDays } from '../../server/utils/dateUtils';
import { isSubscriptionStatusSuspended, isPremiumSubscriptionType } from '../../shared/subscriptionType';

export const businessLogicSuite: TestSuiteDefinition = {
  name: 'business-logic',
  notes: 'In-process business logic tests using REAL modules only. No business-logic changes.',
  cases: [
    {
      id: 'BL-001',
      feature: 'subscriptionPackagePolicy',
      flow: 'constants',
      expected: 'MAX_ACTIVE=90, RENEWAL_WINDOW=10, MAX_REMAINING=100',
      severity: 'HIGH',
      status: 'PASS',
      run: async () => {
        if (MAX_ACTIVE_SUBSCRIPTION_PACKAGE_DAYS !== 90) throw new Error('max active mismatch');
        if (SUBSCRIPTION_RENEWAL_WINDOW_DAYS !== 10) throw new Error('renewal window mismatch');
        if (MAX_SUBSCRIPTION_REMAINING_DAYS !== 100) throw new Error('max remaining mismatch');
        return { actual: 'constants_ok', status: 'PASS' };
      },
    },
    {
      id: 'BL-002',
      feature: 'subscriptionPackagePolicy',
      flow: 'duration-normalize',
      expected: 'positive int ok, non-int/string invalid',
      severity: 'MEDIUM',
      status: 'PASS',
      run: async () => {
        if (normalizeSubscriptionPackageDuration(30) !== 30) throw new Error('30');
        if (normalizeSubscriptionPackageDuration('30') !== 30) throw new Error('30s');
        if (normalizeSubscriptionPackageDuration(0) !== null) throw new Error('0');
        if (normalizeSubscriptionPackageDuration(-1) !== null) throw new Error('-1');
        if (normalizeSubscriptionPackageDuration('') !== null) throw new Error('empty');
        return { actual: 'normalize_ok', status: 'PASS' };
      },
    },
    {
      id: 'BL-003',
      feature: 'subscriptionPackagePolicy',
      flow: 'duration-allowed-active',
      expected: 'active allows <=90, >90 blocked; inactive allowed regardless of duration',
      severity: 'HIGH',
      status: 'PASS',
      run: async () => {
        if (!isSubscriptionPackageDurationAllowed(90, true)) throw new Error('90');
        if (isSubscriptionPackageDurationAllowed(91, true)) throw new Error('91');
        if (!isSubscriptionPackageDurationAllowed(30, false)) throw new Error('inactive30');
        if (!isSubscriptionPackageDurationAllowed(91, false)) throw new Error('inactive91');
        return { actual: 'duration_allowed_ok', status: 'PASS' };
      },
    },
    {
      id: 'BL-004',
      feature: 'subscriptionPackagePolicy',
      flow: 'purchasable',
      expected: 'active+valid duration purchasable',
      severity: 'HIGH',
      status: 'PASS',
      run: async () => {
        const ok = isPurchasableSubscriptionPackage({ duration: 30, isActive: true });
        const bad = isPurchasableSubscriptionPackage({ duration: 91, isActive: true });
        if (!ok) throw new Error('ok');
        if (bad) throw new Error('bad');
        return { actual: 'purchasable_ok', status: 'PASS' };
      },
    },
    {
      id: 'BL-005',
      feature: 'subscriptionPricing',
      flow: 'calculate-basic',
      expected: 'base + extras computed correctly',
      severity: 'MEDIUM',
      status: 'PASS',
      run: async () => {
        const pkg: any = { id: 'pkg-test', price: 100, pricePerProperty: 25, propertyCount: 1, maxProperties: 5 };
        const res = calculateSubscriptionPrice(pkg, 3);
        if (res.includedPropertyCount !== 1) throw new Error('inc');
        if (res.billedPropertyCount !== 3) throw new Error('billed');
        if (res.additionalPropertyCount !== 2) throw new Error('add');
        if (res.basePrice !== 100) throw new Error('base');
        if (res.total !== 150) throw new Error('total');
        return { actual: JSON.stringify(res), status: 'PASS' };
      },
    },
    {
      id: 'BL-006',
      feature: 'subscriptionPricing',
      flow: 'legacy-vip',
      expected: 'legacy vip semantics preserved',
      severity: 'MEDIUM',
      status: 'PASS',
      run: async () => {
        // The original VIP Firestore document has no propertyCount and no
        // pricePerProperty; it stores 25 SAR per property while historical
        // two-property payments are 50 SAR. Mirrors shared/subscriptionPricing.test.ts.
        const legacy: any = { id: 'pkg-month-2properties', price: 25 };
        const base = getPackageBasePrice(legacy);
        const inc = getIncludedPropertyCount(legacy);
        if (inc !== 2) throw new Error('inc');
        if (base !== 50) throw new Error('base');
        return { actual: `inc=${inc} base=${base}`, status: 'PASS' };
      },
    },
    {
      id: 'BL-007',
      feature: 'dateUtils',
      flow: 'end-date-capping',
      severity: 'HIGH',
      status: 'PASS',
      expected: 'end date capped at MAX from today',
      run: async () => {
        const start = new Date('2026-01-01T00:00:00+03:00');
        const end = calculateSubscriptionEndDate(start, 200);
        const maxFromStart = capAtMaxDays(end);
        if (maxFromStart.getTime() !== end.getTime()) throw new Error('not_capped');
        return { actual: end.toISOString(), status: 'PASS' };
      },
    },
    {
      id: 'BL-008',
      feature: 'dateUtils',
      flow: 'remaining-days',
      severity: 'MEDIUM',
      status: 'PASS',
      expected: '>=0 logic',
      run: async () => {
        const today = new Date();
        const tom = new Date(today.getTime() + 86400000);
        const rem = calculateRemainingDays(tom);
        if (rem < 0) throw new Error('rem');
        if (calculateRemainingDays(null) !== -1) throw new Error('null');
        return { actual: String(rem), status: 'PASS' };
      },
    },
    {
      id: 'BL-009',
      feature: 'subscriptionType',
      flow: 'normalize',
      severity: 'MEDIUM',
      status: 'PASS',
      expected: 'premium/normal mapped',
      run: async () => {
        if (isPremiumSubscriptionType('مميز') !== true) throw new Error('prem');
        if (isPremiumSubscriptionType('premium') !== true) throw new Error('prem2');
        if (isPremiumSubscriptionType('عادي') !== false) throw new Error('norm');
        if (isSubscriptionStatusSuspended('موقوف مؤقتاً') !== true) throw new Error('susp');
        return { actual: 'ok', status: 'PASS' };
      },
    },
    {
      id: 'BL-010',
      feature: 'paymentScenarioFlow',
      flow: 'isActiveSubscription',
      severity: 'HIGH',
      status: 'PASS',
      expected: 'checks endDate and status',
      run: async () => {
        const active: any = { endDate: new Date(Date.now() + 86400000).toISOString(), status: 'نشط' };
        const expired: any = { endDate: new Date(Date.now() - 86400000).toISOString(), status: 'نشط' };
        if (!isActiveSubscription(active)) throw new Error('active');
        if (isActiveSubscription(expired)) throw new Error('expired');
        return { actual: 'ok', status: 'PASS' };
      },
    },
  ],
};
