// Candidate-supplied contacts and the independent LinkedIn handoff state machine.
// Demo adapters use the same transitions but are always labeled ephemeral and simulated.

export type ContactConfidence = "low" | "medium" | "high";

export type ManualContactInput = {
  full_name: string;
  current_title: string;
  company: string;
  profile_url: string;
  email?: string;
  location: string;
  source_url: string;
  evidence_notes: string;
};

export type HiringContact = ManualContactInput & {
  contact_id: string;
  candidate_id: string;
  job_id: string;
  confidence: ContactConfidence;
  relevance: string;
  evidence_status: "candidate_supplied" | "public_search_result";
  last_checked_at: string | null;
  evidence_date?: string | null;
  created_at: string;
  updated_at: string;
  is_demo: boolean;
};

export type ContactDiscoveryResult = {
  status: "found" | "no_reliable_match" | "not_configured" | "unavailable";
  contacts: HiringContact[];
  fallback_url: string;
  detail: string;
  searched_at: string;
};

export type OutreachStatus = "draft" | "approved" | "handed_off" | "candidate_confirmed_sent";

export type OutreachEventType =
  | "draft_created"
  | "draft_edited"
  | "approved"
  | "linkedin_handoff_opened"
  | "email_handoff_opened"
  | "candidate_confirmed_sent"
  | "reply_recorded"
  | "outcome_recorded";

export type MessageHistoryEvent = {
  history_id: string;
  type: OutreachEventType;
  label: string;
  detail: string;
  created_at: string;
  actor: "candidate" | "backend" | "demo";
  simulated: boolean;
};

export type OutreachResponse = {
  response_id: string;
  reply_date: string;
  content: string;
  outcome: string | null;
  created_at: string;
  source: "candidate_recorded";
  simulated: boolean;
};

export type DraftForOutreach = {
  draft_id: string;
  candidate_id: string;
  job_id: string;
  contact_id: string;
  message: string;
  subject?: string | null;
  factuality_notes: string[];
  personalization_rationale: string;
};

export type OutreachAttachment = {
  artifact_id: string;
  version: number;
  content_hash: string;
  filename: string;
};

export type OutreachMessage = {
  message_id: string;
  draft_id: string;
  candidate_id: string;
  job_id: string;
  contact_id: string;
  package_id?: string | null | undefined;
  channel: "linkedin" | "email";
  recipient_name: string;
  recipient_url: string | null;
  recipient_email?: string | null | undefined;
  subject?: string | null | undefined;
  attachment?: OutreachAttachment | null | undefined;
  body: string;
  status: OutreachStatus;
  factuality_notes: string[];
  personalization_rationale: string;
  approved_text_hash: string | null;
  approved_at: string | null;
  approved_by: string | null;
  handed_off_at: string | null;
  candidate_confirmed_sent_at: string | null;
  created_at: string;
  updated_at: string;
  responses: OutreachResponse[];
  history: MessageHistoryEvent[];
  is_demo: boolean;
};

export type ApprovalReceipt = {
  draft_id: string;
  status: "approved";
  recipient_url: string | null;
  recipient_email?: string | null | undefined;
  subject?: string | null | undefined;
  attachment?: OutreachAttachment | null | undefined;
  body: string;
  approved_text_hash: string;
  approved_at: string;
  approved_by: string;
};

export type LinkedInHandoffReceipt = {
  draft_id: string;
  status: "handed_off";
  linkedin_url: string;
  message: string;
  handed_off_at: string;
};

export type EmailHandoffReceipt = {
  draft_id: string;
  status: "handed_off";
  recipient_email: string;
  subject: string;
  message: string;
  mailto_url: string;
  handed_off_at: string;
};

export type CandidateSentReceipt = {
  draft_id: string;
  status: "candidate_confirmed_sent";
  candidate_confirmed_sent_at: string;
};

export type ApplicationTimelineEventType =
  | "application_package_created"
  | "master_profile_revised"
  | "cv_version_created"
  | "cv_approved"
  | "cv_exported"
  | "answer_saved"
  | "cover_letter_created"
  | "cover_letter_approved"
  | "application_path_approved"
  | "application_handoff_opened"
  | "application_candidate_reported"
  | "application_provider_confirmed";
