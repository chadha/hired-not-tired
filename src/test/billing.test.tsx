import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BillingSummary, PayPalSubscriptionButton, PricingPlans } from "@/components/hnt/billing";
import {
  BILLING_PLANS,
  type BillingStatus,
  type CheckoutIntent,
  type PayPalButtonsOptions,
} from "@/lib/billing";

const intent: CheckoutIntent = {
  intent_id: "checkout-intent-1",
  plan_key: "pro",
  paypal_plan_id: "P-PRO",
  amount: "9.99",
  currency: "EUR",
  environment: "sandbox",
  expires_at: "2026-11-22T08:00:00Z",
};

function activeStatus(): BillingStatus {
  return {
    configured: true,
    environment: "sandbox",
    subscription_id: "I-SANDBOX",
    plan_key: "pro",
    status: "ACTIVE",
    entitlement_active: true,
    entitlement_plan: "pro",
    amount: "9.99",
    currency: "EUR",
    current_period_start: "2026-11-22T07:00:00Z",
    current_period_end: "2026-12-22T07:00:00Z",
    paid_through: "2026-12-22T07:00:00Z",
    cancellation_requested_at: null,
    cancelled_at: null,
    detail: "PayPal confirms this subscription is ACTIVE.",
  };
}

afterEach(() => {
  delete window.paypal;
  document.querySelectorAll("script[data-hnt-paypal]").forEach((script) => script.remove());
  vi.restoreAllMocks();
});

