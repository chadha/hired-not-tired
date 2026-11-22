const marker = "\n\nReferenced postings:\n";

export function scopeQuestion(
  question: string,
  jobs: { id: string; title: string; publisher: string }[],
) {
  if (!jobs.length) return question;
  return (
    question +
    marker +
    jobs
      .map((job) =>
        `• ${job.title.trim()} · ${job.publisher.trim()} (job ${job.id})`.replace(/[\r\n]+/g, " "),
      )
      .join("\n")
  );
}

export function readQuestion(message: string) {
  const at = message.lastIndexOf(marker);
  if (at >= 0) {
    const lines = message.slice(at + marker.length).split("\n");
    if (lines.length <= 3 && lines.every((line) => /^• .+ \(job [^()\s]+\)$/.test(line))) {
      return { question: message.slice(0, at), references: lines.map((line) => line.slice(2)) };
    }
  }
  return { question: message, references: [] as string[] };
}
