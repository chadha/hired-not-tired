import type { Opportunity } from "./api";

export type AskCoach = (question: string, roles: Opportunity[]) => void;

export function RoleActions({
  job,
  hasCv,
  disabled,
  onAsk,
}: {
  job: Opportunity;
  hasCv: boolean;
  disabled: boolean;
  onAsk: AskCoach;
}) {
  return (
    <div className="coach-role-actions" aria-label={`Ask about ${job.title}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onAsk("What would I own in this role?", [job])}
      >
        Explore the role
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onAsk("What does this company build, and who are its customers?", [job])}
      >
        Company brief
      </button>
      {hasCv && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onAsk("Where does my CV match this role, and what are the gaps?", [job])}
        >
          Check my fit
        </button>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onAsk("Help me draft a cover letter for this role.", [job])}
      >
        Draft a letter
      </button>
    </div>
  );
}
