import { useState } from "react";
import { CreditCard, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  AccountDeletionResult,
  AuthenticatedWorkspace,
  ConsentInput,
  ConsentNoticeType,
} from "@/lib/linkedin-auth";

const OPTIONAL_CONSENTS: Array<{
  type: Extract<ConsentNoticeType, "analytics" | "marketing" | "research">;
  label: string;
  description: string;
}> = [
  {
    type: "analytics",
    label: "Product analytics",
    description: "Help us understand product usage.",
  },
  {
    type: "marketing",
    label: "Marketing",
    description: "Receive career tips and product updates.",
  },
  {
    type: "research",
    label: "Research & model improvement",
    description: "Allow separately approved research and model-improvement use.",
  },
];

export function AccountSettings({
  workspace,
  busy,
  onConsents,
  onDelete,
}: {
  workspace: AuthenticatedWorkspace;
  busy: boolean;
  onConsents: (input: ConsentInput[]) => Promise<void>;
  onDelete: () => Promise<AccountDeletionResult>;
}) {
  const [showDeletion, setShowDeletion] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const current = new Map(workspace.consents.map((consent) => [consent.notice_type, consent]));

  const changeConsent = async (notice_type: ConsentNoticeType, granted: boolean) => {
    setError(null);
    try {
      await onConsents([
        { notice_type, notice_version: workspace.consent_versions[notice_type], granted },
      ]);
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  const deleteAccount = async () => {
    setError(null);
    try {
      await onDelete();
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  return (
    <section
      aria-labelledby="account-settings-title"
      className="rounded-2xl border bg-card p-5 shadow-soft"
    >
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <h2 id="account-settings-title" className="font-bold">
            Account & privacy
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {workspace.identity.name ?? "LinkedIn account"} ·{" "}
            {workspace.identity.email ?? "No email claim provided"}
          </p>
        </div>
      </div>
      <div className="mt-4 rounded-xl bg-secondary/45 p-3">
        <Button variant="outline" size="sm" asChild>
          <a href="/pricing">
            <CreditCard /> Plans & billing
          </a>
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          View EUR monthly plans, PayPal Sandbox status and renewal cancellation.
        </p>
      </div>
      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        Service terms v{workspace.consent_versions.service_terms} and privacy v
        {workspace.consent_versions.privacy} are essential acknowledgements. Optional choices are
        separate.
      </p>
      <div className="mt-4 space-y-3">
        {OPTIONAL_CONSENTS.map((item) => (
          <label key={item.type} className="flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-primary"
              checked={current.get(item.type)?.granted ?? false}
              disabled={busy}
              onChange={(event) => void changeConsent(item.type, event.target.checked)}
            />
            <span>
              <span className="font-medium">{item.label}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{item.description}</span>
            </span>
          </label>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="mt-5 border-t pt-4">
        {!showDeletion ? (
          <Button
            type="button"
            variant="ghost"
            className="px-0 text-destructive"
            onClick={() => setShowDeletion(true)}
          >
            <Trash2 className="h-4 w-4" /> Close account
          </Button>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void deleteAccount();
            }}
            className="space-y-3"
          >
            <p className="text-xs leading-relaxed text-muted-foreground">
              This deletes your active profile and identity link and revokes sessions. Pseudonymized
              consent audits may be retained up to six years and backups up to 30 days; legal holds
              supersede deletion.
            </p>
            <label className="block text-xs font-medium">
              Type DELETE to confirm
              <input
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
              />
            </label>
            <div className="flex gap-2">
              <Button
                type="submit"
                variant="destructive"
                size="sm"
                disabled={busy || confirmation !== "DELETE"}
              >
                {busy ? "Closing…" : "Close and anonymize"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setShowDeletion(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}