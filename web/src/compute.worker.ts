import { createExperiment } from "./experiment";
import type { Parameters } from "./types";

self.onmessage = ({ data }: MessageEvent<Parameters>) => {
  const experiment = createExperiment(data.seed);
  const started = performance.now();
  let processed = 0;
  function step() {
    try {
      const count = Math.min(10_000, data.samples - processed);
      const result = experiment.batch(count);
      processed += count;
      self.postMessage({
        type: "progress",
        progress: processed / data.samples,
        point: { samples: processed, estimate: result.pi_estimate },
      });
      if (processed === data.samples) {
        self.postMessage({
          type: "complete",
          result: {
            ...result,
            seed: data.seed,
            duration_seconds: (performance.now() - started) / 1000,
          },
        });
      } else {
        // Small pauses make progress and cancellation observable in the public demo.
        // Reported duration is wall time, including these pauses.
        setTimeout(step, 25);
      }
    } catch {
      self.postMessage({
        type: "error",
        message: "The browser worker could not finish this run.",
      });
    }
  }
  step();
};