describe("Sandbox pricing", () => {
  it("shows exact monthly EUR prices and highlights Pro as most popular", () => {
    render(
      <PricingPlans
        plans={BILLING_PLANS}
        checkoutAvailable={false}
        signedIn={false}
        busyPlan={null}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Starter monthly plan").textContent).toContain("4,99");
    expect(screen.getByLabelText("Pro monthly plan").textContent).toContain("9,99");
    expect(screen.getByLabelText("Premium monthly plan").textContent).toContain("19,99");
    expect(BILLING_PLANS.find((plan) => plan.key === "pro")?.recommended).toBe(true);
    expect(BILLING_PLANS.filter((plan) => plan.recommended)).toHaveLength(1);
    expect(screen.getAllByText("EUR · one-month billing interval")).toHaveLength(3);
  });

  it("disables every checkout when Sandbox is unconfigured and never shows paid success", () => {
    render(
      <PricingPlans
        plans={BILLING_PLANS}
        checkoutAvailable={false}
        signedIn={true}
        busyPlan={null}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getAllByText("Sandbox checkout not configured yet")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Choose Starter" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Choose Pro" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Choose Premium" })).toBeDisabled();
    expect(screen.queryByText(/entitlement is active/)).not.toBeInTheDocument();
  });

  it("enables only server-configured plans and selects Pro", () => {
    const onSelect = vi.fn();
    const plans = BILLING_PLANS.map((plan) => ({
      ...plan,
      configured: plan.key === "pro",
      paypal_plan_id: plan.key === "pro" ? "P-PRO" : null,
    }));
    render(
      <PricingPlans
        plans={plans}
        checkoutAvailable={true}
        signedIn={true}
        busyPlan={null}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByRole("button", { name: "Choose Starter" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Choose Pro" }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: "pro", amount: "9.99" }));
  });

  it("offers sign-in for every plan without claiming checkout is configured", () => {
    const onSelect = vi.fn();
    render(
      <PricingPlans
        plans={BILLING_PLANS}
        checkoutAvailable={false}
        signedIn={false}
        allowSignIn
        busyPlan={null}
        onSelect={onSelect}
      />,
    );
    for (const plan of BILLING_PLANS) {
      fireEvent.click(screen.getByRole("button", { name: `Sign in for ${plan.name}` }));
      expect(onSelect).toHaveBeenCalledWith(plan);
    }
  });

  it("blocks additional checkout while server-confirmed subscription access remains", () => {
    const onSelect = vi.fn();
    render(
      <PricingPlans
        plans={BILLING_PLANS.map((plan) => ({ ...plan, configured: true }))}
        checkoutAvailable
        signedIn
        currentPlan="pro"
        busyPlan={null}
        onSelect={onSelect}
      />,
    );
    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("PayPal subscription button", () => {
  function mockButtons() {
    let options: PayPalButtonsOptions;
    window.paypal = {
      Buttons: (received) => {
        options = received;
        return {
          render: async (target) => {
            const approve = document.createElement("button");
            approve.textContent = "Mock Sandbox approval";
            approve.onclick = async () => {
              const subscriptionID = await options.createSubscription(
                {},
                {
                  subscription: { create: vi.fn().mockResolvedValue("I-SANDBOX") },
                },
              );
              await options.onApprove({ subscriptionID });
            };
            const cancel = document.createElement("button");
            cancel.textContent = "Mock Sandbox cancellation";
            cancel.onclick = () => options.onCancel();
            target.append(approve, cancel);
          },
        };
      },
    };
    return () => options;
  }

  it("binds plan and pending intent, then trusts only backend verification", async () => {
    const getOptions = mockButtons();
    const onVerify = vi.fn().mockResolvedValue(activeStatus());
    render(
      <PayPalSubscriptionButton
        intent={intent}
        clientId="sandbox-public-client"
        onVerify={onVerify}
      />,
    );
    const button = await screen.findByRole("button", { name: "Mock Sandbox approval" });
    const createSubscription = vi.fn().mockResolvedValue("I-SANDBOX");
    button.onclick = async () => {
      await getOptions().createSubscription({}, { subscription: { create: createSubscription } });
      await getOptions().onApprove({ subscriptionID: "I-SANDBOX" });
    };
    fireEvent.click(button);
    await waitFor(() => expect(onVerify).toHaveBeenCalledWith("I-SANDBOX"));
    expect(createSubscription).toHaveBeenCalledWith({
      plan_id: "P-PRO",
      custom_id: "checkout-intent-1",
    });
    expect(
      await screen.findByText("Backend verified: pro entitlement is active."),
    ).toBeInTheDocument();
  });

  it("shows cancellation without calling verification or granting access", async () => {
    mockButtons();
    const onVerify = vi.fn();
    render(
      <PayPalSubscriptionButton
        intent={intent}
        clientId="sandbox-public-client"
        onVerify={onVerify}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Mock Sandbox cancellation" }));
    expect(await screen.findByText(/PayPal approval was cancelled/)).toBeInTheDocument();
    expect(onVerify).not.toHaveBeenCalled();
    expect(screen.queryByText(/entitlement is active/)).not.toBeInTheDocument();
  });

  it("does not load or approve a live checkout", async () => {
    mockButtons();
    const paypal = window.paypal;
    if (!paypal) throw new Error("Test PayPal adapter missing");
    const buttons = vi.spyOn(paypal, "Buttons");
    const onVerify = vi.fn();
    render(
      <PayPalSubscriptionButton
        intent={{ ...intent, environment: "live" }}
        clientId="sandbox-public-client"
        onVerify={onVerify}
      />,
    );
    await screen.findByRole("alert");
    expect(buttons).not.toHaveBeenCalled();
    expect(onVerify).not.toHaveBeenCalled();
  });

  it("does not display active access while verification is pending or rejected", async () => {
    mockButtons();
    const onVerify = vi.fn().mockRejectedValue(new Error("Verification failed"));
    render(
      <PayPalSubscriptionButton
        intent={intent}
        clientId="sandbox-public-client"
        onVerify={onVerify}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Mock Sandbox approval" }));
    await screen.findByRole("alert");
    expect(onVerify).toHaveBeenCalledWith("I-SANDBOX");
    expect(screen.queryByText(/entitlement is active/)).not.toBeInTheDocument();
  });

  it("loads the SDK with subscription vault and EUR parameters", async () => {
    vi.resetModules();
    const { loadPayPalSdk } = await import("@/lib/billing");
    const pending = loadPayPalSdk("sandbox-public-client");
    const script = document.querySelector<HTMLScriptElement>("script[data-hnt-paypal]");
    expect(script?.src).toContain("client-id=sandbox-public-client");
    expect(script?.src).toContain("vault=true");
    expect(script?.src).toContain("intent=subscription");
    expect(script?.src).toContain("currency=EUR");
    window.paypal = { Buttons: vi.fn() };
    script?.dispatchEvent(new Event("load"));
    await expect(pending).resolves.toBe(window.paypal);
  });
});

describe("Subscription cancellation", () => {
  it("requires confirmation and explains paid-through access", async () => {
    const onCancel = vi.fn().mockResolvedValue(undefined);
    render(<BillingSummary status={activeStatus()} busy={false} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel renewal" }));
    expect(screen.getByText(/access continues|paid-through access/)).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm cancellation" }));
    await waitFor(() => expect(onCancel).toHaveBeenCalledWith("I-SANDBOX"));
  });
});