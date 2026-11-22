import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HiringContactPanel } from "@/components/hnt/hiring-contact";
import { OutreachCard } from "@/components/hnt/outreach";
import type { Job } from "@/lib/api";
import {
  ActionGuard,
  applyCandidateSentConfirmation,
  applyLinkedInHandoff,
  approveOutreachMessage,
  createOutreachMessage,
  editOutreachMessage,
  getHandoffBlockReason,
  invalidateApprovalForRecipientEdit,
  makeCandidateContact,
  makeTimelineEvent,
  recordCandidateReply,
  validateContactInput,
  validateLinkedInProfileUrl,
  validateReplyInput,
  type ApprovalReceipt,
  type HiringContact,
  type OutreachMessage,
} from "@/lib/hiring-contacts";

const NOW = "2026-11-22T01:00:00.000Z";
const job: Job = {
  job_id: "job_test",
  title: "Platform Engineer",
  company: "Example Engineering",
  location: "Berlin",
  description: "Build reliable platform systems with Python.",
  requirements: ["Python"],
  currency: "EUR",
  remote_type: "hybrid",
  source: "candidate_submitted",
  source_url: "https://example.com/jobs/platform",
  is_demo: false,
};

function contact(overrides: Partial<HiringContact> = {}): HiringContact {
  return {
    ...makeCandidateContact(
      {
        full_name: "Robin Example",
        current_title: "Engineering Lead",
        company: "Example Engineering",
        profile_url: "https://www.linkedin.com/in/robin-example",
        location: "Berlin",
        source_url: "https://example.com/team",
        evidence_notes:
          "Candidate note: Robin leads the platform team; vacancy ownership is unknown.",
      },
      "candidate_test",
      job.job_id,
      false,
      NOW,
      "contact_test",
    ),
    ...overrides,
  };
}

function draft(currentContact = contact()): OutreachMessage {
  return createOutreachMessage(
    {
      draft_id: "draft_test",
      candidate_id: "candidate_test",
      job_id: job.job_id,
      contact_id: currentContact.contact_id,
      message:
        "Hi Robin, my confirmed Python platform background aligns with this vacancy. Would you be open to a short conversation?",
      factuality_notes: ["Contact details are candidate-supplied."],
      personalization_rationale: "Uses the job, confirmed Python skill, and supplied contact note.",
    },
    currentContact,
    NOW,
  );
}

function approval(message: OutreachMessage): ApprovalReceipt {
  return {
    draft_id: message.draft_id,
    status: "approved",
    recipient_url: message.recipient_url,
    body: message.body,
    approved_text_hash: "exact-sha-256-hash",
    approved_at: "2026-11-22T01:01:00.000Z",
    approved_by: message.candidate_id,
  };
}

function approvedMessage(): OutreachMessage {
  const message = draft();
  return approveOutreachMessage(message, approval(message));
}

function handedOffMessage(): OutreachMessage {
  const message = approvedMessage();
  return applyLinkedInHandoff(message, {
    draft_id: message.draft_id,
    status: "handed_off",
    linkedin_url: message.recipient_url!,
    message: message.body,
    handed_off_at: "2026-11-22T01:02:00.000Z",
  });
}

function renderOutreach(message: OutreachMessage) {
  const callbacks = {
    onSaveDraft: vi.fn().mockResolvedValue(undefined),
    onApprove: vi.fn().mockResolvedValue(undefined),
    onHandoff: vi.fn().mockResolvedValue(undefined),
    onConfirmSent: vi.fn().mockResolvedValue(undefined),
    onNotYet: vi.fn(),
    onReply: vi.fn().mockResolvedValue(undefined),
  };
  render(
    <OutreachCard message={message} contact={contact()} job={job} busy={false} {...callbacks} />,
  );
  return callbacks;
}

