// Typed client for the Hired Not Tired FastAPI engine (/api/v1).
// Without VITE_API_BASE_URL, the explicitly labeled local demo uses ephemeral in-memory adapters.
import {
  buildMailtoUrl,
  canonicalApprovalContent,
  editEmailOutreachMessage,
  editOutreachMessage,
  getHandoffBlockReason,
  makeCandidateContact,
  validateContactInput,
  validateLinkedInProfileUrl,
  validateReplyInput,
  type ApprovalReceipt,
  type CandidateSentReceipt,
  type CareerTimelineEvent,
  type ContactDiscoveryResult,
  type DraftForOutreach,
  type EmailHandoffReceipt,
  type HiringContact,
  type LinkedInHandoffReceipt,
  type ManualContactInput,
  type OutreachMessage,
  type ReplyInput,
} from "@/lib/hiring-contacts";
import {
  applicationCvHash,
  approveApplicationChannel,
  approveApplicationCv as applyApplicationCvApproval,
  approveCoverLetter,
  applyProviderSubmissionReceipt,
  coverLetterHash,
  createApplicationPackage as buildApplicationPackage,
  createCoverLetter,
  getCurrentCoverLetter,
  getCurrentCvArtifact,
  LOCAL_PROVIDER_CAPABILITIES,
  recordApplicationHandoff,
  reportApplicationSubmitted,
  reviseApplicationMasterProfile,
  saveApplicationCvVersion as saveApplicationCv,
  saveCoverLetterVersion,
  upsertApplicationAnswer,
  type ApplicationChannel,
  type ApplicationPackage,
  type CvApproval,
  type MasterProfileRevisionInput,
  type MasterProfileSnapshot,
  type ProviderCapabilities,
} from "@/lib/application-package";
import type { BillingPlan, BillingStatus, CheckoutIntent, PlanKey } from "@/lib/billing";
import {
  linkedInAuthorizationUrl,
  localLinkedInAuthCapability,
  LINKEDIN_AUTH_CONTRACT,
  type AccountDeletionResult,
  type AuthenticatedWorkspace,
  type ConsentInput,
  type ConsentsResponse,
  type LinkedInAuthCapability,
} from "@/lib/linkedin-auth";

export type Candidate = {
  candidate_id: string;
  full_name: string;
  email: string;
  linkedin_url?: string | null;
  career_goal: string;
  target_roles: string[];
  locations: string[];
  minimum_salary?: number | null;
  currency: string;
  remote_preference: string;
  skills: string[];
  experience_years?: number | null;
  summary: string;
  cv_text: string;
  cv_filename?: string | null;
  master_profile_version?: number;
  profile_confirmed_at?: string | null;
  master_profile_history?: MasterProfileSnapshot[];
  master_documents?: Array<{
    filename: string;
    text: string;
    version: number;
    captured_at: string;
  }>;
};
export type Job = {
  job_id: string;
  title: string;
  company: string;
  location: string;
  description: string;
  requirements: string[];
  salary_min?: number | null;
  salary_max?: number | null;
  currency: string;
  remote_type: string;
  source: string;
  source_url: string;
  retrieved_at?: string;
  is_demo: boolean;
  application_method?: "easy_apply" | "external" | "unknown" | null;
};
export type MatchEvidence = {
  requirement: string;
  status: "strong_match" | "partial_match" | "gap" | "unknown";
  evidence: string;
};
export type JobMatch = {
  candidate_id: string;
  job_id: string;
  match_score: number;
  confidence: "low" | "medium" | "high";
  strengths: string[];
  gaps: string[];
  evidence: MatchEvidence[];
  constraints_met: boolean;
  recommendation: string;
};
export type OutreachDraft = {
  draft_id: string;
  candidate_id: string;
  job_id: string;
  recipient_name?: string | null;
  subject?: string | null;
  message: string;
  factuality_notes: string[];
  status: string;
  requires_user_action: boolean;
};
export type InteractionType =
  | "application_submitted"
  | "outreach_sent"
  | "recruiter_reply"
  | "interview"
  | "rejection"
  | "offer"
  | "note";
export type Interaction = {
  interaction_id: string;
  candidate_id: string;
  job_id: string;
  channel: string;
  interaction_type: InteractionType;
  content: string;
  outcome?: string | null;
  simulated: boolean;
  created_at: string;
};
export type RecommendedAction = {
  action_id: string;
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  action_type: string;
  estimated_minutes?: number | null;
};
export type WorkspaceData = {
  contacts: HiringContact[];
  application_packages: ApplicationPackage[];
  messages: OutreachMessage[];
  interactions: Interaction[];
  timeline: CareerTimelineEvent[];
};

export type CoachReply = {
  message: string;
  insights: string[];
  recommended_actions: RecommendedAction[];
  workflow_id: string;
  coach_mode: "demo" | "bedrock";
};
export type OnboardInput = {
  full_name: string;
  email: string;
  linkedin_url?: string;
  career_goal: string;
  target_roles: string[];
  locations: string[];
  minimum_salary?: number;
  currency?: string;
  remote_preference: "remote" | "hybrid" | "onsite" | "any";
};

const BASE = (import.meta.env["VITE_API_BASE_URL"] as string | undefined)?.replace(/\/$/, "");
export const isLiveApi = Boolean(BASE);

export class ApiError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function http<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  const method = (init.method ?? "GET").toUpperCase();
  const suppliedHeaders = init.headers ?? {};
  const headers = {
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...(method !== "GET" && authCsrfToken ? { "X-CSRF-Token": authCsrfToken } : {}),
    ...(method !== "GET" && !("Idempotency-Key" in suppliedHeaders)
      ? { "Idempotency-Key": globalThis.crypto.randomUUID() }
      : {}),
    ...suppliedHeaders,
  };
  const url = `${BASE}/api/v1${path}`;
  try {
    res = await fetch(url, {
      ...init,
      credentials: "include",
      headers,
    });
  } catch (error) {
    const diagnostic = networkDiagnostic(method, url, error);
    console.error("[career-engine] request failed before a readable response", diagnostic);
    throw new ApiError(
      `We couldn't reach the career engine. Check your connection and try again. No local demo success was substituted. Diagnostic: ${formatNetworkDiagnostic(diagnostic)}`,
    );
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      detail?: unknown;
      error?: { message?: unknown; request_id?: unknown };
    };
    const requestId =
      typeof body.error?.request_id === "string"
        ? body.error.request_id
        : res.headers.get("X-Request-ID");
    const message =
      typeof body.error?.message === "string"
        ? body.error.message
        : typeof body.detail === "string"
          ? body.detail
          : `The engine returned an error (${res.status}). Please retry.`;
    throw new ApiError(
      res.status >= 500 && requestId ? `${message} (Reference: ${requestId})` : message,
      res.status,
    );
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export type NetworkDiagnostic = {
  method: string;
  url: string;
  origin: string | null;
  error_name: string;
  error_message: string;
  hint: string;
};

/**
 * Safe, non-secret description of a fetch that failed before a readable response.
 * Contains no headers, cookies, CSRF tokens, request bodies or query strings.
 */
