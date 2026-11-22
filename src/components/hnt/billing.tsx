import { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SimBadge } from "@/components/hnt/brand";
import {
  formatEuro,
  loadPayPalSdk,
  type BillingPlan,
  type BillingStatus,
  type CheckoutIntent,
  type PlanKey,
} from "@/lib/billing";
import { cn } from "@/lib/utils";

export function PricingPlans({
  plans,
  checkoutAvailable,
  signedIn,
  busyPlan,
  onSelect,
  checking = false,
  allowSignIn = false,
  currentPlan = null,
}: {
  plans: BillingPlan[];
  checkoutAvailable: boolean;
  signedIn: boolean;
  busyPlan: PlanKey | null;
  onSelect: (plan: BillingPlan) => void;
  checking?: boolean;
  allowSignIn?: boolean;
  currentPlan?: string | null;
}) {
  return (
    <div className="grid items-stretch gap-6 md:grid-cols-3">
      {plans.map((plan) => {
        const available = checkoutAvailable && plan.configured;
        return (
          <article
            key={plan.key}
            aria-label={`${plan.name} monthly plan`}
            className={cn(
              "relative flex flex-col rounded-[20px] border bg-card p-6 shadow-soft",
              plan.recommended && "border-primary ring-2 ring-primary/15",
            )}
          >
            {plan.recommended && (
              <span className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">
                Most Popular
              </span>
            )}
            <h2 className="font-display text-2xl font-bold">{plan.name}</h2>
            <p className="mt-4 font-display text-4xl font-bold">
              {formatEuro(plan.amount)}
              <span className="ml-1 font-sans text-sm font-normal text-muted-foreground">
                / month
              </span>
            </p>
            <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              EUR · one-month billing interval
            </p>
            <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
              {plan.key === "starter"
                ? "A practical starting point for your next application."
                : plan.key === "pro"
                  ? "Our recommended choice for a focused job search."
                  : "A higher-priced option for your next career chapter."}
            </p>
            <ul className="mt-5 space-y-2 text-sm">
              {[
                "See where your experience fits each role",
                "Tailor your CV with facts you confirm",
                "Export PDF or DOCX when you are ready",
                "Review outreach before taking the next step",
              ].map((capability) => (
                <li key={capability} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{capability}</span>
                </li>
              ))}
            </ul>
            <p className="mb-6 mt-4 text-xs leading-relaxed text-muted-foreground">
              {plan.key === "premium"
                ? "Same current tools; no exclusive extras or higher limits."
                : "All current career tools included."}
            </p>
            <Button
              className="mt-auto w-full"
              variant={plan.recommended ? "default" : "outline"}
              disabled={
                checking ||
                busyPlan !== null ||
                Boolean(currentPlan) ||
                (signedIn ? !available : !allowSignIn)
              }
              onClick={() => onSelect(plan)}
            >
              {busyPlan === plan.key && <LoaderCircle />}
              {checking
                ? "Checking account…"
                : currentPlan
                  ? currentPlan === plan.key
                    ? "Current plan"
                    : "Plan change unavailable"
                  : busyPlan === plan.key
                    ? "Preparing Sandbox…"
                    : signedIn
                      ? `Choose ${plan.name}`
                      : allowSignIn
                        ? `Sign in for ${plan.name}`
                        : "Sandbox unavailable"}
            </Button>
            {!available && (
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Sandbox checkout not configured yet
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}

export function PayPalSubscriptionButton({
  intent,
  clientId,
  onVerify,
}: {
  intent: CheckoutIntent;
  clientId: string;
  onVerify: (subscriptionId: string) => Promise<BillingStatus>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "verifying" | "cancelled" | "error">(
    "loading",
  );
  const [message, setMessage] = useState("Loading PayPal Sandbox…");
  const [verifiedStatus, setVerifiedStatus] = useState<BillingStatus | null>(null);

  useEffect(() => {
    let active = true;
    const target = container.current;
    if (!target) return;
    if (intent.environment !== "sandbox") {
      setState("error");
      setMessage("Only PayPal Sandbox checkout is available. No payment was started.");
      return;
    }
    loadPayPalSdk(clientId)
      .then((paypal) => {
        if (!active || !container.current) return;
        setState("ready");
        setMessage("Approve in PayPal Sandbox. Approval alone does not unlock a plan.");
        const buttons = paypal.Buttons({
          style: { shape: "rect", color: "gold", label: "subscribe" },
          createSubscription: (_data, actions) =>
            actions.subscription.create({
              plan_id: intent.paypal_plan_id,
              custom_id: intent.intent_id,
            }),
          onApprove: async (data) => {
            if (!data.subscriptionID) {
              setState("error");
              setMessage("PayPal returned no subscription ID. No paid status was granted.");
              return;
            }
            setState("verifying");
            setMessage("Verifying the subscription with the backend…");
            try {
              const status = await onVerify(data.subscriptionID);
              if (!active) return;
              setVerifiedStatus(status);
              setState(status.entitlement_active ? "ready" : "verifying");
              setMessage(status.detail);
            } catch (error) {
              if (!active) return;
              setState("error");
              setMessage(`${(error as Error).message} No paid status was granted.`);
            }
          },
          onCancel: () => {
            if (!active) return;
            setState("cancelled");
            setMessage(
              "PayPal approval was cancelled. No subscription or paid status was created.",
            );
          },
          onError: () => {
            if (!active) return;
            setState("error");
            setMessage("PayPal could not complete approval. No paid status was granted.");
          },
        });
        target.replaceChildren();
        return buttons.render(target);
      })
      .catch((error: Error) => {
        if (!active) return;
        setState("error");
        setMessage(`${error.message} No paid status was granted.`);
      });
    return () => {
      active = false;
      target.replaceChildren();
    };
  }, [clientId, intent.environment, intent.intent_id, intent.paypal_plan_id, onVerify]);

  return (
    <section
      aria-label="PayPal Sandbox checkout"
      className="mt-6 rounded-[20px] border bg-card p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-bold">PayPal Sandbox subscription</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatEuro(intent.amount)} EUR monthly · server verification required
          </p>
        </div>
        <SimBadge label="SANDBOX · no real charge" />
      </div>
      <div
        ref={container}
        className="mt-5 min-h-12"
        aria-busy={state === "loading" || state === "verifying"}
      />
      {(state === "loading" || state === "verifying") && (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="h-4 w-4" /> {message}
        </p>
      )}
      {state !== "loading" && state !== "verifying" && (
        <p
          role={state === "error" ? "alert" : "status"}
          className="mt-3 text-sm text-muted-foreground"
        >
          {message}
        </p>
      )}
      {verifiedStatus?.entitlement_active && (
        <p className="mt-3 rounded-xl bg-success/15 p-3 text-sm font-semibold">
          Backend verified: {verifiedStatus.entitlement_plan} entitlement is active.
        </p>
      )}
    </section>
  );
}

export function BillingSummary({
  status,
  busy,
  onCancel,
}: {
  status: BillingStatus;
  busy: boolean;
  onCancel: (subscriptionId: string) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!status.subscription_id) return null;
  return (
    <section aria-label="Current subscription" className="mb-8 rounded-[20px] border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-bold">Current subscription</h2>
          <p className="mt-1 text-sm text-muted-foreground">{status.detail}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Plan: {status.plan_key ?? "Unknown"} · PayPal status: {status.status ?? "Unknown"}
          </p>
          {status.paid_through && (
            <p className="mt-1 text-xs text-muted-foreground">
              Confirmed paid through:{" "}
              {new Intl.DateTimeFormat("de-DE", { dateStyle: "long" }).format(
                new Date(status.paid_through),
              )}
            </p>
          )}
        </div>
        {status.status === "ACTIVE" && !status.cancellation_requested_at && (
          <Button variant="outline" size="sm" onClick={() => setConfirming(true)} disabled={busy}>
            Cancel renewal
          </Button>
        )}
      </div>
      {confirming && (
        <div className="mt-4 rounded-xl bg-secondary/45 p-4">
          <p className="text-sm">
            Request cancellation at PayPal. If PayPal confirms paid-through access, it remains
            available until that date.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => {
                setError(null);
                const subscriptionId = status.subscription_id;
                if (!subscriptionId) return;
                void onCancel(subscriptionId).catch((reason: Error) => setError(reason.message));
              }}
            >
              Confirm cancellation
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
              Keep subscription
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}