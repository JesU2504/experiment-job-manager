import type { Client, Job, JobEvent, Parameters } from "./types";
import { isEvent, isJob } from "./validation";

export function normalizeBaseUrl(value: string) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Enter an HTTP or HTTPS API URL without credentials, query parameters or fragments.",
    );
  return url.toString().replace(/\/+$/, "");
}

export class ApiClient implements Client {
  mode = "api" as const;
  private base: string;
  private controllers = new Set<AbortController>();
  constructor(
    base: string,
    private key: string,
  ) {
    this.base = normalizeBaseUrl(base);
  }

  private async request<T>(
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const headers: Record<string, string> = { "X-API-Key": this.key };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
      const response = await fetch(this.base + path, {
        method: body === undefined ? "GET" : "POST",
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error("The server did not return a valid JSON response.");
      }
      if (!response.ok) {
        if (response.status === 401)
          throw new Error(
            "The API key was not accepted. Check it and reconnect.",
          );
        throw new Error(
          typeof data.detail === "string"
            ? data.detail
            : `The API returned HTTP ${response.status}.`,
        );
      }
      return data as T;
    } catch (error) {
      if (error instanceof TypeError)
        throw new Error(
          "Could not reach the API. Check its URL, network access and CORS configuration.",
        );
      if (error instanceof DOMException && error.name === "AbortError")
        throw new Error("The API request timed out or was disconnected.");
      throw error;
    } finally {
      clearTimeout(timer);
      this.controllers.delete(controller);
    }
  }

  async list() {
    const data = await this.request<{ items: Job[] }>("/v1/jobs?limit=100");
    if (!data || !Array.isArray(data.items) || !data.items.every(isJob))
      throw new Error(
        "This server did not return valid Experiment Job Manager data.",
      );
    return data.items;
  }
  submit(parameters: Parameters) {
    return this.request<Job>("/v1/jobs", { parameters }, crypto.randomUUID());
  }
  cancel(id: string) {
    return this.request<Job>(`/v1/jobs/${encodeURIComponent(id)}/cancel`, {});
  }
  retry(id: string) {
    return this.request<Job>(`/v1/jobs/${encodeURIComponent(id)}/retry`, {});
  }
  async events(id: string) {
    const data = await this.request<JobEvent[]>(
      `/v1/jobs/${encodeURIComponent(id)}/events?limit=200`,
    );
    if (!Array.isArray(data) || !data.every(isEvent))
      throw new Error("The API returned an invalid event history.");
    return data;
  }
  series() {
    return [];
  }
  dispose() {
    this.controllers.forEach((controller) => controller.abort());
    this.controllers.clear();
    this.key = "";
  }
}
