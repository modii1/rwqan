/**
 * 🗃️ Server-side in-memory cache with TTL and stale-while-revalidate
 * 
 * Reduces Firestore reads by caching frequently-accessed collections.
 * Cache is automatically invalidated after TTL expires.
 * Supports stale-while-revalidate for better performance.
 * Write operations should call invalidate() to keep data fresh.
 */

interface CacheEntry<T> {
  data: T;
  expiry: number;
  staleAt: number;
}

interface PendingFetch<T> {
  promise: Promise<T>;
  timestamp: number;
}

class MemoryCache {
  private store = new Map<string, CacheEntry<any>>();
  private pendingFetches = new Map<string, PendingFetch<any>>();
  private maxSize = 100;
  private accessOrder: string[] = [];

  /**
   * Get cached value or fetch from source with stale-while-revalidate
   * @param key Cache key (e.g., "properties", "payments")
   * @param fetcher Async function to fetch data if cache miss
   * @param ttlMs Time-to-live in milliseconds (default: 5 minutes)
   * @param staleWhileRevalidateMs Stale period in ms (default: 1 minute)
   */
  async getOrFetch<T>(
    key: string, 
    fetcher: () => Promise<T>, 
    ttlMs: number = 5 * 60 * 1000,
    staleWhileRevalidateMs: number = 1 * 60 * 1000
  ): Promise<T> {
    const cached = this.store.get(key);
    const now = Date.now();

    if (cached && now < cached.expiry) {
      this.updateAccessOrder(key);
      return cached.data as T;
    }

    if (cached && now < cached.staleAt && this.pendingFetches.has(key)) {
      this.updateAccessOrder(key);
      return cached.data as T;
    }

    if (this.pendingFetches.has(key)) {
      const pending = this.pendingFetches.get(key);
      if (pending && now - pending.timestamp < 30000) {
        return pending.promise as T;
      }
    }

    const fetchPromise = (async () => {
      try {
        const data = await fetcher();
        this.store.set(key, { 
          data, 
          expiry: now + ttlMs,
          staleAt: now + ttlMs + staleWhileRevalidateMs 
        });
        this.updateAccessOrder(key);
        this.enforceMaxSize();
        return data;
      } finally {
        this.pendingFetches.delete(key);
      }
    })();

    this.pendingFetches.set(key, { promise: fetchPromise, timestamp: now });

    if (cached) {
      return cached.data as T;
    }

    return fetchPromise;
  }

  /**
   * Synchronous get - returns cached data only, no fetch
   */
  get<T>(key: string): T | null {
    const cached = this.store.get(key);
    if (cached && Date.now() < cached.expiry) {
      this.updateAccessOrder(key);
      return cached.data as T;
    }
    return null;
  }

  /**
   * Set cache value manually
   */
  set<T>(key: string, data: T, ttlMs: number = 5 * 60 * 1000): void {
    const now = Date.now();
    this.store.set(key, {
      data,
      expiry: now + ttlMs,
      staleAt: now + ttlMs + 60000
    });
    this.updateAccessOrder(key);
    this.enforceMaxSize();
  }

  /**
   * Invalidate a specific cache key (call after writes)
   */
  invalidate(key: string): void {
    this.store.delete(key);
    this.pendingFetches.delete(key);
    this.removeFromAccessOrder(key);
  }

  /**
   * Invalidate multiple keys at once
   */
  invalidateMany(keys: string[]): void {
    for (const key of keys) {
      this.invalidate(key);
    }
  }

  /**
   * Invalidate all cached data
   */
  invalidateAll(): void {
    this.store.clear();
    this.pendingFetches.clear();
    this.accessOrder = [];
  }

  /**
   * Check if key exists and is valid
   */
  has(key: string): boolean {
    const cached = this.store.get(key);
    return !!cached && Date.now() < cached.expiry;
  }

  /**
   * Get remaining TTL for a key
   */
  getRemainingTTL(key: string): number {
    const cached = this.store.get(key);
    if (!cached) return 0;
    return Math.max(0, cached.expiry - Date.now());
  }