export type CareerTimelineEventType = OutreachEventType | ApplicationTimelineEventType;

export type CareerTimelineEvent = {
  timeline_id: string;
  job_id: string;
  draft_id: string | null;
  contact_id: string | null;
  type: CareerTimelineEventType;
  title: string;
  detail: string;
  created_at: string;
  source: "backend_confirmed" | "candidate_reported" | "demo";
  simulated: boolean;
};

export type ReplyInput = {
  reply_date: string;
  content: string;
  outcome: string | null;
};

const uid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
const timestamp = () => new Date().toISOString();

export function canonicalApprovalContent(
  recipientUrl: string | null,
  body: string,
  details?: {
    channel: "linkedin" | "email";
    recipient_email?: string | null | undefined;
    subject?: string | null | undefined;
    attachment?: OutreachAttachment | null | undefined;
    package_id?: string | null | undefined;
  },
): string {
  if (!details) return JSON.stringify({ channel: "linkedin", recipient_url: recipientUrl, body });
  return JSON.stringify({
    channel: details.channel,
    recipient_url: recipientUrl,
    recipient_email: details.recipient_email ?? null,
    subject: details.subject ?? null,
    body,
    attachment: details.attachment ?? null,
    package_id: details.package_id ?? null,
  });
}

export function validateEmailAddress(
  value: string | null | undefined,
  required = false,
): string | null {
  const email = value?.trim().toLowerCase() ?? "";
  if (!email) {
    if (required)
      throw new Error("A candidate-supplied email address is required for email handoff.");
    return null;
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address. It is never guessed or generated.");
  }
  return email;
}

export function normalizeSourceUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Enter a valid source URL, including https://.");
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Source URL must be a public http or https URL without credentials.");
  }
  return url.toString();
}

export function validateLinkedInProfileUrl(value: string | null, required = false): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    if (required) throw new Error("A public LinkedIn profile URL is required for handoff.");
    return null;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Enter a valid public LinkedIn profile URL, including https://.");
  }
  const linkedInHost = url.hostname === "linkedin.com" || url.hostname.endsWith(".linkedin.com");
  if (
    url.protocol !== "https:" ||
    !linkedInHost ||
    !/^\/in\/[^/]+\/?$/.test(url.pathname) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "Use a public HTTPS LinkedIn profile URL in the format https://www.linkedin.com/in/name.",
    );
  }
  return `https://www.linkedin.com${url.pathname.replace(/\/$/, "")}`;
}

export function validateContactInput(
  input: ManualContactInput,
  requireProfile = false,
): ManualContactInput {
  const fullName = input.full_name.trim();
  if (!fullName) throw new Error("Name is required.");
  return {
    full_name: fullName,
    current_title: input.current_title.trim(),
    company: input.company.trim(),
    profile_url: validateLinkedInProfileUrl(input.profile_url, requireProfile) ?? "",
    email: validateEmailAddress(input.email) ?? "",
    location: input.location.trim(),
    source_url: normalizeSourceUrl(input.source_url) ?? "",
    evidence_notes: input.evidence_notes.trim(),
  };
}

export function makeCandidateContact(
  input: ManualContactInput,
  candidateId: string,
  jobId: string,
  isDemo: boolean,
  at = timestamp(),
  contactId = uid("contact"),
): HiringContact {
  const valid = validateContactInput(input);
  return {
    ...valid,
    contact_id: contactId,
    candidate_id: candidateId,
    job_id: jobId,
    confidence: valid.source_url && valid.evidence_notes ? "medium" : "low",
    relevance:
      valid.evidence_notes ||
      "Candidate-supplied contact. Relevance to this vacancy has not been independently verified.",
    evidence_status: "candidate_supplied",
    last_checked_at: at,
    created_at: at,
    updated_at: at,
    is_demo: isDemo,
  };
}

function history(
  type: OutreachEventType,
  label: string,
  detail: string,
  simulated: boolean,
  at = timestamp(),
): MessageHistoryEvent {
  return {
    history_id: uid("history"),
    type,
    label,
    detail,
    created_at: at,
    actor: simulated
      ? "demo"
      : type === "draft_created" || type === "approved"
        ? "backend"
        : "candidate",
    simulated,
  };
}

