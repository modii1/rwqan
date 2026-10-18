/**
 * RWQAN LIVE DATA — data-environment store.
 *
 * Holds the currently selected data environment (TEST/LIVE) for the isolated
 * DEV copy. This is deliberately SEPARATE from the deploy/release system: it
 * only selects which data source the read-only preview uses. It never triggers
 * a deploy, never enables payments, and defaults to the safe `TEST`.
 *
 * The state is intentionally in-process (a DEV tool): a server restart resets
 * it to `TEST`, which is the safe default. Moving the switch to LIVE is refused
 * at the route layer unless a safe read-only production configuration exists.
 */
import type { DataEnvironment } from "../../shared/liveData";

export interface DataEnvironmentStore {
  get(): DataEnvironment;
  set(environment: DataEnvironment): void;
}

class InMemoryDataEnvironmentStore implements DataEnvironmentStore {
  private environment: DataEnvironment = "TEST";

  get(): DataEnvironment {
    return this.environment;
  }

  set(environment: DataEnvironment): void {
    this.environment = environment;
  }
}

export const dataEnvironmentStore: DataEnvironmentStore =
  new InMemoryDataEnvironmentStore();

export function createDataEnvironmentStore(
  initial: DataEnvironment = "TEST",
): DataEnvironmentStore {
  const store = new InMemoryDataEnvironmentStore();
  store.set(initial);
  return store;
}
