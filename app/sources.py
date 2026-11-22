from __future__ import annotations

from app.schemas import JobOpportunity
from app.store import store


class JobSource:
    """Interface for a permitted job source. Implement adapters only for authorized sources."""

    source_name = "base"

    def discover(self, query: str | None, limit: int) -> list[JobOpportunity]:
        raise NotImplementedError


class CandidateSubmittedSource(JobSource):
    source_name = "candidate_submitted"

    def discover(self, query: str | None, limit: int) -> list[JobOpportunity]:
        return []  # Submitted URLs require an approved parser/integration; don't silently scrape.


class DemoSource(JobSource):
    source_name = "demo"

    def discover(self, query: str | None, limit: int) -> list[JobOpportunity]:
        if store.jobs:
            return list(store.jobs.values())[:limit]
        return []


SOURCES: dict[str, JobSource] = {
    "candidate_submitted": CandidateSubmittedSource(),
    "demo": DemoSource(),
}
