import { useState } from "react";
import {
  Briefcase,
  Check,
  FileText,
  MapPin,
  Sparkles,
  TriangleAlert,
  Clock,
  RotateCcw,
  Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  fmtSalary,
  type Candidate,
  type Job,
  type JobMatch,
  type InteractionType,
  type RecommendedAction,
  type Interaction,
} from "@/lib/api";
import type {
  ContactDiscoveryResult,
  HiringContact,
  ManualContactInput,
} from "@/lib/hiring-contacts";
import { HiringContactPanel } from "@/components/hnt/hiring-contact";
import { SimBadge } from "./brand";
import { cn } from "@/lib/utils";

export function Shell({
  title,
  icon,
  extra,
  children,
  className,
}: {
  title: string;
  icon?: React.ReactNode;
  extra?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-2xl border bg-card p-4 shadow-soft sm:p-5", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {icon}
          {title}
        </div>
        {extra}
      </div>
      {children}
    </div>
  );
}

export function Chip({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "good" | "gap";
}) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-1 text-xs font-medium",
        tone === "good" && "bg-success/15 text-foreground",
        tone === "gap" && "bg-warning/10 text-foreground",
        tone === "default" && "bg-secondary text-secondary-foreground",
      )}
    >
      {children}
    </span>
  );
}

export function ProfileCard({ c, demo }: { c: Candidate; demo?: boolean }) {
  return (
    <Shell
      title="Career profile"
      icon={<Sparkles className="h-3.5 w-3.5" />}
      extra={demo && <SimBadge label="Demo candidate" />}
    >
      <h3 className="text-xl font-bold">{c.full_name}</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {c.summary || "Add your CV to enrich your profile."}
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Aiming for</dt>
          <dd className="font-medium">{c.career_goal}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Where</dt>
          <dd className="font-medium">{c.locations.join(", ") || "Open"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Salary floor</dt>
          <dd className="font-medium">
            {c.minimum_salary ? `€${Math.round(c.minimum_salary / 1000)}k` : "Not set"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Experience</dt>
          <dd className="font-medium">{c.experience_years ? `${c.experience_years} yrs` : "—"}</dd>
        </div>
      </dl>
      {c.skills.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {c.skills.map((s) => (
            <Chip key={s}>{s}</Chip>
          ))}
        </div>
      )}
    </Shell>
  );
}

function ScoreRing({ score }: { score: number }) {
  const r = 22,
    circ = 2 * Math.PI * r;
  return (
    <div className="relative h-14 w-14 shrink-0">
      <svg viewBox="0 0 56 56" className="h-14 w-14 -rotate-90">
        <circle cx="28" cy="28" r={r} className="fill-none stroke-muted" strokeWidth="5" />
        <circle
          cx="28"
          cy="28"
          r={r}
          className={cn(
            "fill-none",
            score >= 70 ? "stroke-success" : score >= 50 ? "stroke-warning" : "stroke-brand-spark",
          )}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - score / 100)}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center font-display text-base font-bold">
        {score}
      </span>
    </div>
  );
}