export function networkDiagnostic(method: string, url: string, error: unknown): NetworkDiagnostic {
  const origin = typeof window === "undefined" ? null : window.location.origin;
  const safeUrl = url.split(/[?#]/, 1)[0] ?? url;
  const name = error instanceof Error ? error.name : typeof error;
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 200);
  let hint =
    "The browser blocked or lost the response. Common causes: the server returned an error without CORS headers, this site origin is not allowed by the API, a proxy timeout, or no network.";
  if (origin?.startsWith("https:") && safeUrl.startsWith("http:")) {
    hint = "The API URL uses http on an https page, so the browser blocks it as mixed content.";
  } else if (!/^https?:\/\//.test(safeUrl)) {
    hint =
      "The API base URL is not an absolute http(s) URL; check the frontend build configuration.";
  } else if (name === "AbortError") {
    hint = "The request was cancelled before the API answered.";
  }
  return { method, url: safeUrl, origin, error_name: name, error_message: message, hint };
}

function formatNetworkDiagnostic(d: NetworkDiagnostic): string {
  return `${d.method} ${d.url} from ${d.origin ?? "unknown origin"} failed (${d.error_name}: ${d.error_message}). ${d.hint}`;
}

let authCsrfToken: string | null = null;

async function authHttp<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? "GET";
  try {
    return await http<T>(path, {
      ...init,
      headers: {
        ...(method !== "GET" && authCsrfToken ? { "X-CSRF-Token": authCsrfToken } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) authCsrfToken = null;
    throw error;
  }
}
const post = <T>(path: string, body?: unknown) =>
  http<T>(path, body ? { method: "POST", body: JSON.stringify(body) } : { method: "POST" });

const packageRevisionHeaders = (
  applicationPackage: ApplicationPackage,
): Record<string, string> => ({
  "If-Match": String(applicationPackage.revision ?? 1),
});

async function billingHttp<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!BASE)
    throw new ApiError("Sandbox checkout not configured yet. No local paid status was created.");
  return authHttp<T>(path, init);
}

async function outreachHttp<T>(path: string, init: RequestInit): Promise<T> {
  try {
    return await http<T>(path, init);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      const method = init.method ?? "GET";
      throw new ApiError(
        `Required backend endpoint unavailable: ${method} /api/v1${path}. The operation was not completed and no demo fallback was used.`,
        404,
      );
    }
    throw error;
  }
}