export function createOutreachMessage(
  draft: DraftForOutreach,
  contact: HiringContact,
  at = timestamp(),
  options: {
    channel?: "linkedin" | "email";
    package_id?: string | null;
    attachment?: OutreachAttachment | null;
  } = {},
): OutreachMessage {
  if (
    draft.job_id !== contact.job_id ||
    draft.contact_id !== contact.contact_id ||
    draft.candidate_id !== contact.candidate_id
  ) {
    throw new Error("The selected job, candidate, and contact do not belong to this draft.");
  }
  if (!draft.message.trim()) throw new Error("The backend returned an empty message draft.");
  const channel = options.channel ?? "linkedin";
  const recipientEmail = channel === "email" ? validateEmailAddress(contact.email, true) : null;
  if (channel === "email" && !draft.subject?.trim()) {
    throw new Error("An email subject is required before review.");
  }
  return {
    message_id: draft.draft_id,
    draft_id: draft.draft_id,
    candidate_id: draft.candidate_id,
    job_id: draft.job_id,
    contact_id: contact.contact_id,
    package_id: options.package_id ?? null,
    channel,
    recipient_name: contact.full_name,
    recipient_url: contact.profile_url || null,
    recipient_email: recipientEmail,
    subject: draft.subject?.trim() || null,
    attachment: options.attachment ?? null,
    body: draft.message,
    status: "draft",
    factuality_notes: draft.factuality_notes,
    personalization_rationale: draft.personalization_rationale,
    approved_text_hash: null,
    approved_at: null,
    approved_by: null,
    handed_off_at: null,
    candidate_confirmed_sent_at: null,
    created_at: at,
    updated_at: at,
    responses: [],
    history: [
      history(
        "draft_created",
        "Draft created",
        `Created for ${contact.full_name}; approval is required before handoff.`,
        contact.is_demo,
        at,
      ),
    ],
    is_demo: contact.is_demo,
  };
}

export function editOutreachMessage(
  message: OutreachMessage,
  body: string,
  at = timestamp(),
): OutreachMessage {
  if (!body.trim()) throw new Error("Write a message before saving it.");
  if (message.status === "handed_off" || message.status === "candidate_confirmed_sent") {
    throw new Error("A message cannot be edited after handoff. Create a new draft instead.");
  }
  if (body === message.body) return message;
  return {
    ...message,
    body,
    status: "draft",
    approved_text_hash: null,
    approved_at: null,
    approved_by: null,
    handed_off_at: null,
    updated_at: at,
    history: [
      ...message.history,
      history(
        "draft_edited",
        "Draft edited",
        "The edit invalidated any earlier approval. Exact-message approval is required again.",
        message.is_demo,
        at,
      ),
    ],
  };
}

export function editEmailOutreachMessage(
  message: OutreachMessage,
  subject: string,
  body: string,
  at = timestamp(),
): OutreachMessage {
  if (message.channel !== "email") throw new Error("This draft is not an email message.");
  if (!subject.trim()) throw new Error("Write an email subject before saving it.");
  const edited = editOutreachMessage(message, body, at);
  if (subject === message.subject) return edited;
  return {
    ...edited,
    subject: subject.trim(),
    status: "draft",
    approved_text_hash: null,
    approved_at: null,
    approved_by: null,
    updated_at: at,
    history: [
      ...edited.history,
      history(
        "draft_edited",
        "Email subject edited",
        "The subject edit invalidated any earlier approval. Exact-payload approval is required again.",
        message.is_demo,
        at,
      ),
    ],
  };
}

export function invalidateApprovalForRecipientEdit(
  message: OutreachMessage,
  contact: HiringContact,
  at = timestamp(),
): OutreachMessage {
  if (message.contact_id !== contact.contact_id) return message;
  if (message.status === "handed_off" || message.status === "candidate_confirmed_sent") {
    throw new Error(
      "This contact is already linked to a handoff. Add a new contact instead of changing its recipient history.",
    );
  }
  const edited = editOutreachMessage(message, message.body, at);
  return {
    ...edited,
    recipient_name: contact.full_name,
    recipient_url: contact.profile_url || null,
    recipient_email: message.channel === "email" ? contact.email || null : message.recipient_email,
    status: "draft",
    approved_text_hash: null,
    approved_at: null,
    approved_by: null,
    updated_at: at,
    history: [
      ...edited.history,
      history(
        "draft_edited",
        "Recipient updated",
        "The contact edit invalidated approval. Review and approve the recipient and message again.",
        message.is_demo,
        at,
      ),
    ],
  };
}

