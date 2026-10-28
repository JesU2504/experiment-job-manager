export type Status =
  "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type Parameters = { samples: number; seed: number };
export type Point = { samples: number; estimate: number };
export type Result = {
  samples: number;
  seed: number;
  pi_estimate: number;
  absolute_error: number;
  estimated_standard_error: number;
  duration_seconds: number;
};
export type Job = {
  id: string;
  kind: string;
  parameters: Parameters;
  status: Status;
  progress: number;
  attempts: number;
  max_attempts: number;
  result: Result | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  example?: boolean;
};
export type JobEvent = {
  id: number;
  status: Status;
  message: string;
  created_at: string;
};
export type WorkerMessage =
  | { type: "progress"; progress: number; point: Point }
  | { type: "complete"; result: Result }
  | { type: "error"; message: string };
export interface Client {
  mode: "demo" | "api";
  list(): Promise<Job[]>;
  submit(parameters: Parameters): Promise<Job>;
  cancel(id: string): Promise<Job>;
  retry(id: string): Promise<Job>;
  events(id: string): Promise<JobEvent[]>;
  series(id: string): Point[];
  subscribe?(listener: () => void): () => void;
  clearFinished?(): void;
  dispose(): void;
}
