import type { Candidate, Job, JobMatch } from "@/lib/api";

export type CvSource = {
  kind: "uploaded_cv" | "conversational_profile";
  filename: string | null;
  text: string;
};

export type ProfileFact = {
  fact_id: string;
  fact_type: "identity" | "preference" | "skill" | "experience" | "summary" | "career_history";
  label: string;
  value: string;
  source_kind: CvSource["kind"] | "conversational_onboarding";
  source_reference: string;
  source_excerpt: string;
  confidence: number;
  confirmed_at: string | null;
  version: number;
};

export type ProfileFactConflict = {
  conflict_id: string;
  fact_id: string;
  current_value: string;
  proposed_value: string;
  source_reference: string;
  source_excerpt: string;
  status: "open" | "resolved_keep_current" | "resolved_use_proposed" | "resolved_candidate_edit";
};

export type MasterProfileSnapshot = {
  profile_version: number;
  captured_at: string;
  revision_of: number | null;
  source: CvSource;
  facts: ProfileFact[];
  conflicts: ProfileFactConflict[];
};

export type JobSnapshot = {
  snapshot_id: string;
  title: string;
  company: string;
  location: string;
  description: string;
  requirements: string[];
  source_url: string;
  application_method: Job["application_method"];
  captured_at: string;
};

export type RequirementStatus = "strong_match" | "partial_match" | "gap" | "unknown";
export type ApplicationRequirement = {
  requirement_id: string;
  text: string;
  category: "skill" | "experience" | "qualification" | "responsibility" | "application_question";
  priority: "required" | "preferred" | "unclear";
  status: RequirementStatus;
  candidate_evidence: string | null;
  evidence_fact_ids: string[];
  uncertainty: string;
  recommended_action: string;
};

export type JobAnalysis = {
  requirements: ApplicationRequirement[];
  application_questions: ApplicationRequirement[];
  method: "deterministic_local_demo" | "backend";
  notes: string[];
};

export type CvApproval = {
  artifact_id: string;
  version: number;
  approved_text_hash: string;
  approved_at: string;
  approved_by: string;
};

export type CvArtifact = {
  artifact_id: string;
  package_id: string;
  version: number;
  content: string;
  change_summary: string[];
  evidence_used: string[];
  evidence_fact_ids: string[];
  source_profile_version: number;
  source_job_snapshot_id: string;
  created_at: string;
  approval: CvApproval | null;
};

export type ApplicationAnswer = {
  answer_id: string;
  question: string;
  proposed_answer: string;
  evidence_fact_ids: string[];
  status: "needs_candidate_input" | "candidate_confirmed";
  sensitive: boolean;
  version: number;
  updated_at: string;
};

export type CoverLetterArtifact = {
  artifact_id: string;
  package_id: string;
  version: number;
  content: string;
  source_profile_version: number;
  source_job_snapshot_id: string;
  created_at: string;
  approval: CvApproval | null;
};

export type ApplicationChannelId = "linkedin_easy_apply" | "employer_site" | "hiring_team";
export type ChannelActionState =
  "draft" | "approved" | "handed_off" | "candidate_reported" | "provider_confirmed" | "failed";

export type PackageApproval = {
  approval_id: string;
  channel: ApplicationChannelId;
  destination: string;
  canonical_payload: string;
  payload_hash: string;
  cv_artifact_id: string;
  cv_version: number;
  approved_at: string;
  approved_by: string;
  invalidated_at: string | null;
};

export type ApplicationChannelAction = {
  channel: ApplicationChannelId;
  state: ChannelActionState;
  approval: PackageApproval | null;
  idempotency_key: string;
  handed_off_at: string | null;
  candidate_reported_at: string | null;
  provider_receipt_id: string | null;
};

export type ApplicationIntegrationCapability = {
  authorized: boolean;
  account_authorized: boolean;
  job_eligible: boolean;
  required_fields_verified: boolean;
  reason: string;
};

export type ProviderCapabilities = {
  source: "local_demo" | "backend";
  needle: {
    enabled: boolean;
    contact_discovery: boolean;
    sending: boolean;
    reason: string;
  };
  email: {
    handoff: boolean;
    send: boolean;
    verified_sender: boolean;
    verified_recipient: boolean;
    consent_and_suppression: boolean;
    durable_audit: boolean;
    idempotency: boolean;
    reason: string;
  };
  applications: {
    linkedin_easy_apply: ApplicationIntegrationCapability;
    employer_site: ApplicationIntegrationCapability;
  };
  documents: {
    pdf: "local_validated" | "backend" | "unavailable";
    docx: "local_validated" | "backend" | "unavailable";
  };
};

export const LOCAL_PROVIDER_CAPABILITIES: ProviderCapabilities = {
  source: "local_demo",
  needle: {
    enabled: false,
    contact_discovery: false,
    sending: false,
    reason: "Needle is disabled. Manual contacts and LinkedIn/email handoffs remain available.",
  },
  email: {
    handoff: true,
    send: false,
    verified_sender: false,
    verified_recipient: false,
    consent_and_suppression: false,
    durable_audit: false,
    idempotency: false,
    reason: "No authorized email provider is configured. Use copy or mailto handoff only.",
  },
  applications: {
    linkedin_easy_apply: {
      authorized: false,
      account_authorized: false,
      job_eligible: false,
      required_fields_verified: false,
      reason: "No official authorized LinkedIn submission integration is configured.",
    },
    employer_site: {
      authorized: false,
      account_authorized: false,
      job_eligible: false,
      required_fields_verified: false,
      reason: "No authorized employer/ATS submission integration is configured.",
    },
  },
  documents: { pdf: "local_validated", docx: "local_validated" },
};

export const UNAVAILABLE_PROVIDER_CAPABILITIES: ProviderCapabilities = {
  ...LOCAL_PROVIDER_CAPABILITIES,
  source: "backend",
  email: {
    ...LOCAL_PROVIDER_CAPABILITIES.email,
    handoff: true,
    reason: "Backend email provider capability has not been confirmed; only handoff is available.",
  },
  documents: { pdf: "unavailable", docx: "unavailable" },
};

