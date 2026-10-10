import { describe, expect, it } from "vitest";
import { coreVersion } from "./index.js";

describe("core", () => {
  it("reports a version", () => {
    expect(coreVersion).toBe("0.1.0");
  });
});