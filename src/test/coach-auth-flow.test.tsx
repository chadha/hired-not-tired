import {
  RouterProvider,
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Candidate } from "@/lib/api";
import type { AuthenticatedWorkspace, LinkedInAuthCapability } from "@/lib/linkedin-auth";

const candidateId = "2d54f369-b3a6-4b3e-b87a-e995f542e8e2";
const workspace: AuthenticatedWorkspace = {
  candidate_id: candidateId,
  identity: { sub: "stable-linkedin-subject", name: "Robin Example" },
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
const candidate: Candidate = {
  candidate_id: candidateId,
  full_name: "Robin Example",
  email: "robin@example.test",
  career_goal: "Platform Engineer",
  target_roles: ["Platform Engineer"],
  locations: ["Berlin"],
  currency: "EUR",
  remote_preference: "hybrid",
  skills: [],
  summary: "A confirmed test profile.",
  cv_text: "",
};
const capability: LinkedInAuthCapability = {
  provider: "linkedin_oidc",
  status: "available",
  authorization_path: "/api/v1/auth/linkedin/authorize",
  scopes: ["openid", "profile", "email"],
  missing: [],
  detail: "Backend LinkedIn OIDC is configured.",
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockAuthenticatedFlow(startAuthenticated = true) {
  let authenticated = startAuthenticated;
  const sessionRequests: Array<RequestInit | undefined> = [];
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === "https://backend.test/api/v1/auth/capabilities") return json(capability);
    if (url === "https://backend.test/api/v1/auth/session") {
      sessionRequests.push(init);
      return authenticated
        ? json(workspace)
        : json(
            { error: { code: "authentication_required", message: "Sign in to continue." } },
            401,
          );
    }
    if (url === `https://backend.test/api/v1/candidates/${candidateId}/profile`) {
      return json(candidate);
    }
    if (url === "https://backend.test/api/v1/jobs/discover") return json({ jobs: [] });
    if (url === `https://backend.test/api/v1/candidates/${candidateId}/workspace`) {
      return json({
        contacts: [],
        application_packages: [],
        messages: [],
        interactions: [],
        timeline: [],
      });
    }
    if (url === `https://backend.test/api/v1/coach/action-plan/${candidateId}`) {
      return json({ actions: [] });
    }
    if (url === "https://backend.test/api/v1/auth/logout") {
      authenticated = false;
      return new Response(null, { status: 204 });
    }
    if (url.includes("/demo/")) throw new Error("Demo must not be called in live mode");
    return json({ error: { message: `Unexpected test request: ${url}` } }, 404);
  });
  return { fetchMock, sessionRequests };
}

async function renderAuthRoutes(initialEntry: string) {
  window.history.replaceState({}, "", initialEntry);
  const [{ Route: LandingRoute }, { Route: CoachRoute }] = await Promise.all([
    import("@/routes/index"),
    import("@/routes/coach"),
  ]);
  const LandingComponent = LandingRoute.options.component;
  const CoachComponent = CoachRoute.options.component;
  if (!LandingComponent || !CoachComponent) throw new Error("Authentication route is missing");
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: LandingComponent,
  });
  const coachRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/coach",
    component: CoachComponent,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, coachRoute]),
    history: createBrowserHistory(),
  });
  const view = render(<RouterProvider router={router} />);
  return { router, view };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_API_BASE_URL", "https://backend.test");
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("Authenticated coach session lifecycle", () => {
  it("loads the workspace, preserves access on refresh, and signs out", async () => {
    const flow = mockAuthenticatedFlow();
    vi.stubGlobal("fetch", flow.fetchMock);
    const first = await renderAuthRoutes("/coach?auth=linkedin&first_login=1");

    await screen.findByText("Robin Example");
    await screen.findByText(/No opportunities yet/);
    expect(sessionStorage.getItem("hnt.candidate")).toBe(candidateId);
    expect(sessionStorage.getItem("hnt.candidate.demo")).toBe("0");
    expect(flow.sessionRequests).toHaveLength(1);
    expect(flow.sessionRequests[0]?.credentials).toBe("include");

    first.view.unmount();
    vi.resetModules();
    await renderAuthRoutes("/coach");
    await screen.findByText("Robin Example");
    expect(flow.sessionRequests).toHaveLength(2);
    expect(flow.sessionRequests[1]?.credentials).toBe("include");

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByRole("button", { name: "Continue with LinkedIn" });
    await waitFor(() => expect(sessionStorage.getItem("hnt.candidate")).toBeNull());
    const logout = flow.fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/api/v1/auth/logout"),
    );
    expect(logout?.[1]).toMatchObject({
      method: "POST",
      credentials: "include",
      headers: { "X-CSRF-Token": "memory-only-csrf-token" },
    });
    expect(flow.sessionRequests.at(-1)?.credentials).toBe("include");
  });

  it("shows a useful error instead of silently redirecting after session rejection", async () => {
    const flow = mockAuthenticatedFlow(false);
    vi.stubGlobal("fetch", flow.fetchMock);
    const { router } = await renderAuthRoutes("/coach?auth=linkedin&first_login=1");

    await screen.findByText("Sign in with LinkedIn to open your coach.");
    expect(router.state.location.pathname).toBe("/");
    expect(router.state.location.search).toEqual({ auth_error: "authentication_required" });
    expect(sessionStorage.getItem("hnt.candidate")).toBeNull();
    expect(flow.fetchMock.mock.calls.some(([url]) => String(url).includes("/profile"))).toBe(false);
    expect(flow.fetchMock.mock.calls.some(([url]) => String(url).includes("/demo/"))).toBe(false);
  });
});