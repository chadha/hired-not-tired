import { useState } from "react";
import { AlertTriangle, Check, FilePlus2, Pencil, Plus, ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  getCurrentCoverLetter,
  suggestApplicationAnswer,
  type ApplicationAnswer,
  type ApplicationPackage,
  type MasterProfileRevisionInput,
  type ProfileFact,
} from "@/lib/application-package";

export type AnswerInput = {
  answer_id?: string;
  question: string;
  proposed_answer: string;
  confirmed: boolean;
};

const dateTime = (value: string) =>
  new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );

type ReviseMaster = (input: MasterProfileRevisionInput) => Promise<boolean>;

function MasterFactRow({
  fact,
  busy,
  unavailable,
  onRevise,
}: {
  fact: ProfileFact;
  busy: boolean;
  unavailable: boolean;
  onRevise: ReviseMaster;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(fact.value);
  const dirty = text !== fact.value;
  return (
    <li className="rounded-xl bg-secondary/35 p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{fact.label}</span>
        <span className={fact.confirmed_at ? "text-success" : "text-muted-foreground"}>
          {fact.confirmed_at ? "Candidate confirmed" : "Needs confirmation"} · v{fact.version}
        </span>
      </div>
      {editing ? (
        <div className="mt-2">
          <Textarea
            aria-label={`Edit ${fact.label}`}
            rows={fact.fact_type === "career_history" ? 8 : 3}
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={busy}
            className="bg-background"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Save only facts you can confirm. Blank optional values remain unknown; this creates a
            new master and tailored-CV revision without overwriting history.
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              disabled={busy || (!dirty && Boolean(fact.confirmed_at))}
              onClick={() =>
                void onRevise({ fact_id: fact.fact_id, value: text }).then((saved) => {
                  if (saved) setEditing(false);
                })
              }
            >
              <Check /> Confirm new revision
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap text-muted-foreground">
            {fact.value || "Unknown / not supplied"}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Source: {fact.source_reference} · confidence {Math.round(fact.confidence * 100)}%
            {fact.confirmed_at ? ` · confirmed ${dateTime(fact.confirmed_at)}` : " · not confirmed"}
          </p>
          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            aria-label={`Edit ${fact.label}`}
            disabled={busy || unavailable}
            onClick={() => {
              setText(fact.value);
              setEditing(true);
            }}
          >
            <Pencil /> Edit / confirm fact
          </Button>
        </>
      )}
    </li>
  );
}

export function ConfirmedFacts({
  applicationPackage,
  busy,
  onRevise,
}: {
  applicationPackage: ApplicationPackage;
  busy: boolean;
  onRevise: (input: MasterProfileRevisionInput) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const master = applicationPackage.master_profile;
  const conflicts = (master.conflicts ?? []).filter((conflict) => conflict.status === "open");
  const unconfirmed = master.facts.filter((fact) => !fact.confirmed_at).length;
  const history = applicationPackage.master_profile_history ?? [master];
  const unavailable = !applicationPackage.is_demo;
  const run: ReviseMaster = async (input) => {
    setError(null);
    try {
      await onRevise(input);
      return true;
    } catch (caught) {
      setError((caught as Error).message);
      return false;
    }
  };
  return (
    <details className="mt-3 rounded-xl border bg-background p-3">
      <summary className="cursor-pointer text-sm font-semibold">
        Master profile facts, provenance & revisions
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">
        Master profile version {master.profile_version} · captured {dateTime(master.captured_at)}.
        Every explicit edit creates an immutable revision and a new job-specific CV. Earlier
        packages and artifacts keep their original source version.
      </p>
      {unavailable && (
        <p className="mt-3 rounded-xl bg-secondary/45 p-3 text-xs text-muted-foreground">
          Live master revision is unavailable: PATCH /api/v1/candidates/{"{candidate_id}"}
          /profile/facts/{"{fact_id}"} and POST /api/v1/application-packages/{"{package_id}"}
          /cv-artifacts are absent from the inspected FastAPI backend. No local demo result will be
          substituted.
        </p>
      )}
      {conflicts.map((conflict) => {
        const fact = master.facts.find((item) => item.fact_id === conflict.fact_id);
        return (
          <section
            key={conflict.conflict_id}
            aria-label={`Resolve conflict for ${fact?.label ?? conflict.fact_id}`}
            className="mt-3 rounded-xl border-2 border-warning/40 bg-secondary/25 p-3 text-xs"
          >
            <p className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4" /> Candidate choice required
            </p>
            <p className="mt-2 text-muted-foreground">
              Uploaded source {conflict.source_reference} contains “{conflict.source_excerpt}”. It
              has not overwritten the current {fact?.label.toLowerCase() ?? "profile fact"}.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy || unavailable}
                onClick={() => void run({ conflict_id: conflict.conflict_id, use_proposed: false })}
              >
                Keep {conflict.current_value}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || unavailable}
                onClick={() => void run({ conflict_id: conflict.conflict_id, use_proposed: true })}
              >
                Use {conflict.proposed_value}
              </Button>
            </div>
          </section>
        );
      })}
      {unconfirmed > 0 && !conflicts.length && (
        <Button
          size="sm"
          variant="outline"
          className="mt-3"
          disabled={busy || unavailable}
          onClick={() => void run({ confirm_all: true })}
        >
          <Check /> Confirm all current facts ({unconfirmed})
        </Button>
      )}
      <ul className="mt-3 space-y-2">
        {master.facts.map((fact) => (
          <MasterFactRow
            key={`${fact.fact_id}-${fact.version}`}
            fact={fact}
            busy={busy}
            unavailable={unavailable}
            onRevise={run}
          />
        ))}
      </ul>
      <details className="mt-3 rounded-xl bg-secondary/25 p-3">
        <summary className="cursor-pointer text-xs font-semibold">
          Immutable master revision history ({history.length})
        </summary>
        <ol className="mt-2 space-y-2 text-xs text-muted-foreground">
          {[...history].reverse().map((revision) => (
            <li key={`${revision.profile_version}-${revision.captured_at}`}>
              Master v{revision.profile_version}
              {revision.revision_of
                ? ` · revises v${revision.revision_of}`
                : " · original snapshot"}
              · {dateTime(revision.captured_at)} · {revision.source.kind.replaceAll("_", " ")}
            </li>
          ))}
        </ol>
      </details>
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-destructive/5 p-3 text-xs text-destructive">
          {error}
        </p>
      )}
    </details>
  );
}

