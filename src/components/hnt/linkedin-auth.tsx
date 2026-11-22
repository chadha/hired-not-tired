import { ArrowRight, Linkedin, LockKeyhole, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  canStartLinkedInSignIn,
  linkedInSignInBlockReason,
  type LinkedInAuthCapability,
} from "@/lib/linkedin-auth";

export function LinkedInSignInActions({
  capability,
  checking,
  authBusy,
  demoBusy,
  allowDemo,
  onLinkedIn,
  onDemo,
}: {
  capability: LinkedInAuthCapability;
  checking: boolean;
  authBusy: boolean;
  demoBusy: boolean;
  allowDemo: boolean;
  onLinkedIn: () => void;
  onDemo: () => void;
}) {
  const available = canStartLinkedInSignIn(capability);
  const reason = linkedInSignInBlockReason(capability);
  return (
    <div className="mt-8 max-w-xl">
      <Button
        size="lg"
        variant="outline"
        className="h-12 w-full rounded-xl border-primary/20 bg-primary px-6 text-base font-semibold text-primary-foreground shadow-soft hover:bg-primary/90 disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 sm:w-auto"
        disabled={checking || authBusy || !available}
        onClick={onLinkedIn}
        aria-describedby={!available ? "linkedin-auth-status" : undefined}
      >
        <Linkedin className="h-5 w-5" aria-hidden="true" />
        {checking
          ? "Checking LinkedIn sign-in…"
          : authBusy
            ? "Opening secure sign-in…"
            : "Continue with LinkedIn"}
      </Button>
      {!available && !checking && (
        <div
          id="linkedin-auth-status"
          role="status"
          className="mt-4 rounded-xl border bg-background p-4 text-foreground"
        >
          <p className="flex items-start gap-2 text-sm font-medium">
            <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            Integration access required — LinkedIn sign-in is unavailable.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{reason}</p>
          <details className="mt-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground">
              Required configuration or backend contracts
            </summary>
            <ul className="mt-2 space-y-1 font-mono">
              {capability.missing.map((endpoint) => (
                <li key={endpoint}>{endpoint}</li>
              ))}
            </ul>
          </details>
        </div>
      )}
      {allowDemo && (
        <div className="mt-5 border-t pt-5">
          <Button
            size="lg"
            variant="spark"
            className="h-12 rounded-xl px-6"
            disabled={demoBusy}
            onClick={onDemo}
          >
            {demoBusy ? "Loading fictional demo…" : "Explore the local demo"}
            <ArrowRight className="h-4 w-4" />
          </Button>
          <p className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            DEMO · fictional data · no account or LinkedIn login · ephemeral browser memory
          </p>
        </div>
      )}
    </div>
  );
}