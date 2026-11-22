import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { formatEuro, type BillingPlan } from "@/lib/billing";
import { cn } from "@/lib/utils";

const comparisons = [
  "Explore your strengths in one conversation",
  "Review job matches, strengths and gaps",
  "Tailor a CV using your confirmed experience",
  "Keep master and job-specific CV versions separate",
  "Download your CV as PDF or DOCX",
  "Review and approve each application handoff",
  "Prepare editable LinkedIn and email outreach",
];

export function PricingComparison({ plans }: { plans: BillingPlan[] }) {
  return (
    <section
      aria-labelledby="comparison-heading"
      className="mt-20 min-w-0 overflow-hidden border-t pt-12"
    >
      <h2 id="comparison-heading" className="font-display text-3xl font-bold">
        Compare your options
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        All three plans currently offer the same career tools. Pro is our recommended choice;
        Premium does not currently add exclusive features or higher usage allowances.
      </p>
      <div className="relative mt-7 overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[540px] border-collapse text-left text-sm">
          <caption className="sr-only">
            Current career tools included with each monthly plan
          </caption>
          <thead>
            <tr className="border-b bg-muted/40">
              <th scope="col" className="w-2/5 p-4 font-semibold">
                Career tools
              </th>
              {plans.map((plan) => (
                <th
                  key={plan.key}
                  scope="col"
                  className={cn("p-4 text-center", plan.recommended && "bg-primary/5")}
                >
                  <span className="block font-display text-base font-bold">{plan.name}</span>
                  <span className="mt-1 block font-normal text-muted-foreground">
                    {formatEuro(plan.amount)} / month
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {comparisons.map((benefit) => (
              <tr key={benefit} className="border-b last:border-0">
                <th scope="row" className="p-4 font-normal">
                  {benefit}
                </th>
                {plans.map((plan) => (
                  <td
                    key={plan.key}
                    className={cn("p-4 text-center", plan.recommended && "bg-primary/5")}
                  >
                    <Check aria-hidden="true" className="mx-auto h-4 w-4 text-primary" />
                    <span className="sr-only">Included with {plan.name}</span>
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t">
              <th scope="row" className="p-4 font-normal">
                Plan-specific usage limits
              </th>
              {plans.map((plan) => (
                <td
                  key={plan.key}
                  className={cn(
                    "p-4 text-center text-muted-foreground",
                    plan.recommended && "bg-primary/5",
                  )}
                >
                  Not specified
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        No unlimited-use promise. External applications and messages remain under your control;
        opening a destination or copying a draft is not a confirmed send.
      </p>
    </section>
  );
}

const faqs = [
  {
    question: "How do I cancel?",
    answer:
      "Sign in, open this page and choose Cancel renewal under Current subscription. Review the confirmation, then confirm cancellation. We request cancellation from PayPal and display the confirmed result. If PayPal has confirmed a paid-through date, access continues until that date. A failed request is shown as an error, not a completed cancellation.",
  },
  {
    question: "How often am I billed?",
    answer:
      "Each plan renews every month in EUR until renewal is cancelled. Starter is €4.99, Pro is €9.99 and Premium is €19.99 per month. This is PayPal Sandbox testing only: no real money is charged, and no real tax is collected.",
  },
  {
    question: "Are taxes included?",
    answer:
      "No real tax is charged during Sandbox testing. Live VAT treatment and any tax-inclusive total have not been configured, so these test prices are not a final live tax quote. Applicable taxes and the final total must be disclosed before any future live purchase.",
  },
  {
    question: "Can I upgrade or downgrade?",
    answer:
      "In-place plan changes and automatic prorating are not available yet. To change plans in Sandbox, cancel renewal first, wait until the confirmed access period ends, then start the plan you want. We do not offer a second checkout while your account still has confirmed subscription access.",
  },
  {
    question: "Why choose Pro or Premium?",
    answer:
      "Pro is our recommended €9.99 monthly option. Starter provides the same current tools at €4.99. Premium is the €19.99 option for candidates who prefer that tier, but it does not currently include extra features, priority support or higher limits. Choose based on the current offering, not promised future benefits.",
  },
  {
    question: "What are the usage limits?",
    answer:
      "There are no published plan-specific allowances at this stage. That is not a promise of unlimited use: file validation, provider availability and application safety checks still apply. We will show numerical plan limits only when they are implemented and enforced.",
  },
  {
    question: "How is my career data protected?",
    answer:
      "LinkedIn sign-in uses identity claims, not your employment history or connections. Career facts require your confirmation, and each application handoff requires your approval. Optional analytics, marketing and research consent are separate choices. Account closure revokes sessions and deletes active profile and identity links; documented audit, backup and legal retention can still apply.",
  },
];

export function PricingFaq() {
  return (
    <section aria-labelledby="faq-heading" className="mt-16 border-t pt-12">
      <div className="grid gap-6 md:grid-cols-[1fr_2fr] md:gap-12">
        <div>
          <h2 id="faq-heading" className="font-display text-3xl font-bold">
            Before you choose
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Clear answers about your plan, your renewal and your data.
          </p>
          <Link
            to="/privacy"
            className="mt-4 inline-block text-sm font-medium text-primary underline underline-offset-4"
          >
            Read our privacy policy
          </Link>
        </div>
        <Accordion type="multiple">
          {faqs.map(({ question, answer }) => (
            <AccordionItem key={question} value={question}>
              <AccordionTrigger className="gap-4 py-5 font-semibold">{question}</AccordionTrigger>
              <AccordionContent className="leading-relaxed text-muted-foreground">
                {answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}