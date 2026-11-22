import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Route } from "@/routes/index";

const title = "Hired Not Tired — You are more than your CV.";
const description =
  "Show employers the value they can't see. Discover your strengths. Find opportunities that fit. Apply with confidence.";

describe("Landing marketing claim", () => {
  it("uses the locked claim in page and social metadata", async () => {
    const head = await Route.options.head?.({} as never);

    expect(head?.meta).toEqual(
      expect.arrayContaining([
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
      ]),
    );
    expect(JSON.stringify(head)).not.toContain("Your career deserves more");
  });

  it("renders the message hierarchy before the unchanged auth and demo actions", async () => {
    const LandingComponent = Route.options.component;
    if (!LandingComponent) throw new Error("Landing route component is missing");

    const rootRoute = createRootRoute();
    const indexRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: LandingComponent,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([indexRoute]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    render(<RouterProvider router={router} />);

    const h1 = await screen.findByRole("heading", {
      level: 1,
      name: "You are more than your CV.",
    });
    const h2 = screen.getByRole("heading", {
      level: 2,
      name: "Show employers the value they can't see.",
    });
    const supportingCopy = screen.getByText(
      "Discover your strengths. Find opportunities that fit. Apply with confidence.",
    );
    const signIn = screen.getByRole("button", { name: "Continue with LinkedIn" });
    const demo = screen.getByRole("button", { name: "Explore the local demo" });

    expect(h1.compareDocumentPosition(h2) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      h2.compareDocumentPosition(supportingCopy) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      supportingCopy.compareDocumentPosition(signIn) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(signIn).toBeDisabled();
    expect(demo).toBeEnabled();
    expect(
      screen.getByText(/DEMO · fictional data · no account or LinkedIn login/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Your career deserves more/)).not.toBeInTheDocument();
  });
});