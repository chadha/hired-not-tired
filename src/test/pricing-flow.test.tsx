import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BILLING_PLANS,
  type BillingStatus,
  type PayPalButtonsOptions,
  type PlanKey,
} from "@/lib/billing";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  plans: vi.fn(),
  status: vi.fn(),
  checkout: vi.fn(),
  verify: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("@/lib/api", () => ({
  isLiveApi: true,
  ApiError: class extends Error {
    constructor(
      message: string,
      public status: number,
    ) {
      super(message);
    }
  },
  api: {
    linkedinAuthSession: mocks.session,
    billingPlans: mocks.plans,
    billingStatus: mocks.status,
    createBillingCheckout: mocks.checkout,
    verifyBillingSubscription: mocks.verify,
    cancelBillingSubscription: mocks.cancel,
  },
}));

const emptyStatus: BillingStatus = {
  configured: true,
  environment: "sandbox",
  subscription_id: null,
  plan_key: null,
  status: null,
  entitlement_active: false,
  entitlement_plan: null,
  amount: null,
  currency: null,
  current_period_start: null,
  current_period_end: null,
  paid_through: null,
  cancellation_requested_at: null,
  cancelled_at: null,
  detail: "No subscription.",
};

async function openPricing() {
  const { Route } = await import("@/routes/pricing");
  const component = Route.options.component;
  if (!component) throw new Error("Pricing component missing");
  const root = createRootRoute();
  const pricing = createRoute({ getParentRoute: () => root, path: "/pricing", component });
  const home = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => <div>Existing sign-in</div>,
  });
  const privacy = createRoute({
    getParentRoute: () => root,
    path: "/privacy",
    component: () => <div>Privacy</div>,
  });
  const coach = createRoute({
    getParentRoute: () => root,
    path: "/coach",
    component: () => <div>Coach</div>,
  });
  const router = createRouter({
    routeTree: root.addChildren([home, pricing, privacy, coach]),
    history: createMemoryHistory({ initialEntries: ["/pricing"] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_PAYPAL_CLIENT_ID", "test-sandbox-public-id");
  mocks.session.mockResolvedValue({ candidate_id: "test-candidate" });
  mocks.plans.mockResolvedValue({
    environment: "sandbox",
    plans: BILLING_PLANS.map((plan) => ({
      ...plan,
      configured: true,
      paypal_plan_id: `P-${plan.key}`,
    })),
  });
  mocks.status.mockResolvedValue(emptyStatus);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  delete window.paypal;
});

describe("Pricing route subscription handoffs", () => {
  it.each([
    ["starter", "4.99"],
    ["pro", "9.99"],
    ["premium", "19.99"],
  ] as const)(
    "binds %s to its exact Sandbox checkout and server verification",
    async (key: PlanKey, amount) => {
      mocks.checkout.mockResolvedValue({
        intent_id: `intent-${key}`,
        plan_key: key,
        paypal_plan_id: `P-${key}`,
        amount,
        currency: "EUR",
        environment: "sandbox",
        expires_at: "2026-12-01T00:00:00Z",
      });
      mocks.verify.mockResolvedValue({
        ...emptyStatus,
        subscription_id: `I-${key}`,
        plan_key: key,
        status: "ACTIVE",
        entitlement_active: true,
        entitlement_plan: key,
        amount,
        currency: "EUR",
      });
      let options: PayPalButtonsOptions | undefined;
      window.paypal = {
        Buttons: (received) => {
          options = received;
          return { render: async () => {} };
        },
      };
      await openPricing();
      const name = BILLING_PLANS.find((plan) => plan.key === key)?.name;
      const button = await screen.findByRole("button", { name: `Choose ${name}` });
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.click(button);
      await waitFor(() => expect(options).toBeDefined());
      expect(mocks.checkout).toHaveBeenCalledWith(key);
      expect(mocks.verify).not.toHaveBeenCalled();
      const create = vi.fn().mockResolvedValue(`I-${key}`);
      if (!options) throw new Error("PayPal buttons missing");
      await options.createSubscription({}, { subscription: { create } });
      expect(create).toHaveBeenCalledWith({ plan_id: `P-${key}`, custom_id: `intent-${key}` });
      const received = options;
      await act(async () => received.onApprove({ subscriptionID: `I-${key}` }));
      await waitFor(() => expect(mocks.verify).toHaveBeenCalledWith(`intent-${key}`, `I-${key}`));
      await screen.findByLabelText("Current subscription");
    },
  );

  it("sends signed-out candidates to existing sign-in, without creating checkout", async () => {
    const { ApiError } = await import("@/lib/api");
    mocks.session.mockRejectedValue(new ApiError("Sign in", 401));
    const router = await openPricing();
    const button = await screen.findByRole("button", { name: "Sign in for Pro" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(mocks.checkout).not.toHaveBeenCalled();
  });

  it("rejects mismatched checkout before PayPal starts", async () => {
    mocks.checkout.mockResolvedValue({ plan_key: "premium", environment: "sandbox" });
    const buttons = vi.fn();
    window.paypal = { Buttons: buttons };
    await openPricing();
    const button = await screen.findByRole("button", { name: "Choose Pro" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await screen.findByRole("alert");
    expect(buttons).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
  });
});