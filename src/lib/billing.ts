export type PlanKey = "starter" | "pro" | "premium";

export type BillingPlan = {
  key: PlanKey;
  name: string;
  amount: "4.99" | "9.99" | "19.99";
  currency: "EUR";
  interval_unit: "MONTH";
  interval_count: 1;
  recommended: boolean;
  configured: boolean;
  paypal_plan_id: string | null;
};

export type CheckoutIntent = {
  intent_id: string;
  plan_key: PlanKey;
  paypal_plan_id: string;
  amount: string;
  currency: "EUR";
  environment: "sandbox" | "live";
  expires_at: string;
};

export type BillingStatus = {
  configured: boolean;
  environment: "sandbox" | "live";
  subscription_id: string | null;
  plan_key: string | null;
  status: string | null;
  entitlement_active: boolean;
  entitlement_plan: string | null;
  amount: string | null;
  currency: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  paid_through: string | null;
  cancellation_requested_at: string | null;
  cancelled_at: string | null;
  detail: string;
};

export const BILLING_PLANS: BillingPlan[] = [
  {
    key: "starter",
    name: "Starter",
    amount: "4.99",
    currency: "EUR",
    interval_unit: "MONTH",
    interval_count: 1,
    recommended: false,
    configured: false,
    paypal_plan_id: null,
  },
  {
    key: "pro",
    name: "Pro",
    amount: "9.99",
    currency: "EUR",
    interval_unit: "MONTH",
    interval_count: 1,
    recommended: true,
    configured: false,
    paypal_plan_id: null,
  },
  {
    key: "premium",
    name: "Premium",
    amount: "19.99",
    currency: "EUR",
    interval_unit: "MONTH",
    interval_count: 1,
    recommended: false,
    configured: false,
    paypal_plan_id: null,
  },
];

export function formatEuro(amount: string): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(
    Number(amount),
  );
}

export type PayPalSubscriptionData = { subscriptionID?: string };
export type PayPalButtonActions = {
  subscription: {
    create: (input: { plan_id: string; custom_id: string }) => Promise<string>;
  };
};
export type PayPalButtonsOptions = {
  style?: { shape?: string; color?: string; label?: string };
  createSubscription: (data: unknown, actions: PayPalButtonActions) => Promise<string>;
  onApprove: (data: PayPalSubscriptionData) => Promise<void>;
  onCancel: () => void;
  onError: (error: Error) => void;
};
export type PayPalNamespace = {
  Buttons: (options: PayPalButtonsOptions) => { render: (target: HTMLElement) => Promise<void> };
};

declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

let paypalLoader: Promise<PayPalNamespace> | null = null;

export function loadPayPalSdk(clientId: string): Promise<PayPalNamespace> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("PayPal checkout is available only in the browser."));
  }
  if (window.paypal) return Promise.resolve(window.paypal);
  if (paypalLoader) return paypalLoader;
  paypalLoader = new Promise<PayPalNamespace>((resolve, reject) => {
    const script = document.createElement("script");
    const query = new URLSearchParams({
      "client-id": clientId,
      vault: "true",
      intent: "subscription",
      currency: "EUR",
      components: "buttons",
    });
    script.src = `https://www.paypal.com/sdk/js?${query.toString()}`;
    script.async = true;
    script.dataset["hntPaypal"] = "sandbox-subscriptions";
    script.onload = () => {
      if (window.paypal) resolve(window.paypal);
      else reject(new Error("PayPal loaded without its subscription button library."));
    };
    script.onerror = () => reject(new Error("The PayPal SDK could not be loaded."));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    paypalLoader = null;
    throw error;
  });
  return paypalLoader;
}