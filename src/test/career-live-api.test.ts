import { afterEach, describe, expect, it, vi } from "vitest";
import { createApplicationPackage } from "@/lib/application-package";
import type { Candidate, Job } from "@/lib/api";
import { makeCandidateContact } from "@/lib/hiring-contacts";

const job: Job = {
  job_id: "job_live",
  title: "Platform Engineer",
  company: "Example Engineering",
  location: "Berlin",
  description: "Build reliable Python services.",
  requirements: ["Python"],
  currency: "EUR",
  remote_type: "hybrid",
  source: "job_url_import",
  source_url: "https://example.com/jobs/platform",
  retrieved_at: "2026-11-22T00:00:00.000Z",
  is_demo: false,
};
const candidate: Candidate = {
  candidate_id: "candidate_live",
  full_name: "Amara Example",
  email: "amara@example.test",
  career_goal: "Platform Engineer",
  target_roles: ["Platform Engineer"],
  locations: ["Berlin"],
  currency: "EUR",
  remote_preference: "hybrid",
  skills: ["Python"],
  summary: "Platform engineer",
  cv_text: "Platform Engineer\nBuilt Python services.",
  master_profile_version: 3,
  profile_confirmed_at: "2026-11-22T00:00:00.000Z",
};
const contactInput = {
  full_name: "Robin Example",
  current_title: "Engineering Lead",
  company: "Example Engineering",
  profile_url: "https://www.linkedin.com/in/robin-example",
  email: "robin@example.test",
  location: "Berlin",
  source_url: "https://example.com/team",
  evidence_notes: "Public team-page evidence",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function liveApi(fetchMock: ReturnType<typeof vi.fn>) {
  vi.resetModules();
  vi.stubEnv("VITE_API_BASE_URL", "https://backend.test");
  vi.stubGlobal("fetch", fetchMock);
  return import("@/lib/api");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("durable career API wiring", () => {
  it("adds the authenticated CSRF token, an idempotency key and contact email", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({ candidate_id: "candidate_live", csrf_token: "csrf-test", consents: [] }),
      )
      .mockResolvedValueOnce(response({ contact_id: "contact_live" }));
    const { api } = await liveApi(fetchMock);
    await api.linkedinAuthSession();
    await api.createContact("candidate_live", job, contactInput);
    const init = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["X-CSRF-Token"]).toBe("csrf-test");
    expect(headers["Idempotency-Key"]).toMatch(/[0-9a-f-]{36}/);
    expect(JSON.parse(init.body as string).evidence.email).toBe("robin@example.test");
  });

  it("binds package edits to the server revision", async () => {
    const applicationPackage = {
      ...createApplicationPackage(candidate, job, undefined, "2026-11-22T00:00:00.000Z"),
      revision: 7,
      is_demo: false as const,
    };
    const fetchMock = vi.fn().mockResolvedValue(response(applicationPackage));
    const { api } = await liveApi(fetchMock);
    await api.saveApplicationCv(applicationPackage, "Candidate-reviewed CV version");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)["If-Match"]).toBe("7");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBeTruthy();
  });

  it("uses the real import, discovery and workspace resources without local substitution", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(job))
      .mockResolvedValueOnce(
        response({
          status: "not_configured",
          contacts: [],
          fallback_url: "https://www.linkedin.com/search/results/people/?keywords=Platform",
          detail: "No provider",
          searched_at: "2026-11-22T00:00:00.000Z",
        }),
      )
      .mockResolvedValueOnce(
        response({
          contacts: [],
          application_packages: [],
          messages: [],
          interactions: [],
          timeline: [],
        }),
      );
    const { api } = await liveApi(fetchMock);
    expect((await api.importJob("candidate_live", job.source_url)).source_url).toBe(job.source_url);
    expect((await api.discoverContacts("candidate_live", job)).contacts).toEqual([]);
    expect((await api.getWorkspace("candidate_live")).application_packages).toEqual([]);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://backend.test/api/v1/jobs/import",
      "https://backend.test/api/v1/candidates/candidate_live/jobs/job_live/contacts/discover",
      "https://backend.test/api/v1/candidates/candidate_live/workspace",
    ]);
  });

  it("keeps demo contact discovery empty and explicitly unconfigured", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_API_BASE_URL", "");
    const { api } = await import("@/lib/api");
    const result = await api.discoverContacts("candidate_demo", job);
    expect(result.status).toBe("not_configured");
    expect(result.contacts).toEqual([]);
    expect(result.fallback_url).toContain("Platform%20Engineer%20Example%20Engineering");
  });

  it("sends profile edits with optimistic concurrency and explicit confirmation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(candidate));
    const { api } = await liveApi(fetchMock);
    await api.patchProfile("candidate_live", {
      career_goal: "Staff Platform Engineer",
      master_profile_version: 3,
    });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toMatchObject({
      expected_version: 3,
      candidate_confirmed: true,
      career_goal: "Staff Platform Engineer",
    });
  });

  it("passes the exact selected contact into grounded LinkedIn generation", async () => {
    const selected = makeCandidateContact(contactInput, "candidate_live", job.job_id, false);
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        draft_id: "draft_live",
        candidate_id: "candidate_live",
        job_id: job.job_id,
        contact_id: selected.contact_id,
        message: "Grounded draft",
        factuality_notes: [],
        status: "draft",
        requires_user_action: true,
      }),
    );
    const { api } = await liveApi(fetchMock);
    await api.createLinkedInDraft("candidate_live", job, selected);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string).contact_id).toBe(selected.contact_id);
  });
});