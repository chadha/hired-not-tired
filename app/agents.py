from __future__ import annotations

import re
from typing import Any

from app.schemas import (
    CandidateProfile, JobOpportunity, JobMatch, MatchEvidence,
    LearningInsight, RecommendedAction, Interaction, CoachChatResponse,
)
from app.store import store


def normalize_words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-zA-Z0-9+#.]+", text.lower()) if len(w) > 2}


class ProfileAgent:
    COMMON_SKILLS = {
        "python", "java", "typescript", "javascript", "aws", "azure", "gcp",
        "kubernetes", "docker", "fastapi", "terraform", "postgresql", "sql",
        "machine learning", "llm", "agentic ai", "rag", "langgraph",
        "platform engineering", "backend", "microservices", "react",
    }

    def extract(self, text: str) -> tuple[list[str], str]:
        lower = text.lower()
        skills = sorted(skill for skill in self.COMMON_SKILLS if skill in lower)
        summary = " ".join(text.split())[:500]
        return skills, summary


class MatchingAgent:
    def match(self, profile: CandidateProfile, job: JobOpportunity) -> JobMatch:
        candidate_skills = {x.lower() for x in profile.skills}
        job_terms = set()
        for req in job.requirements:
            job_terms |= normalize_words(req)
        job_terms |= normalize_words(job.description)
        matched = sorted(s for s in candidate_skills if s in job_terms)
        missing = sorted((job_terms - candidate_skills) & {
            "python", "aws", "kubernetes", "llm", "rag", "langgraph",
            "machine learning", "terraform", "fastapi", "platform engineering"
        })
        denominator = max(1, min(len(job.requirements), 8))
        score = min(98, round(55 + 43 * len(matched) / denominator)) if matched else 35
        if profile.minimum_salary and job.salary_max and job.salary_max < profile.minimum_salary:
            score = min(score, 20)
        location_ok = not profile.locations or any(
            loc.lower() in job.location.lower() or "remote" in job.location.lower()
            for loc in profile.locations
        )
        salary_ok = not profile.minimum_salary or not job.salary_max or job.salary_max >= profile.minimum_salary
        evidence = [
            MatchEvidence(requirement=s, status="strong_match", evidence=f"Listed in candidate profile and relevant to {job.title}.")
            for s in matched[:5]
        ]
        evidence += [
            MatchEvidence(requirement=s, status="gap", evidence="Not found in the supplied candidate profile; verify before treating as a real gap.")
            for s in missing[:4]
        ]
        return JobMatch(
            candidate_id=profile.candidate_id,
            job_id=job.job_id,
            match_score=score,
            confidence="medium" if profile.skills else "low",
            strengths=matched[:6],
            gaps=missing[:5],
            evidence=evidence,
            constraints_met=location_ok and salary_ok,
            recommendation="prepare_outreach" if score >= 70 and location_ok and salary_ok else "review_or_skip",
        )


class LearningAgent:
    def analyze(self, interaction: Interaction) -> list[LearningInsight]:
        text = interaction.content.lower()
        insights: list[LearningInsight] = []
        if any(term in text for term in ["production ai", "production-grade", "deploying llm", "llm deployment"]):
            insights.append(LearningInsight(
                insight_id=store.new_id("ins"),
                category="skill_gap",
                title="Production AI experience may need stronger evidence",
                detail="A recruiter mentioned production AI implementation. Treat this as feedback to investigate, not proof of a permanent skills gap.",
                evidence_interaction_ids=[interaction.interaction_id],
                confidence="medium",
            ))
        if any(term in text for term in ["interview", "next round", "schedule a call"]):
            insights.append(LearningInsight(
                insight_id=store.new_id("ins"),
                category="strength",
                title="Recruiter engagement",
                detail="A recruiter response indicates an active conversation. Prepare role-specific examples and follow up promptly.",
                evidence_interaction_ids=[interaction.interaction_id],
                confidence="medium",
            ))
        if interaction.interaction_type == "rejection":
            insights.append(LearningInsight(
                insight_id=store.new_id("ins"),
                category="momentum",
                title="Rejection recorded; progress continues",
                detail="One outcome should not redefine the candidate's prospects. Extract specific feedback and adjust only where evidence supports it.",
                evidence_interaction_ids=[interaction.interaction_id],
                confidence="high",
            ))
        if not insights:
            insights.append(LearningInsight(
                insight_id=store.new_id("ins"),
                category="strategy",
                title="Interaction added to career history",
                detail="This interaction is now part of the candidate's career timeline. More outcomes are needed before drawing a reliable pattern.",
                evidence_interaction_ids=[interaction.interaction_id],
                confidence="low",
            ))
        return insights


