import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthenticatedWorkspace, LinkedInAuthCapability } from "@/lib/linkedin-auth";

const configurationRequired: LinkedInAuthCapability = {
  provider: "linkedin_oidc",
  status: "configuration_required",
  authorization_path: null,
  scopes: ["openid", "profile", "email"],
  missing: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
  detail: "LinkedIn Developer Portal credentials are not configured. No login is simulated.",
};

const available: LinkedInAuthCapability = {
  ...configurationRequired,
  status: "available",
  authorization_path: "/api/v1/auth/linkedin/authorize",
  missing: [],
  detail: "Backend LinkedIn OIDC is configured.",
};

const workspace: AuthenticatedWorkspace = {
  candidate_id: "2d54f369-b3a6-4b3e-b87a-e995f542e8e2",
  identity: { sub: "stable-linkedin-subject", name: "Example User" },
  first_login: true,
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

function mockAuthResponses(capability: LinkedInAuthCapability, sessionResponse: Response) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url === "https://backend.test/api/v1/auth/capabilities") return json(capability);
    if (url === "https://backend.test/api/v1/auth/session") return sessionResponse;
    if (url.includes("/demo/")) throw new Error("Demo must not be called in live mode");
    return json({ error: { message: "Unexpected test request" } }, 404);
  });
}

async function renderLiveLanding(initialEntry = "/") {
  window.history.replaceState({}, "", initialEntry);
  const { Route } = await import("@/routes/index");
  const LandingComponent = Route.options.component;
  if (!LandingComponent) throw new Error("Landing route component is missing");
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: LandingComponent,
  });
  const coachRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/coach",
    component: () => <div>Authenticated coach</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, coachRoute]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_API_BASE_URL", "https://backend.test");
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("Live LinkedIn authentication flow", () => {
  it("disables configuration_required sign-in and never renders demo access", async () => {
    vi.stubGlobal(
      "fetch",
      mockAuthResponses(
        configurationRequired,
        json({ error: { message: "Sign in to continue." } }, 401),
      ),
    );
    await renderLiveLanding();

    await screen.findByText(/LinkedIn Developer Portal credentials are not configured/);
    expect(screen.getByRole("button", { name: "Continue with LinkedIn" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Explore the local demo" })).toBeNull();
    expect(screen.queryByText(/Opening secure sign-in/)).toBeNull();
  });

  it("shows backend failure without substituting demo success", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline")));
    await renderLiveLanding();

    await screen.findByText(/Integration access required/);
    expect(
      (await screen.findAllByText(/No local demo success was substituted/)).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Continue with LinkedIn" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Explore the local demo" })).toBeNull();
  });

  it("keeps callback errors visible without bootstrapping an older session", async () => {
    const fetchMock = mockAuthResponses(configurationRequired, json(workspace));
    vi.stubGlobal("fetch", fetchMock);
    await renderLiveLanding("/?auth_error=oauth_validation_failed&error_description=private");

    await screen.findByText("LinkedIn sign-in could not be validated. No session was created.");
    expect(screen.queryByText(/private/)).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://backend.test/api/v1/auth/capabilities");
    expect(screen.queryByText("Authenticated coach")).toBeNull();
  });

  it("bootstraps a mocked successful session and enters the authenticated coach", async () => {
    const fetchMock = mockAuthResponses(available, json(workspace));
    vi.stubGlobal("fetch", fetchMock);
    await renderLiveLanding();

    await screen.findByText("Authenticated coach");
    expect(sessionStorage.getItem("hnt.candidate")).toBe(workspace.candidate_id);
    expect(sessionStorage.getItem("hnt.candidate.demo")).toBe("0");
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://backend.test/api/v1/auth/capabilities",
      "https://backend.test/api/v1/auth/session",
    ]);
  });

  it("discards stale invalid_state and still bootstraps an authenticated session", async () => {
    const fetchMock = mockAuthResponses(available, json(workspace));
    vi.stubGlobal("fetch", fetchMock);
    await renderLiveLanding("/?auth_error=invalid_state&utm_source=linkedin#details");

    await screen.findByText("Authenticated coach");
    expect(
      screen.queryByText("The sign-in attempt expired or was invalid. Please start again."),
    ).toBeNull();
    expect(window.location.search).toBe("?utm_source=linkedin");
    expect(window.location.hash).toBe("#details");
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://backend.test/api/v1/auth/capabilities",
      "https://backend.test/api/v1/auth/session",
    ]);
  });

  it("leaves the home page clean when invalid_state has no active session", async () => {
    const fetchMock = mockAuthResponses(
      available,
      json({ error: { message: "Sign in to continue." } }, 401),
    );
    vi.stubGlobal("fetch", fetchMock);
    await renderLiveLanding("/?auth_error=invalid_state");

    await screen.findByRole("button", { name: "Continue with LinkedIn" });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "https://backend.test/api/v1/auth/session",
        expect.anything(),
      ),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(window.location.search).toBe("");
    expect(screen.queryByText("Authenticated coach")).toBeNull();
  });
});