import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/onboard")({
  head: () => ({
    meta: [
      { title: "LinkedIn sign-in — Hired Not Tired" },
      {
        name: "description",
        content: "Manual registration has been replaced by the LinkedIn sign-in entry point.",
      },
      { property: "og:title", content: "LinkedIn sign-in — Hired Not Tired" },
      {
        property: "og:description",
        content: "Start with LinkedIn or open the explicitly labeled fictional local demo.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  // The old manual registration wizard is intentionally retired. Profile enrichment stays in the chat.
  component: () => <Navigate to="/" replace />,
});