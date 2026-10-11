import { describe, expect, it } from "vitest";
import { assessMasterPassword } from "./password-policy.js";

describe("assessMasterPassword", () => {
  it("rejects a common weak password", () => {
    const assessment = assessMasterPassword("password");
    expect(assessment.acceptable).toBe(false);
    expect(assessment.score).toBeLessThan(3);
  });

  it("accepts a high-entropy password", () => {
    const assessment = assessMasterPassword("9f3K!qz7#Lm2$Vp8");
    expect(assessment.acceptable).toBe(true);
    expect(assessment.score).toBeGreaterThanOrEqual(3);
  });
});
