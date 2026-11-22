import { describe, expect, it } from "vitest";
import {
  applicationCvHash,
  approveApplicationChannel,
  approveApplicationCv,
  createApplicationPackage,
  createCoverLetter,
  getApplicationChannels,
  getChannelAction,
  getCurrentCoverLetter,
  getCurrentCvArtifact,
  getCvExportBlockReason,
  reviseApplicationMasterProfile,
  suggestApplicationAnswer,
  upsertApplicationAnswer,
  type ApplicationPackage,
  type CvApproval,
} from "@/lib/application-package";
import type { Candidate, Job } from "@/lib/api";

const NOW = "2026-11-22T03:00:00.000Z";
const LATER = "2026-11-22T03:05:00.000Z";
const job: Job = {
  job_id: "job_revision",
  title: "Platform Engineer",
  company: "Example Engineering",
  location: "Berlin",
  description: "Build reliable Python services.",
  requirements: ["Python"],
  currency: "EUR",
  remote_type: "hybrid",
  source: "candidate_submitted",
  source_url: "https://example.com/jobs/platform",
  is_demo: true,
  application_method: "external",
};

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    candidate_id: "candidate_revision",
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
    master_profile_version: 1,
    profile_confirmed_at: NOW,
    ...overrides,
  };
}

async function approvalFor(applicationPackage: ApplicationPackage): Promise<CvApproval> {
  const artifact = getCurrentCvArtifact(applicationPackage);
  return {
    artifact_id: artifact.artifact_id,
    version: artifact.version,
    approved_text_hash: await applicationCvHash(artifact),
    approved_at: NOW,
    approved_by: applicationPackage.candidate_id,
  };
}

