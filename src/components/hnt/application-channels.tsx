import { useState } from "react";
import { BriefcaseBusiness, Check, CheckCheck, ExternalLink, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  canonicalChannelPayload,
  getChannelAction,
  getChannelActionBlockReason,
  getPackagePrerequisitesBlockReason,
  type ApplicationChannel,
  type ApplicationPackage,
} from "@/lib/application-package";

const dateTime = (value: string) =>
  new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );

function ChannelCard({
  applicationPackage,
  channel,
  busy,
  onApprove,
  onHandoff,
  onSubmit,
  onReportSubmitted,
}: {
  applicationPackage: ApplicationPackage;
  channel: ApplicationChannel;
  busy: boolean;
  onApprove: (channel: ApplicationChannel) => Promise<void>;
  onHandoff: (channel: ApplicationChannel) => Promise<void>;
  onSubmit: (channel: ApplicationChannel) => Promise<void>;
  onReportSubmitted: (channel: ApplicationChannel) => Promise<void>;
}) {
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = getChannelAction(applicationPackage, channel.id);
  const block = getChannelActionBlockReason(applicationPackage, channel);
  const prerequisite = getPackagePrerequisitesBlockReason(applicationPackage);
  const run = async (callback: () => Promise<void>) => {
    setError(null);
    try {
      await callback();
      setReviewing(false);
    } catch (caught) {
      setError((caught as Error).message);
    }
  };
  const handedOff = action.state === "handed_off" || action.state === "candidate_reported";
  return (
    <article className="rounded-xl border bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-bold">
          <BriefcaseBusiness className="h-4 w-4" /> {channel.title}
        </h4>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
          {action.state === "draft"
            ? channel.state.replaceAll("_", " ")
            : action.state.replaceAll("_", " ")}
        </span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{channel.capability}</p>
      {channel.blocker && <p className="mt-2 text-xs leading-relaxed">{channel.blocker}</p>}
      {channel.destination_url && (
        <p className="mt-2 break-all text-[11px] text-muted-foreground">
          Official destination: {channel.destination_url}
        </p>
      )}

      {channel.action_label && action.state === "draft" && (
        <Button
          size="sm"
          variant="outline"
          className="mt-3"
          disabled={busy}
          onClick={() => setReviewing((value) => !value)}
        >
          <Check /> Review & approve this path
        </Button>
      )}
      {reviewing && action.state === "draft" && (
        <section
          aria-label={`Approve ${channel.title}`}
          className="mt-3 rounded-xl border-2 border-primary/30 p-3"
        >
          <h5 className="text-sm font-bold">Approve exact application package</h5>
          <dl className="mt-2 space-y-1 text-xs">
            <div>
              <dt className="inline text-muted-foreground">Channel: </dt>
              <dd className="inline font-medium">{channel.title}</dd>
            </div>
            <div>
              <dt className="inline text-muted-foreground">Destination: </dt>
              <dd className="inline break-all font-medium">{channel.destination_url}</dd>
            </div>
            <div>
              <dt className="inline text-muted-foreground">CV attachment: </dt>
              <dd className="inline font-medium">
                version{" "}
                {action.approval?.cv_version ??
                  applicationPackage.versions.find(
                    (item) => item.artifact_id === applicationPackage.current_artifact_id,
                  )?.version}
              </dd>
            </div>
            <div>
              <dt className="inline text-muted-foreground">Answers: </dt>
              <dd className="inline font-medium">{applicationPackage.answers.length} reviewed</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">
            Approval binds this exact channel, destination, answers, attachment and CV content. Any
            edit invalidates it. Approval itself does not submit anything.
          </p>
          {prerequisite && <p className="mt-2 text-xs text-destructive">{prerequisite}</p>}
          <Button
            size="sm"
            className="mt-3"
            disabled={busy || Boolean(prerequisite)}
            onClick={() => void run(() => onApprove(channel))}
          >
            <CheckCheck /> Approve exact package
          </Button>
        </section>
      )}

      {action.state === "approved" && (
        <div className="mt-3">
          <p className="text-xs text-success">
            Exact package approved {action.approval ? dateTime(action.approval.approved_at) : ""}.
            No submission recorded.
          </p>
          <Button
            size="sm"
            className="mt-2"
            disabled={busy || Boolean(block)}
            onClick={() =>
              void run(() => (channel.direct_submit ? onSubmit(channel) : onHandoff(channel)))
            }
          >
            {busy ? <LoaderCircle /> : <ExternalLink />}
            {channel.action_label}
          </Button>
        </div>
      )}
      {action.state === "approved" && block && (
        <p className="mt-2 text-xs text-muted-foreground">{block}</p>
      )}
      {action.state === "draft" && !reviewing && prerequisite && (
        <p className="mt-2 text-xs text-muted-foreground">{prerequisite}</p>
      )}

      {action.state === "handed_off" && (
        <div className="mt-3 rounded-xl bg-secondary/35 p-3">
          <p className="text-xs font-semibold">Handed off · not submitted</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Opened {action.handed_off_at ? dateTime(action.handed_off_at) : ""}. Complete CAPTCHA,
            identity checks, declarations and submission yourself on the official site.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            disabled={busy}
            onClick={() => void run(() => onReportSubmitted(channel))}
          >
            I submitted it myself
          </Button>
        </div>
      )}
      {action.state === "candidate_reported" && (
        <p className="mt-3 rounded-xl bg-warning/15 p-3 text-xs">
          <strong>Candidate-reported submission</strong> · not provider-confirmed ·{" "}
          {action.candidate_reported_at ? dateTime(action.candidate_reported_at) : ""}
        </p>
      )}
      {action.state === "provider_confirmed" && (
        <p className="mt-3 rounded-xl bg-success/15 p-3 text-xs">
          <strong>Provider-confirmed submission</strong> · receipt {action.provider_receipt_id}
        </p>
      )}
      {handedOff && action.approval && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer font-semibold">Approved payload receipt</summary>
          <p className="mt-1 break-all text-muted-foreground">
            SHA-256: {action.approval.payload_hash}
          </p>
          <p className="mt-1 text-muted-foreground">Idempotency key: {action.idempotency_key}</p>
        </details>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </article>
  );
}

export function ApplicationChannels({
  applicationPackage,
  channels,
  busy,
  onApprove,
  onHandoff,
  onSubmit,
  onReportSubmitted,
}: {
  applicationPackage: ApplicationPackage;
  channels: ApplicationChannel[];
  busy: boolean;
  onApprove: (channel: ApplicationChannel) => Promise<void>;
  onHandoff: (channel: ApplicationChannel) => Promise<void>;
  onSubmit: (channel: ApplicationChannel) => Promise<void>;
  onReportSubmitted: (channel: ApplicationChannel) => Promise<void>;
}) {
  return (
    <div className="mt-5 border-t pt-4">
      <h4 className="text-sm font-bold">Choose an application path</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        Direct submission appears only when backend capability metadata confirms every prerequisite.
        Otherwise the action is explicitly a handoff.
      </p>
      <div className="mt-3 grid gap-3">
        {channels
          .filter((channel) => channel.id !== "hiring_team")
          .map((channel) => (
            <ChannelCard
              key={`${channel.id}-${getChannelAction(applicationPackage, channel.id).state}-${canonicalChannelPayload(applicationPackage, channel).length}`}
              applicationPackage={applicationPackage}
              channel={channel}
              busy={busy}
              onApprove={onApprove}
              onHandoff={onHandoff}
              onSubmit={onSubmit}
              onReportSubmitted={onReportSubmitted}
            />
          ))}
      </div>
    </div>
  );
}