describe("manual LinkedIn outreach state machine", () => {
  it("completes draft, approval, handoff, self-reported send, reply, and outcome", () => {
    const created = draft();
    const approved = approveOutreachMessage(created, approval(created));
    const handedOff = applyLinkedInHandoff(approved, {
      draft_id: approved.draft_id,
      status: "handed_off",
      linkedin_url: approved.recipient_url!,
      message: approved.body,
      handed_off_at: "2026-11-22T01:02:00.000Z",
    });
    const confirmed = applyCandidateSentConfirmation(handedOff, {
      draft_id: handedOff.draft_id,
      status: "candidate_confirmed_sent",
      candidate_confirmed_sent_at: "2026-11-22T01:03:00.000Z",
    });
    const replied = recordCandidateReply(
      confirmed,
      { reply_date: "2026-11-22", content: "Thanks, let’s talk next week.", outcome: "interview" },
      "2026-11-22T01:04:00.000Z",
    );

    expect(replied.status).toBe("candidate_confirmed_sent");
    expect(replied.responses[0]).toMatchObject({
      source: "candidate_recorded",
      outcome: "interview",
      reply_date: "2026-11-22",
    });
    expect(replied.history.map((event) => event.type)).toEqual([
      "draft_created",
      "approved",
      "linkedin_handoff_opened",
      "candidate_confirmed_sent",
      "reply_recorded",
      "outcome_recorded",
    ]);
  });

  it("rejects a draft whose selected job or contact is missing or mismatched", () => {
    const other = contact({ contact_id: "another_contact", job_id: "another_job" });
    expect(() =>
      createOutreachMessage(
        {
          draft_id: "draft_bad",
          candidate_id: "candidate_test",
          job_id: job.job_id,
          contact_id: "missing",
          message: "Hello",
          factuality_notes: [],
          personalization_rationale: "",
        },
        other,
      ),
    ).toThrow("do not belong");
  });

  it("requires a real public LinkedIn profile URL only for handoff", () => {
    expect(validateLinkedInProfileUrl("", false)).toBeNull();
    expect(() => validateLinkedInProfileUrl("", true)).toThrow("required for handoff");
    expect(
      validateLinkedInProfileUrl("https://www.linkedin.com/in/robin-example?trk=ignored"),
    ).toBe("https://www.linkedin.com/in/robin-example");
  });

  it("rejects invalid, non-LinkedIn, and unsafe profile URLs", () => {
    for (const value of [
      "not-a-url",
      "https://example.com/in/robin",
      "http://www.linkedin.com/in/robin",
      "https://www.linkedin.com/company/example",
      "javascript:alert(1)",
    ]) {
      expect(() => validateLinkedInProfileUrl(value, true)).toThrow();
    }
  });

  it("keeps optional contact facts blank and requires a name", () => {
    const input = {
      full_name: "  Robin  ",
      current_title: "",
      company: "",
      profile_url: "",
      location: "",
      source_url: "",
      evidence_notes: "",
    };
    expect(validateContactInput(input)).toMatchObject({
      full_name: "Robin",
      current_title: "",
      profile_url: "",
    });
    expect(() => validateContactInput({ ...input, full_name: " " })).toThrow("Name is required");
  });

  it("invalidates approval when the exact message is edited", () => {
    const edited = editOutreachMessage(approvedMessage(), "A different exact message");
    expect(edited).toMatchObject({
      status: "draft",
      approved_text_hash: null,
      approved_at: null,
      body: "A different exact message",
    });
    expect(getHandoffBlockReason(edited)).toContain("approval is required");
  });

  it("invalidates approval when the recipient profile is edited", () => {
    const message = approvedMessage();
    const changedRecipient = contact({
      profile_url: "https://www.linkedin.com/in/another-profile",
    });
    const edited = invalidateApprovalForRecipientEdit(message, changedRecipient);
    expect(edited).toMatchObject({
      status: "draft",
      recipient_url: "https://www.linkedin.com/in/another-profile",
      approved_text_hash: null,
      approved_at: null,
    });
    expect(getHandoffBlockReason(edited)).toContain("approval is required");
  });

  it("blocks handoff before exact backend approval", () => {
    const message = draft();
    expect(getHandoffBlockReason(message)).toContain("approval is required");
    expect(() =>
      applyLinkedInHandoff(message, {
        draft_id: message.draft_id,
        status: "handed_off",
        linkedin_url: message.recipient_url!,
        message: message.body,
        handed_off_at: NOW,
      }),
    ).toThrow("approval is required");
  });

  it("blocks handoff when the approved LinkedIn URL is missing", () => {
    const withoutUrl = contact({ profile_url: "" });
    const created = draft(withoutUrl);
    const approved = approveOutreachMessage(created, approval(created));
    expect(getHandoffBlockReason(approved)).toContain("required for handoff");
  });

  it("rejects a handoff payload that differs from the approved text or recipient", () => {
    const message = approvedMessage();
    expect(() =>
      applyLinkedInHandoff(message, {
        draft_id: message.draft_id,
        status: "handed_off",
        linkedin_url: message.recipient_url!,
        message: "changed",
        handed_off_at: NOW,
      }),
    ).toThrow("does not match");
  });

  it("guards repeated clicks for the same operation", () => {
    const guard = new ActionGuard();
    expect(guard.begin("handoff:draft_test")).toBe(true);
    expect(guard.begin("handoff:draft_test")).toBe(false);
    guard.end("handoff:draft_test");
    expect(guard.begin("handoff:draft_test")).toBe(true);
  });

  it("validates empty, invalid, and future replies", () => {
    const now = new Date("2026-11-22T12:00:00.000Z");
    expect(() =>
      validateReplyInput({ reply_date: "2026-11-22", content: " ", outcome: null }, now),
    ).toThrow("reply text");
    expect(() =>
      validateReplyInput({ reply_date: "2026-02-31", content: "Reply", outcome: null }, now),
    ).toThrow("valid reply date");
    expect(() =>
      validateReplyInput({ reply_date: "2026-11-23", content: "Reply", outcome: null }, now),
    ).toThrow("future");
  });

  it("labels candidate-reported and demo timeline provenance explicitly", () => {
    const candidateEvent = makeTimelineEvent(
      job.job_id,
      "candidate_confirmed_sent",
      "Candidate confirmed sent",
      "Self-reported",
      { source: "candidate_reported" },
    );
    const demoEvent = makeTimelineEvent(job.job_id, "approved", "Demo approval", "Ephemeral", {
      source: "demo",
      simulated: true,
    });
    expect(candidateEvent).toMatchObject({ source: "candidate_reported", simulated: false });
    expect(demoEvent).toMatchObject({ source: "demo", simulated: true });
  });
});