describe("candidate-controlled master profile revisions", () => {
  it("keeps extracted facts unconfirmed until the candidate confirms the current revision", () => {
    const originalCandidate = candidate({ profile_confirmed_at: null });
    const created = createApplicationPackage(originalCandidate, job, undefined, NOW);
    expect(created.master_profile.facts.every((fact) => fact.confirmed_at === null)).toBe(true);
    expect(getCvExportBlockReason(created)).toContain("Confirm 7 extracted profile facts");

    const revised = reviseApplicationMasterProfile(
      created,
      originalCandidate,
      { confirm_all: true },
      LATER,
    );
    expect(created.master_profile.facts.every((fact) => fact.confirmed_at === null)).toBe(true);
    expect(
      revised.applicationPackage.master_profile.facts.every((fact) => fact.confirmed_at === LATER),
    ).toBe(true);
    expect(revised.applicationPackage.master_profile_history).toHaveLength(2);
    expect(getCurrentCvArtifact(revised.applicationPackage).version).toBe(2);
    expect(
      reviseApplicationMasterProfile(
        revised.applicationPackage,
        revised.candidate,
        { confirm_all: true },
        LATER,
      ),
    ).toEqual({ candidate: revised.candidate, applicationPackage: revised.applicationPackage });
  });

  it("detects an uploaded email conflict without silently overwriting either value", () => {
    const originalCandidate = candidate({
      cv_text: "robin.other@example.com\nSenior Engineer — Example Studio",
    });
    const created = createApplicationPackage(originalCandidate, job, undefined, NOW);
    expect(created.master_profile.conflicts[0]).toMatchObject({
      current_value: "robin@example.com",
      proposed_value: "robin.other@example.com",
      status: "open",
    });
    expect(created.master_profile.facts.find((fact) => fact.fact_id === "fact_email")?.value).toBe(
      "robin@example.com",
    );
    expect(getCvExportBlockReason(created)).toContain("Resolve 1 uploaded-profile conflict");

    const kept = reviseApplicationMasterProfile(
      created,
      originalCandidate,
      { conflict_id: "conflict_email_v1", use_proposed: false },
      LATER,
    );
    expect(kept.candidate.email).toBe("robin@example.com");
    expect(kept.applicationPackage.master_profile.conflicts[0]?.status).toBe(
      "resolved_keep_current",
    );
    expect(created.master_profile.conflicts[0]?.status).toBe("open");
  });

  it("uses an uploaded conflict value only after explicit selection and preserves old CV content", () => {
    const originalCandidate = candidate({
      cv_text: "robin.other@example.com\nBuilt Python services.",
    });
    const created = createApplicationPackage(originalCandidate, job, undefined, NOW);
    const oldContent = getCurrentCvArtifact(created).content;
    const revised = reviseApplicationMasterProfile(
      created,
      originalCandidate,
      { conflict_id: "conflict_email_v1", use_proposed: true },
      LATER,
    );
    expect(revised.candidate.email).toBe("robin.other@example.com");
    expect(revised.applicationPackage.master_profile.conflicts[0]?.status).toBe(
      "resolved_use_proposed",
    );
    expect(revised.applicationPackage.versions[0]?.content).toBe(oldContent);
    expect(getCurrentCvArtifact(revised.applicationPackage).content).toContain(
      "robin.other@example.com",
    );
  });

  it("creates immutable master and tailored versions and invalidates exact channel approval", async () => {
    const originalCandidate = candidate();
    const created = createApplicationPackage(originalCandidate, job, undefined, NOW);
    const approvedCv = await approveApplicationCv(created, await approvalFor(created));
    const channel = getApplicationChannels(job, approvedCv.capabilities)[1]!;
    const approved = await approveApplicationChannel(approvedCv, channel, NOW);
    const oldMaster = approved.master_profile;
    const oldArtifact = getCurrentCvArtifact(approved);

    const revised = reviseApplicationMasterProfile(
      approved,
      originalCandidate,
      { fact_id: "fact_summary", value: "Candidate-revised summary grounded in Python services." },
      LATER,
    );
    expect(revised.applicationPackage.master_profile_history[0]).toEqual(oldMaster);
    expect(revised.applicationPackage.versions[0]).toEqual(oldArtifact);
    expect(getCurrentCvArtifact(revised.applicationPackage)).toMatchObject({
      version: 2,
      source_profile_version: 2,
      approval: null,
    });
    expect(getChannelAction(revised.applicationPackage, channel.id).approval?.invalidated_at).toBe(
      LATER,
    );
    expect(revised.candidate.cv_text).toBe(originalCandidate.cv_text);
  });

  it("requires fresh review of evidence-based answers and a cover letter after a fact edit", async () => {
    const originalCandidate = candidate();
    let created = createApplicationPackage(originalCandidate, job, undefined, NOW);
    created = upsertApplicationAnswer(created, {
      question: "Why are you a fit?",
      proposed_answer: "",
      confirmed: false,
    });
    const answer = created.answers[0]!;
    created = upsertApplicationAnswer(created, {
      answer_id: answer.answer_id,
      question: answer.question,
      proposed_answer: suggestApplicationAnswer(created, answer.answer_id),
      confirmed: true,
    });
    created = createCoverLetter(created, NOW);
    const oldCover = getCurrentCoverLetter(created)!;
    const revised = reviseApplicationMasterProfile(
      created,
      originalCandidate,
      { fact_id: "fact_skills", value: "Python, FastAPI" },
      LATER,
    );
    expect(revised.applicationPackage.answers[0]).toMatchObject({
      status: "needs_candidate_input",
      version: 3,
    });
    expect(getCurrentCoverLetter(revised.applicationPackage)).toMatchObject({
      version: 2,
      source_profile_version: 2,
      approval: null,
      content: oldCover.content,
    });
    expect(revised.applicationPackage.cover_letter_versions[0]).toEqual(oldCover);
  });

  it("preserves blank optional facts as unknown and makes repeated edits idempotent", () => {
    const originalCandidate = candidate();
    const created = createApplicationPackage(originalCandidate, job, undefined, NOW);
    const revised = reviseApplicationMasterProfile(
      created,
      originalCandidate,
      { fact_id: "fact_summary", value: "" },
      LATER,
    );
    expect(revised.candidate.summary).toBe("");
    expect(
      revised.applicationPackage.master_profile.facts.find(
        (fact) => fact.fact_id === "fact_summary",
      ),
    ).toMatchObject({ value: "", source_excerpt: "Not supplied" });
    const repeated = reviseApplicationMasterProfile(
      revised.applicationPackage,
      revised.candidate,
      { fact_id: "fact_summary", value: "" },
      LATER,
    );
    expect(repeated.candidate).toBe(revised.candidate);
    expect(repeated.applicationPackage).toBe(revised.applicationPackage);
  });
});