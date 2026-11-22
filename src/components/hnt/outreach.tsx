import { useEffect, useState } from "react";
import {
  Check,
  CheckCheck,
  Clipboard,
  ExternalLink,
  History,
  LoaderCircle,
  Mail,
  MessageSquareReply,
  RotateCcw,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Shell } from "@/components/hnt/cards";
import { SimBadge } from "@/components/hnt/brand";
import {
  buildMailtoUrl,
  getHandoffBlockReason,
  type CareerTimelineEvent,
  type HiringContact,
  type OutreachMessage,
  type ReplyInput,
} from "@/lib/hiring-contacts";
import type { Job } from "@/lib/api";

const dateTime = (value: string) =>
  new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
const STATUS = {
  draft: "Draft",
  approved: "Approved",
  handed_off: "Handed off · not sent",
  candidate_confirmed_sent: "Candidate confirmed sent",
};

export function OutreachCard({
  message,
  contact,
  job,
  busy,
  onSaveDraft,
  onApprove,
  onHandoff,
  onRegenerate,
  onConfirmSent,
  onNotYet,
  onReply,
}: {
  message: OutreachMessage;
  contact: HiringContact;
  job: Job;
  busy: boolean;
  onSaveDraft: (body: string, subject?: string) => Promise<void>;
  onApprove: (body: string, subject?: string) => Promise<void>;
  onHandoff: () => Promise<void>;
  onRegenerate?: () => Promise<void>;
  onConfirmSent: () => Promise<void>;
  onNotYet: () => void;
  onReply: (input: ReplyInput) => Promise<void>;
}) {
  const [text, setText] = useState(message.body);
  const [subject, setSubject] = useState(message.subject ?? "");
  const [confirming, setConfirming] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<string | null>(null);
  const [notYet, setNotYet] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyDate, setReplyDate] = useState("");
  const [replyText, setReplyText] = useState("");
  const [outcome, setOutcome] = useState("");
  useEffect(() => {
    setText(message.body);
    setSubject(message.subject ?? "");
  }, [message.body, message.subject, message.draft_id]);
  const isEmail = message.channel === "email";
  const dirty = text !== message.body || (isEmail && subject !== (message.subject ?? ""));
  const locked = message.status === "handed_off" || message.status === "candidate_confirmed_sent";
  const handoffBlock = getHandoffBlockReason(message, text, isEmail ? subject : message.subject);
  const handedOff =
    message.status === "handed_off" || message.status === "candidate_confirmed_sent";

  const run = async (action: () => Promise<void>) => {
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError((error as Error).message);
    }
  };
  const copy = async () => {
    setCopyState(null);
    try {
      await navigator.clipboard.writeText(
        isEmail ? `Subject: ${message.subject ?? ""}\n\n${message.body}` : message.body,
      );
      setCopyState(
        isEmail
          ? "Approved subject and message copied. You still need to send the email yourself."
          : "Approved message copied. You still need to paste and send it yourself in LinkedIn.",
      );
    } catch {
      setCopyState(
        "Clipboard access was unavailable. Select the approved text above and copy it manually.",
      );
    }
  };
  const copyCurrentDraft = async () => {
    setCopyState(null);
    try {
      await navigator.clipboard.writeText(isEmail ? `Subject: ${subject}\n\n${text}` : text);
      setCopyState(
        "Current editable draft copied. Review and approve the exact text before handoff.",
      );
    } catch {
      setCopyState(
        "Clipboard access was unavailable. Select the message above and copy it manually.",
      );
    }
  };
  const saveReply = async () => {
    await run(async () => {
      await onReply({ reply_date: replyDate, content: replyText, outcome: outcome || null });
      setReplyOpen(false);
      setReplyText("");
      setOutcome("");
    });
  };

  return (
    <Shell
      title={isEmail ? "Email outreach" : "LinkedIn outreach"}
      extra={
        message.is_demo ? (
          <SimBadge label="DEMO · in-memory only" />
        ) : (
          <span className="rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground">
            {STATUS[message.status]}
          </span>
        )
      }
    >
      <div className="mb-4 rounded-xl border bg-secondary/45 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold">To: {contact.full_name}</p>
          <span className="text-xs text-muted-foreground">
            Potential hiring contact · {contact.confidence} confidence
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {contact.current_title || "Title not supplied"} ·{" "}
          {contact.company || "Company not supplied"}
        </p>
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Selected job</dt>
            <dd className="font-medium">
              {job.title} · {job.company}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Channel</dt>
            <dd className="font-medium">
              {isEmail ? "Candidate-controlled email handoff" : "Manual LinkedIn handoff"}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Exact destination</dt>
            <dd className="break-all font-medium">
              {isEmail
                ? contact.email || "No candidate-supplied email address"
                : contact.profile_url || "No public LinkedIn URL supplied"}
            </dd>
          </div>
        </dl>
      </div>

      <div className="mb-3 rounded-xl bg-secondary/35 p-3 text-xs leading-relaxed">
        <p>
          <span className="font-semibold">Personalization basis: </span>
          {message.personalization_rationale}
        </p>
        <ul className="mt-2 space-y-1 text-muted-foreground">
          {message.factuality_notes.map((note) => (
            <li key={note}>• {note}</li>
          ))}
        </ul>
      </div>

      {isEmail && (
        <>
          <label htmlFor={`subject-${message.message_id}`} className="text-xs font-semibold">
            Editable email subject
          </label>
          <input
            id={`subject-${message.message_id}`}
            aria-label="Email subject"
            className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={subject}
            disabled={locked || busy}
            onChange={(event) => {
              setSubject(event.target.value);
              setConfirming(false);
              setActionError(null);
            }}
          />
          <p className="mt-2 rounded-xl bg-secondary/35 p-3 text-xs text-muted-foreground">
            Real Send is unavailable without verified provider, sender, recipient, consent,
            suppression, durable audit and idempotency controls. This demo provides copy/mailto
            only.
          </p>
        </>
      )}
      <label
        htmlFor={`outreach-${message.message_id}`}
        className={`text-xs font-semibold ${isEmail ? "mt-3 block" : ""}`}
      >
        Editable message
      </label>
      <Textarea
        id={`outreach-${message.message_id}`}
        aria-label="Outreach message"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setConfirming(false);
          setActionError(null);
        }}
        rows={10}
        className="mt-2 bg-background text-sm leading-relaxed"
        disabled={locked || busy}
      />
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{text.length} characters</span>
        <span>
          {dirty
            ? "Unsaved edits · earlier approval is invalid for this text"
            : "Composer matches the saved draft"}
        </span>
      </div>
      {!locked && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void run(() => onSaveDraft(text, isEmail ? subject : undefined))}
            disabled={!dirty || !text.trim() || busy}
          >
            Save draft
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void copyCurrentDraft()}
            disabled={!text.trim() || busy}
          >
            <Clipboard /> Copy draft
          </Button>
          {onRegenerate && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void run(onRegenerate)}
              disabled={busy}
              title="Creates a new draft; this draft and its edits remain in the conversation"
            >
              <RotateCcw /> Regenerate as new draft
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => setConfirming((value) => !value)}
            disabled={!text.trim() || busy}
          >
            <Check />
            {confirming ? "Hide approval" : "Review & approve"}
          </Button>
        </div>
      )}

      {confirming && !locked && (
        <section
          aria-label="Approve message confirmation"
          className="mt-4 rounded-xl border-2 border-primary/30 bg-background p-4"
        >
          <h4 className="flex items-center gap-2 text-sm font-bold">
            <ShieldAlert className="h-4 w-4" />
            Approve the exact recipient and message
          </h4>
          <dl className="mt-3 grid gap-3 text-xs">
            <div>
              <dt className="text-muted-foreground">Recipient</dt>
              <dd className="font-medium">{contact.full_name}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                {isEmail ? "Email destination" : "Public LinkedIn destination"}
              </dt>
              <dd className="break-all font-medium">
                {isEmail
                  ? contact.email || "Missing — handoff will remain blocked"
                  : contact.profile_url || "Missing — handoff will remain blocked"}
              </dd>
            </div>
          </dl>
          {isEmail && (
            <>
              <p className="mt-3 text-xs font-semibold">Exact subject</p>
              <p className="mt-1 rounded-xl bg-secondary/50 p-3 text-sm">{subject}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Prepared attachment:{" "}
                {message.attachment
                  ? `${message.attachment.filename} · CV v${message.attachment.version} · hash ${message.attachment.content_hash}`
                  : "none"}
                . Mailto cannot attach files; attach the approved CV yourself.
              </p>
            </>
          )}
          <p className="mt-3 text-xs font-semibold">Complete message</p>
          <pre className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-xl bg-secondary/50 p-3 font-sans text-sm leading-relaxed">
            {text}
          </pre>
          <p className="mt-3 rounded-xl bg-warning/15 p-3 text-xs leading-relaxed">
            Approval is not sending.{" "}
            {message.is_demo
              ? "DEMO: approval is stored only in this browser's memory."
              : "The backend must confirm this exact recipient and text before handoff."}
          </p>
          <Button
            size="sm"
            className="mt-3"
            onClick={() =>
              void run(async () => {
                if (isEmail) await onApprove(text, subject);
                else await onApprove(text);
                setConfirming(false);
              })
            }
            disabled={busy || (!dirty && message.status === "approved")}
          >
            <CheckCheck />
            {busy
              ? "Recording approval…"
              : message.is_demo
                ? "Approve message · DEMO"
                : "Approve message"}
          </Button>
        </section>
      )}

      {actionError && (
        <p role="alert" className="mt-3 rounded-xl bg-destructive/5 p-3 text-sm text-destructive">
          {actionError}
        </p>
      )}
      {message.status === "approved" && !dirty && (
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium">
          <CheckCheck className="h-4 w-4 text-success" />
          Exact recipient and payload approved{" "}
          {message.approved_at ? dateTime(message.approved_at) : ""}. Nothing has been sent.
        </p>
      )}

      <div className="mt-5 space-y-3 border-t pt-4">
        <div>
          <h4 className="text-sm font-bold">
            {isEmail ? "User-controlled email handoff" : "User-controlled LinkedIn handoff"}
          </h4>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {isEmail
              ? "Opens your default mail application with the approved recipient, subject and text. It does not attach files, send email, or mark anything delivered."
              : "Opens only the supplied public profile. It does not fill a form, automate LinkedIn, or mark the message sent."}
          </p>
        </div>
        {!handedOff && (
          <>
            <Button
              size="sm"
              onClick={() => void run(onHandoff)}
              disabled={Boolean(handoffBlock) || busy}
            >
              {busy ? <LoaderCircle /> : isEmail ? <Mail /> : <ExternalLink />}
              {busy ? "Recording handoff…" : isEmail ? "Open email draft" : "Open LinkedIn to send"}
            </Button>
            {handoffBlock && <p className="text-xs text-muted-foreground">{handoffBlock}</p>}
          </>
        )}
        {handedOff && (
          <div className="rounded-xl border bg-background p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-warning/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide">
                Handed off · not proof of sending
              </span>
              {message.is_demo && <SimBadge label="DEMO" />}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Handoff recorded {message.handed_off_at ? dateTime(message.handed_off_at) : ""}.
              {isEmail
                ? "Review the approved subject and text, attach the approved CV yourself, and send from your mail application."
                : "Review the approved text, copy it, and send it yourself on LinkedIn."}
            </p>
            {isEmail && <p className="mt-3 text-sm font-semibold">Subject: {message.subject}</p>}
            <pre className="mt-3 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl bg-secondary/50 p-3 font-sans text-sm leading-relaxed">
              {message.body}
            </pre>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => void copy()}>
                <Clipboard />
                Copy approved message
              </Button>
              {!isEmail && (
                <Button size="sm" variant="outline" asChild>
                  <a
                    href="https://www.linkedin.com/messaging/compose/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink /> Open LinkedIn composer
                  </a>
                </Button>
              )}
              <Button size="sm" variant="ghost" asChild>
                <a
                  href={isEmail ? buildMailtoUrl(message) : (message.recipient_url ?? undefined)}
                  target={isEmail ? undefined : "_blank"}
                  rel={isEmail ? undefined : "noreferrer"}
                >
                  {isEmail ? <Mail /> : <ExternalLink />}
                  {isEmail ? "Open email draft again" : "Open public profile again"}
                </a>
              </Button>
            </div>
            {copyState && (
              <p role="status" className="mt-2 text-xs text-muted-foreground">
                {copyState}
              </p>
            )}
          </div>
        )}
      </div>

      {message.status === "handed_off" && (
        <div className="mt-5 rounded-xl border bg-secondary/35 p-4">
          <h4 className="text-sm font-bold">Did you send this message?</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Only your explicit Yes records a candidate-confirmed, self-reported send.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void run(onConfirmSent)} disabled={busy}>
              {busy ? <LoaderCircle /> : <Check />}Yes, I sent it
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setNotYet(true);
                onNotYet();
              }}
              disabled={busy}
            >
              Not yet
            </Button>
          </div>
          {notYet && (
            <p role="status" className="mt-2 text-xs text-muted-foreground">
              No send was recorded. Return after you have actually sent it.
            </p>
          )}
        </div>
      )}

      {message.status === "candidate_confirmed_sent" && (
        <div className="mt-5 space-y-3 border-t pt-4">
          <div className="rounded-xl bg-success/15 p-3 text-sm">
            <p className="flex gap-2">
              <CheckCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <strong>Candidate confirmed sent</strong>{" "}
                {message.candidate_confirmed_sent_at
                  ? dateTime(message.candidate_confirmed_sent_at)
                  : ""}
                .
                <span className="block text-xs text-muted-foreground">
                  Self-reported by you · not provider-verified delivery.
                </span>
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-bold">Replies & outcomes</h4>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setReplyDate(new Date().toISOString().slice(0, 10));
                setReplyOpen((value) => !value);
              }}
            >
              <MessageSquareReply />
              Record a reply
            </Button>
          </div>
          {replyOpen && (
            <div className="rounded-xl border bg-background p-3">
              <label className="text-xs font-semibold" htmlFor={`reply-date-${message.draft_id}`}>
                Reply received date
              </label>
              <input
                id={`reply-date-${message.draft_id}`}
                aria-label="Reply received date"
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                className="mt-1 h-10 w-full rounded-md border bg-card px-3 text-sm"
                value={replyDate}
                onChange={(event) => setReplyDate(event.target.value)}
              />
              <label
                className="mt-3 block text-xs font-semibold"
                htmlFor={`reply-${message.draft_id}`}
              >
                Reply text or summary
              </label>
              <Textarea
                id={`reply-${message.draft_id}`}
                aria-label="Reply text or summary"
                className="mt-1 bg-card"
                rows={4}
                value={replyText}
                onChange={(event) => setReplyText(event.target.value)}
              />
              <label className="mt-3 block text-xs font-semibold">
                Optional outcome
                <select
                  aria-label="Reply outcome"
                  className="mt-1 h-10 w-full rounded-md border bg-card px-3 text-sm font-normal"
                  value={outcome}
                  onChange={(event) => setOutcome(event.target.value)}
                >
                  <option value="">No outcome selected</option>
                  <option value="positive">Positive conversation</option>
                  <option value="interview">Interview</option>
                  <option value="rejection">Rejection</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  onClick={() => void saveReply()}
                  disabled={!replyDate || !replyText.trim() || busy}
                >
                  Save candidate-recorded reply
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setReplyOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {message.responses.length > 0 && (
            <ul className="space-y-2">
              {message.responses.map((response) => (
                <li key={response.response_id} className="rounded-xl bg-secondary/50 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide">
                    <span>Candidate-recorded reply</span>
                    {response.simulated && <SimBadge label="DEMO" />}
                  </div>
                  <p className="mt-1">{response.content}</p>
                  {response.outcome && (
                    <p className="mt-1 text-xs">Outcome: {response.outcome.replaceAll("_", " ")}</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    Received {response.reply_date} · recorded {dateTime(response.created_at)} · not
                    provider-verified
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <details className="mt-5 rounded-xl bg-secondary/35 p-3">
        <summary className="flex cursor-pointer items-center gap-2 text-xs font-semibold">
          <History className="h-4 w-4" />
          Message history ({message.history.length})
        </summary>
        <ol className="mt-3 space-y-3 border-l border-border pl-4">
          {message.history.map((event) => (
            <li key={event.history_id} className="relative text-xs">
              <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-brand-spark" />
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{event.label}</p>
                {event.simulated && <SimBadge label="DEMO" />}
              </div>
              <p className="mt-1 text-muted-foreground">{event.detail}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {dateTime(event.created_at)} ·{" "}
                {event.actor === "candidate"
                  ? "candidate action"
                  : event.actor === "demo"
                    ? "ephemeral demo adapter"
                    : "backend response"}
              </p>
            </li>
          ))}
        </ol>
      </details>
    </Shell>
  );
}

export function CareerTimeline({
  events,
  compact = false,
}: {
  events: CareerTimelineEvent[];
  compact?: boolean;
}) {
  const visible = compact ? events.slice(-5).reverse() : [...events].reverse();
  return (
    <Shell title="Career timeline" icon={<History className="h-3.5 w-3.5" />}>
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Drafts, approvals, handoffs, candidate-confirmed sends and replies will appear here.
        </p>
      ) : (
        <ol className="space-y-4 border-l border-border pl-4">
          {visible.map((event) => (
            <li key={event.timeline_id} className="relative">
              <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-spark" />
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold">{event.title}</p>
                {event.simulated && <SimBadge label="DEMO" />}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{event.detail}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {dateTime(event.created_at)} ·{" "}
                {event.source === "candidate_reported"
                  ? "candidate-reported"
                  : event.source === "demo"
                    ? "ephemeral demo"
                    : "backend-confirmed"}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Shell>
  );
}