class CoachAgent:
    def respond(
        self,
        profile: CandidateProfile,
        message: str,
        interactions: list[Interaction],
        insights: list[LearningInsight],
        jobs: list[JobOpportunity],
    ) -> CoachChatResponse:
        lower = message.lower()
        latest_insights = [x.detail for x in insights[-3:]]
        actions: list[RecommendedAction] = []

        if any(w in lower for w in ["tired", "discouraged", "rejected", "give up", "hopeless"]):
            reply = (
                f"I hear that this is draining, {profile.full_name.split()[0]}. A difficult search can make every rejection feel personal, "
                "but an outcome is information about one process, not a verdict on your ability. "
            )
            if latest_insights:
                reply += "Looking at your recent feedback, here's what we can learn: " + " ".join(latest_insights)
            else:
                reply += "We don't yet have enough evidence to identify a pattern, so let's avoid making a big career decision based on a difficult day."
            actions.extend([
                RecommendedAction(action_id=store.new_id("act"), title="Choose one achievable next step", description="Spend 20 minutes on one high-value action, then stop for today.", priority="high", action_type="wellbeing", estimated_minutes=20),
                RecommendedAction(action_id=store.new_id("act"), title="Review the latest recruiter feedback", description="Separate actionable feedback from assumptions and decide whether a skill or positioning change is justified.", priority="high", action_type="learning", estimated_minutes=30),
                RecommendedAction(action_id=store.new_id("act"), title="Prioritize three relevant opportunities", description="Focus on fit and evidence rather than application volume.", priority="medium", action_type="job_search", estimated_minutes=30),
            ])
        elif any(w in lower for w in ["what next", "next step", "plan", "today"]):
            reply = "Let's make progress visible. Based on your profile and recent activity, I recommend one focused opportunity, one relationship-building action, and one small learning step."
            actions.extend([
                RecommendedAction(action_id=store.new_id("act"), title="Review your highest-fit opportunity", description="Check role requirements and the evidence behind the match.", priority="high", action_type="job_search", estimated_minutes=15),
                RecommendedAction(action_id=store.new_id("act"), title="Prepare one thoughtful outreach message", description="Connect your strongest relevant experience to the team's needs.", priority="medium", action_type="outreach", estimated_minutes=15),
            ])
        else:
            reply = (
                f"I'm here to help you move toward {profile.career_goal}. I can use your profile, "
                f"{len(jobs)} discovered opportunities and {len(interactions)} recorded interactions to make the next step concrete. "
                "Tell me what feels most difficult right now, or ask me to create today's plan."
            )
            actions.append(RecommendedAction(
                action_id=store.new_id("act"),
                title="Build today's career action plan",
                description="Review opportunity fit, recent interactions and one manageable next action.",
                priority="high",
                action_type="job_search",
                estimated_minutes=20,
            ))

        return CoachChatResponse(
            message=reply,
            insights=latest_insights,
            recommended_actions=actions,
            workflow_id=store.new_id("wf"),
            coach_mode="demo",
        )


profile_agent = ProfileAgent()
matching_agent = MatchingAgent()
learning_agent = LearningAgent()
coach_agent = CoachAgent()
