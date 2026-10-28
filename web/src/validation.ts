import { validateParameters } from "./experiment";
import type { Job, JobEvent, Point } from "./types";

const statuses = new Set([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
const timestamp = (value: unknown) =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function isJob(value: unknown): value is Job {
  if (!value || typeof value !== "object") return false;
  const job = value as Job;
  if (
    typeof job.id !== "string" ||
    typeof job.kind !== "string" ||
    !statuses.has(job.status)
  )
    return false;
  if (job.error !== null && typeof job.error !== "string") return false;
  if (
    !job.parameters ||
    validateParameters(job.parameters.samples, job.parameters.seed)
  )
    return false;
  if (!finite(job.progress) || job.progress < 0 || job.progress > 1)
    return false;
  if (
    !Number.isInteger(job.attempts) ||
    !Number.isInteger(job.max_attempts) ||
    job.max_attempts < 1 ||
    job.max_attempts > 5 ||
    job.attempts < 0 ||
    job.attempts > job.max_attempts
  )
    return false;
  if (!timestamp(job.created_at) || !timestamp(job.updated_at)) return false;
  if (job.started_at !== null && !timestamp(job.started_at)) return false;
  if (job.finished_at !== null && !timestamp(job.finished_at)) return false;
  if (job.result !== null) {
    if (typeof job.result !== "object") return false;
    for (const key of [
      "samples",
      "seed",
      "pi_estimate",
      "absolute_error",
      "estimated_standard_error",
      "duration_seconds",
    ] as const) {
      if (!finite(job.result[key])) return false;
    }
  }
  return job.status !== "succeeded" || job.result !== null;
}

export function isEvent(value: unknown): value is JobEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as JobEvent;
  return (
    Number.isInteger(event.id) &&
    statuses.has(event.status) &&
    typeof event.message === "string" &&
    timestamp(event.created_at)
  );
}

export function isPoint(value: unknown): value is Point {
  if (!value || typeof value !== "object") return false;
  const point = value as Point;
  return (
    finite(point.samples) &&
    point.samples > 0 &&
    finite(point.estimate) &&
    point.estimate >= 0 &&
    point.estimate <= 4
  );
}