export function JobCard({
  job,
  match,
  contact,
  discovery,
  discoveryBusy,
  selected,
  onSelect,
  onMatch,
  onDraft,
  onPrepareApplication,
  onAddContact,
  onEditContact,
  onDiscoverContact,
  onSelectContact,
  busy,
}: {
  job: Job;
  match?: JobMatch | undefined;
  contact?: HiringContact | null;
  discovery?: ContactDiscoveryResult | null;
  discoveryBusy?: boolean;
  selected: boolean;
  onSelect: () => void;
  onMatch: () => void;
  onDraft: () => void;
  onPrepareApplication: () => void;
  onAddContact: (input: ManualContactInput) => Promise<void>;
  onEditContact: (input: ManualContactInput) => Promise<void>;
  onDiscoverContact?: () => Promise<void>;
  onSelectContact?: (contact: HiringContact) => void;
  busy?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-card p-4 shadow-soft transition hover:shadow-lift sm:p-5",
        selected && "border-primary ring-1 ring-primary/25",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            {job.is_demo && <SimBadge label="Demo job" />}
            <span className="text-xs text-muted-foreground">
              via {job.source}
              {job.retrieved_at
                ? ` · retrieved ${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(job.retrieved_at))}`
                : ""}
            </span>
          </div>
          <h4 className="text-lg font-bold leading-tight">{job.title}</h4>
          <p className="text-sm text-muted-foreground">{job.company}</p>
        </div>
        {match && <ScoreRing score={match.match_score} />}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" />
            {job.location}
          </span>
          <span className="flex items-center gap-1">
            <Briefcase className="h-3.5 w-3.5" />
            {fmtSalary(job)}
          </span>
        </div>
        <Button
          size="sm"
          variant={selected ? "secondary" : "outline"}
          onClick={onSelect}
          aria-pressed={selected}
        >
          {selected ? <Check /> : null}
          {selected ? "Selected job" : "Select job"}
        </Button>
      </div>

      <HiringContactPanel
        contact={contact}
        discovery={discovery}
        discoveryBusy={discoveryBusy ?? false}
        busy={busy ?? false}
        onAdd={onAddContact}
        onEdit={onEditContact}
        onDiscover={onDiscoverContact}
        onSelectContact={onSelectContact}
      />

      {match ? (
        <div className="mt-4 space-y-3 border-t pt-4">
          <p className="text-xs text-muted-foreground">
            Match score is a decision-support signal from your profile, not a prediction of getting
            hired · {match.confidence} confidence
          </p>
          {!match.constraints_met && (
            <p className="flex items-center gap-1.5 text-sm text-destructive">
              <TriangleAlert className="h-4 w-4" />
              Doesn't meet your location or salary preferences.
            </p>
          )}
          <div>
            <p className="mb-1.5 text-xs font-semibold">Why it fits</p>
            <div className="flex flex-wrap gap-1.5">
              {match.strengths.length ? (
                match.strengths.map((s) => (
                  <Chip key={s} tone="good">
                    ✓ {s}
                  </Chip>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">No direct overlap found yet.</span>
              )}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold">Gaps to check</p>
            <div className="flex flex-wrap gap-1.5">
              {match.gaps.length ? (
                match.gaps.map((s) => (
                  <Chip key={s} tone="gap">
                    {s}
                  </Chip>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">No obvious gaps.</span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onPrepareApplication} disabled={busy}>
              <FileText />
              {busy ? "Preparing…" : "Prepare application"}
            </Button>
            <Button size="sm" variant="outline" onClick={onDraft} disabled={busy}>
              Generate LinkedIn Message
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="secondary" className="mt-4" onClick={onMatch} disabled={busy}>
          {busy ? "Checking fit…" : "Check my fit"}
        </Button>
      )}
    </div>
  );
}

export function JobImportCard({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (sourceUrl: string) => Promise<void>;
}) {
  const [sourceUrl, setSourceUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setError(null);
    try {
      await onSubmit(sourceUrl.trim());
      setSourceUrl("");
    } catch (caught) {
      setError((caught as Error).message);
    }
  };
  return (
    <Shell title="Import a public job URL" icon={<Link2 className="h-3.5 w-3.5" />}>
      <p className="text-sm text-muted-foreground">
        Paste the vacancy link once. We’ll reuse its title, company, location and description for
        application and contact research.
      </p>
      <label className="mt-3 block text-xs font-semibold" htmlFor="job-source-url">
        Public job URL
      </label>
      <input
        id="job-source-url"
        aria-label="Public job URL"
        type="url"
        inputMode="url"
        placeholder="https://employer.example/jobs/role"
        className="mt-1 h-11 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={sourceUrl}
        disabled={busy}
        onChange={(event) => setSourceUrl(event.target.value)}
      />
      <Button
        className="mt-3"
        size="sm"
        disabled={busy || !sourceUrl.trim()}
        onClick={() => void submit()}
      >
        <Link2 /> {busy ? "Importing…" : "Import job"}
      </Button>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </Shell>
  );
}

const TYPES: { v: InteractionType; l: string }[] = [
  { v: "recruiter_reply", l: "Recruiter reply" },
  { v: "interview", l: "Interview" },
  { v: "rejection", l: "Rejection" },
  { v: "offer", l: "Offer" },
  { v: "outreach_sent", l: "I sent outreach" },
  { v: "note", l: "Note" },
];
const SAMPLE =
  "Thanks for your interest, Sarah. Your platform background is strong, but we're prioritising candidates with hands-on production AI and LLM deployment experience for this role.";

export function InteractionForm({
  jobs,
  demo,
  onSubmit,
  busy,
}: {
  jobs: Job[];
  demo: boolean;
  onSubmit: (v: {
    job_id: string;
    interaction_type: InteractionType;
    content: string;
    simulated: boolean;
  }) => void;
  busy?: boolean;
}) {
  const [type, setType] = useState<InteractionType>("recruiter_reply");
  const [jobId, setJobId] = useState(jobs[0]?.job_id ?? "");
  const [content, setContent] = useState("");
  const [sim, setSim] = useState(false);
  return (
    <Shell title="Log what happened">
      <div className="flex flex-wrap gap-1.5">
        {TYPES.map((t) => (
          <button
            key={t.v}
            type="button"
            onClick={() => setType(t.v)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition",
              type === t.v
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-background hover:bg-secondary",
            )}
          >
            {t.l}
          </button>
        ))}
      </div>
      <select
        value={jobId}
        onChange={(e) => setJobId(e.target.value)}
        className="mt-3 h-10 w-full rounded-md border bg-background px-3 text-sm"
      >
        {jobs.map((j) => (
          <option key={j.job_id} value={j.job_id}>
            {j.title} · {j.company}
          </option>
        ))}
      </select>
      <Textarea
        className="mt-3 bg-background"
        rows={4}
        placeholder="Paste the reply or describe what happened…"
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          setSim(false);
        }}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={!content.trim() || !jobId || busy}
          onClick={() =>
            onSubmit({ job_id: jobId, interaction_type: type, content, simulated: sim })
          }
        >
          {busy ? "Saving…" : "Save & ask coach"}
        </Button>
        {demo && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setType("rejection");
              setContent(SAMPLE);
              setSim(true);
            }}
          >
            Use simulated recruiter feedback
          </Button>
        )}
        {sim && <SimBadge />}
      </div>
    </Shell>
  );
}