  /**
   * Pre-warm cache with frequently accessed data
   */
  async warmup(entries: Array<{ key: string; fetcher: () => Promise<any>; ttlMs?: number }>): Promise<void> {
    await Promise.allSettled(
      entries.map(entry => this.getOrFetch(entry.key, entry.fetcher, entry.ttlMs))
    );
  }

  /**
   * Get cache stats for debugging
   */
  getStats(): { keys: string[]; size: number; hits: number } {
    return {
      keys: Array.from(this.store.keys()),
      size: this.store.size,
      hits: this.accessOrder.length
    };
  }

  private updateAccessOrder(key: string): void {
    this.removeFromAccessOrder(key);
    this.accessOrder.push(key);
    if (this.accessOrder.length > this.maxSize) {
      this.accessOrder = this.accessOrder.slice(-this.maxSize);
    }
  }

  private removeFromAccessOrder(key: string): void {
    this.accessOrder = this.accessOrder.filter(k => k !== key);
  }

  private enforceMaxSize(): void {
    if (this.store.size > this.maxSize) {
      const keysToRemove = this.accessOrder.slice(0, Math.floor(this.maxSize * 0.2));
      for (const key of keysToRemove) {
        this.store.delete(key);
      }
      this.accessOrder = this.accessOrder.filter(k => !keysToRemove.includes(k));
    }
  }
}

// Singleton cache instance
export const cache = new MemoryCache();

// Cache key constants
export const CACHE_KEYS = {
  PROPERTIES: "properties",
  SUBSCRIPTIONS: "subscriptions",
  PAYMENTS: "payments",
  REQUESTS: "requests",
  SUGGESTIONS: "suggestions",
  PACKAGES: "packages",
  PACKAGES_ACTIVE: "packages_active",
  FEE_CONFIGS: "fee_configs",
  DISCOUNTS: "discounts",
  DISCOUNTS_ALL: "discounts_all",
  ADDONS: "addon_packages",
  PROPERTY_ADDONS: "property_addons",
  FEATURE_FLAGS: "feature_flags",
  BANK_ACCOUNTS: "bank_accounts",
  WHATSAPP_LOGS: "whatsapp_logs",
  ANALYTICS: "analytics",
  OWNER_PROPERTY: "owner_property",
  OWNER_SUBSCRIPTION: "owner_subscription",
} as const;

// TTL constants (in milliseconds)
export const TTL = {
  SHORT: 1 * 60 * 1000,       // 1 minute - for rapidly changing data (payments, requests)
  MEDIUM: 5 * 60 * 1000,      // 5 minutes - default
  LONG: 15 * 60 * 1000,       // 15 minutes - for rarely changing data
  VERY_LONG: 60 * 60 * 1000,  // 1 hour - for essentially static data (packages, configs)
} as const;

// Helper function to get optimal TTL based on data type
export function getOptimalTTL(dataType: keyof typeof CACHE_KEYS): number {
  const ttlMap: Record<string, number> = {
    PAYMENTS: TTL.SHORT,
    REQUESTS: TTL.SHORT,
    SUBSCRIPTIONS: TTL.MEDIUM,
    PROPERTIES: TTL.MEDIUM,
    SUGGESTIONS: TTL.SHORT,
    PACKAGES: TTL.VERY_LONG,
    PACKAGES_ACTIVE: TTL.VERY_LONG,
    FEE_CONFIGS: TTL.VERY_LONG,
    DISCOUNTS: TTL.LONG,
    DISCOUNTS_ALL: TTL.LONG,
    ADDONS: TTL.LONG,
    PROPERTY_ADDONS: TTL.MEDIUM,
    FEATURE_FLAGS: TTL.VERY_LONG,
    BANK_ACCOUNTS: TTL.LONG,
    WHATSAPP_LOGS: TTL.SHORT,
    ANALYTICS: TTL.MEDIUM,
    OWNER_PROPERTY: TTL.SHORT,
    OWNER_SUBSCRIPTION: TTL.SHORT,
  };
  return ttlMap[dataType] || TTL.MEDIUM;
}