function AnswerEditor({
  answer,
  applicationPackage,
  busy,
  onSave,
}: {
  answer: ApplicationAnswer;
  applicationPackage: ApplicationPackage;
  busy: boolean;
  onSave: (input: AnswerInput) => Promise<void>;
}) {
  const [text, setText] = useState(answer.proposed_answer);
  const [error, setError] = useState<string | null>(null);
  const dirty = text !== answer.proposed_answer;
  const run = async (confirmed: boolean) => {
    setError(null);
    try {
      await onSave({
        answer_id: answer.answer_id,
        question: answer.question,
        proposed_answer: text,
        confirmed,
      });
    } catch (caught) {
      setError((caught as Error).message);
    }
  };
  return (
    <li className="rounded-xl border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-semibold">{answer.question}</p>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase">
          {answer.status === "candidate_confirmed" ? "Reviewed" : "Needs input"} · v{answer.version}
        </span>
      </div>
      {answer.sensitive && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
          <ShieldQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Candidate-only declaration. No answer is inferred from your profile; you may leave it for
          the official form.
        </p>
      )}
      <Textarea
        aria-label={`Answer: ${answer.question}`}
        value={text}
        rows={4}
        className="mt-3 bg-background text-sm"
        placeholder={
          answer.sensitive
            ? "Complete this yourself or leave it for the official form"
            : "Write an answer grounded in your confirmed facts"
        }
        onChange={(event) => setText(event.target.value)}
        disabled={busy}
      />
      <p className="mt-1 text-[11px] text-muted-foreground">
        {answer.evidence_fact_ids.length
          ? `Evidence: ${answer.evidence_fact_ids.join(", ")}`
          : "No profile evidence asserted. Your edit remains candidate-supplied."}
        {dirty ? " · Unsaved change invalidates previous package approvals." : ""}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {!answer.sensitive && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => setText(suggestApplicationAnswer(applicationPackage, answer.answer_id))}
          >
            Use confirmed evidence
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !dirty}
          onClick={() => void run(false)}
        >
          Save draft answer
        </Button>
        <Button
          size="sm"
          disabled={busy || (!dirty && answer.status === "candidate_confirmed")}
          onClick={() => void run(true)}
        >
          <Check />{" "}
          {answer.sensitive && !text.trim() ? "Leave for official form" : "Confirm exact answer"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}