export function approveOutreachMessage(
  message: OutreachMessage,
  receipt: ApprovalReceipt,
): OutreachMessage {
  if (receipt.draft_id !== message.draft_id)
    throw new Error("The backend approved a different draft.");
  if (
    receipt.body !== message.body ||
    receipt.recipient_url !== message.recipient_url ||
    (message.channel === "email" &&
      (receipt.recipient_email !== message.recipient_email ||
        receipt.subject !== message.subject ||
        JSON.stringify(receipt.attachment ?? null) !==
          JSON.stringify(message.attachment ?? null))) ||
    !receipt.approved_text_hash
  ) {
    throw new Error(
      "The backend approval does not match the exact recipient and message. Handoff remains blocked.",
    );
  }
  return {
    ...message,
    status: "approved",
    approved_text_hash: receipt.approved_text_hash,
    approved_at: receipt.approved_at,
    approved_by: receipt.approved_by,
    updated_at: receipt.approved_at,
    history: [
      ...message.history,
      history(
        "approved",
        "Exact message approved",
        `Approved by ${receipt.approved_by} for ${message.recipient_url ?? "a recipient without a LinkedIn URL"}. Approval did not send anything.`,
        message.is_demo,
        receipt.approved_at,
      ),
    ],
  };
}

export function getHandoffBlockReason(
  message: OutreachMessage,
  currentBody = message.body,
  currentSubject = message.subject,
): string | null {
  if (currentBody !== message.body || currentSubject !== message.subject) {
    return "Save and approve your edits before handoff.";
  }
  if (message.status !== "approved")
    return "Backend-confirmed exact-message approval is required before handoff.";
  if (!message.approved_text_hash || !message.approved_at)
    return "The backend approval is incomplete. Handoff remains blocked.";
  try {
    if (message.channel === "email") {
      validateEmailAddress(message.recipient_email, true);
      if (!message.subject?.trim()) throw new Error("An approved email subject is required.");
    } else {
      validateLinkedInProfileUrl(message.recipient_url, true);
    }
  } catch (error) {
    return (error as Error).message;
  }
  return null;
}

export function applyLinkedInHandoff(
  message: OutreachMessage,
  receipt: LinkedInHandoffReceipt,
): OutreachMessage {
  const blocked = getHandoffBlockReason(message);
  if (blocked) throw new Error(blocked);
  if (
    receipt.draft_id !== message.draft_id ||
    receipt.linkedin_url !== message.recipient_url ||
    receipt.message !== message.body
  ) {
    throw new Error(
      "The handoff payload does not match the approved recipient and exact message. Nothing was marked handed off.",
    );
  }
  return {
    ...message,
    status: "handed_off",
    handed_off_at: receipt.handed_off_at,
    updated_at: receipt.handed_off_at,
    history: [
      ...message.history,
      history(
        "linkedin_handoff_opened",
        "LinkedIn handoff recorded",
        "The public profile handoff was prepared. This is not proof that a message was sent.",
        message.is_demo,
        receipt.handed_off_at,
      ),
    ],
  };
}

export function buildMailtoUrl(message: OutreachMessage): string {
  if (message.channel !== "email") throw new Error("This message is not an email draft.");
  const recipient = validateEmailAddress(message.recipient_email, true) as string;
  const subject = message.subject?.trim();
  if (!subject) throw new Error("An email subject is required.");
  return `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message.body)}`;
}

