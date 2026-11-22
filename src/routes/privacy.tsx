import { createFileRoute } from "@tanstack/react-router";
import { Logo } from "@/components/hnt/brand";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy & your data — Hired Not Tired" },
      {
        name: "description",
        content:
          "What Hired Not Tired imports, stores and lets you control across LinkedIn sign-in and career profiles.",
      },
      { property: "og:title", content: "Privacy & your data — Hired Not Tired" },
      {
        property: "og:description",
        content:
          "LinkedIn identity, career-profile provenance, consent choices and local-demo deletion explained.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Privacy,
});

const rows = [
  [
    "LinkedIn sign-in",
    "The standalone FastAPI service requests only openid, profile and email. Authorized claims can include LinkedIn's stable subject identifier, name, profile picture, email and verification status, and locale. These scopes do not provide employment history, skills or connections. Real login remains unavailable until an operator configures LinkedIn credentials; no login is simulated.",
  ],
  [
    "Account & career profile",
    "The authentication backend creates an account keyed by LinkedIn's stable subject, never by email alone, plus an initial empty career profile. Authorized identity claims and candidate-confirmed CV facts have separate provenance. Missing email and other unknowns remain unknown. The separate career-engine endpoints are still required for live job and application data.",
  ],
  [
    "Profile",
    "Name, email, career goal, target roles, locations, salary floor and skills you confirm. CV-extracted facts require your confirmation; conversational edits are candidate-provided.",
  ],
  [
    "CV text",
    "PDF, DOCX, TXT or MD files are parsed locally into text, then the extracted text is used to tailor application packages. Original files are not uploaded. In local demo mode, the text is ephemeral browser memory.",
  ],
  [
    "Consent choices",
    "Required service-terms and privacy acknowledgements are distinct from optional analytics, marketing and research/model-improvement choices. Optional consent is never bundled into account creation. The authenticated backend records granular, versioned choices and withdrawals with timestamps. Career information is not used for unrelated AI model training without an appropriate legal basis and any required explicit choice.",
  ],
  [
    "Hiring contacts",
    "The names, titles, companies, public LinkedIn URLs, email addresses, sources and evidence notes you supply. Unknown fields stay blank and vacancy relevance remains uncertain unless your evidence establishes it. Email addresses are never guessed.",
  ],
  [
    "Local demo",
    "Demo contacts, drafts, approvals, handoffs, confirmations and replies are stored only in browser memory for the current session. They are ephemeral, visibly labeled DEMO, and never sent externally. Opening the demo does not create an account or authenticate you with LinkedIn.",
  ],
  [
    "Application packages",
    "Requirement analysis, confirmed-fact provenance, tailored CV versions, application answers, optional cover letters, exact-package approvals and PDF/DOCX export events. The master CV/profile stays separate. Local demo versions and approvals are ephemeral; exports are generated in your browser.",
  ],
  [
    "Application handoffs",
    "LinkedIn Easy Apply is labeled only when source data confirms it. Employer pages open only for candidate-controlled completion. Email uses copy/mailto handoff only; mailto cannot attach your CV. Needle is disabled and optional. No direct submission, real email sending or automatic attachment is enabled in the local demo.",
  ],
  [
    "Interactions & drafts",
    "Candidate-confirmed sends, dated replies and optional outcomes are self-reported, not provider-verified. Opening or copying a message never records a send; only your explicit confirmation does.",
  ],
];

function Privacy() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto max-w-3xl px-5 py-5">
        <Logo />
      </header>
      <main className="mx-auto max-w-3xl px-5 pb-20 pt-6">
        <h1 className="text-4xl font-bold">Privacy & your data</h1>
        <p className="mt-3 text-muted-foreground">
          You stay in control. Here is what the current product does, what the standalone
          authentication service provides, and which career features still require a live engine.
        </p>
        <div className="mt-8 divide-y rounded-2xl border bg-card shadow-soft">
          {rows.map(([title, description]) => (
            <div key={title} className="grid gap-1 p-5 sm:grid-cols-[170px_1fr]">
              <p className="font-semibold">{title}</p>
              <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
            </div>
          ))}
        </div>
        <h2 className="mt-10 text-2xl font-bold">Deleting your data</h2>
        <p className="mt-2 leading-relaxed text-muted-foreground">
          Local demo data resets when you leave the demo or clear its browser state. Downloaded
          PDF/DOCX files remain on your device until you delete them. Authenticated account closure
          requires exact confirmation and CSRF protection; it deletes active profile and identity
          links and revokes sessions. Pseudonymized consent audits may be retained up to six years,
          backups up to 30 days, and legal holds supersede deletion, so closure is not a claim of
          immediate physical erasure. Privacy questions can be sent to{" "}
          <a className="font-medium text-primary underline" href="mailto:privacy@hirednottired.app">
            privacy@hirednottired.app
          </a>
          .
        </p>
      </main>
    </div>
  );
}