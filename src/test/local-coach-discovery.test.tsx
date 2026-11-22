import { useState } from "react";
import { scopeQuestion, readQuestion } from "@/components/hnt/local-coach/message-scope";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import LocalCoach from "@/components/hnt/local-coach/LocalCoach";
import { CoachAnswer } from "@/components/hnt/local-coach/CoachAnswer";
import { Discovery } from "@/components/hnt/local-coach/Discovery";
import {
  localCoach,
  type Opportunity,
  type Turn,
  type Workspace,
} from "@/components/hnt/local-coach/api";

vi.mock("@/components/hnt/brand", () => ({ Logo: () => <span>Hired Not Tired</span> }));

const job = (id: string, publisher: string): Opportunity => ({
  id,
  title: "Product Manager",
  publisher,
  location: "Berlin",
  day: null,
  precision: null,
  event: null,
  industry: null,
  url: "https://example.com/jobs/" + id,
  apply_url: null,
  apply_status: null,
  verified_form: false,
});
const jobs = [job("1000001", "First company"), job("1000002", "Second company")];
const chat = { id: "10000000-0000-4000-8000-000000000001", title: "Question" };
const workspace: Workspace = {
  cv: null,
  chats: [chat],
  inventory: null,
  model: "test-model",
  effort: "xhigh",
  connected: true,
  calendar: { today: "2026-11-22", week_start: "2026-11-16" },
};
function withCache(element: React.ReactElement) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {element}
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("presents a stored recommendation as switchable roles and sends the selected evidence ID", () => {
  const ask = vi.fn();
  const turn: Turn = {
    id: chat.id,
    question: "Which roles?",
    answer: `Intro.\n\n### 1. Product Manager — First company\n**ID 1000001**\n\n- First fact\n\n### 2. Product Manager — Second company\n**ID 1000002**\n\n[External](https://unlisted.example)\n\n[Posting](https://example.com/jobs/1000002)`,
    sources: jobs,
    references: [],
  };
  function Switchable() {
    const [selected, choose] = useState<string | null>(jobs[0]!.id);
    return (
      <CoachAnswer
        activeId={selected}
        onSelect={(j) => choose(j.id)}
        turn={turn}
        urls={new Set(jobs.map((j) => j.url))}
        hasCv
        disabled={false}
        onAsk={ask}
      />
    );
  }
  render(<Switchable />);
  expect(screen.getByRole("heading", { name: "Your shortlist" })).toBeVisible();
  expect(screen.getByRole("listitem")).toHaveTextContent("First fact");
  fireEvent.click(screen.getByRole("button", { name: /Second company/ }));
  expect(screen.queryByText("First fact")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "External" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Posting" })).toHaveAttribute("href", jobs[1]!.url);
  fireEvent.click(screen.getByRole("button", { name: "Company brief" }));
  expect(ask).toHaveBeenCalledWith(expect.stringContaining("company"), [jobs[1]]);
});

it("renders a new comparison table and selects just the jobs cited in its links", () => {
  const turn: Turn = {
    id: chat.id,
    question: "What is different?",
    answer: `| Posting | Location |\n| --- | --- |\n| [Compare this posting](${jobs[1]!.url}) | Berlin |`,
    sources: jobs,
    references: [],
  };
  render(
    <CoachAnswer
      activeId={null}
      onSelect={vi.fn()}
      turn={turn}
      urls={new Set(jobs.map((j) => j.url))}
      hasCv={false}
      disabled={false}
      onAsk={vi.fn()}
    />,
  );
  expect(screen.getByRole("table")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Roles in this answer" })).toBeVisible();
  expect(screen.getByRole("button", { name: /Second company/ })).toBeVisible();
  expect(screen.queryByRole("button", { name: /First company/ })).toBeNull();
});

it("shows and clears a pending reply while the actual send is unresolved, with one request", async () => {
  const turn: Turn = {
    id: chat.id,
    question: "Show roles",
    answer: "Here are the roles.",
    sources: [],
    references: [],
  };
  vi.spyOn(localCoach, "workspace").mockResolvedValue(workspace);
  vi.spyOn(localCoach, "history").mockResolvedValue({ turns: [], focus: null });
  vi.spyOn(localCoach, "discovery").mockResolvedValue([]);
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  let resolve!: (value: Turn) => void;
  const send = vi.spyOn(localCoach, "send").mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  withCache(<LocalCoach />);
  const box = await screen.findByRole("textbox", { name: "Talk to your coach" });
  await screen.findByText("No discovery topics are available in this inventory yet.");
  fireEvent.change(box, { target: { value: "Show roles" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(screen.getByLabelText("Coach response in progress")).toBeVisible();
  expect(screen.getByRole("button", { name: "Waiting…" })).toBeDisabled();
  expect(send).toHaveBeenCalledTimes(1);
  await act(async () => resolve(turn));
  expect(await screen.findByText("Here are the roles.")).toBeVisible();
  expect(screen.queryByLabelText("Coach response in progress")).not.toBeInTheDocument();
});

it("opens an inventory topic locally and compares only the selected roles", async () => {
  const topic = { id: "size-2-10", label: "2–10 employees", jobs: 2, advertisers: 2 };
  vi.spyOn(localCoach, "discovery").mockResolvedValue([{ name: "Companies", topics: [topic] }]);
  vi.spyOn(localCoach, "discoveryPage").mockResolvedValue({
    topic,
    items: jobs.map((job) => ({ job, evidence: "2–10 employees", evidence_url: null })),
  });
  const ask = vi.fn();
  withCache(
    <Discovery
      initiallyOpen
      hasCv={false}
      disabled={false}
      today={workspace.calendar.today}
      onAsk={ask}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: /2–10 employees/ }));
  for (const j of jobs)
    fireEvent.click(
      await screen.findByRole("button", {
        name: `Select ${j.title} at ${j.publisher} for comparison`,
      }),
    );
  expect(ask).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Compare 2 roles" }));
  expect(ask).toHaveBeenCalledWith(expect.stringContaining("Compare these 2 roles"), jobs);
});

it("keeps the draft while choosing the second role and sends that exact reference", async () => {
  const stored: Turn = {
    id: chat.id,
    question: "Options?",
    references: [],
    answer:
      "### First company · Product Manager\nJob ID 1000001\n\n### Second company · Product Manager\nJob ID 1000002",
    sources: jobs,
  };
  vi.spyOn(localCoach, "workspace").mockResolvedValue(workspace);
  vi.spyOn(localCoach, "history").mockResolvedValue({ turns: [stored], focus: null });
  const focus = vi.spyOn(localCoach, "focus").mockResolvedValue([jobs[1]!]);
  const send = vi
    .spyOn(localCoach, "send")
    .mockResolvedValue({ ...stored, id: "30000000-0000-4000-8000-000000000003" });
  withCache(<LocalCoach />);
  const box = await screen.findByRole("textbox", { name: "Talk to your coach" });
  await screen.findByText("Which role is this message about?");
  fireEvent.change(box, { target: { value: "Explain this role" } });
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "2 Second company Product Manager" }));
  await screen.findByText("Current role", { selector: "b" });
  expect(box).toHaveValue("Explain this role");
  expect(focus).toHaveBeenCalledWith(chat.id, ["1000002"]);
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  const message = send.mock.calls[0]![3];
  expect(readQuestion(message)).toEqual({
    question: "Explain this role",
    references: ["Product Manager · Second company (job 1000002)"],
  });
  expect(message).toBe(scopeQuestion("Explain this role", [jobs[1]!]));
});

it("restores the explicit role for a deep-linked chat even if a newer chat exists", async () => {
  window.history.replaceState(null, "", "/coach?chat=" + chat.id);
  vi.spyOn(localCoach, "workspace").mockResolvedValue({
    ...workspace,
    chats: [{ id: "20000000-0000-4000-8000-000000000002", title: "Other chat" }, chat],
  });
  const history = vi
    .spyOn(localCoach, "history")
    .mockResolvedValue({ turns: [], focus: [jobs[1]!] });
  vi.spyOn(localCoach, "discovery").mockResolvedValue([]);
  vi.spyOn(localCoach, "description").mockResolvedValue({
    description: "Original description for second role",
  });
  withCache(<LocalCoach />);
  await screen.findByText("Current role", { selector: "b" });
  expect(history).toHaveBeenCalledWith(chat.id);
  fireEvent.click(screen.getByRole("button", { name: "Job description" }));
  await screen.findByText("Original description for second role");
  expect(localCoach.description).toHaveBeenCalledWith("1000002");
});
