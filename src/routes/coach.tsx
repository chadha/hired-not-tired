import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, ClipboardList, Lightbulb, LogOut } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Logo, LogoMark, EngineBadge, SimBadge } from "@/components/hnt/brand";
import {
  ActionList,
  ErrorNote,
  InteractionForm,
  InteractionLogged,
  JobCard,
  JobImportCard,
  ProfileCard,
  Shell,
} from "@/components/hnt/cards";
import { CareerTimeline, OutreachCard } from "@/components/hnt/outreach";
import { ApplicationPackageCard } from "@/components/hnt/application-package";
import { AccountSettings } from "@/components/hnt/account-settings";
import { CareerSourcePanel } from "@/components/hnt/career-source-panel";
import type { AnswerInput } from "@/components/hnt/application-content";
import {
  api,
  ApiError,
  isLiveApi,
  type Candidate,
  type CoachReply,
  type Interaction,
  type Job,
  type JobMatch,
  type RecommendedAction,
} from "@/lib/api";
import {
  ActionGuard,
  applyCandidateSentConfirmation,
  applyEmailHandoff,
  applyLinkedInHandoff,
  approveOutreachMessage,
  createOutreachMessage,
  editEmailOutreachMessage,
  editOutreachMessage,
  invalidateApprovalForRecipientEdit,
  makeTimelineEvent,
  recordCandidateReply,
  type CareerTimelineEvent,
  type ContactDiscoveryResult,
  type HiringContact,
  type ManualContactInput,
  type OutreachMessage,
  type ReplyInput,
} from "@/lib/hiring-contacts";
import {
  applicationCvHash,
  getCurrentCvArtifact,
  getCvExportBlockReason,
  type ApplicationChannel,
  type ApplicationPackage,
  type MasterProfileRevisionInput,
} from "@/lib/application-package";
import type { AuthenticatedWorkspace, ConsentInput } from "@/lib/linkedin-auth";
import { session } from "@/lib/session";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/coach")({
  head: () => ({
    meta: [
      { title: "Your coach — Hired Not Tired" },
      {
        name: "description",
        content:
          "Analyze job requirements, tailor and approve a CV, export PDF or DOCX, and manage truthful application and outreach handoffs in one conversation.",
      },
      { property: "og:title", content: "Your coach — Hired Not Tired" },
      {
        property: "og:description",
        content:
          "Select a job, prepare an evidence-grounded application package, approve an exact CV version and track every handoff without false submission claims.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Coach,
});

type Item =
  | { k: "coach"; text: string }
  | { k: "user"; text: string }
  | { k: "profile" }
  | { k: "jobs" }
  | { k: "outreach"; messageId: string }
  | { k: "application"; jobId: string }
  | { k: "timeline" }
  | { k: "form" }
  | { k: "logged"; i: Interaction }
  | { k: "reply"; r: CoachReply }
  | { k: "error"; text: string; retry?: () => void }
  | { k: "typing" };

const QUICK = [
  "Find jobs matching my profile",
  "Build my complete career profile",
  "Find people who can help me",
  "Prepare my application",
  "What should I focus on this week?",
  "Show my career timeline",
  "I want to log a recruiter reply",
  "I'm feeling a bit discouraged",
];
const sourceFor = (isDemo: boolean, candidate = false): CareerTimelineEvent["source"] =>
  isDemo ? "demo" : candidate ? "candidate_reported" : "backend_confirmed";

function Coach() {
  const nav = useNavigate();
  const reduceMotion = useReducedMotion() ?? false;
  const [cid, setCid] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [workspace, setWorkspace] = useState<AuthenticatedWorkspace | null>(null);
  const [accountBusy, setAccountBusy] = useState(false);
  const [c, setC] = useState<Candidate | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [matches, setMatches] = useState<Record<string, JobMatch>>({});
  const [contacts, setContacts] = useState<Record<string, HiringContact>>({});
  const [discoveries, setDiscoveries] = useState<Record<string, ContactDiscoveryResult>>({});
  const [discoveryBusy, setDiscoveryBusy] = useState<Record<string, boolean>>({});
  const [jobImportBusy, setJobImportBusy] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, OutreachMessage>>({});
  const [applicationPackages, setApplicationPackages] = useState<
    Record<string, ApplicationPackage>
  >({});
  const [timeline, setTimeline] = useState<CareerTimelineEvent[]>([]);
  const [busyJob, setBusyJob] = useState<string | null>(null);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [actions, setActions] = useState<RecommendedAction[]>([]);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const actionLocks = useRef(new ActionGuard());

  const push = (...next: Item[]) =>
    setItems((previous) => [...previous.filter((item) => item.k !== "typing"), ...next]);
  const addTimeline = (...events: CareerTimelineEvent[]) =>
    setTimeline((previous) => [...previous, ...events]);

  const load = async (id: string) => {
    setLoadErr(null);
    try {
      const profile = await api.getProfile(id);
      const found = await api.discover(id).catch(() => api.listJobs());
      const matchResults = await Promise.all(
        found.map((job) => api.match(job.job_id, id).catch(() => null)),
      );
      const restored = isLiveApi ? await api.getWorkspace(id) : null;
      const restoredContacts: Record<string, HiringContact> = {};
      const restoredDiscoveries: Record<string, ContactDiscoveryResult> = {};
      const restoredMessages: Record<string, OutreachMessage> = {};
      const restoredPackages: Record<string, ApplicationPackage> = {};
      const restoredItems: Item[] = [];
      for (const job of found) {
        const candidates = restored?.contacts.filter((item) => item.job_id === job.job_id) ?? [];
        if (candidates[0]) restoredContacts[job.job_id] = candidates[0];
        if (candidates.length > 0) {
          restoredDiscoveries[job.job_id] = {
            status: "found",
            contacts: candidates,
            fallback_url: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${job.title} ${job.company}`)}`,
            detail: `${candidates.length} saved contact result${candidates.length === 1 ? "" : "s"}. Review the cited evidence; vacancy ownership is not inferred.`,
            searched_at: candidates[0]?.updated_at ?? new Date().toISOString(),
          };
        }
        const applicationPackage = restored?.application_packages.find(
          (item) => item.job_id === job.job_id,
        );
        if (applicationPackage) {
          restoredPackages[job.job_id] = applicationPackage;
          restoredItems.push({ k: "application", jobId: job.job_id });
        }
      }
      for (const message of restored?.messages ?? []) {
        restoredMessages[message.message_id] = message;
        restoredItems.push({ k: "outreach", messageId: message.message_id });
      }
      const byId: Record<string, JobMatch> = {};
      matchResults.forEach((match) => {
        if (match) byId[match.job_id] = match;
      });
      const ranked = [...found].sort(
        (a, b) => (byId[b.job_id]?.match_score ?? 0) - (byId[a.job_id]?.match_score ?? 0),
      );
      setC(profile);
      setJobs(ranked);
      setMatches(byId);
      setContacts(restoredContacts);
      setDiscoveries(restoredDiscoveries);
      setSelectedJobId(null);
      setMessages(restoredMessages);
      setApplicationPackages(restoredPackages);
      setTimeline(restored?.timeline ?? []);
      const first = profile.full_name.split(" ")[0];
      const localDemo = session.isDemo();
      setItems([
        ...(localDemo
          ? [
              {
                k: "coach" as const,
                text: "You're in the **fictional local demo**. No LinkedIn account is connected, no identity claims were imported, and nothing here creates a real account.",
              },
            ]
          : []),
        {
          k: "coach",
          text: `Good to see you, ${first}. You're working toward **${profile.career_goal}**. Here's the profile I'm using — tell me if anything's off.`,
        },
        { k: "profile" },
        {
          k: "coach",
          text: ranked.length
            ? `I found and ranked ${ranked.length} opportunit${ranked.length === 1 ? "y" : "ies"}. **Select a job** and choose **Prepare application** for a tailored CV, or **Find/add contact** for outreach. Nothing is submitted or sent automatically.`
            : "No opportunities yet — share a job link with me and we'll start there.",
        },
        { k: "jobs" },
        ...restoredItems,
      ]);
      api
        .actionPlan(id)
        .then((result) => setActions(result.actions))
        .catch(() => {});
    } catch (error) {
      setLoadErr((error as Error).message);
    }
  };

  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      if (isLiveApi) {
        try {
          const authenticated = await api.linkedinAuthSession();
          if (!active) return;
          session.set(authenticated.candidate_id, false);
          setWorkspace(authenticated);
          setCid(authenticated.candidate_id);
          setDemo(false);
          await load(authenticated.candidate_id);
        } catch (error) {
          session.clear();
          if (!active) return;
          if (error instanceof ApiError && error.status === 401) {
            nav({ to: "/", search: { auth_error: "authentication_required" } });
          } else {
            setLoadErr((error as Error).message);
          }
        }
        return;
      }
      const id = session.get();
      if (!id || !session.isDemo()) {
        nav({ to: "/" });
        return;
      }
      setCid(id);
      setDemo(true);
      await load(id);
    };
    void bootstrap();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "end" });
  }, [items.length, reduceMotion]);

  const ask = async (text: string) => {
    if (!cid || !text.trim()) return;
    setInput("");
    push({ k: "user", text }, { k: "typing" });
    const normalized = text.toLowerCase();
    if (/timeline|career history/.test(normalized)) {
      push(
        {
          k: "coach",
          text: "Here's your career timeline. Candidate-reported sends and replies are labeled separately from backend-confirmed events.",
        },
        { k: "timeline" },
      );
      return;
    }
    if (/application package|tailored cv|prepare.*application|export.*cv/.test(normalized)) {
      push(
        {
          k: "coach",
          text: "Select a job and choose **Prepare application**. I'll analyze its requirements, create a separate tailored CV version, and let you approve and export PDF or DOCX.",
        },
        { k: "jobs" },
      );
      return;
    }
    if (/hiring (manager|contact)|find.*contact|add.*contact/.test(normalized)) {
      push(
        {
          k: "coach",
          text: "Select a job to research cited public contacts using its existing details. Review the evidence, or use **Find/add contact** for someone you already know. LinkedIn is never scraped.",
        },
        { k: "jobs" },
      );
      return;
    }
    if (/opportunit|jobs?|match/.test(normalized)) {
      push(
        {
          k: "coach",
          text: "Here they are again — select the job you want to work on, then add a potential hiring contact.",
        },
        { k: "jobs" },
      );
      return;
    }
    if (
      /log|reply|interview|rejection|offer|feedback/.test(normalized) &&
      !/feel/.test(normalized)
    ) {
      push(
        {
          k: "coach",
          text: "Let's capture it. Paste what they said — I'll learn from it with you.",
        },
        { k: "form" },
      );
      return;
    }
    setSending(true);
    try {
      const reply = await api.chat(cid, text);
      push({ k: "reply", r: reply });
      setActions(reply.recommended_actions);
    } catch (error) {
      push({ k: "error", text: (error as Error).message, retry: () => ask(text) });
    } finally {
      setSending(false);
    }
  };

  const doMatch = async (job: Job) => {
    if (!cid) return;
    setBusyJob(job.job_id);
    try {
      const match = await api.match(job.job_id, cid);
      setMatches((previous) => ({ ...previous, [job.job_id]: match }));
    } catch (error) {
      push({ k: "error", text: (error as Error).message, retry: () => doMatch(job) });
    } finally {
      setBusyJob(null);
    }
  };

  const discoverContactForJob = async (job: Job) => {
    if (!cid || contacts[job.job_id] || discoveryBusy[job.job_id]) return;
    setDiscoveryBusy((previous) => ({ ...previous, [job.job_id]: true }));
    try {
      const result = await api.discoverContacts(cid, job);
      setDiscoveries((previous) => ({ ...previous, [job.job_id]: result }));
      if (result.contacts[0]) {
        setContacts((previous) => ({ ...previous, [job.job_id]: result.contacts[0]! }));
      }
    } catch (error) {
      setDiscoveries((previous) => ({
        ...previous,
        [job.job_id]: {
          status: "unavailable",
          contacts: [],
          fallback_url: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${job.title} ${job.company}`)}`,
          detail: `${(error as Error).message} No contact was created. Use the contextual people search or enter a contact you already have.`,
          searched_at: new Date().toISOString(),
        },
      }));
    } finally {
      setDiscoveryBusy((previous) => ({ ...previous, [job.job_id]: false }));
    }
  };

  const importJob = async (sourceUrl: string) => {
    if (!cid || jobImportBusy) throw new Error("Wait for the current job import to finish.");
    setJobImportBusy(true);
    try {
      const job = await api.importJob(cid, sourceUrl);
      const match = await api.match(job.job_id, cid);
      setJobs((previous) => [job, ...previous.filter((item) => item.job_id !== job.job_id)]);
      setMatches((previous) => ({ ...previous, [job.job_id]: match }));
      setSelectedJobId(job.job_id);
      push(
        { k: "user", text: `Import this vacancy: ${sourceUrl}` },
        { k: "jobs" },
        {
          k: "coach",
          text: `Imported **${job.title}** with its source URL and retrieval time. I’m checking cited public contacts using the same job details.`,
        },
      );
      await discoverContactForJob(job);
    } catch (error) {
      push({ k: "error", text: `${(error as Error).message} No job was imported.` });
      throw error;
    } finally {
      setJobImportBusy(false);
    }
  };

  const doSelectJob = (job: Job) => {
    setSelectedJobId(job.job_id);
    if (isLiveApi && !contacts[job.job_id]) void discoverContactForJob(job);
    push(
      { k: "user", text: `Select ${job.title} at ${job.company}.` },
      {
        k: "coach",
        text: isLiveApi
          ? `Selected **${job.title}**. I’ll look for cited public hiring contacts using this job’s details. You can also prepare a tailored application or add someone you already know.`
          : `Selected **${job.title}**. Prepare a tailored application package, or add a potential hiring contact using details and evidence you already have.`,
      },
    );
  };

  const doPrepareApplication = async (job: Job) => {
    if (!cid || busyJob) return;
    setSelectedJobId(job.job_id);
    if (isLiveApi && !contacts[job.job_id]) void discoverContactForJob(job);
    setBusyJob(job.job_id);
    push(
      { k: "user", text: `Prepare a tailored application for ${job.title} at ${job.company}.` },
      { k: "typing" },
    );
    try {
      const applicationPackage = await api.createApplicationPackage(cid, job, matches[job.job_id]);
      setApplicationPackages((previous) => ({ ...previous, [job.job_id]: applicationPackage }));
      const artifact = getCurrentCvArtifact(applicationPackage);
      addTimeline(
        makeTimelineEvent(
          job.job_id,
          "application_package_created",
          "Application package created",
          `Tailored CV version ${artifact.version} created from the unchanged master source. No application was submitted.`,
          {
            source: sourceFor(applicationPackage.is_demo),
            simulated: applicationPackage.is_demo,
            at: applicationPackage.created_at,
          },
        ),
      );
      push(
        {
          k: "coach",
          text: applicationPackage.is_demo
            ? "Your application package is ready. Review facts, answers and the tailored CV, then approve each exact artifact and channel. **This local demo is ephemeral and nothing has been submitted.**"
            : "Your application package is ready. Review facts, answers and each exact artifact and channel approval. **Nothing has been submitted.**",
        },
        { k: "application", jobId: job.job_id },
      );
    } catch (error) {
      push({ k: "error", text: (error as Error).message, retry: () => doPrepareApplication(job) });
    } finally {
      setBusyJob(null);
    }
  };

  const doSaveApplicationCv = async (jobId: string, content: string) => {
    const applicationPackage = applicationPackages[jobId];
    if (!applicationPackage || busyJob)
      throw new Error("Wait for the current application action to finish.");
    setBusyJob(jobId);
    try {
      const saved = await api.saveApplicationCv(applicationPackage, content);
      setApplicationPackages((previous) => ({ ...previous, [jobId]: saved }));
      const artifact = getCurrentCvArtifact(saved);
      addTimeline(
        makeTimelineEvent(
          jobId,
          "cv_version_created",
          `Tailored CV version ${artifact.version} saved`,
          "The master CV is unchanged; the new version requires its own approval.",
          {
            source: sourceFor(saved.is_demo),
            simulated: saved.is_demo,
            at: artifact.created_at,
          },
        ),
      );
      push({
        k: "coach",
        text: `Saved tailored CV **version ${artifact.version}**. Earlier versions remain unchanged and this version needs fresh approval.`,
      });
    } catch (error) {
      push({ k: "error", text: `${(error as Error).message} The tailored CV edit was not saved.` });
      throw error;
    } finally {
      setBusyJob(null);
    }
  };

  const doReviseMasterProfile = async (jobId: string, input: MasterProfileRevisionInput) => {
    const applicationPackage = applicationPackages[jobId];
    if (!applicationPackage || busyJob)
      throw new Error("Wait for the current application action to finish.");
    setBusyJob(jobId);
    try {
      const revised = await api.reviseMasterProfile(applicationPackage, input);
      setC(revised.candidate);
      updatePackage(jobId, revised.applicationPackage);
      const artifact = getCurrentCvArtifact(revised.applicationPackage);
      addTimeline(
        makeTimelineEvent(
          jobId,
          "master_profile_revised",
          `Master profile revision ${revised.applicationPackage.master_profile.profile_version} confirmed`,
          `The previous master remains immutable. Tailored CV version ${artifact.version} was created and requires fresh review. Nothing was submitted or sent.`,
          {
            source: sourceFor(revised.applicationPackage.is_demo),
            simulated: revised.applicationPackage.is_demo,
            at: revised.applicationPackage.updated_at,
          },
        ),
      );
      push({
        k: "coach",
        text: `Saved **master profile revision ${revised.applicationPackage.master_profile.profile_version}** and tailored CV **version ${artifact.version}**. Earlier revisions remain unchanged; affected answers, cover letter and channel approvals require fresh review. **No external action was taken.**`,
      });
    } catch (error) {
      push({
        k: "error",
        text: `${(error as Error).message} The master revision was not recorded as complete.`,
      });
      throw error;
    } finally {
      setBusyJob(null);
    }
  };

  const doApproveApplicationCv = async (jobId: string) => {
    const applicationPackage = applicationPackages[jobId];
    if (!applicationPackage || busyJob)
      throw new Error("Wait for the current application action to finish.");
    setBusyJob(jobId);
    try {
      const approved = await api.approveApplicationCv(applicationPackage);
      setApplicationPackages((previous) => ({ ...previous, [jobId]: approved }));
      const artifact = getCurrentCvArtifact(approved);
      addTimeline(
        makeTimelineEvent(
          jobId,
          "cv_approved",
          `Tailored CV version ${artifact.version} approved`,
          "Approval is bound to the exact version and text hash. Nothing was submitted or sent.",
          {
            source: sourceFor(approved.is_demo),
            simulated: approved.is_demo,
            at: artifact.approval?.approved_at ?? approved.updated_at,
          },
        ),
      );
      push({
        k: "coach",
        text: approved.is_demo
          ? `**DEMO:** tailored CV version ${artifact.version} is approved in local memory. PDF and DOCX export are now available; approval alone did not apply anywhere.`
          : `Tailored CV version ${artifact.version} is approved by the backend. Approval alone did not apply anywhere.`,
      });
    } catch (error) {
      push({ k: "error", text: `${(error as Error).message} CV approval was not recorded.` });
      throw error;
    } finally {
      setBusyJob(null);
    }
  };

  const doExportApplicationCv = async (jobId: string, format: "pdf" | "docx") => {
    const applicationPackage = applicationPackages[jobId];
    if (!applicationPackage || !c) throw new Error("The application package is unavailable.");
    const blocked = getCvExportBlockReason(applicationPackage);
    if (blocked) throw new Error(blocked);
    setBusyJob(jobId);
    try {
      const artifact = getCurrentCvArtifact(applicationPackage);
      const job = jobs.find((entry) => entry.job_id === jobId);
      if (!job) throw new Error("The selected job is unavailable.");
      const { downloadValidatedCv } = await import("@/lib/cv-documents");
      const validation = await downloadValidatedCv(
        artifact.content,
        format,
        `${c.full_name}-${job.title}-v${artifact.version}`,
      );
      addTimeline(
        makeTimelineEvent(
          jobId,
          "cv_exported",
          `Approved CV exported as ${format.toUpperCase()}`,
          `Version ${artifact.version} passed document validation. Export is not application submission.`,
          {
            source: sourceFor(applicationPackage.is_demo),
            simulated: applicationPackage.is_demo,
          },
        ),
      );
      return validation;
    } catch (error) {
      push({ k: "error", text: `${(error as Error).message} No export success was recorded.` });
      throw error;
    } finally {
      setBusyJob(null);
    }
  };

  const updatePackage = (jobId: string, applicationPackage: ApplicationPackage) =>
    setApplicationPackages((previous) => ({ ...previous, [jobId]: applicationPackage }));

  const doSaveAnswer = async (jobId: string, input: AnswerInput) => {
    const applicationPackage = applicationPackages[jobId];
    if (!applicationPackage || busyJob)
      throw new Error("Wait for the current package action to finish.");
    setBusyJob(jobId);
    try {
      const saved = await api.saveApplicationAnswer(applicationPackage, input);
      updatePackage(jobId, saved);
      addTimeline(
        makeTimelineEvent(
          jobId,
          "answer_saved",
          "Application answer version saved",
          input.confirmed
            ? "The candidate confirmed this exact answer version. Any later edit invalidates channel approval."
            : "Draft answer saved; candidate confirmation is still required.",
          { source: sourceFor(saved.is_demo, true), simulated: saved.is_demo },
        ),
      );
    } finally {
      setBusyJob(null);
    }
  };

  const doCreateCoverLetter = async (jobId: string) => {
    const applicationPackage = applicationPackages[jobId];
    if (!applicationPackage || busyJob)
      throw new Error("Wait for the current package action to finish.");
    setBusyJob(jobId);
    try {
      const saved = await api.createCoverLetter(applicationPackage);
      updatePackage(jobId, saved);
      addTimeline(
        makeTimelineEvent(
          jobId,
          "cover_letter_created",
          "Cover letter draft created",
          "A separate job-specific draft was created from confirmed profile facts. It is not approved.",
          { source: sourceFor(saved.is_demo), simulated: saved.is_demo },
        ),
      );
    } finally {
      setBusyJob(null);
    }
  };

  const doSaveCoverLetter = async (jobId: string, content: string) => {
    const applicationPackage = applicationPackages[jobId];
    if (!applicationPackage || busyJob)
      throw new Error("Wait for the current package action to finish.");
    setBusyJob(jobId);
    try {
      const saved = await api.saveCoverLetter(applicationPackage, content);
      updatePackage(jobId, saved);
      addTimeline(
        makeTimelineEvent(
          jobId,
          "cover_letter_created",
          "New cover-letter version saved",
          "The previous version is unchanged. The new version requires independent approval.",
          { source: sourceFor(saved.is_demo, true), simulated: saved.is_demo },
        ),
      );
    } finally {
      setBusyJob(null);
    }
  };

  const doApproveCoverLetter = async (jobId: string) => {
    const applicationPackage = applicationPackages[jobId];
    if (!applicationPackage || busyJob)
      throw new Error("Wait for the current package action to finish.");
    setBusyJob(jobId);
    try {
      const saved = await api.approveCoverLetter(applicationPackage);
      updatePackage(jobId, saved);
      addTimeline(
        makeTimelineEvent(
          jobId,
          "cover_letter_approved",
          "Exact cover letter approved",
          "Approval is bound to the exact artifact version and hash. Nothing was submitted.",
          { source: sourceFor(saved.is_demo), simulated: saved.is_demo },
        ),
      );
    } finally {
      setBusyJob(null);
    }
  };

  const doApproveApplicationChannel = async (jobId: string, channel: ApplicationChannel) => {
    const applicationPackage = applicationPackages[jobId];
    if (!applicationPackage || busyJob)
      throw new Error("Wait for the current package action to finish.");
    setBusyJob(jobId);
    try {
      const saved = await api.approveApplicationChannel(applicationPackage, channel);
      updatePackage(jobId, saved);
      addTimeline(
        makeTimelineEvent(
          jobId,
          "application_path_approved",
          `${channel.title} package approved`,
          "The exact destination, answers, CV attachment and artifact version were approved. Approval did not submit anything.",
          { source: sourceFor(saved.is_demo), simulated: saved.is_demo },
        ),
      );
    } finally {
      setBusyJob(null);
    }
  };

  const doApplicationHandoff = async (jobId: string, channel: ApplicationChannel) => {
    const applicationPackage = applicationPackages[jobId];
    if (!applicationPackage || !channel.destination_url)
      throw new Error("The approved destination is unavailable.");
    if (!actionLocks.current.begin(`application-handoff:${jobId}:${channel.id}`))
      throw new Error("This handoff is already in progress.");
    setBusyJob(jobId);
    let popup: Window | null = null;
    try {
      popup = window.open("about:blank", "_blank");
      if (!popup)
        throw new Error(
          "Your browser blocked the official site. Allow popups and retry; no handoff was recorded.",
        );
      const saved = await api.recordApplicationHandoff(applicationPackage, channel);
      popup.opener = null;
      popup.location.href = channel.destination_url;
      updatePackage(jobId, saved);
      addTimeline(
        makeTimelineEvent(
          jobId,
          "application_handoff_opened",
          `${channel.title} handoff opened`,
          "The approved package was prepared for candidate-controlled completion. No submission was recorded.",
          { source: sourceFor(saved.is_demo, true), simulated: saved.is_demo },
        ),
      );
      push({
        k: "coach",
        text: `Opened the official destination. **This is only a handoff — complete the application yourself; no submission was recorded.**`,
      });
    } catch (error) {
      popup?.close();
      throw error;
    } finally {
      actionLocks.current.end(`application-handoff:${jobId}:${channel.id}`);
      setBusyJob(null);
    }
  };

  const doReportApplicationSubmitted = async (jobId: string, channel: ApplicationChannel) => {
    const applicationPackage = applicationPackages[jobId];
    if (!applicationPackage || busyJob)
      throw new Error("Wait for the current package action to finish.");
    setBusyJob(jobId);
    try {
      const saved = await api.reportApplicationSubmitted(applicationPackage, channel);
      updatePackage(jobId, saved);
      addTimeline(
        makeTimelineEvent(
          jobId,
          "application_candidate_reported",
          `${channel.title} submission self-reported`,
          "The candidate attested that they submitted on the official site. This is not provider confirmation.",
          { source: sourceFor(saved.is_demo, true), simulated: saved.is_demo },
        ),
      );
    } finally {
      setBusyJob(null);
    }
  };

  const doSubmitApplication = async (jobId: string, channel: ApplicationChannel) => {
    const applicationPackage = applicationPackages[jobId];
    if (
      !applicationPackage ||
      !actionLocks.current.begin(`application-submit:${jobId}:${channel.id}`)
    )
      throw new Error("This submission is already in progress.");
    setBusyJob(jobId);
    try {
      const saved = await api.submitApplication(applicationPackage, channel);
      updatePackage(jobId, saved);
      addTimeline(
        makeTimelineEvent(
          jobId,
          "application_provider_confirmed",
          `${channel.title} submission provider-confirmed`,
          "A verified provider receipt matched the approved payload hash.",
          { source: "backend_confirmed", simulated: false },
        ),
      );
    } finally {
      actionLocks.current.end(`application-submit:${jobId}:${channel.id}`);
      setBusyJob(null);
    }
  };

  const doPrepareEmail = async (jobId: string) => {
    if (!cid) throw new Error("The candidate session is unavailable.");
    const applicationPackage = applicationPackages[jobId];
    const contact = contacts[jobId];
    const job = jobs.find((entry) => entry.job_id === jobId);
    if (!applicationPackage || !contact || !job)
      throw new Error("Select a job and candidate-supplied contact first.");
    if (busyJob) throw new Error("Wait for the current package action to finish.");
    setBusyJob(jobId);
    try {
      const artifact = getCurrentCvArtifact(applicationPackage);
      const contentHash = await applicationCvHash(artifact);
      const draft = await api.createEmailDraft(cid, job, contact, applicationPackage);
      const message = createOutreachMessage(draft, contact, new Date().toISOString(), {
        channel: "email",
        package_id: applicationPackage.package_id,
        attachment: {
          artifact_id: artifact.artifact_id,
          version: artifact.version,
          content_hash: contentHash,
          filename: `${c?.full_name ?? "candidate"}-${job.title}-cv-v${artifact.version}.pdf`,
        },
      });
      setMessages((previous) => ({ ...previous, [message.message_id]: message }));
      addTimeline(
        makeTimelineEvent(
          jobId,
          "draft_created",
          "Email draft created",
          `Draft for ${contact.email}; exact recipient, subject, body and CV attachment approval is required before mailto handoff.`,
          {
            draftId: message.draft_id,
            contactId: contact.contact_id,
            source: sourceFor(message.is_demo),
            simulated: message.is_demo,
          },
        ),
      );
      push({
        k: "coach",
        text: "Your email draft is in the application package. Review the exact recipient, subject, message and CV attachment. **Mailto opens a draft only; it cannot attach or send the CV.**",
      });
    } finally {
      setBusyJob(null);
    }
  };

  const doAddContact = async (job: Job, input: ManualContactInput) => {
    if (!cid || busyJob)
      throw new Error("Wait for the current job action to finish before adding a contact.");
    setBusyJob(job.job_id);
    setSelectedJobId(job.job_id);
    try {
      const contact = await api.createContact(cid, job, input);
      setContacts((previous) => ({ ...previous, [job.job_id]: contact }));
      push(
        {
          k: "user",
          text: `Add ${contact.full_name} as a potential hiring contact for ${job.title}.`,
        },
        {
          k: "coach",
          text: `Added **${contact.full_name}** as a **potential hiring contact**. Their role and vacancy relevance remain candidate-supplied, not independently verified. You can now generate a LinkedIn message.`,
        },
      );
    } catch (error) {
      push({ k: "error", text: `${(error as Error).message} No contact was added.` });
      throw error;
    } finally {
      setBusyJob(null);
    }
  };

  const doEditContact = async (job: Job, input: ManualContactInput) => {
    const existing = contacts[job.job_id];
    if (!existing || busyJob)
      throw new Error("The selected contact is unavailable or another job action is in progress.");
    const locked = Object.values(messages).find(
      (message) =>
        message.contact_id === existing.contact_id &&
        (message.status === "handed_off" || message.status === "candidate_confirmed_sent"),
    );
    if (locked)
      throw new Error(
        "This contact already has a handoff. Add a new contact rather than changing recipient history.",
      );
    setBusyJob(job.job_id);
    try {
      const updated = await api.updateContact(existing, input);
      setContacts((previous) => ({ ...previous, [job.job_id]: updated }));
      const invalidated = Object.values(messages).filter(
        (message) => message.contact_id === updated.contact_id && message.status === "approved",
      );
      setMessages((previous) =>
        Object.fromEntries(
          Object.entries(previous).map(([id, message]) => [
            id,
            invalidateApprovalForRecipientEdit(message, updated),
          ]),
        ),
      );
      invalidated.forEach((message) =>
        addTimeline(
          makeTimelineEvent(
            job.job_id,
            "draft_edited",
            "Recipient edit invalidated approval",
            "Review and approve the exact recipient and message again.",
            {
              draftId: message.draft_id,
              contactId: updated.contact_id,
              source: sourceFor(updated.is_demo),
              simulated: updated.is_demo,
            },
          ),
        ),
      );
      push({
        k: "coach",
        text: invalidated.length
          ? "Contact updated. The recipient change invalidated the earlier approval; review and approve the draft again before handoff."
          : "Contact updated. Your supplied details and evidence are shown on the potential-contact card.",
      });
    } catch (error) {
      push({ k: "error", text: `${(error as Error).message} The contact edit was not applied.` });
      throw error;
    } finally {
      setBusyJob(null);
    }
  };

  const doDraft = async (job: Job) => {
    if (!cid) return;
    const contact = contacts[job.job_id];
    setSelectedJobId(job.job_id);
    if (!contact) {
      push(
        { k: "user", text: `Generate a LinkedIn message for ${job.title}.` },
        {
          k: "coach",
          text: "First research cited public contacts or use **Find/add contact** for someone you already know. I need a real, evidenced recipient; I won't guess one.",
        },
        { k: "jobs" },
      );
      return;
    }
    if (busyJob) return;
    setBusyJob(job.job_id);
    push(
      {
        k: "user",
        text: `Generate a LinkedIn message to ${contact.full_name} about ${job.title}.`,
      },
      { k: "typing" },
    );
    try {
      const draft = await api.createLinkedInDraft(cid, job, contact);
      const message = createOutreachMessage(draft, contact);
      setMessages((previous) => ({ ...previous, [message.message_id]: message }));
      addTimeline(
        makeTimelineEvent(
          job.job_id,
          "draft_created",
          "LinkedIn draft created",
          `Draft for ${contact.full_name}; exact-message approval is required before handoff.`,
          {
            draftId: message.draft_id,
            contactId: contact.contact_id,
            source: sourceFor(message.is_demo),
            simulated: message.is_demo,
          },
        ),
      );
      push(
        {
          k: "coach",
          text: "Here's your job-specific draft using your confirmed profile and supplied contact details. Review the factuality notes, edit if needed, and explicitly approve the exact recipient and text.",
        },
        { k: "outreach", messageId: message.message_id },
      );
    } catch (error) {
      push({ k: "error", text: (error as Error).message, retry: () => doDraft(job) });
    } finally {
      setBusyJob(null);
    }
  };

  const persistApproval = async (message: OutreachMessage, body: string, subject?: string) => {
    let current = message;
    if (body !== message.body || (message.channel === "email" && subject !== message.subject)) {
      const savedBody = await api.saveLinkedInDraft(message, body, subject);
      current =
        message.channel === "email"
          ? editEmailOutreachMessage(message, subject ?? "", savedBody)
          : editOutreachMessage(message, savedBody);
    }
    const approval = await api.approveLinkedInDraft(current);
    return approveOutreachMessage(current, approval);
  };

  const doSaveDraft = async (messageId: string, body: string, subject?: string) => {
    const message = messages[messageId];
    if (!message || busyMessage) throw new Error("Wait for the current draft action to finish.");
    setBusyMessage(messageId);
    try {
      const savedBody = await api.saveLinkedInDraft(message, body, subject);
      const saved =
        message.channel === "email"
          ? editEmailOutreachMessage(message, subject ?? "", savedBody)
          : editOutreachMessage(message, savedBody);
      setMessages((previous) => ({ ...previous, [messageId]: saved }));
      addTimeline(
        makeTimelineEvent(
          message.job_id,
          "draft_edited",
          "Draft edited",
          "The saved edit invalidated any earlier approval.",
          {
            draftId: message.draft_id,
            contactId: message.contact_id,
            source: sourceFor(message.is_demo),
            simulated: message.is_demo,
          },
        ),
      );
      push({
        k: "coach",
        text: message.is_demo
          ? "**DEMO:** the edited draft is saved only in browser memory. Any earlier approval was invalidated."
          : "The backend saved your edit and invalidated any earlier approval. Approve the exact current text before handoff.",
      });
    } catch (error) {
      push({
        k: "error",
        text: `${(error as Error).message} The edit was not approved or handed off.`,
      });
      throw error;
    } finally {
      setBusyMessage(null);
    }
  };

  const doApprove = async (messageId: string, body: string, subject?: string) => {
    const message = messages[messageId];
    if (!message || busyMessage) throw new Error("Wait for the current draft action to finish.");
    setBusyMessage(messageId);
    try {
      const approved = await persistApproval(message, body, subject);
      setMessages((previous) => ({ ...previous, [messageId]: approved }));
      addTimeline(
        makeTimelineEvent(
          message.job_id,
          "approved",
          "Exact message approved",
          "The exact recipient and text were approved. Approval did not send anything.",
          {
            draftId: message.draft_id,
            contactId: message.contact_id,
            source: sourceFor(message.is_demo),
            simulated: message.is_demo,
            at: approved.approved_at ?? approved.updated_at,
          },
        ),
      );
      push({
        k: "coach",
        text: message.is_demo
          ? "**DEMO:** exact-message approval was recorded by the ephemeral local adapter. You can now test the user-controlled LinkedIn handoff; nothing sends automatically."
          : "The backend confirmed approval for the exact recipient and text. **Approval alone did not send the message.**",
      });
    } catch (error) {
      push({
        k: "error",
        text: `${(error as Error).message} Approval was not recorded and handoff remains blocked.`,
      });
      throw error;
    } finally {
      setBusyMessage(null);
    }
  };

  const doHandoff = async (messageId: string) => {
    const message = messages[messageId];
    if (!message || !actionLocks.current.begin(`handoff:${messageId}`))
      throw new Error("A handoff action is already in progress.");
    setBusyMessage(messageId);
    let popup: Window | null = null;
    try {
      popup = window.open("about:blank", "_blank");
      if (!popup)
        throw new Error(
          "Your browser blocked the handoff. Allow popups, then retry; no handoff was recorded.",
        );
      const receipt =
        message.channel === "email"
          ? await api.recordEmailHandoff(message)
          : await api.recordLinkedInHandoff(message);
      const handedOff =
        message.channel === "email"
          ? applyEmailHandoff(
              message,
              receipt as import("@/lib/hiring-contacts").EmailHandoffReceipt,
            )
          : applyLinkedInHandoff(
              message,
              receipt as import("@/lib/hiring-contacts").LinkedInHandoffReceipt,
            );
      popup.opener = null;
      popup.location.href = "mailto_url" in receipt ? receipt.mailto_url : receipt.linkedin_url;
      setMessages((previous) => ({ ...previous, [messageId]: handedOff }));
      addTimeline(
        makeTimelineEvent(
          message.job_id,
          message.channel === "email" ? "email_handoff_opened" : "linkedin_handoff_opened",
          `${message.channel === "email" ? "Email" : "LinkedIn"} handoff recorded`,
          message.channel === "email"
            ? "The approved mailto draft was opened for candidate-controlled sending. This is not a sent or delivered event."
            : "The supplied public profile was opened for candidate-controlled sending. This is not a sent event.",
          {
            draftId: message.draft_id,
            contactId: message.contact_id,
            source: sourceFor(message.is_demo),
            simulated: message.is_demo,
            at: receipt.handed_off_at,
          },
        ),
      );
      push({
        k: "coach",
        text:
          message.channel === "email"
            ? "The approved email draft is ready in your mail application. Attach the approved CV and send it yourself. **Opening a mail draft does not mean it was sent or delivered.**"
            : "The public LinkedIn profile handoff is ready. Copy the approved message and send it yourself. **Opening LinkedIn does not mean it was sent.**",
      });
    } catch (error) {
      popup?.close();
      push({ k: "error", text: `${(error as Error).message} No sent event was recorded.` });
      throw error;
    } finally {
      actionLocks.current.end(`handoff:${messageId}`);
      setBusyMessage(null);
    }
  };

  const doNotYet = (messageId: string) => {
    const message = messages[messageId];
    if (!message) return;
    push(
      { k: "user", text: "Not yet." },
      {
        k: "coach",
        text: "No send was recorded. Come back after you have actually sent the message yourself.",
      },
    );
  };

  const doConfirmSent = async (messageId: string) => {
    const message = messages[messageId];
    if (!message || !actionLocks.current.begin(`confirm:${messageId}`))
      throw new Error("A send-confirmation action is already in progress.");
    setBusyMessage(messageId);
    try {
      const receipt = await api.confirmCandidateSent(message);
      const confirmed = applyCandidateSentConfirmation(message, receipt);
      setMessages((previous) => ({ ...previous, [messageId]: confirmed }));
      addTimeline(
        makeTimelineEvent(
          message.job_id,
          "candidate_confirmed_sent",
          "Candidate confirmed sent",
          "Self-reported by the candidate; not provider-verified delivery.",
          {
            draftId: message.draft_id,
            contactId: message.contact_id,
            source: sourceFor(message.is_demo, true),
            simulated: message.is_demo,
            at: receipt.candidate_confirmed_sent_at,
          },
        ),
      );
      push({
        k: "coach",
        text: `Recorded as **candidate-confirmed / self-reported sent**. This is your attestation, not ${message.channel === "email" ? "email provider" : "LinkedIn"} verification. You can now record a reply.`,
      });
    } catch (error) {
      push({ k: "error", text: `${(error as Error).message} No sent event was added.` });
      throw error;
    } finally {
      actionLocks.current.end(`confirm:${messageId}`);
      setBusyMessage(null);
    }
  };

  const doReply = async (messageId: string, input: ReplyInput) => {
    const message = messages[messageId];
    if (!message || !actionLocks.current.begin(`reply:${messageId}`))
      throw new Error("A reply is already being saved.");
    setBusyMessage(messageId);
    try {
      const interaction = await api.recordCandidateReply(message, input);
      const updated = recordCandidateReply(message, input);
      const response = updated.responses.at(-1);
      setMessages((previous) => ({ ...previous, [messageId]: updated }));
      addTimeline(
        makeTimelineEvent(
          message.job_id,
          "reply_recorded",
          "Candidate-recorded reply",
          `${input.content.trim()} · received ${input.reply_date}`,
          {
            draftId: message.draft_id,
            contactId: message.contact_id,
            source: sourceFor(message.is_demo, true),
            simulated: message.is_demo,
            at: response?.created_at ?? updated.updated_at,
          },
        ),
      );
      if (response?.outcome)
        addTimeline(
          makeTimelineEvent(
            message.job_id,
            "outcome_recorded",
            "Candidate-recorded outcome",
            response.outcome,
            {
              draftId: message.draft_id,
              contactId: message.contact_id,
              source: sourceFor(message.is_demo, true),
              simulated: message.is_demo,
              at: response.created_at,
            },
          ),
        );
      push(
        { k: "logged", i: interaction },
        {
          k: "coach",
          text: `Saved to the selected job's timeline as a **candidate-recorded reply**, not a provider-verified event${message.is_demo ? ". **DEMO:** the record is ephemeral" : ""}.`,
        },
      );
    } catch (error) {
      push({
        k: "error",
        text: `${(error as Error).message} The reply was not added to the timeline.`,
      });
      throw error;
    } finally {
      actionLocks.current.end(`reply:${messageId}`);
      setBusyMessage(null);
    }
  };

  const doLog = async (value: {
    job_id: string;
    interaction_type: Interaction["interaction_type"];
    content: string;
    simulated: boolean;
  }) => {
    if (!cid) return;
    setSending(true);
    try {
      const interaction = await api.interaction({ candidate_id: cid, ...value });
      push({ k: "logged", i: interaction }, { k: "typing" });
      const reply = await api.chat(
        cid,
        `I just logged a ${value.interaction_type.replace("_", " ")}: ${value.content}`,
      );
      push({ k: "reply", r: reply });
      setActions(reply.recommended_actions);
    } catch (error) {
      push({ k: "error", text: (error as Error).message, retry: () => doLog(value) });
    } finally {
      setSending(false);
    }
  };

  const doLogout = async () => {
    if (demo) {
      session.clear();
      nav({ to: "/" });
      return;
    }
    setAccountBusy(true);
    try {
      await api.logoutLinkedIn();
      session.clear();
      nav({ to: "/" });
    } catch (error) {
      setLoadErr((error as Error).message);
    } finally {
      setAccountBusy(false);
    }
  };

  const doConsents = async (input: ConsentInput[]) => {
    setAccountBusy(true);
    try {
      const result = await api.updateConsents(input);
      setWorkspace((previous) =>
        previous ? { ...previous, consents: result.consents } : previous,
      );
    } finally {
      setAccountBusy(false);
    }
  };

  const doDeleteAccount = async () => {
    setAccountBusy(true);
    try {
      const result = await api.deleteAccount("DELETE");
      session.clear();
      nav({ to: "/", search: { account: "closed" } });
      return result;
    } finally {
      setAccountBusy(false);
    }
  };

  const toggle = (id: string) =>
    setDone((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const pct = actions.length ? Math.round((done.size / actions.length) * 100) : 0;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Logo />
          <div className="flex items-center gap-2">
            {demo && <SimBadge label="Demo scenario" />}
            <EngineBadge />
            <Link
              to="/pricing"
              className="hidden text-sm font-medium text-muted-foreground hover:text-foreground sm:inline"
            >
              Pricing
            </Link>
            <Link
              to="/privacy"
              className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline"
            >
              Privacy
            </Link>
            <Button
              size="icon"
              variant="ghost"
              aria-label={demo ? "Exit local demo" : "Sign out"}
              title={demo ? "Exit local demo" : "Sign out"}
              disabled={accountBusy}
              onClick={() => void doLogout()}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>
      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-6 px-4 lg:grid-cols-[1fr_320px]">
        <main className="flex min-w-0 flex-col">
          <div className="flex-1 space-y-4 py-6">
            {loadErr && (
              <ErrorNote
                message={`${loadErr}${demo ? " If the demo expired, start it again from the home page." : ""}`}
                onRetry={() => cid && load(cid)}
              />
            )}
            {!loadErr && !c && (
              <div className="space-y-3">
                {[0, 1, 2].map((index) => (
                  <div key={index} className="h-24 rounded-2xl bg-muted" />
                ))}
              </div>
            )}
            {items.map((item, index) => (
              <div key={index} className="animate-rise">
                {render(item)}
              </div>
            ))}
            {workspace && !demo && (
              <AccountSettings
                workspace={workspace}
                busy={accountBusy}
                onConsents={doConsents}
                onDelete={doDeleteAccount}
              />
            )}
            <div ref={end} />
          </div>
          <div className="sticky bottom-0 bg-background pb-4 pt-6">
            <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
              {QUICK.map((question) => (
                <button
                  key={question}
                  onClick={() => ask(question)}
                  disabled={!c || sending}
                  className="shrink-0 rounded-full border bg-card px-3 py-1.5 text-xs hover:border-primary/50 disabled:opacity-50"
                >
                  {question}
                </button>
              ))}
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                ask(input);
              }}
              className="flex items-end gap-2 rounded-2xl border bg-card p-2 shadow-soft"
            >
              <Textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                rows={1}
                placeholder="Talk to your coach…"
                className="min-h-10 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    ask(input);
                  }
                }}
              />
              <Button
                type="submit"
                size="icon"
                className="rounded-full"
                disabled={!input.trim() || sending || !c}
                aria-label="Send"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </main>
        <aside className="hidden space-y-4 py-6 lg:block">
          <div className="sticky top-20 max-h-[calc(100vh-6rem)] space-y-4 overflow-y-auto pr-1">
            <Shell title="This week's momentum">
              <div className="flex items-end justify-between">
                <span className="font-display text-4xl font-bold">{pct}%</span>
                <span className="text-xs text-muted-foreground">
                  {done.size}/{actions.length || 0} actions
                </span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-brand-spark transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Fewer, better-aligned moves beat volume.
              </p>
            </Shell>
            <Shell title="Action plan" icon={<ClipboardList className="h-3.5 w-3.5" />}>
              {actions.length ? (
                <ActionList actions={actions} done={done} toggle={toggle} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Ask your coach what to focus on and your plan will appear here.
                </p>
              )}
            </Shell>
            <CareerTimeline events={timeline} compact />
          </div>
        </aside>
      </div>
    </div>
  );

  function render(item: Item) {
    switch (item.k) {
      case "coach":
        return <Bubble who="coach">{md(item.text)}</Bubble>;
      case "user":
        return <Bubble who="user">{item.text}</Bubble>;
      case "typing":
        return (
          <Bubble who="coach">
            <span className="inline-flex gap-1">
              {[0, 1, 2].map((index) => (
                <span key={index} className="h-2 w-2 rounded-full bg-muted-foreground/60" />
              ))}
            </span>
          </Bubble>
        );
      case "profile":
        return c && (
          <div className="grid gap-4">
            <ProfileCard c={c} demo={demo} />
            {isLiveApi && (
              <CareerSourcePanel
                candidate={c}
                onImportLinkedIn={async (url) => {
                  const updated = await api.linkedin(c.candidate_id, url, true);
                  setC(updated);
                  push({ k: "coach", text: "Your LinkedIn profile data has been imported. Review your name, summary and skills before confirming your career profile." });
                }}
                onUploadCv={async (filename, text) => {
                  const updated = await api.uploadCv(c.candidate_id, filename, text);
                  setC(updated);
                  push({ k: "coach", text: `Uploaded **${filename}** and added its extracted text to your career profile. LinkedIn and CV information are retained as separate sources.` });
                }}
                onFindJobs={async () => {
                  const found = await api.discover(c.candidate_id);
                  const results = await Promise.all(found.map((job) => api.match(job.job_id, c.candidate_id).catch(() => null)));
                  const byId: Record<string, JobMatch> = {};
                  results.forEach((result) => { if (result) byId[result.job_id] = result; });
                  const ranked = [...found].sort((a, b) => (byId[b.job_id]?.match_score ?? 0) - (byId[a.job_id]?.match_score ?? 0));
                  setJobs(ranked);
                  setMatches((previous) => ({ ...previous, ...byId }));
                  push(
                    { k: "coach", text: ranked.length ? `Found **${ranked.length} LinkedIn jobs** and ranked them against your profile. Open a role to inspect the match and its gaps.` : "Needle returned no LinkedIn jobs for your current target roles. Try broadening your preferences." },
                    { k: "jobs" },
                  );
                }}
              />
            )}
          </div>
        );
      case "jobs":
        return (
          <div className="grid gap-4">
            {isLiveApi && <JobImportCard busy={jobImportBusy} onSubmit={importJob} />}
            {jobs.length === 0 && (
              <Shell title="Import a vacancy to begin">
                <p className="text-sm text-muted-foreground">
                  No fictional vacancies were substituted. Import a public job URL above; its
                  details will be reused for your application and contact research.
                </p>
              </Shell>
            )}
            {jobs.map((job) => (
              <JobCard
                key={job.job_id}
                job={job}
                match={matches[job.job_id]}
                contact={contacts[job.job_id] ?? null}
                discovery={discoveries[job.job_id] ?? null}
                discoveryBusy={discoveryBusy[job.job_id] ?? false}
                selected={selectedJobId === job.job_id}
                busy={busyJob === job.job_id}
                onSelect={() => doSelectJob(job)}
                onMatch={() => doMatch(job)}
                onAddContact={(input) => doAddContact(job, input)}
                onEditContact={(input) => doEditContact(job, input)}
                onDiscoverContact={() => discoverContactForJob(job)}
                onSelectContact={(selected) =>
                  setContacts((previous) => ({ ...previous, [job.job_id]: selected }))
                }
                onDraft={() => doDraft(job)}
                onPrepareApplication={() => doPrepareApplication(job)}
              />
            ))}
          </div>
        );
      case "outreach": {
        const message = messages[item.messageId];
        const contact = message
          ? (discoveries[message.job_id]?.contacts.find(
              (candidate) => candidate.contact_id === message.contact_id,
            ) ?? contacts[message.job_id])
          : null;
        const job = jobs.find((entry) => entry.job_id === message?.job_id);
        if (!message || !contact || contact.contact_id !== message.contact_id || !job)
          return (
            <ErrorNote message="This outreach message, job, or its selected contact is no longer available." />
          );
        return (
          <OutreachCard
            key={message.message_id}
            message={message}
            contact={contact}
            job={job}
            busy={busyMessage === message.message_id}
            onSaveDraft={(body, subject) => doSaveDraft(message.message_id, body, subject)}
            onApprove={(body, subject) => doApprove(message.message_id, body, subject)}
            onHandoff={() => doHandoff(message.message_id)}
            onRegenerate={() => doDraft(job)}
            onConfirmSent={() => doConfirmSent(message.message_id)}
            onNotYet={() => doNotYet(message.message_id)}
            onReply={(input) => doReply(message.message_id, input)}
          />
        );
      }
      case "application": {
        const applicationPackage = applicationPackages[item.jobId];
        const job = jobs.find((entry) => entry.job_id === item.jobId);
        if (!applicationPackage || !job)
          return (
            <ErrorNote message="This application package or its selected job is no longer available." />
          );
        return (
          <ApplicationPackageCard
            applicationPackage={applicationPackage}
            job={job}
            contact={contacts[job.job_id] ?? null}
            outreach={Object.values(messages)
              .filter(
                (message) =>
                  message.channel === "email" &&
                  message.package_id === applicationPackage.package_id,
              )
              .map((message) => (
                <div key={message.message_id}>
                  {render({ k: "outreach", messageId: message.message_id })}
                </div>
              ))}
            busy={busyJob === job.job_id}
            onSave={(content) => doSaveApplicationCv(job.job_id, content)}
            onApprove={() => doApproveApplicationCv(job.job_id)}
            onExport={(format) => doExportApplicationCv(job.job_id, format)}
            onSaveAnswer={(input) => doSaveAnswer(job.job_id, input)}
            onCreateCoverLetter={() => doCreateCoverLetter(job.job_id)}
            onSaveCoverLetter={(content) => doSaveCoverLetter(job.job_id, content)}
            onApproveCoverLetter={() => doApproveCoverLetter(job.job_id)}
            onApproveChannel={(channel) => doApproveApplicationChannel(job.job_id, channel)}
            onChannelHandoff={(channel) => doApplicationHandoff(job.job_id, channel)}
            onSubmitChannel={(channel) => doSubmitApplication(job.job_id, channel)}
            onReportSubmitted={(channel) => doReportApplicationSubmitted(job.job_id, channel)}
            onPrepareEmail={() => doPrepareEmail(job.job_id)}
            onFindContact={() => push({ k: "jobs" })}
            onReviseMasterProfile={(input) => doReviseMasterProfile(job.job_id, input)}
          />
        );
      }
      case "timeline":
        return <CareerTimeline events={timeline} />;
      case "form":
        return <InteractionForm jobs={jobs} demo={demo} busy={sending} onSubmit={doLog} />;
      case "logged":
        return <InteractionLogged i={item.i} />;
      case "error":
        return <ErrorNote message={item.text} onRetry={item.retry} />;
      case "reply":
        return (
          <div className="space-y-3">
            <Bubble who="coach">{item.r.message}</Bubble>
            {item.r.insights.length > 0 && (
              <Shell title="What I'm noticing" icon={<Lightbulb className="h-3.5 w-3.5" />}>
                <ul className="space-y-2 text-sm">
                  {item.r.insights.map((insight) => (
                    <li key={insight} className="flex gap-2">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      {insight}
                    </li>
                  ))}
                </ul>
              </Shell>
            )}
            {item.r.recommended_actions.length > 0 && (
              <Shell title="Your next steps" icon={<ClipboardList className="h-3.5 w-3.5" />}>
                <ActionList actions={item.r.recommended_actions} done={done} toggle={toggle} />
              </Shell>
            )}
          </div>
        );
    }
  }
}

function Bubble({ who, children }: { who: "coach" | "user"; children: React.ReactNode }) {
  return (
    <div className={cn("flex gap-3", who === "user" && "justify-end")}>
      {who === "coach" && <LogoMark className="h-8 w-8" />}
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed",
          who === "coach"
            ? "rounded-tl-sm bg-card shadow-soft"
            : "rounded-tr-sm bg-primary text-primary-foreground",
        )}
      >
        {children}
      </div>
    </div>
  );
}

function md(text: string) {
  return text
    .split(/(\*\*[^*]+\*\*)/)
    .map((part, index) =>
      part.startsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : part,
    );
}