export function applyEmailHandoff(
  message: OutreachMessage,
  receipt: EmailHandoffReceipt,
): OutreachMessage {
  const blocked = getHandoffBlockReason(message);
  if (blocked) throw new Error(blocked);
  if (
    message.channel !== "email" ||
    receipt.draft_id !== message.draft_id ||
    receipt.recipient_email !== message.recipient_email ||
    receipt.subject !== message.subject ||
    receipt.message !== message.body
  ) {
    throw new Error(
      "The email handoff does not match the approved recipient, subject, message and attachment.",
    );
  }
  return {
    ...message,
    status: "handed_off",
    handed_off_at: receipt.handed_off_at,
    updated_at: receipt.handed_off_at,
    history: [
      ...message.history,
      history(
        "email_handoff_opened",
        "Email handoff recorded",
        "A mailto draft was prepared. Opening it is not proof of sending or delivery.",
        message.is_demo,
        receipt.handed_off_at,
      ),
    ],
  };
}

export function applyCandidateSentConfirmation(
  message: OutreachMessage,
  receipt: CandidateSentReceipt,
): OutreachMessage {
  if (message.status !== "handed_off")
    throw new Error("Complete the channel handoff before confirming that you sent the message.");
  if (receipt.draft_id !== message.draft_id)
    throw new Error("The send confirmation belongs to a different draft.");
  return {
    ...message,
    status: "candidate_confirmed_sent",
    candidate_confirmed_sent_at: receipt.candidate_confirmed_sent_at,
    updated_at: receipt.candidate_confirmed_sent_at,
    history: [
      ...message.history,
      history(
        "candidate_confirmed_sent",
        "Candidate confirmed sent",
        "Self-reported by the candidate. This is not provider-verified delivery.",
        message.is_demo,
        receipt.candidate_confirmed_sent_at,
      ),
    ],
  };
}

export function validateReplyInput(input: ReplyInput, now = new Date()): ReplyInput {
  const content = input.content.trim();
  if (!content) throw new Error("Enter the reply text or a summary before saving.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.reply_date))
    throw new Error("Choose the date the reply was received.");
  const received = new Date(`${input.reply_date}T00:00:00.000Z`);
  if (
    Number.isNaN(received.getTime()) ||
    received.toISOString().slice(0, 10) !== input.reply_date
  ) {
    throw new Error("Enter a valid reply date.");
  }
  const today = now.toISOString().slice(0, 10);
  if (input.reply_date > today) throw new Error("Reply date cannot be in the future.");
  return { reply_date: input.reply_date, content, outcome: input.outcome?.trim() || null };
}

export function recordCandidateReply(
  message: OutreachMessage,
  input: ReplyInput,
  at = timestamp(),
): OutreachMessage {
  if (message.status !== "candidate_confirmed_sent") {
    throw new Error(
      `Confirm that you sent the ${message.channel === "email" ? "email" : "message"} before recording a reply.`,
    );
  }
  const valid = validateReplyInput(input, new Date(at));
  const response: OutreachResponse = {
    response_id: uid("response"),
    ...valid,
    created_at: at,
    source: "candidate_recorded",
    simulated: message.is_demo,
  };
  const events = [
    ...message.history,
    history("reply_recorded", "Candidate-recorded reply", valid.content, message.is_demo, at),
  ];
  if (valid.outcome)
    events.push(
      history("outcome_recorded", "Candidate-recorded outcome", valid.outcome, message.is_demo, at),
    );
  return {
    ...message,
    responses: [...message.responses, response],
    updated_at: at,
    history: events,
  };
}

export class ActionGuard {
  private readonly pending = new Set<string>();
  begin(key: string): boolean {
    if (this.pending.has(key)) return false;
    this.pending.add(key);
    return true;
  }
  end(key: string): void {
    this.pending.delete(key);
  }
}

export function makeTimelineEvent(
  jobId: string,
  type: CareerTimelineEventType,
  title: string,
  detail: string,
  options: {
    draftId?: string | null;
    contactId?: string | null;
    source?: CareerTimelineEvent["source"];
    simulated?: boolean;
    at?: string;
  } = {},
): CareerTimelineEvent {
  return {
    timeline_id: uid("timeline"),
    job_id: jobId,
    draft_id: options.draftId ?? null,
    contact_id: options.contactId ?? null,
    type,
    title,
    detail,
    created_at: options.at ?? timestamp(),
    source: options.source ?? "backend_confirmed",
    simulated: options.simulated ?? false,
  };
}