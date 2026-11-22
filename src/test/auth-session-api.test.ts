import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedWorkspace } from "@/lib/linkedin-auth";

const workspace: AuthenticatedWorkspace = {
  candidate_id: "2d54f369-b3a6-4b3e-b87a-e995f542e8e2",
  identity: { sub: "linkedin-subject", name: "Example User", email_verified: false },
  first_login: false,
  career_profile_created: true,
  consents: [],
  consent_versions: {
    service_terms: "terms-v1",
    privacy: "privacy-v1",
    analytics: "optional-v1",
    marketing: "optional-v1",
    research: "optional-v1",
  },
  session_expires_at: "2026-11-29T03:00:00Z",
  csrf_token: "memory-only-csrf-token",
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_API_BASE_URL", "https://backend.test/");
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("FastAPI session client contract", () => {
  it("bootstraps with credentials and keeps CSRF out of browser storage", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(json(workspace));
    vi.stubGlobal("fetch", fetchMock);
    const { api } = await import("@/lib/api");

    await expect(api.linkedinAuthSession()).resolves.toEqual(workspace);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://backend.test/api/v1/auth/session");
    expect(init?.credentials).toBe("include");
    expect(init?.headers).toEqual({});
    expect(sessionStorage.getItem("hnt.candidate")).toBeNull();
    expect(localStorage.getItem("hnt.csrf")).toBeNull();
  });

  it("sends exact versioned consent and logout requests with the in-memory CSRF token", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(workspace))
      .mockResolvedValueOnce(json({ consents: [] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const { api } = await import("@/lib/api");
    const authenticated = await api.linkedinAuthSession();

    await api.updateConsents([
      {
        notice_type: "marketing",
        notice_version: authenticated.consent_versions.marketing,
        granted: true,
      },
    ]);
    const [, consentInit] = fetchMock.mock.calls[1] ?? [];
    expect(consentInit?.method).toBe("PUT");
    expect(consentInit?.credentials).toBe("include");
    expect(consentInit?.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-CSRF-Token": "memory-only-csrf-token",
    });
    expect(consentInit?.body).toBe(
      JSON.stringify({
        consents: [{ notice_type: "marketing", notice_version: "optional-v1", granted: true }],
      }),
    );

    await api.logoutLinkedIn();
    const [, logoutInit] = fetchMock.mock.calls[2] ?? [];
    expect(logoutInit?.method).toBe("POST");
    expect(logoutInit?.credentials).toBe("include");
    expect(logoutInit?.headers).toMatchObject({ "X-CSRF-Token": "memory-only-csrf-token" });
  });

  it("requires the exact deletion confirmation and accepts the truthful retention result", async () => {
    const result = {
      status: "closed_and_anonymized",
      sessions_revoked: 1,
      active_profile_deleted: true,
      external_identity_deleted: true,
      retention_notice: "Active data deleted; backup retention applies.",
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(workspace))
      .mockResolvedValueOnce(json(result));
    vi.stubGlobal("fetch", fetchMock);
    const { api } = await import("@/lib/api");
    await api.linkedinAuthSession();

    await expect(api.deleteAccount("DELETE")).resolves.toEqual(result);
    const [url, init] = fetchMock.mock.calls[1] ?? [];
    expect(url).toBe("https://backend.test/api/v1/account");
    expect(init?.method).toBe("DELETE");
    expect(init?.body).toBe(JSON.stringify({ confirmation: "DELETE" }));
    expect(init?.headers).toMatchObject({ "X-CSRF-Token": "memory-only-csrf-token" });
  });

  it("surfaces safe backend error messages without demo fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        json(
          {
            error: { code: "integration_not_configured", message: "LinkedIn is not configured." },
          },
          503,
        ),
      ),
    );
    const { api } = await import("@/lib/api");
    const request = api.linkedinAuthSession();
    await expect(request).rejects.toMatchObject({
      status: 503,
      message: "LinkedIn is not configured.",
    });
  });
});