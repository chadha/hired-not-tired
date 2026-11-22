import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUp,
  FileText,
  KeyRound,
  MessageSquare,
  Paperclip,
  Plus,
  RefreshCw,
} from "lucide-react";
import { Logo } from "@/components/hnt/brand";
import { extractCareerDocument } from "@/lib/cv-documents";
import { ConnectionSettings } from "./ConnectionSettings";
import "./local-coach.css";
import { localCoach, type Opportunity, type Conversation, type Workspace } from "./api";
import { Inventory } from "./Inventory";
import { Discovery } from "./Discovery";
import { CoachAnswer, AnswerSources, rolesInAnswer } from "./CoachAnswer";
import { PendingAnswer, type PendingReply } from "./PendingAnswer";

import { RoleFocus } from "./RoleFocus";
import { RoleActions } from "./RoleActions";
import { scopeQuestion } from "./message-scope";

export default function LocalCoach() {
  const cache = useQueryClient();
  const state = useQuery({
    queryKey: ["hnt-local-workspace"],
    queryFn: localCoach.workspace,
    retry: false,
  });
  const [selected, selectChat] = useState<string | null>(null);
  const [allowGroup, setAllowGroup] = useState(false);
  function select(id: string) {
    selectChat(id);
    const url = new URL(window.location.href);
    url.searchParams.set("chat", id);
    window.history.replaceState(window.history.state, "", url);
    setAllowGroup(false);
  }
  const [view, setView] = useState<"chat" | "jobs">("chat");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"send" | "new" | "cv" | "sync" | "focus" | null>(null);
  const [problem, setProblem] = useState("");
  const [pending, setPending] = useState<PendingReply | null>(null);
  const [notice, setNotice] = useState("");
  const retry = useRef<{ chat: string; text: string; id: string } | null>(null);
  const action = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const data = state.data;
  const chat = selected;
  useEffect(() => {
    if (!selected && data?.chats.length) {
      const saved = new URL(window.location.href).searchParams.get("chat");
      select(data.chats.find((c) => c.id === saved)?.id ?? data.chats[0]!.id);
    }
  }, [data?.chats, selected]);
  const history = useQuery({
    queryKey: ["hnt-local-turns", chat],
    queryFn: () => localCoach.history(chat!),
    refetchOnWindowFocus: false,
    enabled: Boolean(chat),
    retry: false,
  });
  const turns = history.data?.turns ?? [];
  const citedUrls = useMemo(
    () =>
      new Set(
        history.data?.turns.flatMap((t) =>
          t.sources.flatMap((s) => (s.apply_url ? [s.url, s.apply_url] : [s.url])),
        ),
      ),
    [history.data?.turns],
  );
  const lists = useMemo(
    () =>
      history.data?.turns
        .map((t) => rolesInAnswer(t, citedUrls))
        .filter((l) => l.length)
        .reverse() ?? [],
    [history.data?.turns, citedUrls],
  );
  const focus = history.data?.focus ?? lists[0] ?? [];
  const choices = [...new Map([...focus, ...lists.flat()].map((j) => [j.id, j])).values()];
  const needsChoice = focus.length > 1 && !allowGroup;
  const activeRole = focus.length === 1 ? focus[0] : undefined;
  useEffect(() => {
    if (pending) end.current?.scrollIntoView({ block: "nearest" });
  }, [pending?.started]);
  const reload = async () => {
    await cache.invalidateQueries({ queryKey: ["hnt-local-workspace"] });
  };

  async function run(kind: NonNullable<typeof busy>, work: () => Promise<void>) {
    if (action.current) return;
    action.current = true;
    setBusy(kind);
    setProblem("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(null);
      action.current = false;
    }
  }
  async function createChat() {
    const newly = await localCoach.newChat();
    cache.setQueryData<Conversation>(["hnt-local-turns", newly.id], { turns: [], focus: null });
    select(newly.id);
    setView("chat");
    cache.setQueryData<Workspace>(
      ["hnt-local-workspace"],
      (old) => old && { ...old, chats: [newly, ...old.chats] },
    );
    return newly.id;
  }
  async function saveFocus(id: string, roles: Opportunity[]) {
    await cache.cancelQueries({ queryKey: ["hnt-local-turns", id] });
    const saved = await localCoach.focus(
      id,
      roles.map((j) => j.id),
    );
    cache.setQueryData<Conversation>(
      ["hnt-local-turns", id],
      (old) => old && { ...old, focus: saved },
    );
    setAllowGroup(false);
    return saved;
  }
  function pick(roles: Opportunity[]) {
    void run("focus", async () => {
      const id = chat ?? (await createChat());
      await saveFocus(id, roles);
      setView("chat");
    });
  }
  async function sendQuestion(question: string, fromComposer: boolean, roles: Opportunity[]) {
    if (!question || busy || !data?.connected || (chat && !history.isSuccess)) return;
    await run("send", async () => {
      const started = Date.now();
      setView("chat");
      setPending({ question, started, phase: chat ? "waiting" : "opening" });
      if (fromComposer) setDraft("");
      let id = chat;
      try {
        if (!id) {
          id = await createChat();
          setPending({ question, started, phase: "waiting" });
        }
        const saved = history.data?.focus;
        const sameScope =
          saved && saved.length === roles.length && saved.every((j, i) => j.id === roles[i]?.id);
        if (!sameScope && (roles.length || saved?.length)) roles = await saveFocus(id, roles);
        const message = scopeQuestion(question, roles);
        if (message.length > 12000)
          throw new Error("Please shorten your message to leave room for the role references.");
        const request =
          retry.current?.chat === id && retry.current.text === message
            ? retry.current
            : { chat: id, text: message, id: crypto.randomUUID() };
        retry.current = request;

        const result = await localCoach.send(id, request.id, turns.at(-1)?.id ?? null, message);
        cache.setQueryData<Conversation>(
          ["hnt-local-turns", id],
          (old) =>
            old && { ...old, turns: [...old.turns.filter((t) => t.id !== result.id), result] },
        );
        setAllowGroup(false);
        retry.current = null;
        if (!turns.length) void reload();
      } catch (error) {
        if (fromComposer || !draft.trim()) setDraft(question);
        if (id) void cache.invalidateQueries({ queryKey: ["hnt-local-turns", id] });
        throw error;
      } finally {
        setPending(null);
      }
    });
  }
  function send(event: FormEvent) {
    event.preventDefault();
    if (!needsChoice) void sendQuestion(draft.trim(), true, focus);
  }
  function ask(text: string, roles: Opportunity[]) {
    if (action.current) return;
    if (draft.trim()) {
      void run("focus", async () => {
        await saveFocus(chat ?? (await createChat()), roles);
        setView("chat");
        setNotice("Role context updated. Your draft is ready to review.");
        requestAnimationFrame(() => input.current?.focus());
      });
      return;
    }
    if (data?.connected) {
      void sendQuestion(text, false, roles);
      return;
    }
    void run("focus", async () => {
      await saveFocus(chat ?? (await createChat()), roles);
      setAllowGroup(roles.length > 1);
      setNotice("Your question is ready. Connect your API key, then select Send.");
      setView("chat");
      setDraft(text);
      setProblem("");
      requestAnimationFrame(() => input.current?.focus());
    });
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <Logo />
        <p className="my-6" role={state.error ? "alert" : "status"}>
          {state.error ? state.error.message : "Opening your workspace…"}
        </p>
        {state.error && (
          <button
            className="coach-button coach-button-outline"
            onClick={() => void state.refetch()}
          >
            Try again
          </button>
        )}
      </main>
    );
  }

  if (!chat && data.chats.length)
    return (
      <main aria-busy="true" className="p-8">
        Opening your conversation…
      </main>
    );
  const showStarters = !turns.length && !pending && (!chat || history.isSuccess);
  return (
    <div className="coach-workspace">
      <header className="coach-header">
        <div className="coach-header-inner">
          <Logo />
          <div className="coach-header-actions">
            <input
              type="file"
              ref={file}
              hidden
              accept=".pdf,.docx,.txt,.md"
              aria-label="CV file"
              onChange={(event) => {
                const doc = event.target.files?.[0];
                event.target.value = "";
                if (doc)
                  void run("cv", async () => {
                    const parsed = await extractCareerDocument(doc);
                    const saved = await localCoach.saveCv(parsed);
                    await reload();
                    setNotice(
                      `Saved ${saved.filename} · ${saved.characters.toLocaleString("en")} characters read.`,
                    );
                  });
              }}
            />
            <button
              className="coach-button coach-button-outline"
              disabled={!!busy}
              onClick={() => file.current?.click()}
            >
              <Paperclip size={16} />{" "}
              {busy === "cv" ? "Reading CV…" : data.cv ? "Replace CV" : "Upload CV"}
            </button>
            <ConnectionSettings state={data} reload={reload} />
          </div>
        </div>
      </header>
      <main className="coach-layout">
        <aside className="coach-sidebar" aria-label="Workspace navigation">
          <button
            className="coach-button coach-button-primary coach-new-chat"
            disabled={!!busy}
            onClick={() =>
              void run("new", async () => {
                await createChat();
                setDraft("");
                retry.current = null;
                requestAnimationFrame(() => input.current?.focus());
              })
            }
          >
            <Plus size={17} /> New chat
          </button>
          {data.chats.length > 0 && (
            <div className="coach-history">
              <h2 className="coach-nav-label">Conversations</h2>
              <nav aria-label="Conversations" className="grid max-h-52 gap-1 overflow-y-auto">
                {data.chats.map((c) => (
                  <button
                    key={c.id}
                    disabled={!!busy}
                    title={c.title}
                    aria-current={c.id === chat && view === "chat" ? "page" : undefined}
                    className="coach-chat-link"
                    onClick={() => {
                      select(c.id);
                      setView("chat");
                      setDraft("");
                      setProblem("");
                      retry.current = null;
                    }}
                  >
                    <MessageSquare size={15} />
                    <span className="truncate">{c.title}</span>
                  </button>
                ))}
              </nav>
            </div>
          )}
          <div className="coach-library">
            <div className="flex items-center justify-between gap-2">
              <h2 className="coach-nav-label">Job inventory</h2>
              <button
                className="coach-icon-button"
                title="Refresh inventory"
                aria-label="Refresh inventory"
                disabled={!!busy}
                onClick={() =>
                  void run("sync", async () => {
                    const fresh = await localCoach.refresh();
                    cache.setQueryData(["hnt-local-workspace"], fresh);
                    await cache.invalidateQueries({ queryKey: ["hnt-inventory"] });
                    await cache.invalidateQueries({ queryKey: ["hnt-discovery"] });
                    setNotice("Job inventory refreshed.");
                  })
                }
              >
                <RefreshCw
                  size={14}
                  className={busy === "sync" ? "motion-safe:animate-spin" : ""}
                />
              </button>
            </div>
            {data.inventory && (
              <p className="coach-inventory-count">
                <strong>{data.inventory.counts.postings.toLocaleString("en")}</strong> jobs
                <br />
                <span>
                  from {data.inventory.counts.publisherNames.toLocaleString("en")} advertisers
                </span>
              </p>
            )}
            <button
              className="coach-browse"
              disabled={!!busy}
              onClick={() => {
                setView(view === "jobs" ? "chat" : "jobs");
                setProblem("");
              }}
            >
              {view === "jobs" ? "Back to coach" : "Browse jobs"} <ArrowRight size={14} />
            </button>
          </div>
          {data.cv && (
            <p className="coach-cv-file">
              <FileText size={15} />
              <span>{data.cv.filename}</span>
            </p>
          )}
        </aside>
        <section
          className="coach-main"
          aria-label={view === "jobs" ? "Job inventory" : "Career coach"}
        >
          {(problem || notice) && (
            <p className="coach-feedback" role={problem ? "alert" : "status"}>
              {problem || notice}
            </p>
          )}
          {view === "jobs" ? (
            <Inventory
              state={data}
              onAsk={ask}
              disabled={!!busy || (!!chat && !history.isSuccess)}
            />
          ) : (
            <>
              {showStarters ? (
                <>
                  <div className="coach-intro">
                    <h1>Your PM career coach</h1>
                    <p>
                      Find your next product role, see where your experience fits, and write a cover
                      letter together.
                    </p>
                  </div>
                </>
              ) : (
                <h1 className="coach-chat-heading">Your PM career coach</h1>
              )}
              {(!chat || history.isSuccess) && (
                <Discovery
                  key={chat}
                  initiallyOpen={showStarters}
                  hasCv={!!data.cv}
                  disabled={!!busy}
                  onAsk={ask}
                  today={data.calendar.today}
                />
              )}
              {history.isSuccess && (
                <RoleFocus
                  key={chat}
                  roles={focus}
                  choices={choices}
                  needsChoice={needsChoice}
                  disabled={!!busy}
                  onSelect={pick}
                />
              )}
              {history.error && <p role="alert">{history.error.message}</p>}
              {chat && history.isPending && <p role="status">Opening conversation…</p>}
              {(turns.length > 0 || pending) && (
                <div className="coach-transcript">
                  {turns.map((t) => (
                    <article key={t.id} className="space-y-4">
                      <div className="coach-question">
                        {t.references.length > 0 && (
                          <div className="hnt-message-refs">
                            {t.references.map((ref) => (
                              <span key={ref}>{ref}</span>
                            ))}
                          </div>
                        )}
                        {t.question}
                      </div>
                      <CoachAnswer
                        activeId={activeRole?.id ?? null}
                        onSelect={(job) => pick([job])}
                        turn={t}
                        urls={citedUrls}
                        hasCv={!!data.cv}
                        disabled={!!busy}
                        onAsk={ask}
                      />
                      <div className="flex flex-wrap items-start gap-4 text-sm">
                        <button
                          className="coach-text-button"
                          onClick={() =>
                            void navigator.clipboard.writeText(t.answer).then(
                              () => setNotice("Answer copied."),
                              () => setProblem("Your browser could not copy this answer."),
                            )
                          }
                        >
                          Copy answer
                        </button>
                        <AnswerSources sources={t.sources} />
                      </div>
                    </article>
                  ))}
                  {pending && (
                    <div ref={end}>
                      <PendingAnswer reply={pending} />
                    </div>
                  )}
                </div>
              )}
              <form onSubmit={send} className="coach-composer">
                <label htmlFor="local-question">Talk to your coach</label>
                {activeRole && (
                  <>
                    <p className="hnt-compose-scope">
                      Discussing <strong>{activeRole.title}</strong> · {activeRole.publisher}
                    </p>
                    <RoleActions job={activeRole} hasCv={!!data.cv} disabled={!!busy} onAsk={ask} />
                  </>
                )}
                {focus.length > 1 && (
                  <div className="hnt-compose-choices">
                    <p>
                      {needsChoice
                        ? "Which role is this message about?"
                        : "This message compares the selected roles."}
                    </p>
                    {focus.map((j) => (
                      <button key={j.id} type="button" disabled={!!busy} onClick={() => pick([j])}>
                        {j.publisher} · {j.title}
                      </button>
                    ))}
                    {focus.length <= 3 && needsChoice && (
                      <button type="button" disabled={!!busy} onClick={() => setAllowGroup(true)}>
                        Ask about all {focus.length} roles
                      </button>
                    )}
                  </div>
                )}
                <textarea
                  id="local-question"
                  ref={input}
                  rows={3}
                  maxLength={12000}
                  value={draft}
                  disabled={!!busy}
                  placeholder="Ask about a role, compare companies, or start a cover letter…"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                <div className="coach-composer-actions">
                  <span>
                    <KeyRound size={13} />
                    {data.connected
                      ? data.model + " · " + data.effort
                      : "Connect your API key to chat."}
                  </span>
                  <button
                    className="coach-button coach-button-primary"
                    disabled={
                      !!busy ||
                      needsChoice ||
                      !data.connected ||
                      !draft.trim() ||
                      (!!chat && !history.isSuccess)
                    }
                  >
                    {busy === "send" ? "Waiting…" : "Send"} <ArrowUp size={15} />
                  </button>
                </div>
              </form>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
