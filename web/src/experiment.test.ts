import { describe, expect, it } from "vitest";
import { createExperiment, validateParameters } from "./experiment";

describe("seeded Monte Carlo calculation", () => {
  it("is reproducible regardless of batch boundaries", () => {
    const whole = createExperiment(42).batch(100_000);
    const chunks = createExperiment(42);
    chunks.batch(25_000);
    chunks.batch(25_000);
    chunks.batch(25_000);
    expect(chunks.batch(25_000)).toEqual(whole);
    expect(whole.absolute_error).toBeLessThan(0.03);
    expect(whole.estimated_standard_error).toBeGreaterThan(0);
  });
  it("supports seed zero and different seeds produce different results", () => {
    expect(createExperiment(0).batch(10_000)).toEqual(
      createExperiment(0).batch(10_000),
    );
    expect(createExperiment(0).batch(10_000).pi_estimate).not.toEqual(
      createExperiment(1).batch(10_000).pi_estimate,
    );
  });
  it.each([999, 5_000_001, 1000.5, NaN, Infinity])(
    "rejects invalid sample count %s",
    (samples) => {
      expect(validateParameters(samples, 42)).not.toBeNull();
    },
  );
  it.each([-1, 2 ** 32, 1.5, NaN])("rejects invalid seed %s", (seed) => {
    expect(validateParameters(1000, seed)).not.toBeNull();
  });
  it("accepts the API parameter boundaries", () => {
    expect(validateParameters(1000, 0)).toBeNull();
    expect(validateParameters(5_000_000, 2 ** 32 - 1)).toBeNull();
  });
});
