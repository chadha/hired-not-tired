import { useEffect, useState, type ReactNode } from "react";
import {
  Check,
  CheckCheck,
  Download,
  FileCheck2,
  FileText,
  LoaderCircle,
  Mail,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Shell, Chip } from "@/components/hnt/cards";
import { SimBadge } from "@/components/hnt/brand";
import {
  getApplicationChannels,
  getCurrentCvArtifact,
  getCvExportBlockReason,
  type ApplicationPackage,
  type ApplicationChannel,
  type MasterProfileRevisionInput,
} from "@/lib/application-package";
import type { CvExportValidation } from "@/lib/cv-documents";
import type { Job } from "@/lib/api";
import type { HiringContact } from "@/lib/hiring-contacts";
import {
  ApplicationAnswers,
  ConfirmedFacts,
  CoverLetterEditor,
  type AnswerInput,
} from "@/components/hnt/application-content";
import { ApplicationChannels } from "@/components/hnt/application-channels";

const dateTime = (value: string) =>
  new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );

export function ApplicationPackageCard({
  applicationPackage,
  job,
  contact,
  outreach,
  busy,
  onSave,
  onApprove,
  onExport,
  onSaveAnswer,
  onCreateCoverLetter,
  onSaveCoverLetter,
  onApproveCoverLetter,
  onApproveChannel,
  onChannelHandoff,
  onSubmitChannel,
  onReportSubmitted,
  onPrepareEmail,
  onFindContact,
  onReviseMasterProfile,
}: {
  applicationPackage: ApplicationPackage;
  job: Job;
  contact: HiringContact | null;
  outreach?: ReactNode;
  busy: boolean;
  onSave: (content: string) => Promise<void>;
  onApprove: () => Promise<void>;
  onExport: (format: "pdf" | "docx") => Promise<CvExportValidation>;
  onSaveAnswer: (input: AnswerInput) => Promise<void>;
  onCreateCoverLetter: () => Promise<void>;
  onSaveCoverLetter: (content: string) => Promise<void>;
  onApproveCoverLetter: () => Promise<void>;
  onApproveChannel: (channel: ApplicationChannel) => Promise<void>;
  onChannelHandoff: (channel: ApplicationChannel) => Promise<void>;
  onSubmitChannel: (channel: ApplicationChannel) => Promise<void>;
  onReportSubmitted: (channel: ApplicationChannel) => Promise<void>;
  onPrepareEmail: () => Promise<void>;
  onFindContact: () => void;
  onReviseMasterProfile: (input: MasterProfileRevisionInput) => Promise<void>;
}) {
  const artifact = getCurrentCvArtifact(applicationPackage);
  const [text, setText] = useState(artifact.content);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<CvExportValidation | null>(null);
  const [exporting, setExporting] = useState<"pdf" | "docx" | null>(null);
  useEffect(() => {
    setText(artifact.content);
    setReviewing(false);
    setExportResult(null);
  }, [artifact.artifact_id, artifact.content]);
  const dirty = text !== artifact.content;
  const exportBlock = getCvExportBlockReason(applicationPackage, text);
  const channels = getApplicationChannels(job, applicationPackage.capabilities);
  const hiringTeam = channels.find((channel) => channel.id === "hiring_team");
  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError((caught as Error).message);
    }
  };
  const exportCv = async (format: "pdf" | "docx") => {
    setExporting(format);
    await run(async () => {
      const result = await onExport(format);
      setExportResult(result);
    });
    setExporting(null);
  };

  return (
    <Shell
      title="Job application package"
      icon={<FileText className="h-3.5 w-3.5" />}
      extra={applicationPackage.is_demo ? <SimBadge label="LOCAL DEMO · in-memory" /> : undefined}
    >
      <div className="rounded-xl border bg-secondary/35 p-3 text-sm">
        <p className="font-semibold">
          {job.title} · {job.company}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Source:{" "}
          {applicationPackage.source.kind === "uploaded_cv"
            ? "uploaded CV"
            : "conversational career profile"}
          {applicationPackage.source.filename ? ` · ${applicationPackage.source.filename}` : ""}
        </p>
        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          The master CV/profile is unchanged. Every edit creates a separate tailored version. Master
          profile v{applicationPackage.master_profile.profile_version} · job snapshot{" "}
          {applicationPackage.job_snapshot.snapshot_id}.
        </p>
      </div>
      <ConfirmedFacts
        applicationPackage={applicationPackage}
        busy={busy}
        onRevise={onReviseMasterProfile}
      />

      <details className="mt-3 rounded-xl border bg-background p-3">
        <summary className="cursor-pointer text-sm font-semibold">
          Job analysis & candidate evidence
        </summary>
        <p className="mt-2 text-xs text-muted-foreground">{applicationPackage.analysis.notes[0]}</p>
        <ul className="mt-3 space-y-2">
          {applicationPackage.analysis.requirements.map((requirement) => (
            <li key={requirement.requirement_id} className="rounded-xl bg-secondary/35 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{requirement.text}</span>
                <Chip
                  tone={
                    requirement.status === "strong_match"
                      ? "good"
                      : requirement.status === "gap"
                        ? "gap"
                        : "default"
                  }
                >
                  {requirement.status.replaceAll("_", " ")}
                </Chip>
                <Chip>{requirement.priority}</Chip>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {requirement.candidate_evidence ?? requirement.uncertainty}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {requirement.recommended_action}
              </p>
            </li>
          ))}
        </ul>
      </details>

      <ApplicationAnswers
        applicationPackage={applicationPackage}
        busy={busy}
        onSave={onSaveAnswer}
      />
      <CoverLetterEditor
        applicationPackage={applicationPackage}
        busy={busy}
        onCreate={onCreateCoverLetter}
        onSave={onSaveCoverLetter}
        onApprove={onApproveCoverLetter}
      />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold">Tailored CV · version {artifact.version}</h4>
          <p className="text-xs text-muted-foreground">Created {dateTime(artifact.created_at)}</p>
        </div>
        {artifact.approval && !dirty ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
            <CheckCheck className="h-4 w-4" /> Exact version approved
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Draft · approval required</span>
        )}
      </div>
      <Textarea
        aria-label="Tailored CV content"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setReviewing(false);
          setExportResult(null);
          setError(null);
        }}
        rows={18}
        className="mt-2 bg-background font-sans text-sm leading-relaxed"
        disabled={busy || exporting !== null}
      />
      <p className="mt-1 text-xs text-muted-foreground">
        {dirty
          ? "Unsaved edit · the previous version and approval remain unchanged"
          : `${text.length} characters · saved immutable version`}
      </p>
      <details className="mt-3 rounded-xl bg-secondary/35 p-3">
        <summary className="cursor-pointer text-xs font-semibold">Change & evidence review</summary>
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {artifact.change_summary.map((change) => (
            <li key={change}>• {change}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs">
          Evidence used:{" "}
          {artifact.evidence_used.length
            ? artifact.evidence_used.join(", ")
            : "no exact confirmed skill overlap; source history retained for review"}
          .
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Fact references: {artifact.evidence_fact_ids.join(", ")}
        </p>
      </details>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!dirty || !text.trim() || busy || exporting !== null}
          onClick={() => void run(() => onSave(text))}
        >
          Save as version {artifact.version + 1}
        </Button>
        <Button
          size="sm"
          disabled={dirty || Boolean(artifact.approval) || busy || exporting !== null}
          onClick={() => setReviewing((value) => !value)}
        >
          <Check /> Review & approve CV
        </Button>
      </div>
      {reviewing && !artifact.approval && !dirty && (
        <section
          aria-label="Approve tailored CV"
          className="mt-3 rounded-xl border-2 border-primary/30 bg-background p-4"
        >
          <h4 className="text-sm font-bold">Approve tailored CV version {artifact.version}</h4>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Approval binds this exact version and text hash. Any later edit requires a new version
            and approval. Approval does not submit an application or send a message.
          </p>
          <pre className="mt-3 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl bg-secondary/40 p-3 font-sans text-xs">
            {artifact.content}
          </pre>
          <Button
            size="sm"
            className="mt-3"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await onApprove();
                setReviewing(false);
              })
            }
          >
            <CheckCheck /> {busy ? "Recording approval…" : "Approve exact CV version"}
          </Button>
        </section>
      )}

      <div className="mt-5 border-t pt-4">
        <h4 className="flex items-center gap-2 text-sm font-bold">
          <Download className="h-4 w-4" /> Validated export
        </h4>
        <p className="mt-1 text-xs text-muted-foreground">
          PDF and editable DOCX come from the same approved text. Extraction, headings, reading
          order and document structure are checked before download.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(["pdf", "docx"] as const).map((format) => {
            const unavailable = applicationPackage.capabilities.documents[format] === "unavailable";
            return (
              <Button
                key={format}
                size="sm"
                variant="outline"
                disabled={Boolean(exportBlock) || unavailable || busy || exporting !== null}
                onClick={() => void exportCv(format)}
              >
                {exporting === format ? <LoaderCircle /> : <FileCheck2 />}
                {unavailable
                  ? `${format.toUpperCase()} unavailable`
                  : exporting === format
                    ? `Validating ${format.toUpperCase()}…`
                    : `Export ${format.toUpperCase()}`}
              </Button>
            );
          })}
        </div>
        {exportBlock && <p className="mt-2 text-xs text-muted-foreground">{exportBlock}</p>}
        {exportResult && (
          <div role="status" className="mt-3 rounded-xl bg-success/15 p-3 text-xs">
            <p className="font-semibold">
              {exportResult.format.toUpperCase()} validated and downloaded
            </p>
            <ul className="mt-1 space-y-1 text-muted-foreground">
              {exportResult.checks.map((check) => (
                <li key={check}>✓ {check}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <ApplicationChannels
        applicationPackage={applicationPackage}
        channels={channels}
        busy={busy}
        onApprove={onApproveChannel}
        onHandoff={onChannelHandoff}
        onSubmit={onSubmitChannel}
        onReportSubmitted={onReportSubmitted}
      />

      <div className="mt-5 border-t pt-4">
        <h4 className="flex items-center gap-2 text-sm font-bold">
          <Mail className="h-4 w-4" /> Hiring team · LinkedIn & email
        </h4>
        <p className="mt-1 text-xs text-muted-foreground">{hiringTeam?.capability}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">{hiringTeam?.blocker}</p>
        {contact ? (
          <div className="mt-3 rounded-xl border bg-background p-3 text-xs">
            <p className="font-semibold">{contact.full_name} · potential hiring contact</p>
            <p className="mt-1 text-muted-foreground">
              {contact.current_title || "Title not supplied"} ·{" "}
              {contact.company || "Company not supplied"}
            </p>
            <p className="mt-1 break-all text-muted-foreground">
              Email: {contact.email || "Not supplied"}
            </p>
            <p className="mt-2 text-muted-foreground">
              Candidate-supplied evidence: {contact.evidence_notes || "No evidence note supplied."}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              disabled={
                busy ||
                !contact.email ||
                Boolean(exportBlock) ||
                !applicationPackage.capabilities.email.handoff
              }
              onClick={() => void run(onPrepareEmail)}
            >
              <Mail /> Prepare email handoff
            </Button>
            {!contact.email && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Edit the contact on the job card to add an evidenced email address.
              </p>
            )}
          </div>
        ) : (
          <Button size="sm" variant="outline" className="mt-3" onClick={onFindContact}>
            <UserPlus /> Find/add contact on job card
          </Button>
        )}
        {outreach && <div className="mt-3 space-y-3">{outreach}</div>}
      </div>

      <details className="mt-4 rounded-xl bg-secondary/35 p-3">
        <summary className="cursor-pointer text-xs font-semibold">
          Version history ({applicationPackage.versions.length})
        </summary>
        <ol className="mt-2 space-y-2 text-xs">
          {[...applicationPackage.versions].reverse().map((version) => (
            <li key={version.artifact_id}>
              Version {version.version} ·{" "}
              {version.approval ? `approved ${dateTime(version.approval.approved_at)}` : "draft"} ·{" "}
              {dateTime(version.created_at)}
            </li>
          ))}
        </ol>
      </details>
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </Shell>
  );
}