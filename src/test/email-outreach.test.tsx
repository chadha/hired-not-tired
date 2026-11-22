import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OutreachCard } from "@/components/hnt/outreach";
import {
  applyEmailHandoff,
  approveOutreachMessage,
  buildMailtoUrl,
  createOutreachMessage,
  editEmailOutreachMessage,
  getHandoffBlockReason,
  makeCandidateContact,
  validateContactInput,
  type ApprovalReceipt,
  type HiringContact,
  type OutreachAttachment,
} from "@/lib/hiring-contacts";
import { getEmailSendBlockReason, LOCAL_PROVIDER_CAPABILITIES } from "@/lib/application-package";
import type { Job } from "@/lib/api";

const NOW = "2026-11-22T02:00:00.000Z";
const job: Job = {
  job_id: "job_email",
  title: "Platform Engineer",
  company: "Example Engineering",
  location: "Remote",
  description: "Build Python services.",
  requirements: ["Python"],
  currency: "EUR",
  remote_type: "remote",
  source: "candidate_submitted",
  source_url: "https://example.com/jobs/platform",
  is_demo: false,
};
const contact: HiringContact = makeCandidateContact(
  {
    full_name: "Robin Example",
    current_title: "Engineering Lead",
    company: "Example Engineering",
    profile_url: "https://www.linkedin.com/in/robin-example",
    email: "Robin.Example@example.com",
    location: "Berlin",
    source_url: "https://example.com/team",
    evidence_notes: "Candidate-supplied role and email evidence.",
  },
  "candidate_email",
  job.job_id,
  true,
  NOW,
  "contact_email",
);
const attachment: OutreachAttachment = {
  artifact_id: "cv_1",
  version: 2,
  content_hash: "cv-hash",
  filename: "candidate-cv-v2.pdf",
};

function emailMessage() {
  return createOutreachMessage(
    {
      draft_id: "draft_email",
      candidate_id: contact.candidate_id,
      job_id: job.job_id,
      contact_id: contact.contact_id,
      subject: "Platform Engineer application",
      message: "Hello Robin,\n\nMy confirmed Python background relates to this role.",
      factuality_notes: ["Candidate-supplied contact; confirmed candidate skill."],
      personalization_rationale: "Uses confirmed profile facts and supplied contact evidence.",
    },
    contact,
    NOW,
    { channel: "email", package_id: "package_email", attachment },
  );
}

function approval(message = emailMessage()): ApprovalReceipt {
  return {
    draft_id: message.draft_id,
    status: "approved",
    recipient_url: message.recipient_url,
    recipient_email: message.recipient_email,
    subject: message.subject,
    attachment: message.attachment,
    body: message.body,
    approved_text_hash: "exact-email-payload-hash",
    approved_at: NOW,
    approved_by: message.candidate_id,
  };
}

describe("email outreach with Needle disabled", () => {
  it("keeps manual contact and handoff available while real send remains blocked", () => {
    expect(LOCAL_PROVIDER_CAPABILITIES.needle.enabled).toBe(false);
    expect(LOCAL_PROVIDER_CAPABILITIES.email.handoff).toBe(true);
    expect(getEmailSendBlockReason(LOCAL_PROVIDER_CAPABILITIES)).toContain(
      "No authorized email provider",
    );
    expect(contact.email).toBe("robin.example@example.com");
    expect(emailMessage()).toMatchObject({
      channel: "email",
      recipient_email: contact.email,
      attachment,
    });
  });

  it("never guesses or accepts malformed email addresses", () => {
    expect(
      validateContactInput({
        full_name: "No Email",
        current_title: "",
        company: "",
        profile_url: "",
        location: "",
        source_url: "",
        evidence_notes: "",
      }).email,
    ).toBe("");
    expect(() =>
      validateContactInput({
        full_name: "Bad Email",
        current_title: "",
        company: "",
        profile_url: "",
        email: "guessed@",
        location: "",
        source_url: "",
        evidence_notes: "",
      }),
    ).toThrow("valid email");
  });

  it("binds approval to exact recipient, subject, body and CV attachment", () => {
    const message = emailMessage();
    const approved = approveOutreachMessage(message, approval(message));
    expect(getHandoffBlockReason(approved)).toBeNull();
    expect(editEmailOutreachMessage(approved, "Changed subject", message.body)).toMatchObject({
      status: "draft",
      approved_text_hash: null,
    });
    expect(getHandoffBlockReason(approved, message.body, "Unsaved subject")).toContain(
      "Save and approve",
    );
  });

  it("rejects mismatched approval and handoff payloads", () => {
    const message = emailMessage();
    expect(() =>
      approveOutreachMessage(message, {
        ...approval(message),
        recipient_email: "other@example.com",
      }),
    ).toThrow("does not match");
    expect(getHandoffBlockReason(message)).toContain("approval is required");
    const approved = approveOutreachMessage(message, approval(message));
    expect(() =>
      applyEmailHandoff(approved, {
        draft_id: message.draft_id,
        status: "handed_off",
        recipient_email: message.recipient_email!,
        subject: message.subject!,
        message: "Changed body",
        mailto_url: buildMailtoUrl(message),
        handed_off_at: NOW,
      }),
    ).toThrow("does not match");
  });

  it("opens only a truthful mailto draft and never claims sending", () => {
    const message = emailMessage();
    const approved = approveOutreachMessage(message, approval(message));
    const receipt = {
      draft_id: message.draft_id,
      status: "handed_off" as const,
      recipient_email: message.recipient_email!,
      subject: message.subject!,
      message: message.body,
      mailto_url: buildMailtoUrl(message),
      handed_off_at: NOW,
    };
    const handedOff = applyEmailHandoff(approved, receipt);
    expect(receipt.mailto_url).toContain("mailto:");
    expect(receipt.mailto_url).toContain("subject=Platform%20Engineer%20application");
    expect(handedOff.status).toBe("handed_off");
    expect(handedOff.candidate_confirmed_sent_at).toBeNull();
    expect(handedOff.history.at(-1)?.type).toBe("email_handoff_opened");
  });

  it("shows copy/mailto handoff and no real-send button", () => {
    const message = emailMessage();
    render(
      <OutreachCard
        message={message}
        contact={contact}
        job={job}
        busy={false}
        onSaveDraft={vi.fn().mockResolvedValue(undefined)}
        onApprove={vi.fn().mockResolvedValue(undefined)}
        onHandoff={vi.fn().mockResolvedValue(undefined)}
        onConfirmSent={vi.fn().mockResolvedValue(undefined)}
        onNotYet={vi.fn()}
        onReply={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByText("Email outreach")).toBeInTheDocument();
    expect(screen.getByLabelText("Email subject")).toHaveValue("Platform Engineer application");
    expect(screen.getByRole("button", { name: "Open email draft" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /Send from Hired Not Tired|Send email/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review & approve" }));
    expect(screen.getByText("Exact subject")).toBeInTheDocument();
    expect(screen.getByText(/Mailto cannot attach files/)).toBeInTheDocument();
  });
});