export function ApplicationAnswers({
  applicationPackage,
  busy,
  onSave,
}: {
  applicationPackage: ApplicationPackage;
  busy: boolean;
  onSave: (input: AnswerInput) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    setError(null);
    try {
      await onSave({ question, proposed_answer: answer, confirmed: false });
      setQuestion("");
      setAnswer("");
      setAdding(false);
    } catch (caught) {
      setError((caught as Error).message);
    }
  };
  return (
    <details className="mt-4 rounded-xl border bg-background p-3">
      <summary className="cursor-pointer text-sm font-semibold">
        Application answers ({applicationPackage.answers.length})
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">
        Only questions supplied by the job or by you appear here. Sensitive declarations are never
        auto-answered. Every edit creates a new answer version and invalidates channel approval.
      </p>
      {applicationPackage.answers.length > 0 && (
        <ul className="mt-3 space-y-3">
          {applicationPackage.answers.map((item) => (
            <AnswerEditor
              key={`${item.answer_id}-${item.version}`}
              answer={item}
              applicationPackage={applicationPackage}
              busy={busy}
              onSave={onSave}
            />
          ))}
        </ul>
      )}
      {!adding ? (
        <Button size="sm" variant="outline" className="mt-3" onClick={() => setAdding(true)}>
          <Plus /> Add a question from the application
        </Button>
      ) : (
        <div className="mt-3 rounded-xl bg-secondary/35 p-3">
          <label className="text-xs font-semibold">
            Exact application question
            <Input
              className="mt-1 bg-background"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
            />
          </label>
          <label className="mt-3 block text-xs font-semibold">
            Your answer (optional draft)
            <Textarea
              className="mt-1 bg-background"
              rows={4}
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
            />
          </label>
          <div className="mt-3 flex gap-2">
            <Button size="sm" disabled={!question.trim() || busy} onClick={() => void add()}>
              Add answer
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </details>
  );
}

export function CoverLetterEditor({
  applicationPackage,
  busy,
  onCreate,
  onSave,
  onApprove,
}: {
  applicationPackage: ApplicationPackage;
  busy: boolean;
  onCreate: () => Promise<void>;
  onSave: (content: string) => Promise<void>;
  onApprove: () => Promise<void>;
}) {
  const artifact = getCurrentCoverLetter(applicationPackage);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError((caught as Error).message);
    }
  };
  return (
    <details className="mt-4 rounded-xl border bg-background p-3">
      <summary className="cursor-pointer text-sm font-semibold">Optional cover letter</summary>
      {!artifact ? (
        <div className="mt-3">
          <p className="text-xs text-muted-foreground">
            Create a separate, editable job-specific draft using only confirmed profile facts.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            disabled={busy}
            onClick={() => void run(onCreate)}
          >
            <FilePlus2 /> Create cover letter
          </Button>
        </div>
      ) : (
        <CoverLetterFields
          key={`${artifact.artifact_id}-${artifact.version}`}
          content={artifact.content}
          version={artifact.version}
          approved={Boolean(artifact.approval)}
          busy={busy}
          onSave={onSave}
          onApprove={onApprove}
        />
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </details>
  );
}

function CoverLetterFields({
  content,
  version,
  approved,
  busy,
  onSave,
  onApprove,
}: {
  content: string;
  version: number;
  approved: boolean;
  busy: boolean;
  onSave: (content: string) => Promise<void>;
  onApprove: () => Promise<void>;
}) {
  const [text, setText] = useState(content);
  const [error, setError] = useState<string | null>(null);
  const dirty = text !== content;
  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError((caught as Error).message);
    }
  };
  return (
    <div className="mt-3">
      <p className="text-xs text-muted-foreground">
        Version {version} · {approved && !dirty ? "exact version approved" : "approval required"}.
        Cover-letter approval is independent of CV approval.
      </p>
      <Textarea
        aria-label="Cover letter content"
        rows={10}
        className="mt-2 bg-background text-sm"
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={busy}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!dirty || !text.trim() || busy}
          onClick={() => void run(() => onSave(text))}
        >
          Save as version {version + 1}
        </Button>
        <Button size="sm" disabled={dirty || approved || busy} onClick={() => void run(onApprove)}>
          <Check /> Approve exact cover letter
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}