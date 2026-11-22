import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Compass, Plus } from "lucide-react";
import { localCoach, type DiscoveryTopic, type Opportunity } from "./api";
import { JobLink } from "./Inventory";
import { RoleActions, type AskCoach } from "./RoleActions";

type Props = { hasCv: boolean; disabled: boolean; onAsk: AskCoach; today: string };
const pageSize = 3;

function counts(topic: DiscoveryTopic) {
  return `${topic.jobs} ${topic.jobs === 1 ? "job" : "jobs"} · ${topic.advertisers} ${topic.advertisers === 1 ? "advertiser" : "advertisers"}`;
}

function TopicResults({
  topic,
  hasCv,
  disabled,
  onAsk,
  today,
  onBack,
}: Props & {
  topic: DiscoveryTopic;
  onBack: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const [picked, setPicked] = useState<Opportunity[]>([]);
  const result = useQuery({
    queryKey: ["hnt-discovery", today, topic.id, offset],
    queryFn: () => localCoach.discoveryPage(topic.id, offset, pageSize),
    staleTime: 60_000,
    retry: false,
  });
  const page = result.data;
  const current = page?.topic ?? topic;
  function toggle(job: Opportunity) {
    setPicked((old) =>
      old.some((j) => j.id === job.id)
        ? old.filter((j) => j.id !== job.id)
        : old.length < 3
          ? [...old, job]
          : old,
    );
  }
  return (
    <div className="coach-topic-results">
      <button onClick={onBack} className="coach-inline-link">
        <ArrowLeft size={14} /> All topics
      </button>
      <div className="coach-topic-heading">
        <div>
          <h3>{current.label}</h3>
          <p>{counts(current)} in your inventory</p>
        </div>
        {picked.length >= 2 && (
          <button
            className="coach-button coach-button-primary"
            disabled={disabled}
            onClick={() =>
              onAsk(
                `Compare these ${picked.length} roles. What would I own, and which looks like the better fit${hasCv ? " for my CV" : ""}?`,
                picked,
              )
            }
          >
            Compare {picked.length} roles <ArrowRight size={14} />
          </button>
        )}
      </div>
      {result.isPending && <p role="status">Finding matching roles…</p>}
      {result.error && (
        <p role="alert">
          {result.error.message}{" "}
          <button className="coach-text-button" onClick={() => void result.refetch()}>
            Try again
          </button>
        </p>
      )}
      {page && (
        <>
          {page.items.map(({ job, evidence, evidence_url }) => {
            const chosen = picked.some((j) => j.id === job.id);
            return (
              <article className="coach-discovery-result" key={job.id}>
                <div className="coach-result-top">
                  <JobLink job={job} />
                  <button
                    className="coach-compare-pick"
                    aria-pressed={chosen}
                    aria-label={`${chosen ? "Remove" : "Select"} ${job.title} at ${job.publisher} for comparison`}
                    disabled={disabled || (!chosen && picked.length >= 3)}
                    onClick={() => toggle(job)}
                  >
                    {chosen ? <Check size={14} /> : <Plus size={14} />}{" "}
                    {chosen ? "Selected" : "Compare"}
                  </button>
                </div>
                {evidence && (
                  <p className="coach-evidence">
                    {evidence}{" "}
                    {evidence_url && (
                      <a href={evidence_url} target="_blank" rel="noreferrer">
                        Source
                      </a>
                    )}
                  </p>
                )}
                <RoleActions job={job} hasCv={hasCv} disabled={disabled} onAsk={onAsk} />
              </article>
            );
          })}
          <div className="coach-topic-pages">
            <button
              className="coach-inline-link"
              disabled={!offset}
              onClick={() => setOffset(offset - pageSize)}
            >
              Previous
            </button>
            <span>
              {offset + 1}–{Math.min(offset + pageSize, page.topic.jobs)} of {page.topic.jobs}
            </span>
            <button
              className="coach-inline-link"
              disabled={offset + pageSize >= page.topic.jobs}
              onClick={() => setOffset(offset + pageSize)}
            >
              Next <ArrowRight size={13} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function Discovery({ initiallyOpen, ...props }: Props & { initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [section, setSection] = useState<string | null>(null);
  const [topic, setTopic] = useState<DiscoveryTopic | null>(null);
  const [more, setMore] = useState(false);
  const topics = useQuery({
    queryKey: ["hnt-discovery", props.today, "topics"],
    queryFn: localCoach.discovery,
    enabled: open,
    staleTime: 60_000,
    retry: false,
  });
  const active = section ? topics.data?.find((s) => s.name === section) : topics.data?.[0];
  function ask(q: string, roles: Opportunity[]) {
    setOpen(false);
    props.onAsk(q, roles);
  }
  return (
    <section className="coach-discovery">
      <button
        className="coach-discovery-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="coach-discovery-icon">
          <Compass size={20} />
        </span>
        <span>Discover your inventory</span>
        <ChevronDown size={17} />
      </button>
      {open && (
        <div className="coach-discovery-body">
          {topic ? (
            <TopicResults
              key={topic.id}
              {...props}
              onAsk={ask}
              topic={topic}
              onBack={() => setTopic(null)}
            />
          ) : (
            <>
              {topics.isPending && <p role="status">Loading topics from your inventory…</p>}
              {topics.error && (
                <p role="alert">
                  {topics.error.message}{" "}
                  <button className="coach-text-button" onClick={() => void topics.refetch()}>
                    Try again
                  </button>
                </p>
              )}
              {topics.data?.length === 0 && (
                <p>No discovery topics are available in this inventory yet.</p>
              )}
              {active && (
                <>
                  <div
                    className="coach-topic-sections"
                    role="group"
                    aria-label="Discovery categories"
                  >
                    {topics.data?.map((s) => (
                      <button
                        key={s.name}
                        aria-pressed={s.name === active.name}
                        onClick={() => {
                          setSection(s.name);
                          setMore(false);
                        }}
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                  <div className="coach-topic-options">
                    {active.topics.slice(0, more ? undefined : 4).map((t) => (
                      <button key={t.id} onClick={() => setTopic(t)}>
                        <span>
                          <strong>{t.label}</strong>
                          <small>{counts(t)}</small>
                        </span>
                        <ArrowRight size={15} />
                      </button>
                    ))}
                  </div>
                  {active.topics.length > 4 && (
                    <button className="coach-inline-link" onClick={() => setMore(!more)}>
                      {more ? "Show fewer" : `Show ${active.topics.length - 4} more topics`}
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
