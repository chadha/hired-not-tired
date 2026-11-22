from __future__ import annotations

from collections import defaultdict
from typing import Any
from uuid import uuid4

from app.schemas import (
    CandidateProfile, JobOpportunity, JobMatch, Interaction, LearningInsight,
    OutreachDraft, RecommendedAction, WorkflowStatus,
)


class MemoryStore:
    """Demo store. Replace with a persistent, tenant-scoped repository before production."""

    def __init__(self) -> None:
        self.candidates: dict[str, CandidateProfile] = {}
        self.jobs: dict[str, JobOpportunity] = {}
        self.matches: dict[str, JobMatch] = {}
        self.interactions: dict[str, Interaction] = {}
        self.insights: dict[str, LearningInsight] = {}
        self.drafts: dict[str, OutreachDraft] = {}
        self.actions: dict[str, list[RecommendedAction]] = defaultdict(list)
        self.workflows: dict[str, WorkflowStatus] = {}

    @staticmethod
    def new_id(prefix: str) -> str:
        return f"{prefix}_{uuid4().hex[:12]}"


store = MemoryStore()
