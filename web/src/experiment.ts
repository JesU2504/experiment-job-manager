/** Mulberry32 PRNG. Browser demo and Python use different PRNGs; each is seeded. */
export function createExperiment(seed: number) {
  let state = seed >>> 0;
  let processed = 0;
  let inside = 0;
  function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }
  return {
    batch(count: number) {
      for (let i = 0; i < count; i++) {
        const x = random();
        const y = random();
        if (x * x + y * y <= 1) inside++;
      }
      processed += count;
      const fraction = inside / processed;
      return {
        samples: processed,
        pi_estimate: 4 * fraction,
        absolute_error: Math.abs(4 * fraction - Math.PI),
        estimated_standard_error:
          4 * Math.sqrt((fraction * (1 - fraction)) / processed),
      };
    },
  };
}

export function validateParameters(
  samples: number,
  seed: number,
): string | null {
  if (!Number.isInteger(samples) || samples < 1000 || samples > 5_000_000)
    return "Use a whole number of samples between 1,000 and 5,000,000.";
  if (!Number.isInteger(seed) || seed < 0 || seed > 2 ** 32 - 1)
    return "Use a whole-number seed between 0 and 4,294,967,295.";
  return null;
}
