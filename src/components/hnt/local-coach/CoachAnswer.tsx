import { Children, isValidElement, useMemo, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  MapPin,
  MessageSquareText,
} from "lucide-react";
import { compiler } from "markdown-to-jsx";
import type { Opportunity, Turn } from "./api";
import { RoleActions, type AskCoach } from "./RoleActions";
import { JobLink } from "./Inventory";

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  return isValidElement<{ children?: ReactNode }>(node) ? nodeText(node.props.children) : "";
}

function safeBlocks(answer: string, urls: Set<string>) {
  const compiled = compiler(answer, {
    forceBlock: true,
    forceWrapper: true,
    wrapper: "div",
    disableParsingRawHTML: true,
    disableAutoLink: true,
    overrides: {
      a: ({ href, children }: { href?: string; children?: ReactNode }) =>
        href && urls.has(href) ? (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        ) : (
          <span>{children}</span>
        ),
      img: ({ alt }: { alt?: string }) => <span>{alt}</span>,
      table: ({ children }: { children?: ReactNode }) => (
        <div className="coach-table-scroll">
          <table>{children}</table>
        </div>
      ),
    },
  });
  return Children.toArray((compiled.props as { children?: ReactNode }).children);
}

type Section = { job: Opportunity; body: ReactNode[] };

function splitShortlist(blocks: ReactNode[], answer: string, sources: Opportunity[]) {
  const lead: ReactNode[] = [],
    after: ReactNode[] = [],
    roles: Section[] = [];
  let target = lead;
  for (const [i, block] of blocks.entries()) {
    if (isValidElement(block) && typeof block.type === "string" && /^h[1-4]$/.test(block.type)) {
      const heading = nodeText(block).toLocaleLowerCase();
      const firstLine = nodeText(blocks[i + 1]).slice(0, 200);
      const identity = /^\s*(?:job\s+)?id\b/i.test(firstLine) ? heading + " " + firstLine : heading;
      const ids = new Set(identity.match(/\b\d{6,}\b/g));
      const job =
        sources.find((s) => ids.has(s.id)) ??
        sources.find(
          (s) =>
            heading.includes(s.title.toLocaleLowerCase()) &&
            heading.includes(s.publisher.toLocaleLowerCase()),
        );
      if (job && !roles.some((section) => section.job.id === job.id)) {
        const section: Section = { job, body: [] };
        roles.push(section);
        target = section.body;
        continue;
      }
      if (roles.length && !/^h4$/.test(block.type)) target = after;
    }
    target.push(block);
  }
  // A comparison can arrive as a table or prose, and a single-role answer may only link
  // its source. Only present inventory cards explicitly referenced in this answer.
  const positions = new Map(Array.from(answer.matchAll(/\b\d{6,}\b/g), (m) => [m[0], m.index]));
  const links = new Map(
    Array.from(answer.matchAll(/\]\((https?:\/\/[^\s)]+)\)/g), (m) => [m[1], m.index]),
  );
  const cited = sources
    .flatMap((job) => {
      const position =
        positions.get(job.id) ??
        links.get(job.url) ??
        (job.apply_url ? links.get(job.apply_url) : undefined);
      return position === undefined ? [] : [{ job, position }];
    })
    .sort((a, b) => a.position - b.position);
  if (!roles.length && cited.length) {
    return {
      lead,
      roles: cited.map(({ job }) => ({ job, body: [] })),
      after,
      title: "Roles in this answer",
    };
  }
  const lastRole = roles.at(-1);
  const closing = lastRole?.body.at(-1);
  if (
    !after.length &&
    lastRole &&
    lastRole.body.length > 1 &&
    isValidElement(closing) &&
    closing.type === "p" &&
    nodeText(closing).trimEnd().endsWith("?")
  ) {
    after.push(lastRole.body.pop());
  }
  return { lead, roles, after, title: "Your shortlist" };
}

export function rolesInAnswer(turn: Turn, urls: Set<string>) {
  return splitShortlist(safeBlocks(turn.answer, urls), turn.answer, turn.sources).roles.map(
    (s) => s.job,
  );
}

