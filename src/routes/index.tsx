import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Compass, FileCheck2, MessageCircleHeart } from "lucide-react";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { Logo, EngineBadge } from "@/components/hnt/brand";
import { ErrorNote } from "@/components/hnt/cards";
import { LinkedInSignInActions } from "@/components/hnt/linkedin-auth";
import { api, ApiError, isLiveApi } from "@/lib/api";
import {
  localLinkedInAuthCapability,
  LINKEDIN_AUTH_CONTRACT,
  type LinkedInAuthCapability,
} from "@/lib/linkedin-auth";
import { session } from "@/lib/session";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Hired Not Tired — You are more than your CV." },
      {
        name: "description",
        content:
          "Show employers the value they can't see. Discover your strengths. Find opportunities that fit. Apply with confidence.",
      },
      { property: "og:title", content: "Hired Not Tired — You are more than your CV." },
      {
        property: "og:description",
        content:
          "Show employers the value they can't see. Discover your strengths. Find opportunities that fit. Apply with confidence.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Hired Not Tired — You are more than your CV." },
      {
        name: "twitter:description",
        content:
          "Show employers the value they can't see. Discover your strengths. Find opportunities that fit. Apply with confidence.",
      },
    ],
  }),
  component: Index,
});

const heroVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } },
};

const featureListVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};

const featureCardVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: "easeOut" } },
};

const benefits = [
  {
    icon: Compass,
    title: "Opportunities that fit",
    description: "See the evidence behind every match, including gaps and unknowns.",
  },
  {
    icon: MessageCircleHeart,
    title: "People who matter",
    description:
      "Prepare candidate-approved LinkedIn and email outreach without invented contacts.",
  },
  {
    icon: FileCheck2,
    title: "Your next move",
    description: "Tailor a truthful CV and choose each application handoff in one conversation.",
  },
];

function Index() {
  const nav = useNavigate();
  const reduceMotion = useReducedMotion() ?? false;
  const [demoBusy, setDemoBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [checking, setChecking] = useState(isLiveApi);
  const [capability, setCapability] = useState<LinkedInAuthCapability>(localLinkedInAuthCapability);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!isLiveApi) return;
    let active = true;
    api
      .linkedinAuthCapability()
      .then((result) => {
        if (active) setCapability(result);
      })
      .catch((error: Error) => {
        if (!active) return;
        setCapability({
          ...localLinkedInAuthCapability(),
          status: "unavailable",
          missing: [LINKEDIN_AUTH_CONTRACT.capabilities],
          detail: error.message,
        });
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isLiveApi) return;
    const params = new URLSearchParams(window.location.search);
    const authError = params.get("auth_error");
    const messages: Record<string, string> = {
      access_denied: "LinkedIn authorization was cancelled. No account or session was created.",
      oauth_validation_failed: "LinkedIn sign-in could not be validated. No session was created.",
      account_closed:
        "This account is closed. Contact the operator before attempting to restore access.",
      oauth_failed: "LinkedIn sign-in could not be completed. Please try again.",
    };
    if (authError === "invalid_state") {
      params.delete("auth_error");
      const search = params.toString();
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`,
      );
    } else if (authError) {
      setErr(messages[authError] ?? messages["oauth_failed"] ?? "Sign-in failed.");
    }
    if (params.get("account") === "closed") {
      setNotice(
        "Your active profile was deleted and your account was closed. Documented audit and backup retention still applies.",
      );
    }
    // Other failed callbacks must remain visible instead of being hidden by an older valid session.
    if (authError && authError !== "invalid_state") return;
    let active = true;
    api
      .linkedinAuthSession()
      .then((authenticated) => {
        if (!active) return;
        session.set(authenticated.candidate_id, false);
        nav({ to: "/coach" });
      })
      .catch((error: ApiError) => {
        if (error.status !== 401 && active && (!authError || authError === "invalid_state")) {
          setErr(error.message);
        }
      });
    return () => {
      active = false;
    };
  }, [nav]);

  const demo = async () => {
    setDemoBusy(true);
    setErr(null);
    try {
      const result = await api.seed();
      session.set(result.candidate.candidate_id, true);
      nav({ to: "/coach" });
    } catch (error) {
      setErr((error as Error).message);
    } finally {
      setDemoBusy(false);
    }
  };

  const linkedIn = async () => {
    setAuthBusy(true);
    setErr(null);
    try {
      window.location.assign(api.linkedinAuthorizationUrl(capability));
    } catch (error) {
      setErr((error as Error).message);
      setAuthBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6">
        <Logo />
        <div className="flex items-center gap-3">
          <EngineBadge />
          <Link
            to="/pricing"
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Pricing
          </Link>
          <Link to="/privacy" className="text-sm text-muted-foreground hover:text-foreground">
            Privacy
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 pb-20 pt-12 sm:pt-24">
        <motion.div
          className="max-w-3xl"
          variants={heroVariants}
          initial={reduceMotion ? false : "hidden"}
          animate="visible"
        >
          <h1 className="max-w-3xl text-5xl font-bold leading-[1.04] sm:text-7xl">
            You are more than your CV.
          </h1>
          <h2 className="mt-5 max-w-2xl text-2xl font-bold leading-snug sm:text-3xl">
            Show employers the value they can't see.
          </h2>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Discover your strengths. Find opportunities that fit. Apply with confidence.
          </p>
          <LinkedInSignInActions
            capability={capability}
            checking={checking}
            authBusy={authBusy}
            demoBusy={demoBusy}
            allowDemo={!isLiveApi}
            onLinkedIn={linkedIn}
            onDemo={demo}
          />
          {notice && (
            <p role="status" className="mt-6 max-w-xl rounded-xl border bg-background p-4 text-sm">
              {notice}
            </p>
          )}
          {err && (
            <div className="mt-6 max-w-xl">
              <ErrorNote message={err} />
            </div>
          )}
          <p className="mt-6 max-w-xl text-xs leading-relaxed text-muted-foreground">
            Real sign-in uses only LinkedIn OpenID Connect identity claims. It does not import
            employment history, skills or connections. Optional career information is added later
            with your confirmation.
          </p>
        </motion.div>
        <motion.section
          aria-label="What you can do"
          className="mt-20 grid gap-4 md:grid-cols-3"
          variants={featureListVariants}
          initial={reduceMotion ? false : "hidden"}
          {...(reduceMotion ? {} : { whileInView: "visible" })}
          viewport={{ once: true, amount: 0.2 }}
        >
          {benefits.map((benefit) => (
            <motion.div
              key={benefit.title}
              variants={featureCardVariants}
              className="rounded-[20px] border border-border bg-card p-6"
            >
              <benefit.icon className="h-5 w-5 text-primary" />
              <h2 className="mt-4 text-xl font-bold">{benefit.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {benefit.description}
              </p>
            </motion.div>
          ))}
        </motion.section>
      </main>
    </div>
  );
}