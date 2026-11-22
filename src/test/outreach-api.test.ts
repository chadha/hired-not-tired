import { afterEach, describe, expect, it, vi } from "vitest";
import { makeCandidateContact, type OutreachMessage } from "@/lib/hiring-contacts";

const contactInput = {
  full_name: "Robin Example",
  current_title: "Engineering Lead",
  company: "Example Engineering",
  profile_url: "https://www.linkedin.com/in/robin-example",
  location: "",
  source_url: "https://example.com/team",
  evidence_notes: "Candidate-supplied test note.",
};
const job = {
  job_id: "job_live_test",
  title: "Platform Engineer",
  company: "Example Engineering",
  location: "Berlin",
  description: "Build Python platform systems.",
  requirements: ["Python"],
  currency: "EUR",
  remote_type: "hybrid",
  source: "candidate_submitted",
  source_url: "https://example.com/job",
  is_demo: false,
};

function message(): OutreachMessage {
  const contact = makeCandidateContact(
    contactInput,
    "candidate_live",
    job.job_id,
    false,
    "2026-11-22T00:00:00.000Z",
    "contact_live",
  );
  return {
    message_id: "draft_live",
    draft_id: "draft_live",
    candidate_id: "candidate_live",
    job_id: job.job_id,
    contact_id: contact.contact_id,
    channel: "linkedin",
    recipient_name: contact.full_name,
    recipient_url: contact.profile_url,
    body: "Exact approved message",
    status: "approved",
    factuality_notes: [],
    personalization_rationale: "Test",
    approved_text_hash: "hash",
    approved_at: "2026-11-22T00:01:00.000Z",
    approved_by: "candidate_live",
    handed_off_at: null,
    candidate_confirmed_sent_at: null,
    created_at: "2026-11-22T00:00:00.000Z",
    updated_at: "2026-11-22T00:01:00.000Z",
    responses: [],
    history: [],
    is_demo: false,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function liveApi(fetchMock: ReturnType<typeof vi.fn>) {
  vi.resetModules();
  vi.stubEnv("VITE_API_BASE_URL", "https://backend.test");
  vi.stubGlobal("fetch", fetchMock);
  return import("@/lib/api");
}

describe("outreach FastAPI integration boundaries", () => {
  it("uses the existing POST /outreach/draft operation for generation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          draft_id: "draft_live",
          candidate_id: "candidate_live",
          job_id: job.job_id,
          message: "Generated draft",
          factuality_notes: [],
          status: "draft",
          requires_user_action: true,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const { api } = await liveApi(fetchMock);
    const contact = makeCandidateContact(contactInput, "candidate_live", job.job_id, false);
    const result = await api.createLinkedInDraft("candidate_live", job, contact);
    expect(result.message).toBe("Generated draft");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://backend.test/api/v1/outreach/draft",
      expect.objectContaining({ method: "POST" }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toMatchObject({
      candidate_id: "candidate_live",
      job_id: job.job_id,
      hiring_contact_name: "Robin Example",
      contact_id: contact.contact_id,
    });
  });

  it("reports a missing approval endpoint without substituting demo success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "Not Found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const { api } = await liveApi(fetchMock);
    await expect(api.approveLinkedInDraft(message())).rejects.toThrow(
      "Required backend endpoint unavailable: POST /api/v1/candidates/candidate_live/outreach/drafts/draft_live/approve",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("reports backend unavailability without creating a local contact", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network down"));
    const { api } = await liveApi(fetchMock);
    await expect(api.createContact("candidate_live", job, contactInput)).rejects.toThrow(
      "No local demo success was substituted",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("reports a missing email draft endpoint without demo fallback", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "Not Found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const { api } = await liveApi(fetchMock);
    const contact = makeCandidateContact(
      { ...contactInput, email: "robin@example.com" },
      "candidate_live",
      job.job_id,
      false,
    );
    const applicationPackage = {
      package_id: "package_live",
      candidate_id: "candidate_live",
      current_artifact_id: "cv_live",
      versions: [{ artifact_id: "cv_live" }],
    } as Parameters<typeof api.createEmailDraft>[3];
    await expect(
      api.createEmailDraft("candidate_live", job, contact, applicationPackage),
    ).rejects.toThrow(
      "Required backend endpoint unavailable: POST /api/v1/application-packages/package_live/outreach-drafts",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("uses the existing POST /interactions operation for candidate-recorded replies", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          interaction_id: "int_live",
          candidate_id: "candidate_live",
          job_id: job.job_id,
          channel: "manual_linkedin",
          interaction_type: "recruiter_reply",
          content: "Candidate-recorded LinkedIn reply (received 2026-11-22): Let’s talk",
          outcome: "interview",
          simulated: false,
          created_at: "2026-11-22T01:00:00.000Z",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const { api } = await liveApi(fetchMock);
    const sent = {
      ...message(),
      status: "candidate_confirmed_sent" as const,
      handed_off_at: "2026-11-22T00:02:00.000Z",
      candidate_confirmed_sent_at: "2026-11-22T00:03:00.000Z",
    };
    await api.recordCandidateReply(sent, {
      reply_date: "2026-11-22",
      content: "Let’s talk",
      outcome: "interview",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://backend.test/api/v1/interactions",
      expect.objectContaining({ method: "POST" }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toMatchObject({
      interaction_type: "recruiter_reply",
      channel: "manual_linkedin",
      simulated: false,
      outcome: "interview",
    });
  });
});