export type ApplicationPackage = {
  package_id: string;
  candidate_id: string;
  job_id: string;
  /** Present for durable backend packages; absent only in the ephemeral local demo. */
  revision?: number;
  status: "draft" | "approved";
  source: CvSource;
  master_profile: MasterProfileSnapshot;
  master_profile_history: MasterProfileSnapshot[];
  job_snapshot: JobSnapshot;
  analysis: JobAnalysis;
  versions: CvArtifact[];
  current_artifact_id: string;
  answers: ApplicationAnswer[];
  cover_letter_versions: CoverLetterArtifact[];
  current_cover_letter_id: string | null;
  channel_actions: ApplicationChannelAction[];
  capabilities: ProviderCapabilities;
  created_at: string;
  updated_at: string;
  is_demo: boolean;
};

export type ApplicationChannel = {
  id: ApplicationChannelId;
  title: string;
  state: "guided_handoff" | "manual_outreach" | "unavailable" | "direct_submit_available";
  capability: string;
  blocker: string | null;
  destination_url: string | null;
  action_label: string | null;
  direct_submit: boolean;
};

const uid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
const clean = (value: string) => value.replace(/\s+/g, " ").trim();
const sensitiveQuestion = (value: string) =>
  /work authori[sz]ation|visa|sponsor|demographic|disability|equal.opportunity|gender|ethnicity|race|veteran|criminal|salary expectation/i.test(
    value,
  );