// ---------- Simulated engine (mirrors the repository's demo heuristics) ----------
const mem = {
  candidates: new Map<string, Candidate & { cv_text?: string }>(),
  jobs: new Map<string, Job>(),
  interactions: [] as Interaction[],
  actions: new Map<string, RecommendedAction[]>(),
  contacts: new Map<string, HiringContact>(),
  approvals: new Map<string, ApprovalReceipt>(),
  handoffs: new Map<string, LinkedInHandoffReceipt | EmailHandoffReceipt>(),
  confirmations: new Map<string, CandidateSentReceipt>(),
  applicationPackages: new Map<string, ApplicationPackage>(),
};
const id = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`;
const wait = (ms = 450) => new Promise((r) => setTimeout(r, ms));
const COMMON = [
  "python",
  "java",
  "typescript",
  "javascript",
  "aws",
  "azure",
  "gcp",
  "kubernetes",
  "docker",
  "fastapi",
  "terraform",
  "postgresql",
  "sql",
  "machine learning",
  "llm",
  "rag",
  "react",
  "platform engineering",
  "backend",
  "microservices",
];
const words = (t: string) =>
  new Set((t.toLowerCase().match(/[a-z0-9+#.]+/g) ?? []).filter((w) => w.length > 2));
function need<T>(v: T | undefined, what: string): T {
  if (!v) throw new ApiError(`${what} not found.`);
  return v;
}

const DEMO_JOBS: Job[] = [
  {
    job_id: "job_ai_architect_demo",
    title: "AI Solutions Architect",
    company: "Northstar AI (demo)",
    location: "Berlin / Hybrid",
    description:
      "Design enterprise AI solutions, cloud architecture, Python services and production LLM workflows.",
    requirements: ["Python", "AWS", "Kubernetes", "Production AI", "LLM evaluation"],
    salary_min: 80000,
    salary_max: 95000,
    currency: "EUR",
    remote_type: "hybrid",
    source: "demo",
    source_url: "https://example.com/demo/ai-solutions-architect",
    is_demo: true,
  },
  {
    job_id: "job_platform_demo",
    title: "Senior Platform Engineer",
    company: "Orbit Systems (demo)",
    location: "Remote",
    description:
      "Build cloud-native platform services with Kubernetes, Terraform, Python and observability.",
    requirements: ["Python", "Kubernetes", "Terraform", "AWS", "Observability"],
    salary_min: 78000,
    salary_max: 90000,
    currency: "EUR",
    remote_type: "remote",
    source: "demo",
    source_url: "https://example.com/demo/platform-engineer",
    is_demo: true,
  },
];

async function sha256(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle)
    throw new ApiError(
      "This browser cannot create the demo approval hash. Exact-message approval remains blocked.",
    );
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const local = {
  async seed() {
    await wait();
    const c: Candidate = {
      candidate_id: "cand_sarah_demo",
      full_name: "Sarah Miller",
      email: "sarah.demo@example.com",
      linkedin_url: "https://www.linkedin.com/in/sarah-miller-demo",
      career_goal: "AI Solutions Architect",
      target_roles: ["AI Solutions Architect", "Senior Platform Engineer"],
      locations: ["Berlin", "Remote"],
      minimum_salary: 75000,
      currency: "EUR",
      remote_preference: "any",
      skills: ["Python", "AWS", "Kubernetes", "FastAPI", "Platform Engineering", "Docker"],
      experience_years: 6,
      summary: "Senior backend and platform engineer moving toward production AI architecture.",
      cv_text:
        "PROFESSIONAL EXPERIENCE\nSenior Platform Engineer — fictional demo employer\nBuilt candidate-confirmed Python, AWS, Kubernetes, FastAPI and Docker platform services.\n\nEDUCATION\nEducation details not supplied in this fictional demo profile.",
      cv_filename: "sarah-miller-fictional-demo-cv.txt",
      master_profile_version: 1,
      profile_confirmed_at: new Date().toISOString(),
      master_documents: [],
    };
    mem.candidates.set(c.candidate_id, c);
    DEMO_JOBS.forEach((j) => mem.jobs.set(j.job_id, j));
    return { candidate: c, jobs: DEMO_JOBS, demo: true };
  },
  async onboard(i: OnboardInput): Promise<Candidate> {
    await wait();
    const c: Candidate = {
      candidate_id: id("cand"),
      currency: "EUR",
      skills: [],
      summary: "",
      cv_text: "",
      cv_filename: null,
      master_profile_version: 1,
      profile_confirmed_at: null,
      master_documents: [],
      linkedin_url: i.linkedin_url ?? null,
      minimum_salary: i.minimum_salary ?? null,
      ...i,
    };
    mem.candidates.set(c.candidate_id, c);
    return c;
  },
  async uploadCv(cid: string, filename: string, text: string) {
    await wait();
    const c = need(mem.candidates.get(cid), "Candidate");
    const lower = text.toLowerCase();
    const found = COMMON.filter((s) => lower.includes(s)).map((s) =>
      s.replace(/\b\w/g, (m) => m.toUpperCase()),
    );
    c.skills = Array.from(new Set([...c.skills, ...found]));
    c.summary = text.split(/\s+/).join(" ").slice(0, 500);
    const version = (c.master_profile_version ?? 0) + 1;
    c.master_documents = [
      ...(c.master_documents ?? []),
      { filename, text, version, captured_at: new Date().toISOString() },
    ];
    c.master_profile_version = version;
    c.profile_confirmed_at = null;
    c.cv_text = text;
    c.cv_filename = filename;
    return { ...c };
  },
  async patchProfile(cid: string, patch: Partial<Candidate>) {
    await wait(250);
    const c = need(mem.candidates.get(cid), "Candidate");
    const changesMaster = [
      "summary",
      "skills",
      "experience_years",
      "career_goal",
      "target_roles",
    ].some((key) => key in patch);
    if (changesMaster && !patch.profile_confirmed_at) {
      c.master_profile_version = (c.master_profile_version ?? 1) + 1;
      c.profile_confirmed_at = null;
    }
    Object.assign(c, patch);
    return { ...c };
  },
  async getProfile(cid: string) {
    await wait(150);
    return { ...need(mem.candidates.get(cid), "Candidate") };
  },
  async listJobs() {
    await wait(200);
    if (!mem.jobs.size) DEMO_JOBS.forEach((j) => mem.jobs.set(j.job_id, j));
    return [...mem.jobs.values()];
  },
  async match(jobId: string, cid: string): Promise<JobMatch> {
    await wait(600);
    const p = need(mem.candidates.get(cid), "Candidate");
    const job = need(mem.jobs.get(jobId), "Job");
    const skills = new Set(p.skills.map((s) => s.toLowerCase()));
    const terms = new Set<string>();
    job.requirements.forEach((r) => words(r).forEach((w) => terms.add(w)));
    words(job.description).forEach((w) => terms.add(w));
    const matched = [...skills].filter((s) => terms.has(s)).sort();
    const missing = [...terms]
      .filter(
        (t) =>
          !skills.has(t) &&
          [
            "python",
            "aws",
            "kubernetes",
            "llm",
            "rag",
            "terraform",
            "fastapi",
            "observability",
          ].includes(t),
      )
      .sort();
    let score = matched.length
      ? Math.min(
          98,
          Math.round(
            55 + (43 * matched.length) / Math.max(1, Math.min(job.requirements.length, 8)),
          ),
        )
      : 35;
    const salaryOk = !p.minimum_salary || !job.salary_max || job.salary_max >= p.minimum_salary;
    if (!salaryOk) score = Math.min(score, 20);
    const locOk =
      !p.locations.length ||
      p.locations.some(
        (l) =>
          job.location.toLowerCase().includes(l.toLowerCase()) ||
          job.location.toLowerCase().includes("remote"),
      );
    return {
      candidate_id: cid,
      job_id: jobId,
      match_score: score,
      confidence: p.skills.length ? "medium" : "low",
      strengths: matched.slice(0, 6),
      gaps: missing.slice(0, 5),
      evidence: [
        ...matched.slice(0, 5).map((s) => ({
          requirement: s,
          status: "strong_match" as const,
          evidence: `Listed in your profile and relevant to ${job.title}.`,
        })),
        ...missing.slice(0, 4).map((s) => ({
          requirement: s,
          status: "gap" as const,
          evidence: "Not found in your supplied profile; verify before treating as a real gap.",
        })),
      ],
      constraints_met: locOk && salaryOk,
      recommendation: score >= 70 && locOk && salaryOk ? "prepare_outreach" : "review_or_skip",
    };
  },
  async draft(
    cid: string,
    jobId: string,
    contact?: HiringContact,
    tone: "professional" | "warm" | "concise" = "warm",
  ): Promise<OutreachDraft> {
    await wait(700);
    const p = need(mem.candidates.get(cid), "Candidate");
    const job = need(mem.jobs.get(jobId), "Job");
    const hi = contact ? `Hi ${contact.full_name},` : "Hi there,";
    const top = p.skills.slice(0, 3).join(", ") || "my confirmed background";
    const roleContext = contact?.current_title
      ? ` Given your listed role as ${contact.current_title}, I thought this might be relevant to you.`
      : "";
    const body =
      tone === "concise"
        ? `${hi}\n\nI'm interested in the ${job.title} role at ${job.company}. My confirmed experience with ${top} lines up with the role.${roleContext} Would you be open to a short conversation?\n\nBest,\n${p.full_name}`
        : `${hi}\n\nI came across the ${job.title} role at ${job.company} and its focus on ${job.requirements.slice(0, 2).join(" and ")} caught my attention.${roleContext} My confirmed background includes ${top}, and I'm currently focused on ${p.career_goal}.\n\nWould you be open to a short conversation about the role and the challenges the team is solving?\n\nBest,\n${p.full_name}`;
    return {
      draft_id: id("draft"),
      candidate_id: cid,
      job_id: jobId,
      recipient_name: contact?.full_name ?? null,
      subject: null,
      message: body,
      factuality_notes: [
        "Only candidate-confirmed profile skills and the selected job details were referenced.",
        "Contact details are candidate-supplied and have not been independently verified.",
        "Nothing is sent automatically.",
      ],
      status: "draft",
      requires_user_action: true,
    };
  },
  async interaction(
    i: Omit<Interaction, "interaction_id" | "created_at" | "channel"> & { channel?: string },
  ) {
    await wait();
    const it: Interaction = {
      channel: "manual",
      ...i,
      interaction_id: id("int"),
      created_at: new Date().toISOString(),
    };
    mem.interactions.push(it);
    return it;
  },
  async chat(cid: string, message: string): Promise<CoachReply> {
    await wait(900);
    const p = need(mem.candidates.get(cid), "Candidate");
    const ints = mem.interactions.filter((x) => x.candidate_id === cid);
    const last = ints.at(-1);
    const lower = message.toLowerCase();
    const insights: string[] = [];
    let msg = `Thanks, ${p.full_name.split(" ")[0]}. `;
    if (last?.interaction_type === "rejection" || /reject|tired|down|discourag/.test(lower)) {
      msg +=
        "That's a hard one, and it's completely normal to feel it. A single outcome is a data point, not a verdict on you. Let's turn it into something useful.";
      insights.push(
        "Rejections that cite a specific skill are the most actionable feedback you can get.",
      );
    } else if (
      last?.interaction_type === "recruiter_reply" ||
      last?.interaction_type === "interview"
    ) {
      msg +=
        "This is real momentum — someone engaged with you. Let's prepare well so the next conversation lands.";
      insights.push("Replies correlate with role-specific outreach that names concrete overlap.");
    } else {
      msg += `You're aiming for ${p.career_goal}. Here's where I'd focus your energy this week — fewer, better-aligned moves.`;
    }
    if (last && /production|llm|ai/.test(last.content.toLowerCase()))
      insights.push(
        "Recent feedback points to production AI evidence as your highest-leverage gap.",
      );
    if (p.skills.length)
      insights.push(`Your strongest signals: ${p.skills.slice(0, 3).join(", ")}.`);
    const actions: RecommendedAction[] = [
      {
        action_id: id("act"),
        title: "Review your top match",
        description: "Open the best-aligned opportunity and check its gaps before deciding.",
        priority: "high",
        action_type: "job_search",
        estimated_minutes: 10,
      },
      {
        action_id: id("act"),
        title: "Review one thoughtful message",
        description:
          "Personalise a draft, approve the exact text, and use the manual LinkedIn handoff.",
        priority: "medium",
        action_type: "outreach",
        estimated_minutes: 15,
      },
      {
        action_id: id("act"),
        title: "Close one evidence gap",
        description: "Write up a small production AI project or case study you can point to.",
        priority: "medium",
        action_type: "learning",
        estimated_minutes: 45,
      },
      {
        action_id: id("act"),
        title: "Take a proper break",
        description: "Momentum is a marathon. Block 30 minutes away from the search today.",
        priority: "low",
        action_type: "wellbeing",
        estimated_minutes: 30,
      },
    ];
    mem.actions.set(cid, actions);
    return {
      message: msg,
      insights,
      recommended_actions: actions,
      workflow_id: id("wf"),
      coach_mode: "demo",
    };
  },
  async actionPlan(cid: string) {
    await wait(200);
    return { candidate_id: cid, actions: mem.actions.get(cid) ?? [] };
  },
  async createApplicationPackage(
    cid: string,
    job: Job,
    match?: JobMatch,
  ): Promise<ApplicationPackage> {
    await wait(650);
    const candidate = need(mem.candidates.get(cid), "Candidate");
    need(mem.jobs.get(job.job_id), "Job");
    const applicationPackage = buildApplicationPackage(candidate, job, match);
    mem.applicationPackages.set(applicationPackage.package_id, applicationPackage);
    return applicationPackage;
  },
  async reviseMasterProfile(
    applicationPackage: ApplicationPackage,
    input: MasterProfileRevisionInput,
  ): Promise<{ candidate: Candidate; applicationPackage: ApplicationPackage }> {
    await wait(300);
    need(mem.applicationPackages.get(applicationPackage.package_id), "Application package");
    const candidate = need(mem.candidates.get(applicationPackage.candidate_id), "Candidate");
    const revised = reviseApplicationMasterProfile(applicationPackage, candidate, input);
    mem.candidates.set(revised.candidate.candidate_id, revised.candidate);
    mem.applicationPackages.set(revised.applicationPackage.package_id, revised.applicationPackage);
    return revised;
  },
  async saveApplicationCv(
    applicationPackage: ApplicationPackage,
    content: string,
  ): Promise<ApplicationPackage> {
    await wait(300);
    need(mem.applicationPackages.get(applicationPackage.package_id), "Application package");
    const saved = saveApplicationCv(applicationPackage, content);
    mem.applicationPackages.set(saved.package_id, saved);
    return saved;
  },
  async approveApplicationCv(applicationPackage: ApplicationPackage): Promise<ApplicationPackage> {
    await wait(350);
    need(mem.applicationPackages.get(applicationPackage.package_id), "Application package");
    const artifact = getCurrentCvArtifact(applicationPackage);
    const approval: CvApproval = {
      artifact_id: artifact.artifact_id,
      version: artifact.version,
      approved_text_hash: await applicationCvHash(artifact),
      approved_at: new Date().toISOString(),
      approved_by: applicationPackage.candidate_id,
    };
    const approved = await applyApplicationCvApproval(applicationPackage, approval);
    mem.applicationPackages.set(approved.package_id, approved);
    return approved;
  },
  async saveAnswer(
    applicationPackage: ApplicationPackage,
    input: { answer_id?: string; question: string; proposed_answer: string; confirmed: boolean },
  ) {
    await wait(250);
    need(mem.applicationPackages.get(applicationPackage.package_id), "Application package");
    const saved = upsertApplicationAnswer(applicationPackage, input);
    mem.applicationPackages.set(saved.package_id, saved);
    return saved;
  },
  async createCoverLetter(applicationPackage: ApplicationPackage) {
    await wait(300);
    need(mem.applicationPackages.get(applicationPackage.package_id), "Application package");
    const saved = createCoverLetter(applicationPackage);
    mem.applicationPackages.set(saved.package_id, saved);
    return saved;
  },
  async saveCoverLetter(applicationPackage: ApplicationPackage, content: string) {
    await wait(250);
    need(mem.applicationPackages.get(applicationPackage.package_id), "Application package");
    const saved = saveCoverLetterVersion(applicationPackage, content);
    mem.applicationPackages.set(saved.package_id, saved);
    return saved;
  },
  async approveCoverLetter(applicationPackage: ApplicationPackage) {
    await wait(300);
    need(mem.applicationPackages.get(applicationPackage.package_id), "Application package");
    const artifact = getCurrentCoverLetter(applicationPackage);
    if (!artifact) throw new ApiError("Create a cover letter before approval.");
    const approval: CvApproval = {
      artifact_id: artifact.artifact_id,
      version: artifact.version,
      approved_text_hash: await coverLetterHash(artifact),
      approved_at: new Date().toISOString(),
      approved_by: applicationPackage.candidate_id,
    };
    const saved = await approveCoverLetter(applicationPackage, approval);
    mem.applicationPackages.set(saved.package_id, saved);
    return saved;
  },
  async approveChannel(applicationPackage: ApplicationPackage, channel: ApplicationChannel) {
    await wait(300);
    need(mem.applicationPackages.get(applicationPackage.package_id), "Application package");
    const saved = await approveApplicationChannel(applicationPackage, channel);
    mem.applicationPackages.set(saved.package_id, saved);
    return saved;
  },
  async handoffChannel(applicationPackage: ApplicationPackage, channel: ApplicationChannel) {
    await wait(250);
    need(mem.applicationPackages.get(applicationPackage.package_id), "Application package");
    const saved = await recordApplicationHandoff(applicationPackage, channel);
    mem.applicationPackages.set(saved.package_id, saved);
    return saved;
  },
  async reportSubmitted(applicationPackage: ApplicationPackage, channel: ApplicationChannel) {
    await wait(250);
    need(mem.applicationPackages.get(applicationPackage.package_id), "Application package");
    const saved = reportApplicationSubmitted(applicationPackage, channel.id);
    mem.applicationPackages.set(saved.package_id, saved);
    return saved;
  },
};

