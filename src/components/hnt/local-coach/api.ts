import { readQuestion } from "./message-scope";
import { z } from "zod";
import type { CareerDocumentInput } from "@/lib/cv-documents";

const webLink = z.url({ protocol: /^https?$/ });
const chat = z.object({ id: z.uuid(), title: z.string() });
const cv = z.object({ filename: z.string(), format: z.string(), characters: z.number().int() });
const card = z.object({
  id: z.string(),
  title: z.string(),
  publisher: z.string(),
  location: z.string().nullable(),
  day: z.string().nullable(),
  precision: z.string().nullable(),
  event: z.string().nullable(),
  industry: z.string().nullable(),
  url: webLink,
  apply_url: webLink.nullable(),
  apply_status: z.string().nullable(),
  verified_form: z.boolean(),
});
const turn = z
  .object({
    id: z.uuid(),
    question: z.string(),
    answer: z.string(),
    sources: z.array(card),
  })
  .transform((row) => ({ ...row, ...readQuestion(row.question) }));
const conversation = z.object({ turns: z.array(turn), focus: z.array(card).nullable() });
export type Conversation = z.infer<typeof conversation>;
const state = z.object({
  inventory: z
    .object({
      counts: z.object({
        postings: z.number(),
        publisherNames: z.number(),
        withDescription: z.number(),
      }),
      observed_at: z.string(),
      pages: z.number(),
    })
    .nullable(),
  cv: cv.nullable(),
  chats: z.array(chat),
  connected: z.boolean(),
  model: z.string(),
  effort: z.string(),
  calendar: z.object({ today: z.string(), week_start: z.string() }),
});
const results = z.object({ total: z.number(), estimated_dates: z.number(), jobs: z.array(card) });
const topic = z.object({
  id: z.string(),
  label: z.string(),
  jobs: z.number().int().positive(),
  advertisers: z.number().int().positive(),
});
const discovery = z.array(z.object({ name: z.string(), topics: z.array(topic).nonempty() }));
const discoveryPage = z.object({
  topic,
  items: z.array(
    z.object({ job: card, evidence: z.string().nullable(), evidence_url: webLink.nullable() }),
  ),
});
export type DiscoveryTopic = z.infer<typeof topic>;
const linked = z.object({ connected: z.boolean() });
export type Workspace = z.infer<typeof state>;
export type Opportunity = z.infer<typeof card>;
export type Turn = z.infer<typeof turn>;

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch("/local-api" + path, {
    method,
    headers: { "X-HNT-Workspace": "local", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const detail: unknown = await response.json().catch(() => null);
    if (
      detail &&
      typeof detail === "object" &&
      "detail" in detail &&
      typeof detail.detail === "string"
    ) {
      throw new Error(detail.detail);
    }
    throw new Error("The local coach server returned an error (HTTP " + response.status + ").");
  }
  return schema.parse(await response.json());
}

export const localCoach = {
  workspace: () => request("/workspace", state),
  discovery: () => request("/discovery", discovery),
  discoveryPage: (id: string, offset: number, limit: number) =>
    request(
      "/discovery/" + encodeURIComponent(id) + "?offset=" + offset + "&limit=" + limit,
      discoveryPage,
    ),
  refresh: () => request("/inventory/refresh", state, "POST"),
  connect: (key: string, effort: string) => request("/connection", linked, "PUT", { key, effort }),
  disconnect: () => request("/connection", linked, "DELETE"),
  saveCv: (doc: CareerDocumentInput) => request("/cv", cv, "PUT", doc),
  newChat: () => request("/chats", chat, "POST"),
  history: (id: string) => request("/chats/" + id, conversation),
  focus: (id: string, ids: string[]) =>
    request("/role-focus/" + id, z.array(card), "PUT", { job_ids: ids }),
  description: (id: string) =>
    request(
      "/role-description/" + encodeURIComponent(id),
      z.object({ description: z.string().nullable() }),
    ),
  send: (chatId: string, id: string, previous_id: string | null, question: string) =>
    request("/chats/" + chatId + "/turns", turn, "POST", { id, previous_id, question }),
  search: (
    terms: string[],
    city: string | null,
    dates: Workspace["calendar"] | null,
    offset: number,
  ) =>
    request("/inventory/search", results, "POST", {
      terms,
      city,
      industry: null,
      company: null,
      date_from: dates?.week_start ?? null,
      date_to: dates?.today ?? null,
      offset,
      limit: 8,
    }),
};
