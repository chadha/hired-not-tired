import { useState, type FormEvent } from "react";
import { ExternalLink, LoaderCircle, Pencil, Search, ShieldQuestion, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SimBadge } from "@/components/hnt/brand";
import {
  validateContactInput,
  type ContactDiscoveryResult,
  type HiringContact,
  type ManualContactInput,
} from "@/lib/hiring-contacts";

const EMPTY: ManualContactInput = {
  full_name: "",
  current_title: "",
  company: "",
  profile_url: "",
  email: "",
  location: "",
  source_url: "",
  evidence_notes: "",
};

const inputClass =
  "mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

function ContactForm({
  contact,
  busy,
  onSave,
  onCancel,
}: {
  contact: HiringContact | null;
  busy: boolean;
  onSave: (input: ManualContactInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<ManualContactInput>(
    contact
      ? {
          full_name: contact.full_name,
          current_title: contact.current_title,
          company: contact.company,
          profile_url: contact.profile_url,
          email: contact.email ?? "",
          location: contact.location,
          source_url: contact.source_url,
          evidence_notes: contact.evidence_notes,
        }
      : EMPTY,
  );
  const [error, setError] = useState<string | null>(null);
  const update = (key: keyof ManualContactInput, value: string) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const valid = validateContactInput(form);
      await onSave(valid);
    } catch (caught) {
      setError((caught as Error).message);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="mt-3 space-y-3 rounded-xl border bg-background p-3"
      aria-label={contact ? "Edit potential hiring contact" : "Add potential hiring contact"}
    >
      <p className="text-xs leading-relaxed text-muted-foreground">
        Enter only information you already have. Nothing is searched, scraped, or invented.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold">
          Name <span className="text-destructive">*</span>
          <input
            aria-label="Contact name"
            className={inputClass}
            value={form.full_name}
            onChange={(event) => update("full_name", event.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="text-xs font-semibold">
          Current title
          <input
            aria-label="Current title"
            className={inputClass}
            value={form.current_title}
            onChange={(event) => update("current_title", event.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="text-xs font-semibold">
          Company
          <input
            aria-label="Contact company"
            className={inputClass}
            value={form.company}
            onChange={(event) => update("company", event.target.value)}
            autoComplete="organization"
          />
        </label>
        <label className="text-xs font-semibold">
          Location
          <input
            aria-label="Contact location"
            className={inputClass}
            value={form.location}
            onChange={(event) => update("location", event.target.value)}
            autoComplete="off"
          />
        </label>
      </div>
      <label className="block text-xs font-semibold">
        Public LinkedIn profile URL
        <input
          aria-label="Public LinkedIn profile URL"
          className={inputClass}
          value={form.profile_url}
          onChange={(event) => update("profile_url", event.target.value)}
          placeholder="https://www.linkedin.com/in/name"
          inputMode="url"
          autoComplete="off"
        />
        <span className="mt-1 block font-normal text-muted-foreground">
          Optional while adding; required before LinkedIn handoff.
        </span>
      </label>
      <label className="block text-xs font-semibold">
        Email address
        <input
          aria-label="Contact email address"
          type="email"
          className={inputClass}
          value={form.email ?? ""}
          onChange={(event) => update("email", event.target.value)}
          placeholder="name@company.example"
          autoComplete="off"
        />
        <span className="mt-1 block font-normal text-muted-foreground">
          Optional; enter only an address you already have. Required before email handoff.
        </span>
      </label>
      <label className="block text-xs font-semibold">
        Source URL
        <input
          aria-label="Contact source URL"
          className={inputClass}
          value={form.source_url}
          onChange={(event) => update("source_url", event.target.value)}
          placeholder="https://company.example/team"
          inputMode="url"
          autoComplete="off"
        />
      </label>
      <label className="block text-xs font-semibold">
        Evidence or notes
        <Textarea
          aria-label="Contact evidence or notes"
          className="mt-1 bg-background text-sm"
          rows={3}
          value={form.evidence_notes}
          onChange={(event) => update("evidence_notes", event.target.value)}
          placeholder="What you observed, and why this person may be relevant…"
        />
      </label>
      {error && (
        <p role="alert" className="rounded-xl bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={busy || !form.full_name.trim()}>
          {busy ? <LoaderCircle /> : <UserPlus />}
          {busy ? "Saving…" : contact ? "Save contact changes" : "Add potential contact"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ContactCard({ contact, onEdit }: { contact: HiringContact; onEdit: () => void }) {
  const providerResult = contact.evidence_status === "public_search_result";
  return (
    <article
      className="mt-3 rounded-xl border bg-background p-3"
      aria-label={`Potential hiring contact: ${contact.full_name}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
          Potential hiring contact
        </span>
        {contact.is_demo && <SimBadge label="DEMO · ephemeral" />}
        <span className="rounded-full bg-warning/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
          {contact.confidence} confidence ·{" "}
          {providerResult ? "public search result" : "candidate supplied"}
        </span>
      </div>
      <div className="mt-3 flex items-start justify-between gap-3">
        <div>
          <h5 className="font-bold">{contact.full_name}</h5>
          <p className="text-sm text-muted-foreground">
            {[
              contact.current_title || "Title not established by the evidence",
              contact.company || "Company not supplied",
            ].join(" · ")}
          </p>
          {contact.location && (
            <p className="mt-0.5 text-xs text-muted-foreground">{contact.location}</p>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={onEdit}>
          <Pencil />
          Edit
        </Button>
      </div>
      <div className="mt-3 space-y-2 rounded-xl bg-secondary/45 p-3 text-xs leading-relaxed">
        <p>
          <span className="font-semibold">Why relevant: </span>
          <span className="text-muted-foreground">{contact.relevance}</span>
        </p>
        <p className="text-muted-foreground">
          <span className="font-semibold text-foreground">Uncertainty: </span>
          {providerResult
            ? "A public search result is evidence to review, not proof of current role or vacancy ownership."
            : "Vacancy ownership and current role are candidate-supplied, not independently verified."}
        </p>
        <p className="whitespace-pre-wrap text-muted-foreground">
          <span className="font-semibold text-foreground">Evidence: </span>
          {contact.evidence_notes || "No evidence note supplied."}
        </p>
        {contact.source_url ? (
          <a
            href={contact.source_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-semibold underline underline-offset-2"
          >
            Open public source
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <p className="text-muted-foreground">No source URL supplied.</p>
        )}
      </div>
      <p className="mt-2 break-all text-xs text-muted-foreground">
        Email: {contact.email || "Not supplied — email handoff unavailable until you add it."}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {contact.profile_url ? (
          <Button size="sm" variant="ghost" className="px-0" asChild>
            <a href={contact.profile_url} target="_blank" rel="noreferrer">
              <ExternalLink />
              Open LinkedIn profile
            </a>
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            No LinkedIn URL · edit the contact before handoff.
          </p>
        )}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {providerResult ? "Evidence retrieved " : "Last candidate edit "}
        {new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
          new Date(contact.evidence_date ?? contact.updated_at),
        )}
        . Opening a profile never sends a message.
      </p>
    </article>
  );
}

export function HiringContactPanel({
  contact,
  busy = false,
  discovery,
  discoveryBusy = false,
  onAdd,
  onEdit,
  onDiscover,
  onSelectContact,
}: {
  contact?: HiringContact | null | undefined;
  busy?: boolean;
  discovery?: ContactDiscoveryResult | null | undefined;
  discoveryBusy?: boolean;
  onAdd: (input: ManualContactInput) => Promise<void>;
  onEdit: (input: ManualContactInput) => Promise<void>;
  onDiscover?: (() => Promise<void>) | undefined;
  onSelectContact?: ((contact: HiringContact) => void) | undefined;
}) {
  const [formMode, setFormMode] = useState<"add" | "edit" | null>(null);
  const save = async (input: ManualContactInput) => {
    if (formMode === "edit") await onEdit(input);
    else await onAdd(input);
    setFormMode(null);
  };
  const alternatives = (discovery?.contacts ?? []).filter(
    (candidate) => candidate.contact_id !== contact?.contact_id,
  );
  return (
    <section aria-label="Hiring contact" className="mt-4 rounded-2xl border bg-secondary/45 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <UserPlus className="h-4 w-4" />
          Hiring contact
        </h5>
        <span className="rounded-full bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
          {discoveryBusy
            ? "Searching public sources"
            : contact
              ? "Review contact"
              : discovery?.status === "found"
                ? "Review results"
                : discovery?.status === "no_reliable_match"
                  ? "No reliable match"
                  : discovery?.status === "not_configured"
                    ? "Discovery not configured"
                    : "Not searched"}
        </span>
      </div>
      {discoveryBusy && (
        <p role="status" className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="h-4 w-4" /> Researching public results using this job’s title and
          company…
        </p>
      )}
      {discovery && !discoveryBusy && (
        <div className="mt-3 rounded-xl border bg-background p-3 text-xs leading-relaxed">
          <p className="text-muted-foreground">{discovery.detail}</p>
          <Button size="sm" variant="ghost" className="mt-2 px-0" asChild>
            <a href={discovery.fallback_url} target="_blank" rel="noreferrer">
              <Search /> Open contextual LinkedIn people search
            </a>
          </Button>
        </div>
      )}
      {!contact && !formMode && !discoveryBusy && (
        <div className="mt-3 space-y-3">
          <p className="max-w-md text-sm text-muted-foreground">
            Research uses the selected job’s existing title and company. Only cited public results
            are shown; LinkedIn is never scraped.
          </p>
          <div className="flex flex-wrap gap-2">
            {onDiscover && (
              <Button size="sm" onClick={() => void onDiscover()} disabled={busy}>
                <Search /> Find hiring contact
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setFormMode("add")} disabled={busy}>
              <UserPlus />
              Find/add contact
            </Button>
          </div>
        </div>
      )}
      {contact && !formMode && <ContactCard contact={contact} onEdit={() => setFormMode("edit")} />}
      {alternatives.length > 0 && !formMode && (
        <div className="mt-3 rounded-xl border bg-background p-3">
          <h6 className="text-xs font-bold">Other evidenced possibilities</h6>
          <ul className="mt-2 space-y-2">
            {alternatives.map((candidate) => (
              <li
                key={candidate.contact_id}
                className="flex items-center justify-between gap-3 text-xs"
              >
                <span>
                  <strong>{candidate.full_name}</strong>
                  <span className="block text-muted-foreground">
                    {candidate.current_title || "Role needs review"} · {candidate.confidence}{" "}
                    confidence
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onSelectContact?.(candidate)}
                  disabled={busy}
                >
                  Select
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {formMode && (
        <ContactForm
          key={`${formMode}-${contact?.contact_id ?? "new"}`}
          contact={formMode === "edit" ? (contact ?? null) : null}
          busy={busy}
          onSave={save}
          onCancel={() => setFormMode(null)}
        />
      )}
      {!contact && !formMode && (
        <p className="mt-3 flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <ShieldQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Every contact remains “potential” until evidence explicitly establishes a vacancy
          relationship.
        </p>
      )}
    </section>
  );
}