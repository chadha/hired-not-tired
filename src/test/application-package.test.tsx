import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApplicationPackageCard } from "@/components/hnt/application-package";
import {
  analyzeJobForApplication,
  applicationCvHash,
  approveApplicationCv,
  buildMasterProfile,
  createApplicationPackage,
  getApplicationChannels,
  getCurrentCvArtifact,
  getCvExportBlockReason,
  saveApplicationCvVersion,
  type ApplicationPackage,
  type CvApproval,
} from "@/lib/application-package";
import type { Candidate, Job } from "@/lib/api";

const NOW = "2026-11-22T02:00:00.000Z";
const job: Job = {
  job_id: "job_application_test",
  title: "Platform Engineer",
  company: "Example Engineering",
  location: "Berlin",
  description: "Build reliable Python platform services. Kubernetes experience is preferred.",
  requirements: ["Python", "Kubernetes"],
  currency: "EUR",
  remote_type: "hybrid",
  source: "candidate_submitted",
  source_url: "https://example.com/jobs/platform",
  is_demo: true,
  application_method: "unknown",
};

function candidate(
  cvText = "Senior Engineer — Example Studio\nBuilt Python services with PostgreSQL.",
): Candidate {
  return {
    candidate_id: "candidate_application_test",
    full_name: "Robin Example",
    email: "robin@example.com",
    linkedin_url: null,
    career_goal: "Platform Engineer",
    target_roles: ["Platform Engineer"],
    locations: ["Berlin"],
    minimum_salary: null,
    currency: "EUR",
    remote_preference: "hybrid",
    skills: ["Python", "PostgreSQL"],
    experience_years: 4,
    summary: "Platform engineer focused on reliable services.",
    cv_text: cvText,
    cv_filename: cvText ? "master-robin.pdf" : null,
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

function renderCard(applicationPackage: ApplicationPackage) {
  const callbacks = {
    onSave: vi.fn().mockResolvedValue(undefined),
    onApprove: vi.fn().mockResolvedValue(undefined),
    onExport: vi.fn().mockResolvedValue({ format: "pdf", checks: ["passed"], pages: 1 }),
    onChannelHandoff: vi.fn().mockResolvedValue(undefined),
    onSaveAnswer: vi.fn().mockResolvedValue(undefined),
    onCreateCoverLetter: vi.fn().mockResolvedValue(undefined),
    onSaveCoverLetter: vi.fn().mockResolvedValue(undefined),
    onApproveCoverLetter: vi.fn().mockResolvedValue(undefined),
    onApproveChannel: vi.fn().mockResolvedValue(undefined),
    onSubmitChannel: vi.fn().mockResolvedValue(undefined),
    onReportSubmitted: vi.fn().mockResolvedValue(undefined),
    onPrepareEmail: vi.fn().mockResolvedValue(undefined),
    onFindContact: vi.fn(),
    onReviseMasterProfile: vi.fn().mockResolvedValue(undefined),
  };
  render(
    <ApplicationPackageCard
      applicationPackage={applicationPackage}
      job={job}
      contact={null}
      busy={false}
      {...callbacks}
    />,
  );
  return callbacks;
}

describe("CV-led application package", () => {
  it("supports uploaded-CV and conversational-profile sources without changing the master", () => {
    const uploadedCandidate = candidate();
    const originalMaster = uploadedCandidate.cv_text;
    const uploaded = createApplicationPackage(uploadedCandidate, job, undefined, NOW);
    const conversationalCandidate = candidate("");
    const conversational = createApplicationPackage(conversationalCandidate, job, undefined, NOW);

    expect(uploaded.source).toMatchObject({
      kind: "uploaded_cv",
      filename: "master-robin.pdf",
      text: originalMaster,
    });
    expect(uploadedCandidate.cv_text).toBe(originalMaster);
    expect(conversational.source.kind).toBe("conversational_profile");
    expect(conversational.source.text).toBe(buildMasterProfile(conversationalCandidate));
    expect(getCurrentCvArtifact(conversational).content).toContain(
      "Candidate-confirmed experience: 4 years.",
    );
  });

  it("shows requirement evidence and leaves missing evidence uncertain", () => {
    const analysis = analyzeJobForApplication(candidate(), job);
    expect(analysis.requirements[0]).toMatchObject({
      text: "Python",
      status: "strong_match",
      candidate_evidence: "Candidate-confirmed skill: Python.",
    });
    expect(analysis.requirements[1]).toMatchObject({ text: "Kubernetes", status: "unknown" });
    expect(analysis.application_questions).toEqual([]);
    expect(analysis.notes[0]).toContain("not an ATS ranking");
  });

  it("does not invent employers, metrics or qualifications", () => {
    const content = getCurrentCvArtifact(
      createApplicationPackage(candidate(), job, undefined, NOW),
    ).content;
    expect(content).toContain("Senior Engineer — Example Studio");
    expect(content).not.toContain("Google");
    expect(content).not.toContain("increased revenue");
    expect(content).not.toContain("Master of Science");
  });

  it("creates an immutable new version on edit and invalidates export approval", async () => {
    const created = createApplicationPackage(candidate(), job, undefined, NOW);
    const approved = await approveApplicationCv(created, await approvalFor(created));
    const original = getCurrentCvArtifact(approved);
    const edited = saveApplicationCvVersion(
      approved,
      `${original.content}\nAdditional truthful candidate edit.`,
      "2026-11-22T02:05:00.000Z",
    );

    expect(edited.versions).toHaveLength(2);
    expect(edited.versions[0]?.content).toBe(original.content);
    expect(getCurrentCvArtifact(edited).version).toBe(2);
    expect(getCurrentCvArtifact(edited).approval).toBeNull();
    expect(getCvExportBlockReason(edited)).toContain("approve this exact");
  });

  it("binds approval to the exact artifact version and content hash", async () => {
    const created = createApplicationPackage(candidate(), job, undefined, NOW);
    const approved = await approveApplicationCv(created, await approvalFor(created));
    expect(approved.status).toBe("approved");
    expect(getCvExportBlockReason(approved)).toBeNull();
    expect(getCvExportBlockReason(approved, "Unsaved different text")).toContain("Save this edit");

    const badApproval = { ...(await approvalFor(created)), approved_text_hash: "wrong-hash" };
    await expect(approveApplicationCv(created, badApproval)).rejects.toThrow("does not match");
  });

  it("keeps unconfirmed Easy Apply and unsupported direct submission disabled", () => {
    const channels = getApplicationChannels(job);
    expect(channels[0]).toMatchObject({
      state: "unavailable",
      destination_url: null,
      action_label: null,
    });
    expect(channels[1]).toMatchObject({
      state: "guided_handoff",
      action_label: "Continue on official site",
    });
    expect(channels[2]?.blocker).toContain("Needle is disabled");

    const easyApply = getApplicationChannels({
      ...job,
      source: "linkedin",
      source_url: "https://www.linkedin.com/jobs/view/123",
      application_method: "easy_apply",
    })[0];
    expect(easyApply).toMatchObject({
      state: "guided_handoff",
      action_label: "Continue on official site",
    });
  });

  it("shows the exact missing live revision contracts without enabling demo fallback", () => {
    const applicationPackage = {
      ...createApplicationPackage(candidate(), job, undefined, NOW),
      is_demo: false,
    };
    renderCard(applicationPackage);
    expect(screen.getByText(/Live master revision is unavailable:/)).toHaveTextContent(
      "PATCH /api/v1/candidates/{candidate_id}/profile/facts/{fact_id}",
    );
    expect(screen.getByText(/Live master revision is unavailable:/)).toHaveTextContent(
      "POST /api/v1/application-packages/{package_id}/cv-artifacts",
    );
    expect(screen.getByRole("button", { name: "Edit Full name" })).toBeDisabled();
  });

  it("labels the local package and blocks exports before exact-version approval", () => {
    const applicationPackage = createApplicationPackage(candidate(), job, undefined, NOW);
    renderCard(applicationPackage);
    expect(screen.getByText("LOCAL DEMO · in-memory")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export PDF" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export DOCX" })).toBeDisabled();
    expect(
      screen.getByText(
        /The master CV\/profile is unchanged\. Every edit creates a separate tailored version\./,
      ),
    ).toBeInTheDocument();
  });
});