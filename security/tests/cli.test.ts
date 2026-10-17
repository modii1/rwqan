import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseArgv } from "../src/cli";

describe("parseArgv", () => {
  it("parses --no-network as a presence flag", () => {
    const opts = parseArgv(["--no-network"]);
    assert.equal(opts.noNetwork, true);
  });

  it("does not swallow a following flag as the boolean value", () => {
    const opts = parseArgv(["--no-network", "--ci"]);
    assert.equal(opts.noNetwork, true);
    assert.equal(opts.ci, true);
  });

  it("still accepts an explicit value form", () => {
    assert.equal(parseArgv(["--no-network", "false"]).noNetwork, false);
    assert.equal(parseArgv(["--no-network", "true"]).noNetwork, true);
  });

  it("defaults to env NO_NETWORK when the flag is absent", () => {
    const opts = parseArgv([], { NO_NETWORK: "true" } as unknown as NodeJS.ProcessEnv);
    assert.equal(opts.noNetwork, true);
  });

  it("defaults to development target", () => {
    assert.equal(parseArgv([]).target, "development");
    assert.equal(parseArgv(["--target", "production"]).target, "production");
  });
});