describe("inline contact and outreach UI", () => {
  it("does not submit an invalid LinkedIn URL", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<HiringContactPanel onAdd={onAdd} onEdit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Find/add contact" }));
    fireEvent.change(screen.getByLabelText("Contact name"), { target: { value: "Robin Example" } });
    fireEvent.change(screen.getByLabelText("Public LinkedIn profile URL"), {
      target: { value: "https://example.com/in/robin" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add potential contact" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("public HTTPS LinkedIn profile URL");
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("shows candidate evidence, uncertainty, and the potential-contact label", () => {
    render(<HiringContactPanel contact={contact()} onAdd={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.getByText("Potential hiring contact")).toBeInTheDocument();
    expect(screen.getByText("medium confidence · candidate supplied")).toBeInTheDocument();
    expect(
      screen.getByText(/Vacancy ownership and current role are candidate-supplied/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("shows cited public results, evidence status and selectable alternatives", () => {
    const first = contact({ evidence_status: "public_search_result", confidence: "high" });
    const alternative = contact({
      contact_id: "contact_alternative",
      full_name: "Sam Example",
      current_title: "Recruiter",
      evidence_status: "public_search_result",
      confidence: "medium",
    });
    const onSelectContact = vi.fn();
    render(
      <HiringContactPanel
        contact={first}
        discovery={{
          status: "found",
          contacts: [first, alternative],
          fallback_url: "https://www.linkedin.com/search/results/people/?keywords=Platform",
          detail: "Two public results; vacancy ownership is not established.",
          searched_at: NOW,
        }}
        onAdd={vi.fn()}
        onEdit={vi.fn()}
        onSelectContact={onSelectContact}
      />,
    );
    expect(screen.getByText("high confidence · public search result")).toBeInTheDocument();
    expect(screen.getByText(/not proof of current role or vacancy ownership/)).toBeInTheDocument();
    expect(screen.getByText("Other evidenced possibilities")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(onSelectContact).toHaveBeenCalledWith(alternative);
  });

  it("provides a no-provider people-search fallback without inventing a contact", async () => {
    const onDiscover = vi.fn().mockResolvedValue(undefined);
    render(
      <HiringContactPanel
        discovery={{
          status: "not_configured",
          contacts: [],
          fallback_url:
            "https://www.linkedin.com/search/results/people/?keywords=Platform%20Example",
          detail: "Verified automatic contact discovery is not configured.",
          searched_at: NOW,
        }}
        onAdd={vi.fn()}
        onEdit={vi.fn()}
        onDiscover={onDiscover}
      />,
    );
    expect(
      screen.getByText("Verified automatic contact discovery is not configured."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /contextual LinkedIn people search/ })).toHaveAttribute(
      "href",
      "https://www.linkedin.com/search/results/people/?keywords=Platform%20Example",
    );
    fireEvent.click(screen.getByRole("button", { name: "Find hiring contact" }));
    await waitFor(() => expect(onDiscover).toHaveBeenCalledOnce());
    expect(screen.queryByText("Robin Example")).not.toBeInTheDocument();
  });

  it("copies the current editable draft without approving or sending it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const callbacks = renderOutreach(draft());
    fireEvent.change(screen.getByLabelText("Outreach message"), {
      target: { value: "My edited, still-unapproved draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Copy draft" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("My edited, still-unapproved draft"),
    );
    expect(callbacks.onApprove).not.toHaveBeenCalled();
    expect(callbacks.onHandoff).not.toHaveBeenCalled();
  });

  it("shows the exact recipient and complete text before approval", async () => {
    const message = draft();
    const callbacks = renderOutreach(message);
    expect(screen.getByRole("button", { name: "Open LinkedIn to send" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Review & approve" }));
    const confirmation = screen.getByLabelText("Approve message confirmation");
    expect(within(confirmation).getByText(contact().full_name)).toBeInTheDocument();
    expect(within(confirmation).getByText(contact().profile_url)).toBeInTheDocument();
    expect(within(confirmation).getByText(message.body)).toBeInTheDocument();
    fireEvent.click(within(confirmation).getByRole("button", { name: "Approve message" }));
    await waitFor(() => expect(callbacks.onApprove).toHaveBeenCalledWith(message.body));
    expect(callbacks.onHandoff).not.toHaveBeenCalled();
  });

  it("treats Not yet as no send event", () => {
    const callbacks = renderOutreach(handedOffMessage());
    fireEvent.click(screen.getByRole("button", { name: "Not yet" }));
    expect(callbacks.onNotYet).toHaveBeenCalledOnce();
    expect(callbacks.onConfirmSent).not.toHaveBeenCalled();
    expect(screen.getByText(/No send was recorded/)).toBeInTheDocument();
  });

  it("records a dated reply through the candidate-reported path", async () => {
    const message = applyCandidateSentConfirmation(handedOffMessage(), {
      draft_id: "draft_test",
      status: "candidate_confirmed_sent",
      candidate_confirmed_sent_at: "2026-11-22T01:03:00.000Z",
    });
    const callbacks = renderOutreach(message);
    expect(
      screen.getByText(/Self-reported by you · not provider-verified delivery/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Record a reply" }));
    fireEvent.change(screen.getByLabelText("Reply text or summary"), {
      target: { value: "Let’s arrange a call." },
    });
    fireEvent.change(screen.getByLabelText("Reply outcome"), { target: { value: "interview" } });
    fireEvent.click(screen.getByRole("button", { name: "Save candidate-recorded reply" }));
    await screen.findByText(/Self-reported by you/);
    expect(callbacks.onReply).toHaveBeenCalledWith({
      reply_date: new Date().toISOString().slice(0, 10),
      content: "Let’s arrange a call.",
      outcome: "interview",
    });
  });

  it("labels local demo approval and data as ephemeral", () => {
    const demoContact = contact({ is_demo: true });
    const demoDraft = createOutreachMessage(
      {
        draft_id: "draft_demo",
        candidate_id: "candidate_test",
        job_id: job.job_id,
        contact_id: demoContact.contact_id,
        message: "Fictional demo draft",
        factuality_notes: [],
        personalization_rationale: "Demo facts only",
      },
      demoContact,
    );
    renderOutreach(demoDraft);
    expect(screen.getByText("DEMO · in-memory only")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review & approve" }));
    expect(
      screen.getByText(/approval is stored only in this browser's memory/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Send from Hired Not Tired/ }),
    ).not.toBeInTheDocument();
  });
});