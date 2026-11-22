import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Check, FileText, MessageSquare, X } from "lucide-react";
import { localCoach, type Opportunity } from "./api";

export function RoleFocus({
  roles,
  choices,
  needsChoice,
  disabled,
  onSelect,
}: {
  roles: Opportunity[];
  choices: Opportunity[];
  needsChoice: boolean;
  disabled: boolean;
  onSelect: (roles: Opportunity[]) => void;
}) {
  const [picker, setPicker] = useState(false);
  const [descriptionId, showDescription] = useState<string | null>(null);
  const one = roles.length === 1 ? roles[0] : undefined;
  const showing = !!one && descriptionId === one.id;
  const jd = useQuery({
    queryKey: ["hnt-role-description", one?.id],
    queryFn: () => localCoach.description(one!.id),
    enabled: showing,
    staleTime: 60_000,
    retry: false,
  });
  function choose(next: Opportunity[]) {
    setPicker(false);
    showDescription(null);
    onSelect(next);
  }
  if (!choices.length && !roles.length) return null;
  return (
    <section aria-label="Conversation focus" className="hnt-focus">
      <div className="hnt-focus-top">
        <MessageSquare size={16} />
        <b>
          {one
            ? "Current role"
            : needsChoice
              ? "Choose a role to discuss"
              : roles.length
                ? "Comparing roles"
                : "General conversation"}
        </b>
        <button
          type="button"
          disabled={disabled}
          aria-expanded={picker}
          onClick={() => setPicker(!picker)}
        >
          {picker ? "Close choices" : one ? "Change role" : "Choose role"}
        </button>
      </div>
      {one && (
        <>
          <h2>{one.title}</h2>
          <p>
            {one.publisher}
            {one.location && " · " + one.location}
          </p>
          <div className="hnt-focus-links">
            <button
              type="button"
              aria-expanded={showing}
              onClick={() => showDescription(showing ? null : one.id)}
            >
              <FileText size={14} />
              {showing ? "Hide description" : "Job description"}
            </button>
            <a href={one.url} target="_blank" rel="noreferrer">
              Original posting <ArrowUpRight size={13} />
            </a>
            {one.apply_status === "employer_page_closed" ? (
              <span>Closed by employer</span>
            ) : (
              one.apply_url &&
              one.apply_url !== one.url && (
                <a href={one.apply_url} target="_blank" rel="noreferrer">
                  Application link · {one.publisher} <ArrowUpRight size={13} />
                </a>
              )
            )}
          </div>
          {showing && (
            <div className="hnt-focus-jd">
              {jd.isPending ? (
                "Loading job description…"
              ) : jd.error ? (
                <span role="alert">
                  {jd.error.message} <button onClick={() => void jd.refetch()}>Retry</button>
                </span>
              ) : (
                jd.data?.description ||
                "The original description has not been captured. You can check the original posting above."
              )}
            </div>
          )}
        </>
      )}
      {(needsChoice || (!one && roles.length > 1)) && (
        <div className="hnt-focus-options">
          {(roles.length ? roles : choices).map((j) => (
            <button key={j.id} disabled={disabled} onClick={() => choose([j])}>
              {j.publisher} · {j.title}
            </button>
          ))}
        </div>
      )}
      {picker && (
        <div className="hnt-focus-options" aria-label="Switch conversation focus">
          {choices.map((j) => (
            <button
              key={j.id}
              disabled={disabled}
              aria-pressed={one?.id === j.id}
              onClick={() => choose([j])}
            >
              {one?.id === j.id && <Check size={13} />} {j.publisher} · {j.title}
            </button>
          ))}
          <button disabled={disabled} onClick={() => choose([])}>
            <X size={13} /> General conversation
          </button>
        </div>
      )}
    </section>
  );
}