export function CoachAnswer({
  turn,
  urls,
  hasCv,
  disabled,
  onAsk,
  activeId,
  onSelect,
}: {
  turn: Turn;
  urls: Set<string>;
  hasCv: boolean;
  disabled: boolean;
  onAsk: AskCoach;
  activeId: string | null;
  onSelect: (job: Opportunity) => void;
}) {
  const parts = useMemo(
    () => splitShortlist(safeBlocks(turn.answer, urls), turn.answer, turn.sources),
    [turn.answer, turn.sources, urls],
  );
  const current = parts.roles.find((s) => s.job.id === activeId) ?? parts.roles[0];
  const repeatsCurrentRole =
    parts.roles.length === 1 && current?.job.id === activeId && !current.body.length;
  return (
    <div className="coach-reply">
      <div className="coach-reply-byline">
        <MessageSquareText size={16} aria-hidden="true" /> Your career coach
      </div>
      {parts.lead.length > 0 && <div className="coach-prose">{parts.lead}</div>}
      {current && !repeatsCurrentRole && (
        <section className="coach-shortlist" aria-label="Recommended roles">
          <div className="coach-shortlist-head">
            <h2>{parts.title}</h2>
            <span>
              {parts.roles.length} {parts.roles.length === 1 ? "role" : "roles"}
            </span>
          </div>
          <div className="coach-shortlist-grid">
            <div className="coach-shortlist-menu" role="group" aria-label="Choose a role">
              {parts.roles.map(({ job }, index) => (
                <button
                  key={job.id}
                  aria-pressed={activeId === job.id}
                  disabled={disabled}
                  onClick={() => onSelect(job)}
                >
                  <span className="coach-role-number">{index + 1}</span>
                  <span>
                    <strong>{job.publisher}</strong>
                    <small>{job.title}</small>
                  </span>
                  {activeId === job.id ? (
                    <Check size={16} aria-label="Current role" />
                  ) : (
                    <ChevronRight size={15} aria-hidden="true" />
                  )}
                </button>
              ))}
            </div>
            <article className="coach-role-detail" aria-label={current.job.title}>
              <div className="coach-role-company">
                {current.job.publisher} ·{" "}
                {current.job.id === activeId ? "Current role" : "Role preview"}
              </div>
              <h3>{current.job.title}</h3>
              {current.job.location && (
                <p className="coach-role-location">
                  <MapPin size={13} />
                  {current.job.location}
                </p>
              )}
              <RoleActions job={current.job} hasCv={hasCv} disabled={disabled} onAsk={onAsk} />
              <div className="coach-prose">
                {current.body.map((block, index) => {
                  if (!isValidElement<{ children?: ReactNode }>(block) || block.type !== "p")
                    return block;
                  const pieces = Children.toArray(block.props.children);
                  const single = pieces.length === 1 ? pieces[0] : null;
                  if (
                    isValidElement<{ href?: string }>(single) &&
                    single.props.href &&
                    [current.job.url, current.job.apply_url].includes(single.props.href) &&
                    /^(?:view and apply|original posting|application link)$/i.test(
                      nodeText(block).trim(),
                    )
                  )
                    return null;
                  if (/^\s*(?:job\s+)?id[:\s]/i.test(nodeText(block)))
                    return (
                      <p className="coach-role-meta" key={index}>
                        {block.props.children}
                      </p>
                    );
                  return block;
                })}
              </div>
              <div className="coach-role-destinations">
                <a href={current.job.url} target="_blank" rel="noreferrer">
                  View posting <ArrowUpRight size={14} />
                </a>
                {current.job.apply_status === "employer_page_closed" ? (
                  <span>Closed by employer</span>
                ) : (
                  current.job.apply_url &&
                  current.job.apply_url !== current.job.url && (
                    <a href={current.job.apply_url} target="_blank" rel="noreferrer">
                      {current.job.verified_form ? "Open application form" : "Application link"}{" "}
                      <ArrowUpRight size={14} />
                    </a>
                  )
                )}
              </div>
            </article>
          </div>
        </section>
      )}
      {parts.after.length > 0 && <div className="coach-prose">{parts.after}</div>}
    </div>
  );
}

export function AnswerSources({ sources }: { sources: Opportunity[] }) {
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(5);
  if (!sources.length) return null;
  return (
    <div className="coach-source-list">
      <button className="coach-text-button" onClick={() => setOpen(!open)} aria-expanded={open}>
        Job sources ({sources.length}) <ChevronDown size={14} />
      </button>
      {open && (
        <div>
          {sources.slice(0, limit).map((job) => (
            <JobLink key={job.id} job={job} />
          ))}
          {sources.length > limit && (
            <button className="coach-text-button" onClick={() => setLimit(limit + 5)}>
              Show more sources
            </button>
          )}
        </div>
      )}
    </div>
  );
}
