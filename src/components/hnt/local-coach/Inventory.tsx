import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RoleActions, type AskCoach } from "./RoleActions";
import { localCoach, type Opportunity, type Workspace } from "./api";

export function JobLink({ job }: { job: Opportunity }) {
  return (
    <article className="coach-job">
      <a
        className="font-semibold underline decoration-border underline-offset-4 hover:text-primary"
        href={job.url}
        target="_blank"
        rel="noreferrer"
      >
        {job.title}
      </a>
      <div className="mt-1 text-sm">
        {job.publisher}
        {job.location && ` · ${job.location}`}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {job.day && (
          <span>
            {job.event === "reposted" ? "Reposted" : "Posted"} · {job.day}
            {job.precision === "estimated_day" ? " (estimated)" : ""}
          </span>
        )}
        {job.industry && (
          <span>
            {job.day && " · "}
            {job.industry}
          </span>
        )}
      </div>
      {job.apply_status === "employer_page_closed" ? (
        <small>The employer has closed this role.</small>
      ) : (
        job.apply_url && (
          <a
            className="mt-1 inline-block text-sm underline"
            href={job.apply_url}
            target="_blank"
            rel="noreferrer"
          >
            {job.verified_form ? "Open verified application form" : "View application link"}
          </a>
        )
      )}
    </article>
  );
}

export function Inventory({
  state,
  onAsk,
  disabled,
}: {
  state: Workspace;
  onAsk: AskCoach;
  disabled: boolean;
}) {
  const [text, setText] = useState("");
  const [city, setCity] = useState("");
  const [weekly, setWeekly] = useState(false);
  const [filters, setFilters] = useState({ text: "", city: "", weekly: false });
  const [offset, setOffset] = useState(0);
  const results = useQuery({
    queryKey: [
      "hnt-inventory",
      filters,
      offset,
      state.inventory?.observed_at,
      state.calendar.today,
    ],
    queryFn: () =>
      localCoach.search(
        filters.text ? [filters.text] : [],
        filters.city || null,
        filters.weekly ? state.calendar : null,
        offset,
      ),
  });
  return (
    <section className="coach-inventory space-y-4">
      <h1 className="coach-chat-heading">Job inventory</h1>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setFilters({ text: text.trim(), city: city.trim(), weekly });
          setOffset(0);
        }}
      >
        <label className="grid flex-1 gap-1 text-sm">
          Role, company or keyword
          <input
            className="coach-field"
            placeholder="Product manager"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          City
          <input
            className="coach-field w-32"
            placeholder="Berlin"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 py-2 text-sm">
          <input type="checkbox" checked={weekly} onChange={(e) => setWeekly(e.target.checked)} />
          This week
        </label>
        <button className="coach-button coach-button-primary">Search</button>
      </form>
      {results.isPending && <p role="status">Searching your inventory…</p>}
      {results.error && <p role="alert">{results.error.message}</p>}
      {results.data && (
        <>
          <p className="text-sm text-muted-foreground">
            {results.data.total.toLocaleString("en")}{" "}
            {results.data.total === 1 ? "matching job" : "matching jobs"} ·{" "}
            {results.data.estimated_dates.toLocaleString("en")} with estimated dates
          </p>
          {results.data.jobs.map((job) => (
            <div key={job.id} className="coach-result">
              <JobLink job={job} />
              <RoleActions job={job} hasCv={!!state.cv} disabled={disabled} onAsk={onAsk} />
            </div>
          ))}
          <div className="flex justify-between">
            <button
              className="coach-button coach-button-outline"
              disabled={!offset}
              onClick={() => setOffset(Math.max(0, offset - 8))}
            >
              Previous
            </button>
            <button
              className="coach-button coach-button-outline"
              disabled={offset + 8 >= results.data.total}
              onClick={() => setOffset(offset + 8)}
            >
              Next
            </button>
          </div>
        </>
      )}
    </section>
  );
}
