import { describe, expect, it } from "vitest";
import { DemoClient } from "./demo";
import { createExperiment } from "./experiment";
import type { Parameters, Result, WorkerMessage } from "./types";

class FakeWorker {
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  parameters: Parameters | null = null;
  postMessage(parameters: Parameters) {
    this.parameters = parameters;
  }
  terminate() {
    this.terminated = true;
  }
  send(data: WorkerMessage) {
    this.onmessage?.({ data } as MessageEvent<WorkerMessage>);
  }
}
function harness(storage?: Pick<Storage, "getItem" | "setItem">) {
  const workers: FakeWorker[] = [];
  const client = new DemoClient(storage, () => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker as unknown as Worker;
  });
  return { client, workers };
}
const params = { samples: 1000, seed: 42 };
const result: Result = {
  ...createExperiment(42).batch(1000),
  seed: 42,
  duration_seconds: 0.1,
};

describe("browser queue lifecycle", () => {
  it("processes one run at a time and advances the next queued run", async () => {
    const { client, workers } = harness();
    const first = await client.submit(params);
    const second = await client.submit(params);
    expect(workers).toHaveLength(1);
    expect(
      (await client.list()).find((job) => job.id === second.id)?.status,
    ).toBe("queued");
    workers[0].send({
      type: "progress",
      progress: 0.5,
      point: { samples: 500, estimate: 3.1 },
    });
    expect(client.series(first.id)).toHaveLength(1);
    workers[0].send({ type: "complete", result });
    expect(workers).toHaveLength(2);
    expect(
      (await client.list()).find((job) => job.id === first.id)?.result,
    ).toEqual(result);
    expect(
      (await client.events(first.id)).map((event) => event.status),
    ).toEqual(["queued", "running", "succeeded"]);
    client.dispose();
  });
  it("rejects stale writes after cancellation and retry", async () => {
    const { client, workers } = harness();
    const job = await client.submit(params);
    await client.cancel(job.id);
    await client.retry(job.id);
    workers[0].send({ type: "complete", result });
    expect((await client.list())[0].status).toBe("running");
    expect((await client.list())[0].result).toBeNull();
    workers[1].send({ type: "complete", result });
    expect((await client.list())[0].status).toBe("succeeded");
    expect((await client.list())[0].attempts).toBe(2);
    expect((await client.events(job.id)).map((event) => event.status)).toEqual([
      "queued",
      "running",
      "cancelled",
      "queued",
      "running",
      "succeeded",
    ]);
    client.dispose();
  });
  it("does not consume an attempt when cancelling queued work", async () => {
    const { client, workers } = harness();
    await client.submit(params);
    const queued = await client.submit(params);
    const cancelled = await client.cancel(queued.id);
    expect(cancelled.attempts).toBe(0);
    await client.cancel(queued.id);
    expect(await client.events(queued.id)).toHaveLength(2);
    expect(workers).toHaveLength(1);
    client.dispose();
  });
  it("enforces the attempt budget", async () => {
    const { client } = harness();
    const job = await client.submit(params);
    for (let i = 0; i < 2; i++) {
      await client.cancel(job.id);
      await client.retry(job.id);
    }
    await client.cancel(job.id);
    await expect(client.retry(job.id)).rejects.toThrow("attempts remaining");
    client.dispose();
  });
  it("records worker errors and permits a manual retry", async () => {
    const { client, workers } = harness();
    const job = await client.submit(params);
    workers[0].send({ type: "error", message: "Example worker error" });
    expect((await client.list())[0].status).toBe("failed");
    await client.retry(job.id);
    expect((await client.list())[0].error).toBeNull();
    client.dispose();
  });
  it("recovers unfinished work as cancelled after reload", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const first = harness(storage);
    await first.client.submit(params);
    first.client.dispose();
    const restored = harness(storage);
    expect((await restored.client.list())[0].status).toBe("cancelled");
    expect(
      (await restored.client.events((await restored.client.list())[0].id)).at(
        -1,
      )?.message,
    ).toContain("previous browser session");
    restored.client.dispose();
  });
  it("ignores malformed saved data and still works when storage is unavailable", async () => {
    const malformed = harness({
      getItem: () => '[{"job":{"id":"broken"}}]',
      setItem: () => {},
    });
    expect(await malformed.client.list()).toEqual([]);
    const denied = harness({
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
    });
    await expect(denied.client.submit(params)).resolves.toMatchObject({
      status: "running",
    });
    malformed.client.dispose();
    denied.client.dispose();
  });
  it("clears only finished runs and preserves current work", async () => {
    const { client, workers } = harness();
    const first = await client.submit(params);
    workers[0].send({ type: "complete", result });
    const active = await client.submit(params);
    client.clearFinished();
    expect((await client.list()).map((job) => job.id)).toEqual([active.id]);
    await expect(client.events(first.id)).rejects.toThrow("could not be found");
    client.dispose();
  });
});
