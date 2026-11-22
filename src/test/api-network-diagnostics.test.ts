import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_API_BASE_URL", "https://backend.test/");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("career engine network diagnostics", () => {
  it("calls the absolute API base and reports a safe diagnostic when fetch fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { api } = await import("@/lib/api");

    const failure = api.onboard({
      full_name: "Private Person",
      email: "private@example.com",
      career_goal: "secret goal",
      target_roles: [],
      locations: [],
      remote_preference: "any",
    });

    await expect(failure).rejects.toThrow(
      `POST https://backend.test/api/v1/candidates/onboard from ${window.location.origin} failed (TypeError: Failed to fetch)`,
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://backend.test/api/v1/candidates/onboard");
    const serialized = JSON.stringify(logged.mock.calls);
    expect(serialized).toContain("https://backend.test/api/v1/candidates/onboard");
    expect(serialized).not.toContain("private@example.com");
    expect(serialized).not.toContain("Idempotency-Key");
  });

  it("flags mixed content when an https page calls an http API", async () => {
    const { networkDiagnostic } = await import("@/lib/api");
    vi.stubGlobal("window", { location: { origin: "https://hirednottired.com" } });
    const diagnostic = networkDiagnostic(
      "GET",
      "http://api.example/api/v1/jobs?q=x",
      new TypeError("x"),
    );
    expect(diagnostic.url).toBe("http://api.example/api/v1/jobs");
    expect(diagnostic.hint).toMatch(/mixed content/);
  });

  it("shows the server reference for readable 500 responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "internal_error",
              message: "An unexpected error occurred.",
              request_id: "req123",
            },
          }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const { api } = await import("@/lib/api");
    await expect(api.getProviderCapabilities()).rejects.toThrow(
      "An unexpected error occurred. (Reference: req123)",
    );
  });
});