export function InteractionLogged({ i }: { i: Interaction }) {
  return (
    <div className="rounded-2xl border border-dashed bg-background/60 p-4 text-sm">
      <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Logged · {i.interaction_type.replace("_", " ")} {i.simulated && <SimBadge />}
      </div>
      <p className="italic text-muted-foreground">“{i.content}”</p>
    </div>
  );
}

export function ActionList({
  actions,
  done,
  toggle,
}: {
  actions: RecommendedAction[];
  done: Set<string>;
  toggle: (id: string) => void;
}) {
  return (
    <ul className="space-y-2">
      {actions.map((a) => (
        <li key={a.action_id}>
          <button
            onClick={() => toggle(a.action_id)}
            className={cn(
              "flex w-full items-start gap-3 rounded-xl border bg-background p-3 text-left transition hover:border-primary/40",
              done.has(a.action_id) && "opacity-60",
            )}
          >
            <span
              className={cn(
                "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2",
                done.has(a.action_id)
                  ? "border-success bg-success text-primary-foreground"
                  : a.priority === "high"
                    ? "border-primary"
                    : "border-border",
              )}
            >
              {done.has(a.action_id) && <Check className="h-3 w-3" />}
            </span>
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "block text-sm font-semibold",
                  done.has(a.action_id) && "line-through",
                )}
              >
                {a.title}
              </span>
              <span className="block text-xs text-muted-foreground">{a.description}</span>
            </span>
            {a.estimated_minutes && (
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {a.estimated_minutes}m
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ErrorNote({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: (() => void) | undefined;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-background p-4 text-sm text-foreground">
      <TriangleAlert className="h-4 w-4 text-destructive" />
      <span className="flex-1">{message}</span>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RotateCcw className="h-4 w-4" />
          Retry
        </Button>
      )}
    </div>
  );
}