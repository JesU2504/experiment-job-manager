import { validateParameters } from "./experiment";
import type {
  Client,
  Job,
  JobEvent,
  Parameters,
  Point,
  Status,
  WorkerMessage,
} from "./types";
import { isEvent, isJob, isPoint } from "./validation";

const STORAGE_KEY = "ejm-demo-v1";
type RecordData = { job: Job; events: JobEvent[]; series: Point[] };
type WorkerLike = Pick<
  Worker,
  "postMessage" | "terminate" | "onmessage" | "onerror"
>;
type StorageLike = Pick<Storage, "getItem" | "setItem">;
const defaultWorker = () =>
  new Worker(new URL("./compute.worker.ts", import.meta.url), {
    type: "module",
  });
const terminal = (status: Status) =>
  ["succeeded", "failed", "cancelled"].includes(status);

export class DemoClient implements Client {
  mode = "demo" as const;
  private records: RecordData[] = [];
  private listeners = new Set<() => void>();
  private active: { id: string; attempt: number; worker: WorkerLike } | null =
    null;
  private disposed = false;

  constructor(
    private storage?: StorageLike,
    private workerFactory: () => WorkerLike = defaultWorker,
  ) {
    try {
      const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "[]");
      if (Array.isArray(saved)) {
        this.records = saved
          .filter(
            (item) =>
              isJob(item?.job) &&
              Array.isArray(item.events) &&
              item.events.every(isEvent) &&
              Array.isArray(item.series) &&
              item.series.every(isPoint),
          )
          .slice(0, 100);
      }
    } catch {
      /* An unavailable or malformed session store starts a clean demo. */
    }
    for (const record of this.records) {
      if (!terminal(record.job.status)) {
        record.job.status = "cancelled";
        record.job.finished_at = record.job.updated_at =
          new Date().toISOString();
        this.addEvent(
          record,
          "cancelled",
          "The previous browser session ended before completion.",
        );
      }
    }
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.records));
    } catch {
      /* Computation still works without storage. */
    }
    this.listeners.forEach((listener) => listener());
  }

  private addEvent(record: RecordData, status: Status, message: string) {
    record.events.push({
      id: record.events.length + 1,
      status,
      message,
      created_at: new Date().toISOString(),
    });
  }

  private find(id: string) {
    const record = this.records.find((item) => item.job.id === id);
    if (!record) throw new Error("This experiment could not be found.");
    return record;
  }

  async list() {
    return this.records.map((record) => structuredClone(record.job));
  }
  async events(id: string) {
    return structuredClone(this.find(id).events);
  }
  series(id: string) {
    return this.find(id).series.slice();
  }

  async submit(parameters: Parameters, example = false) {
    const error = validateParameters(parameters.samples, parameters.seed);
    if (error) throw new Error(error);
    if (this.disposed) throw new Error("This demo session has ended.");
    if (this.records.length >= 100)
      throw new Error("Clear finished runs before adding more experiments.");
    const now = new Date().toISOString();
    const job: Job = {
      id: crypto.randomUUID(),
      kind: "monte_carlo_pi",
      parameters: { ...parameters },
      status: "queued",
      progress: 0,
      attempts: 0,
      max_attempts: 3,
      result: null,
      error: null,
      created_at: now,
      updated_at: now,
      started_at: null,
      finished_at: null,
      example,
    };
    const record = { job, events: [], series: [] } as RecordData;
    this.addEvent(record, "queued", "Experiment added to the browser queue.");
    this.records.unshift(record);
    this.emit();
    this.pump();
    return structuredClone(job);
  }

  private pump() {
    if (this.active || this.disposed) return;
    const record = [...this.records]
      .reverse()
      .find((item) => item.job.status === "queued");
    if (!record) return;
    const job = record.job;
    job.status = "running";
    job.attempts++;
    job.progress = 0;
    job.started_at = job.updated_at = new Date().toISOString();
    this.addEvent(
      record,
      "running",
      "Browser worker started the seeded calculation.",
    );
    const attempt = job.attempts;
    let worker: WorkerLike;
    try {
      worker = this.workerFactory();
    } catch {
      job.status = "failed";
      job.error = "Web Workers are unavailable in this browser.";
      job.finished_at = new Date().toISOString();
      this.addEvent(record, "failed", job.error);
      this.emit();
      this.pump();
      return;
    }
    this.active = { id: job.id, attempt, worker };
    const owns = () =>
      this.active?.id === job.id &&
      this.active.attempt === attempt &&
      job.status === "running";
    const fail = (message: string) => {
      if (!owns()) return;
      job.status = "failed";
      job.error = message;
      job.finished_at = job.updated_at = new Date().toISOString();
      this.addEvent(record, "failed", message);
      worker.terminate();
      this.active = null;
      this.emit();
      this.pump();
    };
    worker.onerror = () =>
      fail("The browser worker stopped unexpectedly. You can retry this run.");
    worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
      if (!owns()) return;
      if (data.type === "error") {
        fail(data.message);
        return;
      }
      job.updated_at = new Date().toISOString();
      if (data.type === "progress") {
        job.progress = data.progress;
        record.series.push(data.point);
        // Keep a bounded convergence trace, always retaining its latest point.
        if (record.series.length > 64)
          record.series = record.series.filter(
            (_, i) => i % 2 === 0 || i === record.series.length - 1,
          );
      } else {
        job.status = "succeeded";
        job.progress = 1;
        job.result = data.result;
        job.finished_at = job.updated_at;
        this.addEvent(
          record,
          "succeeded",
          "Result and reproducibility metadata saved in this tab.",
        );
        worker.terminate();
        this.active = null;
      }
      this.emit();
      this.pump();
    };
    worker.postMessage(parametersFor(job));
    this.emit();
  }

  async cancel(id: string) {
    const record = this.find(id);
    if (record.job.status === "cancelled") return structuredClone(record.job);
    if (terminal(record.job.status))
      throw new Error("Only queued or running experiments can be cancelled.");
    record.job.status = "cancelled";
    record.job.finished_at = record.job.updated_at = new Date().toISOString();
    this.addEvent(
      record,
      "cancelled",
      "Experiment cancelled. No later result can overwrite it.",
    );
    if (this.active?.id === id) {
      this.active.worker.terminate();
      this.active = null;
    }
    this.emit();
    this.pump();
    return structuredClone(record.job);
  }

  async retry(id: string) {
    const record = this.find(id);
    const job = record.job;
    if (
      !["cancelled", "failed"].includes(job.status) ||
      job.attempts >= job.max_attempts
    )
      throw new Error(
        "Retry requires a failed or cancelled run with attempts remaining.",
      );
    Object.assign(job, {
      status: "queued",
      progress: 0,
      result: null,
      error: null,
      started_at: null,
      finished_at: null,
      updated_at: new Date().toISOString(),
    });
    record.series = [];
    this.addEvent(record, "queued", "Experiment queued for another attempt.");
    this.emit();
    this.pump();
    return structuredClone(job);
  }

  clearFinished() {
    this.records = this.records.filter(
      (record) => !terminal(record.job.status),
    );
    this.emit();
  }

  dispose() {
    this.disposed = true;
    this.active?.worker.terminate();
    this.active = null;
    this.listeners.clear();
  }
}

const parametersFor = (job: Job) => ({ ...job.parameters });
