import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LinkedInSignInActions } from "@/components/hnt/linkedin-auth";
import {
  canStartLinkedInSignIn,
  linkedInAuthorizationUrl,
  linkedInSignInBlockReason,
  LINKEDIN_AUTH_CONTRACT,
  LINKEDIN_AUTHORIZATION_PATH,
  LINKEDIN_OIDC_SCOPES,
  localLinkedInAuthCapability,
  type LinkedInAuthCapability,
} from "@/lib/linkedin-auth";

function available(overrides: Partial<LinkedInAuthCapability> = {}): LinkedInAuthCapability {
  return {
    provider: "linkedin_oidc",
    status: "available",
    authorization_path: LINKEDIN_AUTHORIZATION_PATH,
    scopes: [...LINKEDIN_OIDC_SCOPES],
    missing: [],
    detail: "Backend-verified test capability.",
    ...overrides,
  };
}

function renderActions(capability: LinkedInAuthCapability, allowDemo = true) {
  const onLinkedIn = vi.fn();
  const onDemo = vi.fn();
  render(
    <LinkedInSignInActions
      capability={capability}
      checking={false}
      authBusy={false}
      demoBusy={false}
      allowDemo={allowDemo}
      onLinkedIn={onLinkedIn}
      onDemo={onDemo}
    />,
  );
  return { onLinkedIn, onDemo };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("LinkedIn-only authentication boundary", () => {
  it("requests only the three standard OIDC scopes", () => {
    expect(LINKEDIN_OIDC_SCOPES).toEqual(["openid", "profile", "email"]);
    expect(localLinkedInAuthCapability().scopes).toEqual(["openid", "profile", "email"]);
  });

  it("blocks local sign-in and never invents an authorization URL", () => {
    const capability = localLinkedInAuthCapability();
    expect(capability.status).toBe("configuration_required");
    expect(capability.authorization_path).toBeNull();
    expect(canStartLinkedInSignIn(capability)).toBe(false);
    expect(linkedInSignInBlockReason(capability)).toContain("No login is simulated");
    expect(() => linkedInAuthorizationUrl(undefined, capability)).toThrow("No login is simulated");
    expect(capability.missing).toContain(LINKEDIN_AUTH_CONTRACT.callback);
    expect(capability.missing).toContain(LINKEDIN_AUTH_CONTRACT.deleteAccount);
  });

  it("accepts only the exact backend authorization route when all scopes are advertised", () => {
    expect(canStartLinkedInSignIn(available())).toBe(true);
    expect(linkedInAuthorizationUrl("https://backend.test/", available())).toBe(
      "https://backend.test/api/v1/auth/linkedin/authorize",
    );
    expect(canStartLinkedInSignIn(available({ scopes: ["openid"] }))).toBe(false);
  });

  it("rejects an external or browser-supplied authorization destination", () => {
    const malicious = available({ authorization_path: "https://evil.test/authorize" });
    expect(canStartLinkedInSignIn(malicious)).toBe(false);
    expect(() => linkedInAuthorizationUrl("https://backend.test", malicious)).toThrow(
      "invalid LinkedIn authorization configuration",
    );
  });

  it("shows a disabled sign-in button and clearly labeled demo instead of fake success", () => {
    const { onLinkedIn, onDemo } = renderActions(localLinkedInAuthCapability());
    const signIn = screen.getByRole("button", { name: "Continue with LinkedIn" });
    expect(signIn).toBeDisabled();
    fireEvent.click(signIn);
    expect(onLinkedIn).not.toHaveBeenCalled();
    expect(screen.getByText(/Integration access required/)).toBeInTheDocument();
    expect(
      screen.getByText(/DEMO · fictional data · no account or LinkedIn login/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Explore the local demo" }));
    expect(onDemo).toHaveBeenCalledOnce();
  });

  it("does not expose guest/demo access in live authentication mode", () => {
    renderActions(localLinkedInAuthCapability(), false);
    expect(
      screen.queryByRole("button", { name: "Explore the local demo" }),
    ).not.toBeInTheDocument();
  });

  it("enables sign-in only for a backend-advertised authorized capability", () => {
    const { onLinkedIn } = renderActions(available());
    const signIn = screen.getByRole("button", { name: "Continue with LinkedIn" });
    expect(signIn).toBeEnabled();
    fireEvent.click(signIn);
    expect(onLinkedIn).toHaveBeenCalledOnce();
  });

  it("reports the missing live capability endpoint without demo fallback", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://backend.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "Not Found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const { api } = await import("@/lib/api");
    await expect(api.linkedinAuthCapability()).rejects.toThrow(
      "Required backend endpoint unavailable: GET /api/v1/auth/capabilities",
    );
  });
});