async function sha256(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error(
      "This browser cannot create the exact approval hash. Approval remains blocked.",
    );
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function buildMasterProfile(candidate: Candidate): string {
  return [
    candidate.full_name,
    candidate.email,
    candidate.linkedin_url || "",
    `Career goal: ${candidate.career_goal}`,
    `Target roles: ${candidate.target_roles.join(", ") || "Not supplied"}`,
    `Locations: ${candidate.locations.join(", ") || "Not supplied"}`,
    `Experience: ${candidate.experience_years == null ? "Not supplied" : `${candidate.experience_years} years`}`,
    `Skills: ${candidate.skills.join(", ") || "Not supplied"}`,
    `Summary: ${candidate.summary || "Not supplied"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function createMasterProfileSnapshot(
  candidate: Candidate,
  at: string,
): MasterProfileSnapshot {
  const source: CvSource = {
    kind: candidate.cv_text?.trim() ? "uploaded_cv" : "conversational_profile",
    filename: candidate.cv_filename ?? null,
    text: candidate.cv_text?.trim() || buildMasterProfile(candidate),
  };
  const version = candidate.master_profile_version ?? 1;
  // Undefined supports legacy/demo candidates that predate explicit confirmation metadata.
  // An explicit null means extraction still requires candidate confirmation.
  const confirmedAt =
    candidate.profile_confirmed_at === null ? null : (candidate.profile_confirmed_at ?? at);
  const conversationalSource = {
    source_kind: "conversational_onboarding" as const,
    source_reference: "Candidate-reviewed onboarding conversation",
    confidence: 1,
    confirmed_at: confirmedAt,
    version,
  };
  const facts: ProfileFact[] = [
    {
      fact_id: "fact_full_name",
      fact_type: "identity",
      label: "Full name",
      value: candidate.full_name,
      source_excerpt: candidate.full_name,
      ...conversationalSource,
    },
    {
      fact_id: "fact_email",
      fact_type: "identity",
      label: "Email",
      value: candidate.email,
      source_excerpt: candidate.email,
      ...conversationalSource,
    },
    {
      fact_id: "fact_career_goal",
      fact_type: "preference",
      label: "Career goal",
      value: candidate.career_goal,
      source_excerpt: candidate.career_goal,
      ...conversationalSource,
    },
    {
      fact_id: "fact_skills",
      fact_type: "skill",
      label: "Confirmed skills",
      value: candidate.skills.join(", "),
      source_excerpt: candidate.skills.join(", ") || "No skills supplied",
      ...conversationalSource,
    },
    {
      fact_id: "fact_summary",
      fact_type: "summary",
      label: "Professional summary",
      value: candidate.summary,
      source_excerpt: candidate.summary || "No summary supplied",
      ...conversationalSource,
    },
  ];
  if (candidate.experience_years != null) {
    facts.push({
      fact_id: "fact_experience_years",
      fact_type: "experience",
      label: "Years of experience",
      value: String(candidate.experience_years),
      source_excerpt: `${candidate.experience_years} years`,
      ...conversationalSource,
    });
  }
  facts.push({
    fact_id: "fact_career_history",
    fact_type: "career_history",
    label:
      source.kind === "uploaded_cv" ? "Uploaded career history" : "Conversational career profile",
    value: source.text,
    source_kind: source.kind,
    source_reference: source.filename ?? "Candidate-reviewed conversational profile",
    source_excerpt: source.text.slice(0, 500),
    confidence: 1,
    confirmed_at: confirmedAt,
    version,
  });
  const extractedEmail =
    source.kind === "uploaded_cv"
      ? source.text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]
      : undefined;
  const conflicts: ProfileFactConflict[] =
    extractedEmail && extractedEmail.toLowerCase() !== candidate.email.toLowerCase()
      ? [
          {
            conflict_id: `conflict_email_v${version}`,
            fact_id: "fact_email",
            current_value: candidate.email,
            proposed_value: extractedEmail,
            source_reference: source.filename ?? "Uploaded CV",
            source_excerpt: extractedEmail,
            status: "open",
          },
        ]
      : [];
  return {
    profile_version: version,
    captured_at: at,
    revision_of: null,
    source,
    facts,
    conflicts,
  };
}

function requirementAnalysis(
  candidate: Candidate,
  requirement: string,
  index: number,
  match?: JobMatch,
): ApplicationRequirement {
  const normalized = requirement.toLowerCase();
  const confirmedSkill = candidate.skills.find(
    (skill) =>
      skill.toLowerCase() === normalized ||
      normalized.includes(skill.toLowerCase()) ||
      skill.toLowerCase().includes(normalized),
  );
  const suppliedMatch = match?.evidence.find(
    (item) => item.requirement.toLowerCase() === normalized,
  );
  const status: RequirementStatus = confirmedSkill
    ? "strong_match"
    : (suppliedMatch?.status ??
      (match?.gaps.some((gap) => gap.toLowerCase() === normalized) ? "gap" : "unknown"));
  const sourceText = candidate.cv_text?.trim() || buildMasterProfile(candidate);
  const sourceContains = sourceText.toLowerCase().includes(normalized);
  const evidence = confirmedSkill
    ? `Candidate-confirmed skill: ${confirmedSkill}.`
    : sourceContains
      ? "The exact requirement wording appears in the candidate-supplied source; review its context."
      : suppliedMatch?.evidence || null;
  return {
    requirement_id: `requirement_${index + 1}`,
    text: requirement,
    category: "skill",
    priority: "required",
    status: evidence && status === "unknown" ? "partial_match" : status,
    candidate_evidence: evidence,
    evidence_fact_ids: confirmedSkill
      ? ["fact_skills"]
      : sourceContains
        ? ["fact_career_history"]
        : [],
    uncertainty: evidence
      ? "The evidence supports review, not a guarantee of proficiency or ATS acceptance."
      : "No candidate-confirmed evidence was found for this exact requirement.",
    recommended_action: evidence
      ? "Keep the supported evidence and review its wording."
      : "Add truthful evidence to the master profile only if you have it; otherwise leave the gap visible.",
  };
}

export function analyzeJobForApplication(
  candidate: Candidate,
  job: Job,
  match?: JobMatch,
): JobAnalysis {
  const requirements = job.requirements.map((requirement, index) =>
    requirementAnalysis(candidate, requirement, index, match),
  );
  const sentences = job.description
    .split(/(?<=[.!?])\s+/)
    .map(clean)
    .filter((sentence) => sentence.length > 12);
  const responsibilities = sentences
    .filter((sentence) => !sentence.includes("?"))
    .map((sentence, index): ApplicationRequirement => ({
      requirement_id: `responsibility_${index + 1}`,
      text: sentence,
      category: "responsibility",
      priority: /preferred|nice to have|bonus/i.test(sentence) ? "preferred" : "unclear",
      status: "unknown",
      candidate_evidence: null,
      evidence_fact_ids: [],
      uncertainty:
        "Responsibility extracted from the job description; no specific candidate evidence is asserted.",
      recommended_action: "Review against the master CV and add only evidence you can confirm.",
    }));
  const applicationQuestions = sentences
    .filter((sentence) => sentence.includes("?"))
    .map((sentence, index): ApplicationRequirement => ({
      requirement_id: `question_${index + 1}`,
      text: sentence,
      category: "application_question",
      priority: "required",
      status: "unknown",
      candidate_evidence: null,
      evidence_fact_ids: [],
      uncertainty: "No answer has been reviewed or approved.",
      recommended_action: "Answer from candidate-confirmed facts before applying.",
    }));
  return {
    requirements: [...requirements, ...responsibilities],
    application_questions: applicationQuestions,
    method: "deterministic_local_demo",
    notes: [
      "Requirement analysis is deterministic and heuristic, not an ATS ranking or hiring probability.",
      "Unknown evidence remains unknown; no qualification, metric, employer or responsibility is invented.",
    ],
  };
}

function buildTailoredCv(candidate: Candidate, job: Job, source: CvSource): string {
  const relevantSkills = job.requirements
    .map((requirement) =>
      candidate.skills.find(
        (skill) =>
          skill.toLowerCase() === requirement.toLowerCase() ||
          requirement.toLowerCase().includes(skill.toLowerCase()),
      ),
    )
    .filter((skill): skill is string => Boolean(skill));
  const otherSkills = candidate.skills.filter((skill) => !relevantSkills.includes(skill));
  const contact = [candidate.email, candidate.linkedin_url || ""].filter(Boolean).join(" | ");
  return [
    candidate.full_name.toUpperCase(),
    `Target role: ${job.title} — ${job.company}`,
    contact,
    "",
    "PROFESSIONAL SUMMARY",
    candidate.summary || `Candidate targeting ${candidate.career_goal}.`,
    candidate.experience_years == null
      ? ""
      : `Candidate-confirmed experience: ${candidate.experience_years} years.`,
    "",
    "ROLE-RELEVANT CONFIRMED SKILLS",
    relevantSkills.length
      ? relevantSkills.join(" • ")
      : "No exact skill overlap confirmed; see master career history.",
    "",
    "ADDITIONAL CONFIRMED SKILLS",
    otherSkills.length ? otherSkills.join(" • ") : "No additional skills supplied.",
    "",
    source.kind === "uploaded_cv"
      ? "CANDIDATE-CONFIRMED CAREER HISTORY"
      : "CANDIDATE-CONFIRMED CAREER PROFILE",
    source.text,
    "",
    "TAILORING NOTE",
    `Prepared for ${job.title} at ${job.company}. Content is limited to the candidate-confirmed master source and selected job details.`,
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function initialAnswers(analysis: JobAnalysis, at: string): ApplicationAnswer[] {
  return analysis.application_questions.map((question) => ({
    answer_id: uid("answer"),
    question: question.text,
    proposed_answer: "",
    evidence_fact_ids: [],
    status: "needs_candidate_input",
    sensitive: sensitiveQuestion(question.text),
    version: 1,
    updated_at: at,
  }));
}

function initialChannelActions(): ApplicationChannelAction[] {
  return ["linkedin_easy_apply", "employer_site"].map((channel) => ({
    channel: channel as ApplicationChannelId,
    state: "draft" as const,
    approval: null,
    idempotency_key: uid("action"),
    handed_off_at: null,
    candidate_reported_at: null,
    provider_receipt_id: null,
  }));
}

export function createApplicationPackage(
  candidate: Candidate,
  job: Job,
  match: JobMatch | undefined,
  at = new Date().toISOString(),
): ApplicationPackage {
  const packageId = uid("package");
  const masterProfile = createMasterProfileSnapshot(candidate, at);
  const jobSnapshot: JobSnapshot = {
    snapshot_id: uid("snapshot"),
    title: job.title,
    company: job.company,
    location: job.location,
    description: job.description,
    requirements: [...job.requirements],
    source_url: job.source_url,
    application_method: job.application_method,
    captured_at: at,
  };
  const analysis = analyzeJobForApplication(candidate, job, match);
  const relevantSkills = candidate.skills.filter((skill) =>
    job.requirements.some((requirement) => requirement.toLowerCase().includes(skill.toLowerCase())),
  );
  const artifact: CvArtifact = {
    artifact_id: uid("cv"),
    package_id: packageId,
    version: 1,
    content: buildTailoredCv(candidate, job, masterProfile.source),
    change_summary: [
      `Targeted the document to ${job.title} without changing the master CV.`,
      "Reordered candidate-confirmed skills to show exact job overlap first.",
      "Preserved source career history and added no employers, qualifications, achievements or metrics.",
    ],
    evidence_used: relevantSkills,
    evidence_fact_ids: relevantSkills.length
      ? ["fact_skills", "fact_career_history"]
      : ["fact_career_history"],
    source_profile_version: masterProfile.profile_version,
    source_job_snapshot_id: jobSnapshot.snapshot_id,
    created_at: at,
    approval: null,
  };
  return {
    package_id: packageId,
    candidate_id: candidate.candidate_id,
    job_id: job.job_id,
    status: "draft",
    source: masterProfile.source,
    master_profile: masterProfile,
    master_profile_history: [
      ...(candidate.master_profile_history ?? []).filter(
        (revision) =>
          revision.profile_version !== masterProfile.profile_version ||
          revision.captured_at !== masterProfile.captured_at,
      ),
      masterProfile,
    ],
    job_snapshot: jobSnapshot,
    analysis,
    versions: [artifact],
    current_artifact_id: artifact.artifact_id,
    answers: initialAnswers(analysis, at),
    cover_letter_versions: [],
    current_cover_letter_id: null,
    channel_actions: initialChannelActions(),
    capabilities: LOCAL_PROVIDER_CAPABILITIES,
    created_at: at,
    updated_at: at,
    is_demo: true,
  };
}

export function getCurrentCvArtifact(applicationPackage: ApplicationPackage): CvArtifact {
  const artifact = applicationPackage.versions.find(
    (version) => version.artifact_id === applicationPackage.current_artifact_id,
  );
  if (!artifact) throw new Error("The current tailored CV version is unavailable.");
  return artifact;
}

function invalidateChannelApprovals(applicationPackage: ApplicationPackage, at: string) {
  return applicationPackage.channel_actions.map((action) => ({
    ...action,
    state: "draft" as const,
    approval: action.approval ? { ...action.approval, invalidated_at: at } : null,
    handed_off_at: null,
    candidate_reported_at: null,
    provider_receipt_id: null,
  }));
}

export function saveApplicationCvVersion(
  applicationPackage: ApplicationPackage,
  content: string,
  at = new Date().toISOString(),
): ApplicationPackage {
  const current = getCurrentCvArtifact(applicationPackage);
  if (!content.trim()) throw new Error("The tailored CV cannot be empty.");
  if (content === current.content) return applicationPackage;
  const version = Math.max(...applicationPackage.versions.map((artifact) => artifact.version)) + 1;
  const artifact: CvArtifact = {
    ...current,
    artifact_id: uid("cv"),
    version,
    content,
    change_summary: [
      "Candidate edited the tailored CV and saved a new immutable version.",
      "Review every edited claim against the unchanged master source before approval.",
    ],
    created_at: at,
    approval: null,
  };
  return {
    ...applicationPackage,
    status: "draft",
    versions: [...applicationPackage.versions, artifact],
    current_artifact_id: artifact.artifact_id,
    channel_actions: invalidateChannelApprovals(applicationPackage, at),
    updated_at: at,
  };
}

export type MasterProfileRevisionInput =
  | { fact_id: string; value: string }
  | { conflict_id: string; use_proposed: boolean }
  | { confirm_all: true };

export function getMasterProfileReviewBlockReason(
  masterProfile: MasterProfileSnapshot,
): string | null {
  const openConflicts = masterProfile.conflicts.filter((conflict) => conflict.status === "open");
  if (openConflicts.length) {
    return `Resolve ${openConflicts.length} uploaded-profile conflict${openConflicts.length === 1 ? "" : "s"} before approval. Neither value was selected automatically.`;
  }
  const unconfirmed = masterProfile.facts.filter((fact) => !fact.confirmed_at);
  if (unconfirmed.length) {
    return `Confirm ${unconfirmed.length} extracted profile fact${unconfirmed.length === 1 ? "" : "s"} before approval. Unknown values remain unknown.`;
  }
  return null;
}

function appendProfileRevision(
  history: MasterProfileSnapshot[],
  revision: MasterProfileSnapshot,
): MasterProfileSnapshot[] {
  return [
    ...history.filter(
      (item) =>
        item.profile_version !== revision.profile_version ||
        item.captured_at !== revision.captured_at,
    ),
    revision,
  ];
}

export function reviseApplicationMasterProfile(
  applicationPackage: ApplicationPackage,
  candidate: Candidate,
  input: MasterProfileRevisionInput,
  at = new Date().toISOString(),
): { candidate: Candidate; applicationPackage: ApplicationPackage } {
  const currentMaster = applicationPackage.master_profile;
  let facts = currentMaster.facts;
  let conflicts = currentMaster.conflicts;
  let source = currentMaster.source;
  let changedFactId: string | null = null;
  let changeLabel = "Candidate confirmed the current master profile facts.";

  if ("confirm_all" in input) {
    if (currentMaster.conflicts.some((conflict) => conflict.status === "open")) {
      throw new Error("Resolve each uploaded-profile conflict before confirming all facts.");
    }
    if (facts.every((fact) => fact.confirmed_at)) return { candidate, applicationPackage };
    facts = facts.map((fact) =>
      fact.confirmed_at
        ? fact
        : { ...fact, confirmed_at: at, version: fact.version + 1, confidence: 1 },
    );
  } else if ("conflict_id" in input) {
    const conflict = currentMaster.conflicts.find((item) => item.conflict_id === input.conflict_id);
    if (!conflict) throw new Error("The profile conflict is unavailable in this master revision.");
    const resolution = input.use_proposed ? "resolved_use_proposed" : "resolved_keep_current";
    if (conflict.status === resolution) return { candidate, applicationPackage };
    const fact = facts.find((item) => item.fact_id === conflict.fact_id);
    if (!fact) throw new Error("The conflicting profile fact is unavailable.");
    const value = input.use_proposed ? conflict.proposed_value : fact.value;
    changedFactId = fact.fact_id;
    changeLabel = input.use_proposed
      ? `Candidate selected the uploaded value for ${fact.label}.`
      : `Candidate kept the existing value for ${fact.label}.`;
    facts = facts.map((item) =>
      item.fact_id === fact.fact_id
        ? {
            ...item,
            value,
            confirmed_at: at,
            version: item.version + 1,
            confidence: 1,
            ...(input.use_proposed
              ? {
                  source_kind: "uploaded_cv" as const,
                  source_reference: conflict.source_reference,
                  source_excerpt: conflict.source_excerpt,
                }
              : {}),
          }
        : item,
    );
    conflicts = conflicts.map((item) =>
      item.conflict_id === conflict.conflict_id ? { ...item, status: resolution } : item,
    );
  } else {
    const fact = facts.find((item) => item.fact_id === input.fact_id);
    if (!fact) throw new Error("The master profile fact is unavailable.");
    const value = input.value.trim();
    if (["fact_full_name", "fact_email", "fact_career_goal"].includes(fact.fact_id) && !value) {
      throw new Error(
        `${fact.label} cannot be empty. Leave genuinely unknown optional facts blank instead.`,
      );
    }
    if (fact.fact_id === "fact_email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      throw new Error("Enter a valid candidate-confirmed email address.");
    }
    if (
      fact.fact_id === "fact_experience_years" &&
      value &&
      (!/^\d+(\.\d+)?$/.test(value) || Number(value) < 0 || Number(value) > 80)
    ) {
      throw new Error(
        "Enter candidate-confirmed years of experience between 0 and 80, or leave it unknown.",
      );
    }
    const hasOpenConflict = conflicts.some(
      (conflict) => conflict.fact_id === fact.fact_id && conflict.status === "open",
    );
    if (fact.value === value && fact.confirmed_at && !hasOpenConflict) {
      return { candidate, applicationPackage };
    }
    changedFactId = fact.fact_id;
    changeLabel = `Candidate explicitly edited ${fact.label}; no adjacent fact was inferred.`;
    facts = facts.map((item) =>
      item.fact_id === fact.fact_id
        ? {
            ...item,
            value,
            source_kind: "conversational_onboarding",
            source_reference: "Candidate-confirmed master revision in the application package",
            source_excerpt: value || "Not supplied",
            confirmed_at: at,
            confidence: 1,
            version: item.version + 1,
          }
        : item,
    );
    conflicts = conflicts.map((conflict) =>
      conflict.fact_id === fact.fact_id && conflict.status === "open"
        ? { ...conflict, status: "resolved_candidate_edit" }
        : conflict,
    );
    if (fact.fact_id === "fact_career_history") {
      source = { kind: "conversational_profile", filename: null, text: value };
    }
  }

  const revision: MasterProfileSnapshot = {
    ...currentMaster,
    profile_version: currentMaster.profile_version + 1,
    captured_at: at,
    revision_of: currentMaster.profile_version,
    source,
    facts,
    conflicts,
  };
  const valueOf = (factId: string) => facts.find((fact) => fact.fact_id === factId)?.value ?? "";
  const years = valueOf("fact_experience_years");
  const fullyConfirmed =
    facts.every((fact) => fact.confirmed_at) &&
    conflicts.every((conflict) => conflict.status !== "open");
  const history = appendProfileRevision(
    appendProfileRevision(candidate.master_profile_history ?? [], currentMaster),
    revision,
  );
  const nextCandidate: Candidate = {
    ...candidate,
    full_name: valueOf("fact_full_name"),
    email: valueOf("fact_email"),
    career_goal: valueOf("fact_career_goal"),
    skills: valueOf("fact_skills")
      .split(",")
      .map((skill) => skill.trim())
      .filter(Boolean),
    summary: valueOf("fact_summary"),
    experience_years: years ? Number(years) : null,
    cv_text: source.text,
    cv_filename: source.filename,
    master_profile_version: revision.profile_version,
    profile_confirmed_at: fullyConfirmed ? at : null,
    master_profile_history: history,
  };
  const job: Job = {
    job_id: applicationPackage.job_id,
    title: applicationPackage.job_snapshot.title,
    company: applicationPackage.job_snapshot.company,
    location: applicationPackage.job_snapshot.location,
    description: applicationPackage.job_snapshot.description,
    requirements: [...applicationPackage.job_snapshot.requirements],
    currency: candidate.currency,
    remote_type: candidate.remote_preference,
    source: "candidate_confirmed_job_snapshot",
    source_url: applicationPackage.job_snapshot.source_url,
    is_demo: applicationPackage.is_demo,
    application_method: applicationPackage.job_snapshot.application_method ?? null,
  };
  const currentArtifact = getCurrentCvArtifact(applicationPackage);
  const relevantSkills = nextCandidate.skills.filter((skill) =>
    job.requirements.some((requirement) => requirement.toLowerCase().includes(skill.toLowerCase())),
  );
  const artifact: CvArtifact = {
    ...currentArtifact,
    artifact_id: uid("cv"),
    version: Math.max(...applicationPackage.versions.map((item) => item.version)) + 1,
    content: buildTailoredCv(nextCandidate, job, source),
    change_summary: [
      changeLabel,
      `Created from immutable master profile revision ${revision.profile_version}; the previous master and tailored CV remain unchanged.`,
      "No employer, date, qualification, skill, metric or achievement was inferred beyond the candidate's explicit revision.",
    ],
    evidence_used: relevantSkills,
    evidence_fact_ids: relevantSkills.length
      ? ["fact_skills", "fact_career_history"]
      : ["fact_career_history"],
    source_profile_version: revision.profile_version,
    created_at: at,
    approval: null,
  };
  const currentCover = getCurrentCoverLetter(applicationPackage);
  const nextCover: CoverLetterArtifact | null = currentCover
    ? {
        ...currentCover,
        artifact_id: uid("cover"),
        version:
          Math.max(...applicationPackage.cover_letter_versions.map((item) => item.version)) + 1,
        source_profile_version: revision.profile_version,
        created_at: at,
        approval: null,
      }
    : null;
  const answers = changedFactId
    ? applicationPackage.answers.map((answer) =>
        answer.evidence_fact_ids.includes(changedFactId!) && answer.status === "candidate_confirmed"
          ? {
              ...answer,
              status: "needs_candidate_input" as const,
              version: answer.version + 1,
              updated_at: at,
            }
          : answer,
      )
    : applicationPackage.answers;
  const nextPackage: ApplicationPackage = {
    ...applicationPackage,
    status: "draft",
    source,
    master_profile: revision,
    master_profile_history: appendProfileRevision(
      appendProfileRevision(applicationPackage.master_profile_history, currentMaster),
      revision,
    ),
    analysis: analyzeJobForApplication(nextCandidate, job),
    versions: [...applicationPackage.versions, artifact],
    current_artifact_id: artifact.artifact_id,
    answers,
    cover_letter_versions: nextCover
      ? [...applicationPackage.cover_letter_versions, nextCover]
      : applicationPackage.cover_letter_versions,
    current_cover_letter_id: nextCover?.artifact_id ?? applicationPackage.current_cover_letter_id,
    channel_actions: invalidateChannelApprovals(applicationPackage, at),
    updated_at: at,
  };
  return { candidate: nextCandidate, applicationPackage: nextPackage };
}

export async function applicationCvHash(artifact: CvArtifact): Promise<string> {
  return sha256(
    JSON.stringify({
      artifact_id: artifact.artifact_id,
      package_id: artifact.package_id,
      version: artifact.version,
      content: artifact.content,
    }),
  );
}

export async function approveApplicationCv(
  applicationPackage: ApplicationPackage,
  approval: CvApproval,
): Promise<ApplicationPackage> {
  const masterBlock = getMasterProfileReviewBlockReason(applicationPackage.master_profile);
  if (masterBlock) throw new Error(masterBlock);
  const current = getCurrentCvArtifact(applicationPackage);
  if (
    approval.artifact_id !== current.artifact_id ||
    approval.version !== current.version ||
    approval.approved_text_hash !== (await applicationCvHash(current))
  ) {
    throw new Error(
      "Approval does not match the current tailored CV version. Export remains blocked.",
    );
  }
  const approvedArtifact = { ...current, approval };
  return {
    ...applicationPackage,
    status: "approved",
    versions: applicationPackage.versions.map((artifact) =>
      artifact.artifact_id === current.artifact_id ? approvedArtifact : artifact,
    ),
    updated_at: approval.approved_at,
  };
}

export function getCvExportBlockReason(
  applicationPackage: ApplicationPackage,
  editedContent?: string,
): string | null {
  const masterBlock = getMasterProfileReviewBlockReason(applicationPackage.master_profile);
  if (masterBlock) return masterBlock;
  const current = getCurrentCvArtifact(applicationPackage);
  if (editedContent !== undefined && editedContent !== current.content) {
    return "Save this edit as a new CV version, then approve that exact version before export.";
  }
  if (!current.approval || applicationPackage.status !== "approved") {
    return "Review and approve this exact tailored CV version before export.";
  }
  const formatCapabilities = applicationPackage.capabilities.documents;
  if (formatCapabilities.pdf === "unavailable" && formatCapabilities.docx === "unavailable") {
    return "PDF and DOCX rendering are unavailable in the configured backend. No file was created.";
  }
  return null;
}

export function suggestApplicationAnswer(
  applicationPackage: ApplicationPackage,
  answerId: string,
): string {
  const answer = applicationPackage.answers.find((item) => item.answer_id === answerId);
  if (!answer) throw new Error("The application answer is unavailable.");
  if (answer.sensitive) return "";
  const summary = applicationPackage.master_profile.facts.find(
    (fact) => fact.fact_id === "fact_summary",
  )?.value;
  const skills = applicationPackage.master_profile.facts.find(
    (fact) => fact.fact_id === "fact_skills",
  )?.value;
  return [summary, skills ? `My confirmed skills include ${skills}.` : ""]
    .filter(Boolean)
    .join(" ");
}

export function upsertApplicationAnswer(
  applicationPackage: ApplicationPackage,
  input: { answer_id?: string; question: string; proposed_answer: string; confirmed: boolean },
  at = new Date().toISOString(),
): ApplicationPackage {
  const question = input.question.trim();
  const proposedAnswer = input.proposed_answer.trim();
  if (!question) throw new Error("Enter the exact application question.");
  const sensitive = sensitiveQuestion(question);
  if (input.confirmed && !proposedAnswer && !sensitive) {
    throw new Error("Write your answer before confirming it.");
  }
  const existing = input.answer_id
    ? applicationPackage.answers.find((answer) => answer.answer_id === input.answer_id)
    : undefined;
  const next: ApplicationAnswer = {
    answer_id: existing?.answer_id ?? uid("answer"),
    question,
    proposed_answer: proposedAnswer,
    evidence_fact_ids:
      existing &&
      !sensitive &&
      proposedAnswer === suggestApplicationAnswer(applicationPackage, existing.answer_id)
        ? ["fact_summary", "fact_skills"]
        : [],
    status: input.confirmed ? "candidate_confirmed" : "needs_candidate_input",
    sensitive,
    version: (existing?.version ?? 0) + 1,
    updated_at: at,
  };
  return {
    ...applicationPackage,
    answers: existing
      ? applicationPackage.answers.map((answer) =>
          answer.answer_id === existing.answer_id ? next : answer,
        )
      : [...applicationPackage.answers, next],
    channel_actions: invalidateChannelApprovals(applicationPackage, at),
    updated_at: at,
  };
}

export function createCoverLetter(
  applicationPackage: ApplicationPackage,
  at = new Date().toISOString(),
): ApplicationPackage {
  const summary = applicationPackage.master_profile.facts.find(
    (fact) => fact.fact_id === "fact_summary",
  )?.value;
  const skills = applicationPackage.master_profile.facts.find(
    (fact) => fact.fact_id === "fact_skills",
  )?.value;
  const content = [
    "Dear Hiring Team,",
    "",
    `I am interested in the ${applicationPackage.job_snapshot.title} role at ${applicationPackage.job_snapshot.company}.`,
    summary ?? "",
    skills ? `My candidate-confirmed skills include ${skills}.` : "",
    "",
    "I would welcome the opportunity to discuss how my confirmed background relates to this role.",
    "",
    "Kind regards,",
    applicationPackage.master_profile.facts.find((fact) => fact.fact_id === "fact_full_name")
      ?.value ?? "",
  ]
    .filter((line) => line !== "")
    .join("\n");
  const artifact: CoverLetterArtifact = {
    artifact_id: uid("cover"),
    package_id: applicationPackage.package_id,
    version: 1,
    content,
    source_profile_version: applicationPackage.master_profile.profile_version,
    source_job_snapshot_id: applicationPackage.job_snapshot.snapshot_id,
    created_at: at,
    approval: null,
  };
  return {
    ...applicationPackage,
    cover_letter_versions: [artifact],
    current_cover_letter_id: artifact.artifact_id,
    channel_actions: invalidateChannelApprovals(applicationPackage, at),
    updated_at: at,
  };
}

export function getCurrentCoverLetter(
  applicationPackage: ApplicationPackage,
): CoverLetterArtifact | null {
  return (
    applicationPackage.cover_letter_versions.find(
      (artifact) => artifact.artifact_id === applicationPackage.current_cover_letter_id,
    ) ?? null
  );
}

export function saveCoverLetterVersion(
  applicationPackage: ApplicationPackage,
  content: string,
  at = new Date().toISOString(),
): ApplicationPackage {
  const current = getCurrentCoverLetter(applicationPackage);
  if (!current) throw new Error("Create a cover letter before editing it.");
  if (!content.trim()) throw new Error("The cover letter cannot be empty.");
  if (content === current.content) return applicationPackage;
  const artifact: CoverLetterArtifact = {
    ...current,
    artifact_id: uid("cover"),
    version: Math.max(...applicationPackage.cover_letter_versions.map((item) => item.version)) + 1,
    content,
    created_at: at,
    approval: null,
  };
  return {
    ...applicationPackage,
    cover_letter_versions: [...applicationPackage.cover_letter_versions, artifact],
    current_cover_letter_id: artifact.artifact_id,
    channel_actions: invalidateChannelApprovals(applicationPackage, at),
    updated_at: at,
  };
}

export async function coverLetterHash(artifact: CoverLetterArtifact): Promise<string> {
  return sha256(
    JSON.stringify({
      artifact_id: artifact.artifact_id,
      version: artifact.version,
      content: artifact.content,
    }),
  );
}

export async function approveCoverLetter(
  applicationPackage: ApplicationPackage,
  approval: CvApproval,
): Promise<ApplicationPackage> {
  const current = getCurrentCoverLetter(applicationPackage);
  if (
    !current ||
    approval.artifact_id !== current.artifact_id ||
    approval.version !== current.version ||
    approval.approved_text_hash !== (await coverLetterHash(current))
  ) {
    throw new Error("Cover-letter approval does not match the exact current version.");
  }
  return {
    ...applicationPackage,
    cover_letter_versions: applicationPackage.cover_letter_versions.map((artifact) =>
      artifact.artifact_id === current.artifact_id ? { ...artifact, approval } : artifact,
    ),
    updated_at: approval.approved_at,
  };
}

function publicHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function directSubmitAvailable(capability: ApplicationIntegrationCapability): boolean {
  return (
    capability.authorized &&
    capability.account_authorized &&
    capability.job_eligible &&
    capability.required_fields_verified
  );
}

export function getApplicationChannels(
  job: Job,
  capabilities: ProviderCapabilities = UNAVAILABLE_PROVIDER_CAPABILITIES,
): ApplicationChannel[] {
  const destination = publicHttpUrl(job.source_url);
  const linkedInDestination =
    destination && new URL(destination).hostname.endsWith("linkedin.com") ? destination : null;
  const easyApplyConfirmed =
    job.application_method === "easy_apply" && Boolean(linkedInDestination);
  const linkedInDirect =
    easyApplyConfirmed && directSubmitAvailable(capabilities.applications.linkedin_easy_apply);
  const employerDirect =
    Boolean(destination) && directSubmitAvailable(capabilities.applications.employer_site);
  return [
    {
      id: "linkedin_easy_apply",
      title: "LinkedIn Easy Apply",
      state: linkedInDirect
        ? "direct_submit_available"
        : easyApplyConfirmed
          ? "guided_handoff"
          : "unavailable",
      capability: linkedInDirect
        ? "The backend reports an official authorized integration, eligible job and verified required fields. Fresh exact-package approval is still required."
        : easyApplyConfirmed
          ? "Source data confirms Easy Apply. Continue on LinkedIn and submit it yourself with the approved package."
          : "Easy Apply is not confirmed by reliable source data. Direct submission integration is unavailable.",
      blocker: linkedInDirect
        ? null
        : capabilities.applications.linkedin_easy_apply.reason ||
          "No verified Easy Apply marker or authorized direct-submission integration.",
      destination_url: easyApplyConfirmed ? linkedInDestination : null,
      action_label: linkedInDirect
        ? "Submit through authorized integration"
        : easyApplyConfirmed
          ? "Continue on official site"
          : null,
      direct_submit: linkedInDirect,
    },
    {
      id: "employer_site",
      title: "Apply on employer site",
      state: employerDirect
        ? "direct_submit_available"
        : destination
          ? "guided_handoff"
          : "unavailable",
      capability: employerDirect
        ? "The backend reports an authorized employer/ATS integration and verified prerequisites. Approval is still required."
        : destination
          ? "Continue to the supplied official job/application page and complete it yourself. No automatic submission is available."
          : "No usable employer application URL was supplied.",
      blocker: employerDirect ? null : capabilities.applications.employer_site.reason,
      destination_url: destination,
      action_label: employerDirect
        ? "Submit through authorized integration"
        : destination
          ? "Continue on official site"
          : null,
      direct_submit: employerDirect,
    },
    {
      id: "hiring_team",
      title: "Contact hiring team",
      state: "manual_outreach",
      capability: capabilities.email.send
        ? "LinkedIn and email are available; provider sending still requires exact outreach approval and all verified controls."
        : "Use candidate-supplied contacts with LinkedIn or email copy/mailto handoff. Attach the approved CV yourself.",
      blocker: `${capabilities.needle.reason} ${capabilities.email.reason}`,
      destination_url: null,
      action_label: null,
      direct_submit: false,
    },
  ];
}

export function canonicalChannelPayload(
  applicationPackage: ApplicationPackage,
  channel: ApplicationChannel,
): string {
  const artifact = getCurrentCvArtifact(applicationPackage);
  const cover = getCurrentCoverLetter(applicationPackage);
  return JSON.stringify({
    package_id: applicationPackage.package_id,
    channel: channel.id,
    destination: channel.destination_url,
    cv: { artifact_id: artifact.artifact_id, version: artifact.version, content: artifact.content },
    cover_letter: cover
      ? { artifact_id: cover.artifact_id, version: cover.version, content: cover.content }
      : null,
    answers: applicationPackage.answers.map((answer) => ({
      answer_id: answer.answer_id,
      version: answer.version,
      question: answer.question,
      answer: answer.proposed_answer,
      status: answer.status,
    })),
    attachments: [`cv:${artifact.artifact_id}:${artifact.version}`],
  });
}

export function getChannelAction(
  applicationPackage: ApplicationPackage,
  channel: ApplicationChannelId,
): ApplicationChannelAction {
  return (
    applicationPackage.channel_actions.find((action) => action.channel === channel) ?? {
      channel,
      state: "draft",
      approval: null,
      idempotency_key: uid("action"),
      handed_off_at: null,
      candidate_reported_at: null,
      provider_receipt_id: null,
    }
  );
}

export function getPackagePrerequisitesBlockReason(
  applicationPackage: ApplicationPackage,
): string | null {
  const cvBlock = getCvExportBlockReason(applicationPackage);
  if (cvBlock) return cvBlock;
  if (applicationPackage.answers.some((answer) => answer.status !== "candidate_confirmed")) {
    return "Confirm every supplied application answer, or leave sensitive declarations for the external form.";
  }
  const cover = getCurrentCoverLetter(applicationPackage);
  if (cover && !cover.approval)
    return "Review and approve the exact cover-letter version or remove it before handoff.";
  return null;
}

export function getChannelActionBlockReason(
  applicationPackage: ApplicationPackage,
  channel: ApplicationChannel,
): string | null {
  const prerequisite = getPackagePrerequisitesBlockReason(applicationPackage);
  if (prerequisite) return prerequisite;
  if (!channel.destination_url)
    return "No verified destination is available for this application path.";
  const action = getChannelAction(applicationPackage, channel.id);
  if (!action.approval || action.approval.invalidated_at) {
    return "Review and approve the exact destination, answers, attachment and CV version before continuing.";
  }
  if (action.approval.canonical_payload !== canonicalChannelPayload(applicationPackage, channel)) {
    return "The package or destination changed. Fresh exact-package approval is required.";
  }
  return null;
}

export async function approveApplicationChannel(
  applicationPackage: ApplicationPackage,
  channel: ApplicationChannel,
  at = new Date().toISOString(),
): Promise<ApplicationPackage> {
  const prerequisite = getPackagePrerequisitesBlockReason(applicationPackage);
  if (prerequisite) throw new Error(prerequisite);
  if (!channel.destination_url) throw new Error("A verified destination is required.");
  const canonical = canonicalChannelPayload(applicationPackage, channel);
  const artifact = getCurrentCvArtifact(applicationPackage);
  const approval: PackageApproval = {
    approval_id: uid("approval"),
    channel: channel.id,
    destination: channel.destination_url,
    canonical_payload: canonical,
    payload_hash: await sha256(canonical),
    cv_artifact_id: artifact.artifact_id,
    cv_version: artifact.version,
    approved_at: at,
    approved_by: applicationPackage.candidate_id,
    invalidated_at: null,
  };
  const current = getChannelAction(applicationPackage, channel.id);
  const next = { ...current, state: "approved" as const, approval };
  return {
    ...applicationPackage,
    channel_actions: applicationPackage.channel_actions.some(
      (action) => action.channel === channel.id,
    )
      ? applicationPackage.channel_actions.map((action) =>
          action.channel === channel.id ? next : action,
        )
      : [...applicationPackage.channel_actions, next],
    updated_at: at,
  };
}

export async function recordApplicationHandoff(
  applicationPackage: ApplicationPackage,
  channel: ApplicationChannel,
  at = new Date().toISOString(),
): Promise<ApplicationPackage> {
  const blocked = getChannelActionBlockReason(applicationPackage, channel);
  if (blocked) throw new Error(blocked);
  const action = getChannelAction(applicationPackage, channel.id);
  if (action.state === "handed_off" || action.state === "candidate_reported")
    return applicationPackage;
  const next = { ...action, state: "handed_off" as const, handed_off_at: at };
  return {
    ...applicationPackage,
    channel_actions: applicationPackage.channel_actions.map((item) =>
      item.channel === channel.id ? next : item,
    ),
    updated_at: at,
  };
}

export function reportApplicationSubmitted(
  applicationPackage: ApplicationPackage,
  channelId: ApplicationChannelId,
  at = new Date().toISOString(),
): ApplicationPackage {
  const action = getChannelAction(applicationPackage, channelId);
  if (action.state !== "handed_off")
    throw new Error("Open the approved handoff before recording your own submission.");
  const next = { ...action, state: "candidate_reported" as const, candidate_reported_at: at };
  return {
    ...applicationPackage,
    channel_actions: applicationPackage.channel_actions.map((item) =>
      item.channel === channelId ? next : item,
    ),
    updated_at: at,
  };
}

export function applyProviderSubmissionReceipt(
  applicationPackage: ApplicationPackage,
  channel: ApplicationChannel,
  receipt: {
    receipt_id: string;
    channel: ApplicationChannelId;
    payload_hash: string;
    confirmed_at: string;
  },
): ApplicationPackage {
  const action = getChannelAction(applicationPackage, channel.id);
  if (!channel.direct_submit || !action.approval || action.approval.invalidated_at) {
    throw new Error("Authorized direct submission and fresh exact-package approval are required.");
  }
  if (receipt.channel !== channel.id || receipt.payload_hash !== action.approval.payload_hash) {
    throw new Error("The provider receipt does not match the approved package payload.");
  }
  if (action.provider_receipt_id === receipt.receipt_id) return applicationPackage;
  const next = {
    ...action,
    state: "provider_confirmed" as const,
    provider_receipt_id: receipt.receipt_id,
  };
  return {
    ...applicationPackage,
    channel_actions: applicationPackage.channel_actions.map((item) =>
      item.channel === channel.id ? next : item,
    ),
    updated_at: receipt.confirmed_at,
  };
}

export function getEmailSendBlockReason(capabilities: ProviderCapabilities): string | null {
  const email = capabilities.email;
  if (
    email.send &&
    email.verified_sender &&
    email.verified_recipient &&
    email.consent_and_suppression &&
    email.durable_audit &&
    email.idempotency
  ) {
    return null;
  }
  return (
    email.reason || "Verified email sending controls are incomplete. Use copy or mailto handoff."
  );
}