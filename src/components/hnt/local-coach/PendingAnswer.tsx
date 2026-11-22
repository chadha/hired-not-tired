import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";

export type PendingReply = { question: string; started: number; phase: "opening" | "waiting" };

export function PendingAnswer({ reply }: { reply: PendingReply }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, []);
  const seconds = Math.max(0, Math.floor((now - reply.started) / 1000));
  const time = Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
  const label =
    reply.phase === "opening" ? "Opening your conversation…" : "Waiting for your coach’s reply…";
  return (
    <div className="coach-pending">
      <p className="coach-question">{reply.question}</p>
      <div className="coach-pending-card" aria-busy="true" aria-label="Coach response in progress">
        <div className="coach-pending-title">
          <LoaderCircle size={17} className="motion-safe:animate-spin" />
          <strong>Career coach</strong>
          <span aria-hidden="true">{time}</span>
        </div>
        <p>{label}</p>
        <div className="coach-skeleton" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        {seconds >= 25 && reply.phase === "waiting" && (
          <small>Your request is still pending. You can keep this conversation open.</small>
        )}
      </div>
      <span className="sr-only" role="status">
        {label}
      </span>
    </div>
  );
}
