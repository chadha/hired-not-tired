import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccountSettings } from "@/components/hnt/account-settings";
import type { AuthenticatedWorkspace } from "@/lib/linkedin-auth";

const workspace: AuthenticatedWorkspace = {
  candidate_id: "candidate-id",
  identity: { sub: "subject", name: "Example User", email_verified: false },
  first_login: false,
  career_profile_created: true,
  consents: [
    {
      notice_type: "privacy",
      notice_version: "privacy-v1",
      granted: true,
      recorded_at: "2026-11-22T03:00:00Z",
    },
  ],
  consent_versions: {
    service_terms: "terms-v1",
    privacy: "privacy-v1",
    analytics: "optional-v1",
    marketing: "optional-v1",
    research: "optional-v1",
  },
  session_expires_at: "2026-11-29T03:00:00Z",
  csrf_token: "not-rendered",
};

describe("Account and consent controls", () => {
  it("keeps all optional choices unbundled and sends the current notice version", async () => {
    const onConsents = vi.fn().mockResolvedValue(undefined);
    render(
      <AccountSettings
        workspace={workspace}
        busy={false}
        onConsents={onConsents}
        onDelete={vi.fn()}
      />,
    );
    const marketing = screen.getByRole("checkbox", { name: /Marketing/ });
    const research = screen.getByRole("checkbox", { name: /Research & model improvement/ });
    expect(marketing).not.toBeChecked();
    expect(research).not.toBeChecked();

    fireEvent.click(marketing);
    expect(onConsents).toHaveBeenCalledWith([
      { notice_type: "marketing", notice_version: "optional-v1", granted: true },
    ]);
    expect(research).not.toBeChecked();
  });

  it("requires exact DELETE confirmation before account closure", async () => {
    const onDelete = vi.fn().mockResolvedValue({
      status: "closed_and_anonymized",
      sessions_revoked: 1,
      active_profile_deleted: true,
      external_identity_deleted: true,
      retention_notice: "Retention applies.",
    });
    render(
      <AccountSettings
        workspace={workspace}
        busy={false}
        onConsents={vi.fn()}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close account" }));
    const submit = screen.getByRole("button", { name: "Close and anonymize" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), {
      target: { value: "DELETE" },
    });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await vi.waitFor(() => expect(onDelete).toHaveBeenCalledOnce());
  });
});