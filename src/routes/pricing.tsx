import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Logo, SimBadge } from "@/components/hnt/brand";
import { BillingSummary, PayPalSubscriptionButton, PricingPlans } from "@/components/hnt/billing";
import { api, ApiError, isLiveApi } from "@/lib/api";
import {
  BILLING_PLANS,
  type BillingPlan,
  type BillingStatus,
  type CheckoutIntent,
  type PlanKey,
} from "@/lib/billing";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Monthly plans — Hired Not Tired" },
      {
        name: "description",
        content:
          "Starter €4.99, Pro €9.99 and Premium €19.99 monthly in EUR. PayPal Sandbox subscriptions require backend verification.",
      },
      { property: "og:title", content: "Monthly plans — Hired Not Tired" },
      {
        property: "og:description",
        content:
          "Choose a configurable EUR monthly plan. Pro is recommended; PayPal Sandbox checkout never grants browser-only access.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PricingPage,
});

const PUBLIC_PAYPAL_CLIENT_ID = import.meta.env["VITE_PAYPAL_CLIENT_ID"] as string | undefined;

function PricingPage() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(isLiveApi);
  const [signedIn, setSignedIn] = useState(false);
  const [plans, setPlans] = useState<BillingPlan[]>(BILLING_PLANS);
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [intent, setIntent] = useState<CheckoutIntent | null>(null);
  const [busyPlan, setBusyPlan] = useState<PlanKey | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLiveApi) return;
    let active = true;
    const bootstrap = async () => {
      try {
        await api.linkedinAuthSession();
        const [planResponse, billingStatus] = await Promise.all([
          api.billingPlans(),
          api.billingStatus(),
        ]);
        if (!active) return;
        setSignedIn(true);
        setPlans(planResponse.plans);
        setStatus(billingStatus);
      } catch (reason) {
        if (!active) return;
        if (reason instanceof ApiError && reason.status === 401) {
          setSignedIn(false);
        } else {
          setError((reason as Error).message);
        }
      } finally {
        if (active) setChecking(false);
      }
    };
    void bootstrap();
    return () => {
      active = false;
    };
  }, []);

  const selectPlan = async (plan: BillingPlan) => {
    setError(null);
    if (!signedIn) {
      void navigate({ to: "/" });
      return;
    }
    setBusyPlan(plan.key);
    setIntent(null);
    try {
      setIntent(await api.createBillingCheckout(plan.key));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusyPlan(null);
    }
  };

  const verify = useCallback(
    async (subscriptionId: string) => {
      if (!intent) throw new Error("The pending checkout is unavailable. Start again.");
      const verified = await api.verifyBillingSubscription(intent.intent_id, subscriptionId);
      setStatus(verified);
      return verified;
    },
    [intent],
  );

  const cancel = async (subscriptionId: string) => {
    setCancelBusy(true);
    setError(null);
    try {
      setStatus(await api.cancelBillingSubscription(subscriptionId));
      setIntent(null);
    } catch (reason) {
      setError((reason as Error).message);
      throw reason;
    } finally {
      setCancelBusy(false);
    }
  };

  const checkoutAvailable = isLiveApi && Boolean(PUBLIC_PAYPAL_CLIENT_ID);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <nav aria-label="Pricing navigation" className="flex items-center gap-4 text-sm">
          <Link to="/" className="text-muted-foreground hover:text-foreground">
            Home
          </Link>
          <Link to="/privacy" className="text-muted-foreground hover:text-foreground">
            Privacy
          </Link>
          {signedIn && (
            <Link to="/coach" className="font-semibold">
              Back to coach
            </Link>
          )}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-5 pb-20 pt-8">
        <div className="mx-auto max-w-3xl text-center">
          <div className="flex justify-center">
            <SimBadge label="PAYPAL SANDBOX ONLY" />
          </div>
          <h1 className="mt-5 font-display text-4xl font-bold tracking-tight sm:text-5xl">
            Choose your monthly plan
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            Germany-first launch · EUR billing every month. No live payments or real charges are
            enabled.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            Prices are Starter €4.99, Pro €9.99 and Premium €19.99. Existing product capabilities
            are shown without invented limits.
          </p>
        </div>

        {!checkoutAvailable && (
          <div
            role="status"
            className="mx-auto mt-8 max-w-3xl rounded-xl border bg-card p-4 text-center"
          >
            <p className="font-semibold">Sandbox checkout not configured yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              A public PayPal client ID and the authenticated backend are required. No payment or
              paid status is simulated.
            </p>
          </div>
        )}
        {checking && (
          <p className="mt-8 text-center text-sm text-muted-foreground">
            Checking account and Sandbox configuration…
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="mx-auto mt-6 max-w-3xl rounded-xl bg-destructive/5 p-4 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        <div className="mt-10">
          <PricingPlans
            plans={plans}
            checkoutAvailable={checkoutAvailable}
            signedIn={signedIn}
            busyPlan={busyPlan}
            onSelect={(plan) => void selectPlan(plan)}
          />
        </div>

        {intent && PUBLIC_PAYPAL_CLIENT_ID && (
          <div className="mx-auto mt-8 max-w-2xl">
            <PayPalSubscriptionButton
              intent={intent}
              clientId={PUBLIC_PAYPAL_CLIENT_ID}
              onVerify={verify}
            />
          </div>
        )}

        {status && (
          <div className="mx-auto mt-10 max-w-3xl">
            <BillingSummary status={status} busy={cancelBusy} onCancel={cancel} />
          </div>
        )}
      </main>
    </div>
  );
}