function draftForContact(draft: OutreachDraft, contact: HiringContact): DraftForOutreach {
  return {
    draft_id: draft.draft_id,
    candidate_id: draft.candidate_id,
    job_id: draft.job_id,
    contact_id: contact.contact_id,
    message: draft.message,
    subject: draft.subject ?? null,
    factuality_notes: Array.from(
      new Set([
        ...draft.factuality_notes,
        "The recipient is a potential hiring contact, not a confirmed hiring manager.",
      ]),
    ),
    personalization_rationale: `Uses the selected job description, your confirmed career profile, and candidate-supplied details for ${contact.full_name}${contact.evidence_notes ? ", including your evidence note" : ""}.`,
  };
}

export const api = {
  linkedinAuthCapability: async (): Promise<LinkedInAuthCapability> => {
    if (!BASE) return localLinkedInAuthCapability();
    return outreachHttp<LinkedInAuthCapability>("/auth/capabilities", { method: "GET" });
  },
  linkedinAuthorizationUrl: (capability: LinkedInAuthCapability): string =>
    linkedInAuthorizationUrl(BASE, capability),
  linkedinAuthSession: async (): Promise<AuthenticatedWorkspace> => {
    if (!BASE) throw new ApiError("Real session bootstrap requires a configured FastAPI backend.");
    const workspace = await authHttp<AuthenticatedWorkspace>("/auth/session", { method: "GET" });
    // This token is deliberately held only in memory, never localStorage/sessionStorage.
    authCsrfToken = workspace.csrf_token;
    return workspace;
  },
  logoutLinkedIn: async (): Promise<void> => {
    if (!BASE) return;
    await authHttp<void>("/auth/logout", { method: "POST" });
    authCsrfToken = null;
  },
  updateConsents: (consents: ConsentInput[]): Promise<ConsentsResponse> =>
    authHttp<ConsentsResponse>("/account/consents", {
      method: "PUT",
      body: JSON.stringify({ consents }),
    }),
  deleteAccount: async (confirmation: string): Promise<AccountDeletionResult> => {
    const result = await authHttp<AccountDeletionResult>("/account", {
      method: "DELETE",
      body: JSON.stringify({ confirmation }),
    });
    authCsrfToken = null;
    return result;
  },
  linkedinAuthContract: LINKEDIN_AUTH_CONTRACT,
  seed: () =>
    BASE ? post<{ candidate: Candidate; jobs: Job[]; demo: boolean }>("/demo/seed") : local.seed(),
  onboard: (i: OnboardInput) =>
    BASE ? post<Candidate>("/candidates/onboard", i) : local.onboard(i),
  uploadCv: (cid: string, filename: string, text: string) =>
    BASE
      ? post<Candidate>(`/candidates/${cid}/documents/cv`, { filename, text })
      : local.uploadCv(cid, filename, text),
  linkedin: (cid: string, linkedin_url: string, profile_data: Record<string, unknown>) =>
    BASE
      ? post<Candidate>(`/candidates/${cid}/profile/linkedin`, { linkedin_url, profile_data })
      : local.patchProfile(cid, { linkedin_url }),
  patchProfile: (cid: string, patch: Partial<Candidate>) =>
    BASE
      ? http<Candidate>(`/candidates/${cid}/profile`, {
          method: "PATCH",
          body: JSON.stringify({
            ...patch,
            expected_version: patch.master_profile_version ?? 1,
            candidate_confirmed: true,
          }),
        })
      : local.patchProfile(cid, patch),
  getProfile: (cid: string) =>
    BASE ? http<Candidate>(`/candidates/${cid}/profile`) : local.getProfile(cid),
  discover: (cid: string) =>
    BASE
      ? post<{ jobs: Job[] }>("/jobs/discover", {
          candidate_id: cid,
          sources: ["candidate_submitted", "job_url_import"],
          limit: 10,
        }).then((r) => r.jobs)
      : local.listJobs(),
  listJobs: () => (BASE ? http<Job[]>("/jobs") : local.listJobs()),
  importJob: (cid: string, sourceUrl: string): Promise<Job> => {
    if (!BASE) {
      return Promise.reject(
        new ApiError(
          "Public job URL import requires the configured backend. The fictional demo jobs were not changed.",
        ),
      );
    }
    return outreachHttp<Job>("/jobs/import", {
      method: "POST",
      body: JSON.stringify({ candidate_id: cid, source_url: sourceUrl }),
    });
  },
  discoverContacts: async (cid: string, job: Job): Promise<ContactDiscoveryResult> => {
    if (!BASE) {
      return {
        status: "not_configured",
        contacts: [],
        fallback_url: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${job.title} ${job.company}`)}`,
        detail:
          "Verified automatic contact discovery is not configured. Use the contextual LinkedIn people search or add a contact you already know; no person was invented.",
        searched_at: new Date().toISOString(),
      };
    }
    return outreachHttp<ContactDiscoveryResult>(
      `/candidates/${cid}/jobs/${job.job_id}/contacts/discover`,
      { method: "POST", body: JSON.stringify({}) },
    );
  },
  getWorkspace: (cid: string): Promise<WorkspaceData> => {
    if (BASE) return http<WorkspaceData>(`/candidates/${cid}/workspace`);
    return Promise.resolve({
      contacts: [...mem.contacts.values()],
      application_packages: [...mem.applicationPackages.values()],
      messages: [],
      interactions: mem.interactions,
      timeline: [],
    });
  },
  match: (jobId: string, cid: string) =>
    BASE ? post<JobMatch>(`/jobs/${jobId}/match/${cid}`) : local.match(jobId, cid),
  chat: (cid: string, message: string) =>
    BASE
      ? post<CoachReply>("/coach/chat", {
          candidate_id: cid,
          message,
          include_memory: true,
          include_recent_interactions: true,
        })
      : local.chat(cid, message),
  actionPlan: (cid: string) =>
    BASE
      ? http<{ actions: RecommendedAction[] }>(`/coach/action-plan/${cid}`)
      : local.actionPlan(cid),
  createApplicationPackage: (
    cid: string,
    job: Job,
    match?: JobMatch,
  ): Promise<ApplicationPackage> =>
    BASE
      ? outreachHttp<ApplicationPackage>(
          `/candidates/${cid}/jobs/${job.job_id}/application-package`,
          {
            method: "POST",
            body: JSON.stringify({}),
          },
        )
      : local.createApplicationPackage(cid, job, match),
  reviseMasterProfile: async (
    applicationPackage: ApplicationPackage,
    input: MasterProfileRevisionInput,
  ): Promise<{ candidate: Candidate; applicationPackage: ApplicationPackage }> => {
    if (!BASE) return local.reviseMasterProfile(applicationPackage, input);
    const factId =
      "fact_id" in input
        ? input.fact_id
        : "conflict_id" in input
          ? applicationPackage.master_profile.conflicts.find(
              (conflict) => conflict.conflict_id === input.conflict_id,
            )?.fact_id
          : "confirmation";
    if (!factId) throw new ApiError("The profile conflict is unavailable in this master revision.");
    // Both resource families come from spec section 7 and are absent from the inspected backend.
    // A failure never falls back to the local adapter or reports a partial revision as complete.
    const revised = await outreachHttp<{
      candidate: Candidate;
      master_profile: MasterProfileSnapshot;
    }>(`/candidates/${applicationPackage.candidate_id}/profile/facts/${factId}`, {
      method: "PATCH",
      body: JSON.stringify({
        ...input,
        expected_version: applicationPackage.master_profile.profile_version,
        candidate_confirmed: true,
      }),
    });
    const regenerated = await outreachHttp<ApplicationPackage>(
      `/application-packages/${applicationPackage.package_id}/cv-artifacts`,
      {
        method: "POST",
        body: JSON.stringify({
          action: "generate",
          source_profile_version: revised.master_profile.profile_version,
        }),
        headers: packageRevisionHeaders(applicationPackage),
      },
    );
    return { candidate: revised.candidate, applicationPackage: regenerated };
  },
  saveApplicationCv: (
    applicationPackage: ApplicationPackage,
    content: string,
  ): Promise<ApplicationPackage> =>
    BASE
      ? outreachHttp<ApplicationPackage>(
          `/application-packages/${applicationPackage.package_id}/cv-artifacts`,
          {
            method: "PATCH",
            body: JSON.stringify({
              artifact_id: getCurrentCvArtifact(applicationPackage).artifact_id,
              content,
            }),
            headers: packageRevisionHeaders(applicationPackage),
          },
        )
      : local.saveApplicationCv(applicationPackage, content),
  approveApplicationCv: (applicationPackage: ApplicationPackage): Promise<ApplicationPackage> =>
    BASE
      ? outreachHttp<ApplicationPackage>(
          `/application-packages/${applicationPackage.package_id}/approvals`,
          {
            method: "POST",
            body: JSON.stringify({
              artifact_type: "tailored_cv",
              artifact_id: getCurrentCvArtifact(applicationPackage).artifact_id,
              version: getCurrentCvArtifact(applicationPackage).version,
              content: getCurrentCvArtifact(applicationPackage).content,
            }),
            headers: packageRevisionHeaders(applicationPackage),
          },
        )
      : local.approveApplicationCv(applicationPackage),
  getProviderCapabilities: (): Promise<ProviderCapabilities> =>
    BASE
      ? outreachHttp<ProviderCapabilities>("/providers/capabilities", { method: "GET" })
      : Promise.resolve(LOCAL_PROVIDER_CAPABILITIES),
  billingPlans: (): Promise<{ environment: "sandbox" | "live"; plans: BillingPlan[] }> =>
    billingHttp("/billing/plans"),
  billingStatus: (): Promise<BillingStatus> => billingHttp("/billing/subscription"),
  createBillingCheckout: (planKey: PlanKey): Promise<CheckoutIntent> =>
    billingHttp("/billing/checkout-intents", {
      method: "POST",
      body: JSON.stringify({ plan_key: planKey }),
    }),
  verifyBillingSubscription: async (
    intentId: string,
    subscriptionId: string,
  ): Promise<BillingStatus> => {
    const result = await billingHttp<{ verified: boolean; subscription: BillingStatus }>(
      "/billing/verify",
      {
        method: "POST",
        body: JSON.stringify({ intent_id: intentId, subscription_id: subscriptionId }),
      },
    );
    return result.subscription;
  },
  cancelBillingSubscription: async (subscriptionId: string): Promise<BillingStatus> => {
    const result = await billingHttp<{ subscription: BillingStatus }>("/billing/cancellation", {
      method: "POST",
      body: JSON.stringify({ subscription_id: subscriptionId }),
    });
    return result.subscription;
  },
  saveApplicationAnswer: (
    applicationPackage: ApplicationPackage,
    input: { answer_id?: string; question: string; proposed_answer: string; confirmed: boolean },
  ): Promise<ApplicationPackage> =>
    BASE
      ? outreachHttp<ApplicationPackage>(
          `/application-packages/${applicationPackage.package_id}/answers${input.answer_id ? `/${input.answer_id}` : ""}`,
          {
            method: input.answer_id ? "PATCH" : "POST",
            body: JSON.stringify(input),
            headers: packageRevisionHeaders(applicationPackage),
          },
        )
      : local.saveAnswer(applicationPackage, input),
  createCoverLetter: (applicationPackage: ApplicationPackage): Promise<ApplicationPackage> =>
    BASE
      ? outreachHttp<ApplicationPackage>(`/application-packages/${applicationPackage.package_id}`, {
          method: "PATCH",
          body: JSON.stringify({ cover_letter: { action: "create" } }),
          headers: packageRevisionHeaders(applicationPackage),
        })
      : local.createCoverLetter(applicationPackage),
  saveCoverLetter: (
    applicationPackage: ApplicationPackage,
    content: string,
  ): Promise<ApplicationPackage> =>
    BASE
      ? outreachHttp<ApplicationPackage>(`/application-packages/${applicationPackage.package_id}`, {
          method: "PATCH",
          body: JSON.stringify({
            cover_letter: {
              artifact_id: getCurrentCoverLetter(applicationPackage)?.artifact_id,
              content,
            },
          }),
          headers: packageRevisionHeaders(applicationPackage),
        })
      : local.saveCoverLetter(applicationPackage, content),
  approveCoverLetter: (applicationPackage: ApplicationPackage): Promise<ApplicationPackage> => {
    const artifact = getCurrentCoverLetter(applicationPackage);
    if (!artifact) return Promise.reject(new ApiError("Create a cover letter before approval."));
    return BASE
      ? outreachHttp<ApplicationPackage>(
          `/application-packages/${applicationPackage.package_id}/approvals`,
          {
            method: "POST",
            body: JSON.stringify({
              artifact_type: "cover_letter",
              artifact_id: artifact.artifact_id,
              version: artifact.version,
              content: artifact.content,
            }),
            headers: packageRevisionHeaders(applicationPackage),
          },
        )
      : local.approveCoverLetter(applicationPackage);
  },
  approveApplicationChannel: (
    applicationPackage: ApplicationPackage,
    channel: ApplicationChannel,
  ): Promise<ApplicationPackage> =>
    BASE
      ? outreachHttp<ApplicationPackage>(
          `/application-packages/${applicationPackage.package_id}/approvals`,
          {
            method: "POST",
            body: JSON.stringify({
              artifact_type: "channel_action",
              channel: channel.id,
              destination: channel.destination_url,
            }),
            headers: packageRevisionHeaders(applicationPackage),
          },
        )
      : local.approveChannel(applicationPackage, channel),
  recordApplicationHandoff: (
    applicationPackage: ApplicationPackage,
    channel: ApplicationChannel,
  ): Promise<ApplicationPackage> =>
    BASE
      ? outreachHttp<ApplicationPackage>(
          `/application-packages/${applicationPackage.package_id}/actions/${channel.id}`,
          {
            method: "POST",
            headers: {
              "Idempotency-Key": `handoff:${applicationPackage.package_id}:${channel.id}`,
              ...packageRevisionHeaders(applicationPackage),
            },
            body: JSON.stringify({ action: "handoff", destination: channel.destination_url }),
          },
        )
      : local.handoffChannel(applicationPackage, channel),
  reportApplicationSubmitted: (
    applicationPackage: ApplicationPackage,
    channel: ApplicationChannel,
  ): Promise<ApplicationPackage> =>
    BASE
      ? outreachHttp<ApplicationPackage>(
          `/application-packages/${applicationPackage.package_id}/actions/${channel.id}/candidate-confirmation`,
          {
            method: "POST",
            headers: {
              "Idempotency-Key": `reported:${applicationPackage.package_id}:${channel.id}`,
              ...packageRevisionHeaders(applicationPackage),
            },
            body: JSON.stringify({ candidate_reported: true }),
          },
        )
      : local.reportSubmitted(applicationPackage, channel),
  submitApplication: async (
    applicationPackage: ApplicationPackage,
    channel: ApplicationChannel,
  ): Promise<ApplicationPackage> => {
    if (!BASE)
      throw new ApiError("Direct submission is unavailable in the local demo. Use guided handoff.");
    if (!channel.direct_submit)
      throw new ApiError("The backend has not confirmed authorized direct-submission capability.");
    const receipt = await outreachHttp<{
      receipt_id: string;
      channel: ApplicationChannel["id"];
      payload_hash: string;
      confirmed_at: string;
    }>(`/application-packages/${applicationPackage.package_id}/actions/${channel.id}`, {
      method: "POST",
      headers: {
        "Idempotency-Key": `submit:${applicationPackage.package_id}:${channel.id}`,
        ...packageRevisionHeaders(applicationPackage),
      },
      body: JSON.stringify({ action: "submit", destination: channel.destination_url }),
    });
    return applyProviderSubmissionReceipt(applicationPackage, channel, receipt);
  },

  createContact: async (
    cid: string,
    job: Job,
    input: ManualContactInput,
  ): Promise<HiringContact> => {
    const valid = validateContactInput(input);
    if (!BASE) {
      await wait(350);
      const contact = makeCandidateContact(valid, cid, job.job_id, true);
      mem.contacts.set(contact.contact_id, contact);
      return contact;
    }
    // Documented vertical-slice route; absent from the inspected repository OpenAPI schema.
    return outreachHttp<HiringContact>(`/candidates/${cid}/jobs/${job.job_id}/contacts`, {
      method: "POST",
      body: JSON.stringify({
        display_name: valid.full_name,
        current_title: valid.current_title || null,
        current_company: valid.company || null,
        location: valid.location || null,
        linkedin_url: valid.profile_url || null,
        discovery_method: "manual",
        evidence: {
          source_type: "candidate_input",
          source_url: valid.source_url || null,
          observed_fact: valid.evidence_notes || null,
          email: valid.email || null,
        },
      }),
    });
  },
  updateContact: async (
    contact: HiringContact,
    input: ManualContactInput,
  ): Promise<HiringContact> => {
    const valid = validateContactInput(input);
    if (!BASE) {
      await wait(350);
      const updated = {
        ...makeCandidateContact(
          valid,
          contact.candidate_id,
          contact.job_id,
          contact.is_demo,
          new Date().toISOString(),
          contact.contact_id,
        ),
        created_at: contact.created_at,
      };
      mem.contacts.set(updated.contact_id, updated);
      return updated;
    }
    // Documented vertical-slice route; absent from the inspected repository OpenAPI schema.
    return outreachHttp<HiringContact>(
      `/candidates/${contact.candidate_id}/contacts/${contact.contact_id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          display_name: valid.full_name,
          current_title: valid.current_title || null,
          current_company: valid.company || null,
          location: valid.location || null,
          linkedin_url: valid.profile_url || null,
          email: valid.email || null,
          source_url: valid.source_url || null,
          evidence_notes: valid.evidence_notes || null,
        }),
      },
    );
  },
  createLinkedInDraft: async (
    cid: string,
    job: Job,
    contact: HiringContact,
  ): Promise<DraftForOutreach> => {
    const context = [
      contact.current_title,
      contact.company,
      contact.evidence_notes,
      contact.source_url,
    ]
      .filter(Boolean)
      .join(" · ");
    const draft = BASE
      ? await post<OutreachDraft>("/outreach/draft", {
          candidate_id: cid,
          job_id: job.job_id,
          contact_id: contact.contact_id,
          hiring_contact_name: contact.full_name,
          hiring_contact_context: context || null,
          tone: "warm",
        })
      : await local.draft(cid, job.job_id, contact);
    return draftForContact(draft, contact);
  },
  createEmailDraft: async (
    cid: string,
    job: Job,
    contact: HiringContact,
    applicationPackage: ApplicationPackage,
  ): Promise<DraftForOutreach> => {
    const candidate = BASE ? null : need(mem.candidates.get(cid), "Candidate");
    const subject = `Application for ${job.title} — ${candidate?.full_name ?? "candidate"}`;
    const draft = BASE
      ? await outreachHttp<OutreachDraft>(
          `/application-packages/${applicationPackage.package_id}/outreach-drafts`,
          {
            method: "POST",
            headers: packageRevisionHeaders(applicationPackage),
            body: JSON.stringify({
              channel: "email",
              contact_id: contact.contact_id,
              recipient_email: contact.email,
              cv_artifact_id: getCurrentCvArtifact(applicationPackage).artifact_id,
            }),
          },
        )
      : await local.draft(cid, job.job_id, contact);
    return draftForContact({ ...draft, subject: draft.subject ?? subject }, contact);
  },
  saveLinkedInDraft: async (
    message: OutreachMessage,
    body: string,
    subject?: string,
  ): Promise<string> => {
    if (!body.trim()) throw new ApiError("Write a message before saving the draft.");
    if (message.channel === "email" && !subject?.trim()) {
      throw new ApiError("Write an email subject before saving the draft.");
    }
    if (!BASE) {
      await wait(300);
      if (message.channel === "email") editEmailOutreachMessage(message, subject ?? "", body);
      else editOutreachMessage(message, body);
      mem.approvals.delete(message.draft_id);
      return body;
    }
    const email = message.channel === "email";
    const record = await outreachHttp<{ body?: string; message?: string }>(
      email
        ? `/application-packages/${message.package_id}/outreach-drafts/${message.draft_id}`
        : `/candidates/${message.candidate_id}/outreach/drafts/${message.draft_id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          contact_id: message.contact_id,
          recipient_url: message.recipient_url,
          recipient_email: message.recipient_email,
          subject,
          attachment: message.attachment ?? null,
          body,
        }),
      },
    );
    const saved = record.body ?? record.message;
    if (typeof saved !== "string")
      throw new ApiError(
        "The backend did not return the saved draft text. Approval remains blocked.",
      );
    return saved;
  },
  approveLinkedInDraft: async (message: OutreachMessage): Promise<ApprovalReceipt> => {
    const email = message.channel === "email";
    const canonical = email
      ? canonicalApprovalContent(message.recipient_url, message.body, {
          channel: "email",
          recipient_email: message.recipient_email,
          subject: message.subject,
          attachment: message.attachment,
          package_id: message.package_id,
        })
      : canonicalApprovalContent(message.recipient_url, message.body);
    if (!BASE) {
      await wait(350);
      const approvedAt = new Date().toISOString();
      const receipt: ApprovalReceipt = {
        draft_id: message.draft_id,
        status: "approved",
        recipient_url: message.recipient_url,
        recipient_email: message.recipient_email,
        subject: message.subject,
        attachment: message.attachment,
        body: message.body,
        approved_text_hash: await sha256(canonical),
        approved_at: approvedAt,
        approved_by: message.candidate_id,
      };
      mem.approvals.set(message.draft_id, receipt);
      return receipt;
    }
    return outreachHttp<ApprovalReceipt>(
      email
        ? `/application-packages/${message.package_id}/approvals`
        : `/candidates/${message.candidate_id}/outreach/drafts/${message.draft_id}/approve`,
      {
        method: "POST",
        body: JSON.stringify({
          artifact_type: email ? "outreach_draft" : undefined,
          draft_id: message.draft_id,
          contact_id: message.contact_id,
          recipient_url: message.recipient_url,
          recipient_email: message.recipient_email,
          subject: message.subject,
          attachment: message.attachment ?? null,
          body: message.body,
        }),
      },
    );
  },
  recordLinkedInHandoff: async (message: OutreachMessage): Promise<LinkedInHandoffReceipt> => {
    const blocked = getHandoffBlockReason(message);
    if (blocked) throw new ApiError(blocked);
    const linkedinUrl = validateLinkedInProfileUrl(message.recipient_url, true) as string;
    if (!BASE) {
      await wait(300);
      const approval = mem.approvals.get(message.draft_id);
      const currentHash = await sha256(
        canonicalApprovalContent(message.recipient_url, message.body),
      );
      if (
        !approval ||
        approval.approved_text_hash !== currentHash ||
        approval.body !== message.body ||
        approval.recipient_url !== message.recipient_url
      ) {
        throw new ApiError(
          "The demo backend no longer has approval for this exact recipient and text. Handoff is blocked.",
        );
      }
      const existing = mem.handoffs.get(message.draft_id);
      if (existing && "linkedin_url" in existing) return existing;
      const receipt: LinkedInHandoffReceipt = {
        draft_id: message.draft_id,
        status: "handed_off",
        linkedin_url: linkedinUrl,
        message: message.body,
        handed_off_at: new Date().toISOString(),
      };
      mem.handoffs.set(message.draft_id, receipt);
      return receipt;
    }
    // Documented vertical-slice route; absent from the inspected repository OpenAPI schema.
    return outreachHttp<LinkedInHandoffReceipt>(
      `/candidates/${message.candidate_id}/outreach/drafts/${message.draft_id}/handoff`,
      {
        method: "POST",
        headers: { "Idempotency-Key": `handoff:${message.draft_id}` },
        body: JSON.stringify({
          contact_id: message.contact_id,
          recipient_url: linkedinUrl,
          idempotency_key: `handoff:${message.draft_id}`,
        }),
      },
    );
  },
  recordEmailHandoff: async (message: OutreachMessage): Promise<EmailHandoffReceipt> => {
    const blocked = getHandoffBlockReason(message);
    if (blocked) throw new ApiError(blocked);
    const mailto = buildMailtoUrl(message);
    if (!BASE) {
      await wait(250);
      const approval = mem.approvals.get(message.draft_id);
      const currentHash = await sha256(
        canonicalApprovalContent(message.recipient_url, message.body, {
          channel: "email",
          recipient_email: message.recipient_email,
          subject: message.subject,
          attachment: message.attachment,
          package_id: message.package_id,
        }),
      );
      if (
        !approval ||
        approval.approved_text_hash !== currentHash ||
        approval.recipient_email !== message.recipient_email ||
        approval.subject !== message.subject ||
        JSON.stringify(approval.attachment ?? null) !== JSON.stringify(message.attachment ?? null)
      ) {
        throw new ApiError("The demo backend no longer has approval for this exact email payload.");
      }
      const existing = mem.handoffs.get(message.draft_id);
      if (existing && "mailto_url" in existing) return existing;
      const receipt: EmailHandoffReceipt = {
        draft_id: message.draft_id,
        status: "handed_off",
        recipient_email: message.recipient_email as string,
        subject: message.subject as string,
        message: message.body,
        mailto_url: mailto,
        handed_off_at: new Date().toISOString(),
      };
      mem.handoffs.set(message.draft_id, receipt);
      return receipt;
    }
    return outreachHttp<EmailHandoffReceipt>(
      `/application-packages/${message.package_id}/actions/email`,
      {
        method: "POST",
        headers: { "Idempotency-Key": `email-handoff:${message.draft_id}` },
        body: JSON.stringify({
          action: "handoff",
          draft_id: message.draft_id,
          approved_text_hash: message.approved_text_hash,
          idempotency_key: `email-handoff:${message.draft_id}`,
        }),
      },
    );
  },
  confirmCandidateSent: async (message: OutreachMessage): Promise<CandidateSentReceipt> => {
    if (message.status !== "handed_off")
      throw new ApiError(
        "Complete the channel handoff before confirming that you sent the message.",
      );
    if (!BASE) {
      await wait(300);
      if (!mem.handoffs.has(message.draft_id))
        throw new ApiError("The demo backend has no recorded handoff for this draft.");
      const existing = mem.confirmations.get(message.draft_id);
      if (existing) return existing;
      const receipt: CandidateSentReceipt = {
        draft_id: message.draft_id,
        status: "candidate_confirmed_sent",
        candidate_confirmed_sent_at: new Date().toISOString(),
      };
      mem.confirmations.set(message.draft_id, receipt);
      return receipt;
    }
    // Documented vertical-slice route; absent from the inspected repository OpenAPI schema.
    return outreachHttp<CandidateSentReceipt>(
      message.channel === "email"
        ? `/application-packages/${message.package_id}/actions/email/candidate-confirmation`
        : `/candidates/${message.candidate_id}/outreach/drafts/${message.draft_id}/confirm-sent`,
      {
        method: "POST",
        headers: { "Idempotency-Key": `confirmed:${message.draft_id}` },
        body: JSON.stringify({
          candidate_confirmed: true,
          draft_id: message.draft_id,
          idempotency_key: `confirmed:${message.draft_id}`,
        }),
      },
    );
  },
  recordCandidateReply: async (
    message: OutreachMessage,
    input: ReplyInput,
  ): Promise<Interaction> => {
    const valid = validateReplyInput(input);
    if (message.status !== "candidate_confirmed_sent")
      throw new ApiError("Confirm that you sent the message or email before recording a reply.");
    const payload = {
      candidate_id: message.candidate_id,
      job_id: message.job_id,
      draft_id: message.draft_id,
      reply_date: valid.reply_date,
      channel: message.channel === "email" ? "manual_email" : "manual_linkedin",
      interaction_type: "recruiter_reply" as const,
      content: `Candidate-recorded ${message.channel === "email" ? "email" : "LinkedIn"} reply (received ${valid.reply_date}): ${valid.content}`,
      ...(valid.outcome ? { outcome: valid.outcome } : {}),
      simulated: message.is_demo,
    };
    // This endpoint exists in the inspected OpenAPI schema and preserves candidate-entered reply provenance.
    return BASE ? post<Interaction>("/interactions", payload) : local.interaction(payload);
  },
  interaction: (i: {
    candidate_id: string;
    job_id: string;
    interaction_type: InteractionType;
    content: string;
    outcome?: string;
    simulated: boolean;
  }) => (BASE ? post<Interaction>("/interactions", i) : local.interaction(i)),
};

export const fmtSalary = (j: Pick<Job, "salary_min" | "salary_max" | "currency">) =>
  j.salary_min || j.salary_max
    ? `${j.currency === "EUR" ? "€" : j.currency + " "}${Math.round((j.salary_min ?? j.salary_max ?? 0) / 1000)}k–${Math.round((j.salary_max ?? j.salary_min ?? 0) / 1000)}k`
    : "Salary not listed";