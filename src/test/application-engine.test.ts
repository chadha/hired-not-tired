import { describe, expect, it } from "vitest";
import {
  LOCAL_PROVIDER_CAPABILITIES,
  analyzeJobForApplication,
  applicationCvHash,
  applyProviderSubmissionReceipt,
  approveApplicationChannel,
  approveApplicationCv,
  canonicalChannelPayload,
  createApplicationPackage,
  getApplicationChannels,
  getChannelAction,
  getChannelActionBlockReason,
  getCvExportBlockReason,
  getCurrentCvArtifact,
  recordApplicationHandoff,
  reportApplicationSubmitted,
  saveApplicationCvVersion,
  upsertApplicationAnswer,
  type CvApproval,
} from "@/lib/application-package";
import type { Candidate, Job } from "@/lib/api";

const NOW = "2026-11-22T02:00:00.000Z";
const candidate: Candidate = {
  candidate_id: "candidate_engine",
  full_name: "Robin Example",
  email: "robin@example.com",
  linkedin_url: null,
  career_goal: "Platform Engineer",
  target_roles: ["Platform Engineer"],
  locations: ["Berlin"],
  minimum_salary: null,
  currency: "EUR",
  remote_preference: "hybrid",
  skills: ["Python"],
  experience_years: 4,
  summary: "Platform engineer focused on reliable services.",
  cv_text: "Senior Engineer — Example Studio\nBuilt Python services.",
  cv_filename: "master.pdf",
  master_profile_version: 3,
  profile_confirmed_at: NOW,
};
const job: Job = {
  job_id: "job_engine",
  title: "Platform Engineer",
  company: "Example Engineering",
  location: "Berlin",
  description: "Build Python services. What is your work authorization status?",
  requirements: ["Python", "Kubernetes"],
  currency: "EUR",
  remote_type: "hybrid",
  source: "candidate_submitted",
  source_url: "https://example.com/jobs/platform",
  is_demo: false,
  application_method: "external",
};

async function approvedPackage() {
  const created = createApplicationPackage(candidate, job, undefined, NOW);
  const artifact = getCurrentCvArtifact(created);
  const approval: CvApproval = {
    artifact_id: artifact.artifact_id,
    version: artifact.version,
    approved_text_hash: await applicationCvHash(artifact),
    approved_at: NOW,
    approved_by: candidate.candidate_id,
  };
  const approved = await approveApplicationCv(created, approval);
  const declaration = approved.answers[0];
  return declaration
    ? upsertApplicationAnswer(approved, {
        answer_id: declaration.answer_id,
        question: declaration.question,
        proposed_answer: "",
        confirmed: true,
      })
    : approved;
}

