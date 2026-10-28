import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, normalizeBaseUrl } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("HTTP adapter", () => {
  it("normalises valid URLs and rejects embedded credentials or invalid protocols", () => {
    expect(normalizeBaseUrl("https://api.example.test/")).toBe(
      "https://api.example.test",
    );
    for (const value of [
      "javascript:alert(1)",
      "https://user:secret@example.test",
      "https://example.test?key=secret",
    ])
      expect(() => normalizeBaseUrl(value)).toThrow();
  });
  it("sends a key in the header and uses an idempotency key for submission", async () => {
    const mock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "job" }), { status: 202 }),
      );
    vi.stubGlobal("fetch", mock);
    const client = new ApiClient("https://api.example.test", "memory-only-key");
    await client.submit({ samples: 1000, seed: 42 });
    const [url, options] = mock.mock.calls[0];
    expect(url).toBe("https://api.example.test/v1/jobs");
    expect(options.headers["X-API-Key"]).toBe("memory-only-key");
    expect(options.headers["Idempotency-Key"]).toBeTruthy();
    expect(options.body).not.toContain("memory-only-key");
    client.dispose();
  });
  it("reports authentication failures clearly", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response('{"detail":"unauthorised"}', { status: 401 }),
        ),
    );
    await expect(
      new ApiClient("https://api.example.test", "wrong").list(),
    ).rejects.toThrow("not accepted");
  });
  it("rejects the wrong server response rather than exposing invalid state to the UI", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response('{"items":[{"id":"incomplete"}]}')),
    );
    await expect(
      new ApiClient("https://api.example.test", "key").list(),
    ).rejects.toThrow("valid Experiment");
  });
  it("reports a network or CORS error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    await expect(
      new ApiClient("https://api.example.test", "key").list(),
    ).rejects.toThrow("CORS");
  });
  it("aborts pending requests on disconnect", async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, options) => {
        signal = options.signal;
        return new Promise((_resolve, reject) =>
          signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          ),
        );
      }),
    );
    const client = new ApiClient("https://api.example.test", "key");
    const request = client.list();
    client.dispose();
    expect(signal?.aborted).toBe(true);
    await expect(request).rejects.toThrow("disconnected");
  });
});
