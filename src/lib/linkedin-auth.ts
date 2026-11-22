// Backend-facing LinkedIn OIDC contracts. No token exchange or profile trust belongs in the browser.
export const LINKEDIN_OIDC_SCOPES = ["openid", "profile", "email"] as const;

export const LINKEDIN_AUTH_CONTRACT = {
  capabilities: "GET /api/v1/auth/capabilities",
  authorize: "GET /api/v1/auth/linkedin/authorize",
  callback: "GET /api/v1/auth/linkedin/callback",
  session: "GET /api/v1/auth/session",
  logout: "POST /api/v1/auth/logout",
  consent: "PUT /api/v1/account/consents",
  deleteAccount: "DELETE /api/v1/account",
} as const;

export const LINKEDIN_AUTHORIZATION_PATH = "/api/v1/auth/linkedin/authorize" as const;

export type LinkedInAuthCapability = {
  provider: "linkedin_oidc";
  status: "available" | "configuration_required" | "unavailable";
  authorization_path: string | null;
  scopes: string[];
  missing: string[];
  detail: string;
};

/** Only standard OIDC identity claims. Employment, skills and connections are not included. */
export type LinkedInIdentityClaims = {
  sub: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  email?: string;
  email_verified?: boolean;
  locale?: string;
};

export type ConsentNoticeType =
  "service_terms" | "privacy" | "analytics" | "marketing" | "research";

export type AccountConsent = {
  notice_type: ConsentNoticeType;
  notice_version: string;
  granted: boolean;
  recorded_at: string;
};

export type ConsentInput = Pick<AccountConsent, "notice_type" | "notice_version" | "granted">;

export type AuthenticatedWorkspace = {
  candidate_id: string;
  identity: LinkedInIdentityClaims;
  first_login: boolean;
  career_profile_created: boolean;
  consents: AccountConsent[];
  consent_versions: Record<ConsentNoticeType, string>;
  session_expires_at: string;
  csrf_token: string;
};

export type ConsentsResponse = {
  consents: AccountConsent[];
};

export type AccountDeletionResult = {
  status: "closed_and_anonymized";
  sessions_revoked: number;
  active_profile_deleted: boolean;
  external_identity_deleted: boolean;
  retention_notice: string;
};

export function localLinkedInAuthCapability(): LinkedInAuthCapability {
  return {
    provider: "linkedin_oidc",
    status: "configuration_required",
    authorization_path: null,
    scopes: [...LINKEDIN_OIDC_SCOPES],
    missing: Object.values(LINKEDIN_AUTH_CONTRACT),
    detail:
      "LinkedIn Developer Portal credentials and the FastAPI authentication routes are not configured. No login is simulated.",
  };
}

export function linkedInSignInBlockReason(capability: LinkedInAuthCapability): string | null {
  if (
    capability.status === "available" &&
    capability.authorization_path === LINKEDIN_AUTHORIZATION_PATH &&
    LINKEDIN_OIDC_SCOPES.every((scope) => capability.scopes.includes(scope))
  ) {
    return null;
  }
  if (capability.status === "available") {
    return "The backend advertised an invalid LinkedIn authorization configuration. Sign-in remains blocked.";
  }
  return capability.detail;
}

export function canStartLinkedInSignIn(capability: LinkedInAuthCapability): boolean {
  return linkedInSignInBlockReason(capability) === null;
}

export function linkedInAuthorizationUrl(
  backendBase: string | undefined,
  capability: LinkedInAuthCapability,
): string {
  const blocked = linkedInSignInBlockReason(capability);
  if (blocked) throw new Error(blocked);
  if (!backendBase) throw new Error("A FastAPI backend URL is required for LinkedIn sign-in.");
  return `${backendBase.replace(/\/$/, "")}${LINKEDIN_AUTHORIZATION_PATH}`;
}