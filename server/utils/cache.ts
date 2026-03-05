/**
 * 🗃️ Server-side in-memory cache with TTL
 * 
 * Reduces Firestore reads by caching frequently-accessed collections.
 * Cache is automatically invalidated after TTL expires.
 * Write operations should call invalidate() to keep data fresh.
 */

interface CacheEntry<T> {
  data: T;
  expiry: number;
}

class MemoryCache {
  private store = new Map<string, CacheEntry<any>>();
  
  /**
   * Get cached value or fetch from source
   * @param key Cache key (e.g., "properties", "payments")
   * @param fetcher Async function to fetch data if cache miss
   * @param ttlMs Time-to-live in milliseconds (default: 5 minutes)
   */
  async getOrFetch<T>(key: string, fetcher: () => Promise<T>, ttlMs: number = 5 * 60 * 1000): Promise<T> {
    const cached = this.store.get(key);
    if (cached && Date.now() < cached.expiry) {
      return cached.data as T;
    }

    const data = await fetcher();
    this.store.set(key, { data, expiry: Date.now() + ttlMs });
    return data;
  }

  /**
   * Invalidate a specific cache key (call after writes)
   */
  invalidate(key: string): void {
    this.store.delete(key);
  }

  /**
   * Invalidate multiple keys at once
   */
  invalidateMany(keys: string[]): void {
    for (const key of keys) {
      this.store.delete(key);
    }
  }

  /**
   * Invalidate all cached data
   */
  invalidateAll(): void {
    this.store.clear();
  }

  /**
   * Get cache stats for debugging
   */
  getStats(): { keys: string[]; size: number } {
    return {
      keys: Array.from(this.store.keys()),
      size: this.store.size,
    };
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
} as const;

// TTL constants (in milliseconds)
export const TTL = {
  SHORT: 1 * 60 * 1000,      // 1 minute - for rapidly changing data
  MEDIUM: 5 * 60 * 1000,     // 5 minutes - default
  LONG: 15 * 60 * 1000,      // 15 minutes - for rarely changing data
  VERY_LONG: 60 * 60 * 1000, // 1 hour - for essentially static data
} as const;
