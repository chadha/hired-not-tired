import { useRef, useState, type FormEvent } from "react";
import { Check, Eye, EyeOff, KeyRound, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { localCoach, type Workspace } from "./api";

export function ConnectionSettings({
  state,
  reload,
}: {
  state: Workspace;
  reload: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [effort, setEffort] = useState(state.effort);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const keyInput = useRef<HTMLInputElement>(null);
  const session = useRef(0);

  function changeOpen(next: boolean) {
    session.current += 1;
    setOpen(next);
    setKey(next && import.meta.env.DEV ? (import.meta.env.VITE_LOCAL_COACH_KEY_PREFILL ?? "") : "");
    setShowKey(false);
    setError("");
    if (next) setEffort(state.effort);
  }

  async function update(remove: boolean) {
    if (busy) return;
    const current = session.current;
    setBusy(true);
    setError("");
    try {
      if (remove) await localCoach.disconnect();
      else await localCoach.connect(key.trim(), effort);
      await reload();
      if (session.current === current) changeOpen(false);
    } catch (cause) {
      if (session.current === current) setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void update(false);
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="coach-button coach-button-outline">
          {state.connected ? <Check size={16} /> : <KeyRound size={16} />}
          {state.connected ? "OpenAI connected" : "Connect API key"}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={10}
        collisionPadding={12}
        aria-labelledby="coach-connection-title"
        className="w-[min(22rem,calc(100vw-1.5rem))] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto rounded-2xl border bg-background p-5 shadow-xl"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          keyInput.current?.focus();
        }}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="coach-connection-title" className="text-lg">
              OpenAI connection
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">{state.model}</p>
          </div>
          <button
            className="coach-icon-button"
            type="button"
            aria-label="Close API key settings"
            onClick={() => changeOpen(false)}
          >
            <X size={17} />
          </button>
        </div>
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-1.5 text-sm font-medium">
            <label htmlFor="coach-api-key">
              {state.connected ? "Replacement API key" : "OpenAI API key"}
            </label>
            <div className="flex items-stretch rounded-lg border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-orange-600">
              <input
                id="coach-api-key"
                ref={keyInput}
                type={showKey ? "text" : "password"}
                spellCheck={false}
                autoComplete="off"
                required
                minLength={10}
                maxLength={1024}
                className="min-w-0 flex-1 rounded-l-lg px-3 py-2 outline-none"
                value={key}
                onChange={(event) => setKey(event.target.value)}
              />
              <button
                className="inline-flex shrink-0 items-center gap-1.5 rounded-r-lg border-l border-slate-300 bg-slate-100 px-3 text-sm font-semibold text-slate-900 hover:bg-slate-200"
                type="button"
                aria-controls="coach-api-key"
                onClick={() => setShowKey((visible) => !visible)}
              >
                {showKey ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
                {showKey ? "Hide key" : "Show key"}
              </button>
            </div>
          </div>
          <label className="grid gap-1.5 text-sm font-medium">
            Reasoning effort
            <select
              className="coach-field"
              value={effort}
              onChange={(event) => setEffort(event.target.value)}
            >
              <option value="low">Low · faster</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="xhigh">Extra high</option>
              <option value="max">Maximum</option>
            </select>
          </label>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Your key stays in memory on your local server. When you send a message, OpenAI receives
            your question, chat context, CV text and relevant job evidence.
          </p>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {state.connected && (
              <button
                className="coach-button coach-button-outline"
                type="button"
                disabled={busy}
                onClick={() => void update(true)}
              >
                Disconnect
              </button>
            )}
            <button className="coach-button coach-button-primary" disabled={busy || !key.trim()}>
              {busy ? "Updating…" : state.connected ? "Update connection" : "Connect"}
            </button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