describe("authoritative application engine domain", () => {
  it("converges upload and conversational intake on confirmed, sourced canonical facts", () => {
    const uploaded = createApplicationPackage(candidate, job, undefined, NOW);
    const conversational = createApplicationPackage(
      { ...candidate, cv_text: "", cv_filename: null },
      job,
      undefined,
      NOW,
    );
    expect(uploaded.master_profile.facts.map((fact) => fact.fact_id)).toEqual(
      conversational.master_profile.facts.map((fact) => fact.fact_id),
    );
    expect(uploaded.master_profile.facts.every((fact) => fact.confirmed_at === NOW)).toBe(true);
    expect(uploaded.master_profile.facts.at(-1)).toMatchObject({
      source_kind: "uploaded_cv",
      source_reference: "master.pdf",
      version: 3,
    });
    expect(conversational.master_profile.facts.at(-1)?.source_kind).toBe("conversational_profile");
  });

  it("keeps master snapshots and job-specific versions isolated", () => {
    const first = createApplicationPackage(candidate, job, undefined, NOW);
    const second = createApplicationPackage(
      candidate,
      { ...job, job_id: "other", title: "Other role" },
      undefined,
      NOW,
    );
    const edited = saveApplicationCvVersion(
      first,
      `${getCurrentCvArtifact(first).content}\nCandidate correction.`,
    );
    expect(edited.master_profile).toEqual(first.master_profile);
    expect(second.master_profile).toEqual(first.master_profile);
    expect(getCurrentCvArtifact(second).version).toBe(1);
    expect(getCurrentCvArtifact(edited).version).toBe(2);
    expect(candidate.cv_text).toBe("Senior Engineer — Example Studio\nBuilt Python services.");
  });

  it("keeps legal declarations candidate-only and preserves unknown requirements", () => {
    const analysis = analyzeJobForApplication(candidate, job);
    expect(analysis.requirements.find((item) => item.text === "Kubernetes")?.status).toBe(
      "unknown",
    );
    const created = createApplicationPackage(candidate, job, undefined, NOW);
    const declaration = created.answers[0];
    expect(declaration).toMatchObject({
      sensitive: true,
      proposed_answer: "",
      status: "needs_candidate_input",
    });
    const reviewed = upsertApplicationAnswer(created, {
      answer_id: declaration!.answer_id,
      question: declaration?.question ?? "",
      proposed_answer: "",
      confirmed: true,
    });
    expect(reviewed.answers[0]).toMatchObject({
      status: "candidate_confirmed",
      proposed_answer: "",
      evidence_fact_ids: [],
    });
  });

  it("invalidates exact channel approval when an answer or CV artifact changes", async () => {
    let applicationPackage = await approvedPackage();
    applicationPackage = upsertApplicationAnswer(applicationPackage, {
      answer_id: applicationPackage.answers[0]!.answer_id,
      question: applicationPackage.answers[0]?.question ?? "",
      proposed_answer: "",
      confirmed: true,
    });
    const channel = getApplicationChannels(job, applicationPackage.capabilities)[1]!;
    const approved = await approveApplicationChannel(applicationPackage, channel, NOW);
    expect(getChannelActionBlockReason(approved, channel)).toBeNull();
    const changedAnswer = upsertApplicationAnswer(approved, {
      answer_id: approved.answers[0]!.answer_id,
      question: approved.answers[0]?.question ?? "",
      proposed_answer: "Candidate supplied declaration.",
      confirmed: true,
    });
    expect(getChannelAction(changedAnswer, channel.id).approval?.invalidated_at).not.toBeNull();
    expect(getChannelActionBlockReason(changedAnswer, channel)).toContain("approve the exact");
    const changedCv = saveApplicationCvVersion(
      applicationPackage,
      `${getCurrentCvArtifact(applicationPackage).content}\nCorrection`,
    );
    expect(getChannelAction(changedCv, channel.id).approval).toBeNull();
  });

  it("changes the canonical payload when destination, answers, attachment or artifact changes", async () => {
    const applicationPackage = await approvedPackage();
    const channel = getApplicationChannels(job, applicationPackage.capabilities)[1]!;
    const original = canonicalChannelPayload(applicationPackage, channel);
    expect(
      canonicalChannelPayload(applicationPackage, {
        ...channel,
        destination_url: "https://example.com/other",
      }),
    ).not.toBe(original);
    expect(
      canonicalChannelPayload(
        saveApplicationCvVersion(
          applicationPackage,
          `${getCurrentCvArtifact(applicationPackage).content}\nCorrection`,
        ),
        channel,
      ),
    ).not.toBe(original);
    expect(
      canonicalChannelPayload(
        upsertApplicationAnswer(applicationPackage, {
          question: "Why this role?",
          proposed_answer: "Candidate answer",
          confirmed: true,
        }),
        channel,
      ),
    ).not.toBe(original);
  });

  it("distinguishes handoff, candidate attestation and provider confirmation without duplicates", async () => {
    const applicationPackage = await approvedPackage();
    const channel = getApplicationChannels(job, applicationPackage.capabilities)[1]!;
    const approved = await approveApplicationChannel(applicationPackage, channel, NOW);
    const handedOff = await recordApplicationHandoff(approved, channel, NOW);
    expect(await recordApplicationHandoff(handedOff, channel, NOW)).toBe(handedOff);
    expect(() => reportApplicationSubmitted(approved, channel.id)).toThrow("before recording");
    const reported = reportApplicationSubmitted(handedOff, channel.id, NOW);
    expect(getChannelAction(reported, channel.id).state).toBe("candidate_reported");
    expect(getChannelAction(reported, channel.id).provider_receipt_id).toBeNull();
  });

  it("gates direct submission on every authorized capability and verifies receipts", async () => {
    const linkedInJob = {
      ...job,
      source_url: "https://www.linkedin.com/jobs/view/123",
      application_method: "easy_apply" as const,
    };
    expect(getApplicationChannels(linkedInJob)[0]?.direct_submit).toBe(false);
    const capabilities = {
      ...LOCAL_PROVIDER_CAPABILITIES,
      source: "backend" as const,
      applications: {
        ...LOCAL_PROVIDER_CAPABILITIES.applications,
        linkedin_easy_apply: {
          authorized: true,
          account_authorized: true,
          job_eligible: true,
          required_fields_verified: true,
          reason: "Authorized test capability",
        },
      },
    };
    const channel = getApplicationChannels(linkedInJob, capabilities)[0]!;
    expect(channel).toMatchObject({ direct_submit: true, state: "direct_submit_available" });
    let applicationPackage = await approvedPackage();
    applicationPackage = { ...applicationPackage, capabilities };
    const approved = await approveApplicationChannel(applicationPackage, channel, NOW);
    const action = getChannelAction(approved, channel.id);
    const confirmed = applyProviderSubmissionReceipt(approved, channel, {
      receipt_id: "receipt_1",
      channel: channel.id,
      payload_hash: action.approval?.payload_hash ?? "",
      confirmed_at: NOW,
    });
    expect(getChannelAction(confirmed, channel.id).state).toBe("provider_confirmed");
    expect(
      applyProviderSubmissionReceipt(confirmed, channel, {
        receipt_id: "receipt_1",
        channel: channel.id,
        payload_hash: action.approval?.payload_hash ?? "",
        confirmed_at: NOW,
      }),
    ).toBe(confirmed);
  });

  it("exposes honest PDF and DOCX unavailable states", async () => {
    const applicationPackage = await approvedPackage();
    const unavailable = {
      ...applicationPackage,
      capabilities: {
        ...applicationPackage.capabilities,
        documents: { pdf: "unavailable" as const, docx: "unavailable" as const },
      },
    };
    expect(getCvExportBlockReason(unavailable)).toContain("unavailable");
  });
});