import hashlib
import json
import re
import uuid
from datetime import UTC, datetime
from typing import Any, cast
from urllib.parse import quote, urlparse

from app.career_schemas import Candidate, HiringContact, Job, MasterProfile, ProfileFact
from app.errors import ApiError
from app.providers import ProviderError, PublicSearchResult, normalize_public_url


def timestamp() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def new_id() -> str:
    return str(uuid.uuid4())


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def content_hash(value: object) -> str:
    return hashlib.sha256(canonical_json(value).encode()).hexdigest()


def initial_candidate(user_id: str, full_name: str | None, email: str | None) -> Candidate:
    return Candidate(candidate_id=user_id, full_name=full_name or "", email=email or "")


def _fact(
    fact_id: str,
    fact_type: str,
    label: str,
    value: str,
    source_kind: str,
    source_reference: str,
    confirmed_at: str | None,
    version: int,
    excerpt: str | None = None,
) -> ProfileFact:
    return ProfileFact(
        fact_id=fact_id,
        fact_type=fact_type,
        label=label,
        value=value,
        source_kind=source_kind,
        source_reference=source_reference,
        source_excerpt=(excerpt if excerpt is not None else value) or "Not supplied",
        confidence=1 if confirmed_at else 0.7,
        confirmed_at=confirmed_at,
        version=version,
    )


def create_master_profile(candidate: Candidate, at: str | None = None) -> MasterProfile:
    captured = at or timestamp()
    source = {
        "kind": "uploaded_cv" if candidate.cv_text.strip() else "conversational_profile",
        "filename": candidate.cv_filename,
        "text": candidate.cv_text.strip() or build_master_text(candidate),
    }
    confirmed = candidate.profile_confirmed_at
    common = {
        "source_kind": "conversational_onboarding",
        "source_reference": "Candidate-reviewed onboarding conversation",
        "confirmed_at": confirmed,
        "version": candidate.master_profile_version,
    }
    facts = [
        _fact("fact_full_name", "identity", "Full name", candidate.full_name, **common),  # type: ignore[arg-type]
        _fact("fact_email", "identity", "Email", candidate.email, **common),  # type: ignore[arg-type]
        _fact("fact_career_goal", "preference", "Career goal", candidate.career_goal, **common),  # type: ignore[arg-type]
        _fact("fact_skills", "skill", "Confirmed skills", ", ".join(candidate.skills), **common),  # type: ignore[arg-type]
        _fact("fact_summary", "summary", "Professional summary", candidate.summary, **common),  # type: ignore[arg-type]
    ]
    if candidate.experience_years is not None:
        facts.append(
            _fact(
                "fact_experience_years",
                "experience",
                "Years of experience",
                str(candidate.experience_years),
                **common,  # type: ignore[arg-type]
            )
        )
    facts.append(
        _fact(
            "fact_career_history",
            "career_history",
            "Uploaded career history"
            if source["kind"] == "uploaded_cv"
            else "Conversational career profile",
            str(source["text"]),
            str(source["kind"]),
            candidate.cv_filename or "Candidate-reviewed conversational profile",
            confirmed,
            candidate.master_profile_version,
            str(source["text"])[:500],
        )
    )
    conflicts: list[dict[str, Any]] = []
    if source["kind"] == "uploaded_cv":
        match = re.search(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", str(source["text"]), re.I)
        if match and candidate.email and match.group(0).lower() != candidate.email.lower():
            conflicts.append(
                {
                    "conflict_id": f"conflict_email_v{candidate.master_profile_version}",
                    "fact_id": "fact_email",
                    "current_value": candidate.email,
                    "proposed_value": match.group(0),
                    "source_reference": candidate.cv_filename or "Uploaded CV",
                    "source_excerpt": match.group(0),
                    "status": "open",
                }
            )
    return MasterProfile(
        profile_version=candidate.master_profile_version,
        captured_at=captured,
        revision_of=None,
        source=source,
        facts=facts,
        conflicts=conflicts,
    )


def build_master_text(candidate: Candidate) -> str:
    return "\n".join(
        [
            candidate.full_name,
            candidate.email,
            candidate.linkedin_url or "",
            f"Career goal: {candidate.career_goal}",
            f"Target roles: {', '.join(candidate.target_roles) or 'Not supplied'}",
            f"Locations: {', '.join(candidate.locations) or 'Not supplied'}",
            f"Experience: {candidate.experience_years if candidate.experience_years is not None else 'Not supplied'}",
            f"Skills: {', '.join(candidate.skills) or 'Not supplied'}",
            f"Summary: {candidate.summary or 'Not supplied'}",
        ]
    ).strip()


def candidate_from_master(candidate: Candidate, master: MasterProfile, at: str) -> Candidate:
    values = {fact.fact_id: fact.value for fact in master.facts}
    years = values.get("fact_experience_years", "")
    confirmed = all(fact.confirmed_at for fact in master.facts) and all(
        conflict.get("status") != "open" for conflict in master.conflicts
    )
    return candidate.model_copy(
        update={
            "full_name": values.get("fact_full_name", candidate.full_name),
            "email": values.get("fact_email", candidate.email),
            "career_goal": values.get("fact_career_goal", candidate.career_goal),
            "skills": [
                item.strip() for item in values.get("fact_skills", "").split(",") if item.strip()
            ],
            "summary": values.get("fact_summary", ""),
            "experience_years": float(years) if years else None,
            "cv_text": str(master.source.get("text", "")),
            "cv_filename": master.source.get("filename")
            if isinstance(master.source.get("filename"), str)
            else None,
            "master_profile_version": master.profile_version,
            "profile_confirmed_at": at if confirmed else None,
        }
    )


def revise_master(
    candidate: Candidate,
    master: MasterProfile,
    *,
    fact_id: str | None,
    value: str | None,
    conflict_id: str | None,
    use_proposed: bool | None,
    confirm_all: bool,
    at: str | None = None,
) -> tuple[Candidate, MasterProfile, bool]:
    changed_at = at or timestamp()
    facts = [fact.model_copy(deep=True) for fact in master.facts]
    conflicts = [dict(conflict) for conflict in master.conflicts]
    source = dict(master.source)
    changed = False
    if confirm_all:
        if any(conflict.get("status") == "open" for conflict in conflicts):
            raise ApiError(
                422,
                "profile_conflict_open",
                "Resolve each uploaded-profile conflict before confirming all facts.",
            )
        for fact in facts:
            if not fact.confirmed_at:
                fact.confirmed_at = changed_at
                fact.version += 1
                fact.confidence = 1
                changed = True
    elif conflict_id:
        conflict = next(
            (item for item in conflicts if item.get("conflict_id") == conflict_id), None
        )
        if conflict is None:
            raise ApiError(
                404,
                "profile_conflict_not_found",
                "The profile conflict is unavailable in this revision.",
            )
        conflict_fact = next(
            (item for item in facts if item.fact_id == conflict.get("fact_id")), None
        )
        if conflict_fact is None:
            raise ApiError(
                404, "profile_fact_not_found", "The conflicting profile fact is unavailable."
            )
        resolution = "resolved_use_proposed" if use_proposed else "resolved_keep_current"
        if conflict.get("status") != resolution:
            changed = True
        if use_proposed:
            conflict_fact.value = str(conflict.get("proposed_value", ""))
            conflict_fact.source_kind = "uploaded_cv"
            conflict_fact.source_reference = str(conflict.get("source_reference", "Uploaded CV"))
            conflict_fact.source_excerpt = str(conflict.get("source_excerpt", conflict_fact.value))
        conflict_fact.confirmed_at = changed_at
        conflict_fact.version += 1
        conflict_fact.confidence = 1
        conflict["status"] = resolution
    else:
        edited_fact = next((item for item in facts if item.fact_id == fact_id), None)
        if edited_fact is None:
            raise ApiError(404, "profile_fact_not_found", "The master profile fact is unavailable.")
        fact = edited_fact
        next_value = (value or "").strip()
        if fact.fact_id in {"fact_full_name", "fact_email", "fact_career_goal"} and not next_value:
            raise ApiError(422, "required_fact_empty", f"{fact.label} cannot be empty.")
        if fact.fact_id == "fact_email" and not re.fullmatch(
            r"[^\s@]+@[^\s@]+\.[^\s@]+", next_value
        ):
            raise ApiError(422, "invalid_email", "Enter a valid candidate-confirmed email address.")
        if fact.fact_id == "fact_experience_years" and next_value:
            try:
                years = float(next_value)
            except ValueError:
                raise ApiError(
                    422, "invalid_experience", "Enter years of experience between 0 and 80."
                ) from None
            if not 0 <= years <= 80:
                raise ApiError(
                    422, "invalid_experience", "Enter years of experience between 0 and 80."
                )
        if (
            fact.value != next_value
            or not fact.confirmed_at
            or any(
                conflict.get("fact_id") == fact.fact_id and conflict.get("status") == "open"
                for conflict in conflicts
            )
        ):
            changed = True
        fact.value = next_value
        fact.source_kind = "conversational_onboarding"
        fact.source_reference = "Candidate-confirmed master revision"
        fact.source_excerpt = next_value or "Not supplied"
        fact.confirmed_at = changed_at
        fact.confidence = 1
        fact.version += 1
        for conflict in conflicts:
            if conflict.get("fact_id") == fact.fact_id and conflict.get("status") == "open":
                conflict["status"] = "resolved_candidate_edit"
        if fact.fact_id == "fact_career_history":
            source = {"kind": "conversational_profile", "filename": None, "text": next_value}
    if not changed:
        return candidate, master, False
    revision = MasterProfile(
        profile_version=master.profile_version + 1,
        captured_at=changed_at,
        revision_of=master.profile_version,
        source=source,
        facts=facts,
        conflicts=conflicts,
    )
    next_candidate = candidate_from_master(candidate, revision, changed_at)
    history = [
        *next_candidate.master_profile_history,
        master.model_dump(mode="json"),
        revision.model_dump(mode="json"),
    ]
    next_candidate = next_candidate.model_copy(update={"master_profile_history": history})
    return next_candidate, revision, True


def match_job(candidate: Candidate, job: Job) -> dict[str, Any]:
    strengths: list[str] = []
    gaps: list[str] = []
    evidence: list[dict[str, str]] = []
    for requirement in job.requirements:
        normalized = requirement.lower()
        skill = next(
            (
                item
                for item in candidate.skills
                if item.lower() == normalized
                or item.lower() in normalized
                or normalized in item.lower()
            ),
            None,
        )
        if skill:
            strengths.append(skill)
            evidence.append(
                {
                    "requirement": requirement,
                    "status": "strong_match",
                    "evidence": f"Candidate-confirmed skill: {skill}.",
                }
            )
        else:
            gaps.append(requirement)
            evidence.append(
                {
                    "requirement": requirement,
                    "status": "unknown",
                    "evidence": "No candidate-confirmed evidence was found; this is not proof of a gap.",
                }
            )
    count = max(1, len(job.requirements))
    score = round(35 + 60 * len(strengths) / count) if job.requirements else 50
    location_ok = not candidate.locations or any(
        location.lower() in job.location.lower() or "remote" in job.location.lower()
        for location in candidate.locations
    )
    salary_ok = (
        candidate.minimum_salary is None
        or job.salary_max is None
        or job.salary_max >= candidate.minimum_salary
    )
    constraints = location_ok and salary_ok
    if not constraints:
        score = min(score, 40)
    return {
        "candidate_id": candidate.candidate_id,
        "job_id": job.job_id,
        "match_score": min(score, 95),
        "confidence": "medium" if candidate.skills else "low",
        "strengths": strengths[:6],
        "gaps": gaps[:8],
        "evidence": evidence,
        "constraints_met": constraints,
        "recommendation": "prepare_outreach" if score >= 60 and constraints else "review_or_skip",
    }


def analyze_job(candidate: Candidate, job: Job) -> dict[str, Any]:
    match = match_job(candidate, job)
    evidence_by_requirement = {item["requirement"]: item for item in match["evidence"]}
    requirements: list[dict[str, Any]] = []
    for index, requirement in enumerate(job.requirements):
        evidence = evidence_by_requirement[requirement]
        strong = evidence["status"] == "strong_match"
        requirements.append(
            {
                "requirement_id": f"requirement_{index + 1}",
                "text": requirement,
                "category": "skill",
                "priority": "required",
                "status": evidence["status"],
                "candidate_evidence": evidence["evidence"] if strong else None,
                "evidence_fact_ids": ["fact_skills"] if strong else [],
                "uncertainty": "Evidence supports review, not a hiring prediction."
                if strong
                else evidence["evidence"],
                "recommended_action": "Review the supported evidence."
                if strong
                else "Add evidence only if you can confirm it; otherwise leave the unknown visible.",
            }
        )
    sentences = [
        item.strip()
        for item in re.split(r"(?<=[.!?])\s+|\n+", job.description)
        if len(item.strip()) > 12
    ]
    for index, sentence in enumerate(item for item in sentences if "?" not in item):
        requirements.append(
            {
                "requirement_id": f"responsibility_{index + 1}",
                "text": sentence,
                "category": "responsibility",
                "priority": "unclear",
                "status": "unknown",
                "candidate_evidence": None,
                "evidence_fact_ids": [],
                "uncertainty": "Extracted from the job description; no candidate evidence is asserted.",
                "recommended_action": "Review against the confirmed master profile.",
            }
        )
    questions: list[dict[str, Any]] = [
        {
            "requirement_id": f"question_{index + 1}",
            "text": sentence,
            "category": "application_question",
            "priority": "required",
            "status": "unknown",
            "candidate_evidence": None,
            "evidence_fact_ids": [],
            "uncertainty": "No answer has been reviewed or approved.",
            "recommended_action": "Answer only from candidate-confirmed facts.",
        }
        for index, sentence in enumerate(item for item in sentences if "?" in item)
    ]
    return {
        "requirements": requirements,
        "application_questions": questions,
        "method": "backend",
        "notes": [
            "Deterministic requirement mapping is decision support, not an ATS ranking or hiring probability.",
            "Unknown evidence remains unknown; no qualification, metric, employer or responsibility is invented.",
        ],
    }


def tailored_cv(candidate: Candidate, job: Job, source: dict[str, Any]) -> str:
    relevant = [
        skill
        for skill in candidate.skills
        if any(skill.lower() in requirement.lower() for requirement in job.requirements)
    ]
    other = [skill for skill in candidate.skills if skill not in relevant]
    return "\n".join(
        [
            candidate.full_name.upper(),
            f"Target role: {job.title} — {job.company}",
            " | ".join(item for item in (candidate.email, candidate.linkedin_url or "") if item),
            "",
            "PROFESSIONAL SUMMARY",
            candidate.summary or f"Candidate targeting {candidate.career_goal}.",
            f"Candidate-confirmed experience: {candidate.experience_years} years."
            if candidate.experience_years is not None
            else "",
            "",
            "ROLE-RELEVANT CONFIRMED SKILLS",
            " • ".join(relevant)
            if relevant
            else "No exact skill overlap confirmed; see master career history.",
            "",
            "ADDITIONAL CONFIRMED SKILLS",
            " • ".join(other) if other else "No additional skills supplied.",
            "",
            "CANDIDATE-CONFIRMED CAREER HISTORY"
            if source.get("kind") == "uploaded_cv"
            else "CANDIDATE-CONFIRMED CAREER PROFILE",
            str(source.get("text", "")),
            "",
            "TAILORING NOTE",
            f"Prepared for {job.title} at {job.company}. Content is limited to the candidate-confirmed master source and selected job details.",
        ]
    ).strip()


def provider_capabilities(search_configured: bool) -> dict[str, Any]:
    unavailable = {
        "authorized": False,
        "account_authorized": False,
        "job_eligible": False,
        "required_fields_verified": False,
        "reason": "No official authorized direct-submission integration is configured.",
    }
    return {
        "source": "backend",
        "needle": {
            "enabled": False,
            "contact_discovery": False,
            "sending": False,
            "reason": "Needle is disabled. Manual contacts and user-controlled handoffs remain available.",
        },
        "email": {
            "handoff": True,
            "send": False,
            "verified_sender": False,
            "verified_recipient": False,
            "consent_and_suppression": False,
            "durable_audit": True,
            "idempotency": True,
            "reason": "No authorized email provider is configured. Use copy or mailto handoff only.",
        },
        "applications": {"linkedin_easy_apply": unavailable, "employer_site": dict(unavailable)},
        "documents": {"pdf": "local_validated", "docx": "local_validated"},
        "contact_discovery": {
            "configured": search_configured,
            "detail": "Compliant public web search is configured; every result requires source review."
            if search_configured
            else "Verified automatic contact discovery is not configured. Use the contextual LinkedIn people-search fallback or add a contact you already know.",
        },
        "job_import": {
            "configured": True,
            "detail": "Public job-page import is available; pages must expose sufficient job details.",
        },
        "job_search": {
            "configured": False,
            "detail": "No job-search provider is configured. Import a supplied public job URL.",
        },
    }


def create_package(candidate: Candidate, job: Job, capabilities: dict[str, Any]) -> dict[str, Any]:
    at = timestamp()
    package_id = new_id()
    master = create_master_profile(candidate, at)
    snapshot_id = new_id()
    source = master.source
    artifact = {
        "artifact_id": new_id(),
        "package_id": package_id,
        "version": 1,
        "content": tailored_cv(candidate, job, source),
        "change_summary": [
            f"Targeted the document to {job.title} without changing the master CV.",
            "Reordered confirmed skills to show exact job overlap first.",
            "Added no employers, qualifications, achievements or metrics.",
        ],
        "evidence_used": [
            skill
            for skill in candidate.skills
            if any(skill.lower() in req.lower() for req in job.requirements)
        ],
        "evidence_fact_ids": ["fact_skills", "fact_career_history"],
        "source_profile_version": master.profile_version,
        "source_job_snapshot_id": snapshot_id,
        "created_at": at,
        "approval": None,
    }
    analysis = analyze_job(candidate, job)
    answers = [
        {
            "answer_id": new_id(),
            "question": question["text"],
            "proposed_answer": "",
            "evidence_fact_ids": [],
            "status": "needs_candidate_input",
            "sensitive": bool(
                re.search(
                    r"work authori[sz]ation|visa|sponsor|demographic|disability|gender|ethnicity|race|veteran|criminal|salary expectation",
                    question["text"],
                    re.I,
                )
            ),
            "version": 1,
            "updated_at": at,
        }
        for question in analysis["application_questions"]
    ]
    channels = ["linkedin_easy_apply", "employer_site"]
    return {
        "package_id": package_id,
        "candidate_id": candidate.candidate_id,
        "job_id": job.job_id,
        "revision": 1,
        "status": "draft",
        "source": source,
        "master_profile": master.model_dump(mode="json"),
        "master_profile_history": [
            *candidate.master_profile_history,
            master.model_dump(mode="json"),
        ],
        "job_snapshot": {
            "snapshot_id": snapshot_id,
            "title": job.title,
            "company": job.company,
            "location": job.location,
            "description": job.description,
            "requirements": job.requirements,
            "source_url": job.source_url,
            "application_method": job.application_method,
            "captured_at": job.retrieved_at,
        },
        "analysis": analysis,
        "versions": [artifact],
        "current_artifact_id": artifact["artifact_id"],
        "answers": answers,
        "cover_letter_versions": [],
        "current_cover_letter_id": None,
        "channel_actions": [
            {
                "channel": channel,
                "state": "draft",
                "approval": None,
                "idempotency_key": new_id(),
                "handed_off_at": None,
                "candidate_reported_at": None,
                "provider_receipt_id": None,
            }
            for channel in channels
        ],
        "capabilities": capabilities,
        "created_at": at,
        "updated_at": at,
        "is_demo": False,
    }


def current_cv(package: dict[str, Any]) -> dict[str, Any]:
    artifact = next(
        (
            item
            for item in package["versions"]
            if item["artifact_id"] == package["current_artifact_id"]
        ),
        None,
    )
    if artifact is None:
        raise ApiError(
            409, "artifact_unavailable", "The current tailored CV version is unavailable."
        )
    return cast(dict[str, Any], artifact)


def current_cover(package: dict[str, Any]) -> dict[str, Any] | None:
    return next(
        (
            item
            for item in package["cover_letter_versions"]
            if item["artifact_id"] == package.get("current_cover_letter_id")
        ),
        None,
    )


def invalidate_channels(package: dict[str, Any], at: str) -> None:
    for action in package["channel_actions"]:
        action["state"] = "draft"
        if action.get("approval"):
            action["approval"]["invalidated_at"] = at
        action["handed_off_at"] = None
        action["candidate_reported_at"] = None
        action["provider_receipt_id"] = None


def generate_cv_from_master(
    package: dict[str, Any],
    candidate: Candidate,
    job: Job,
    master: MasterProfile | None = None,
) -> dict[str, Any]:
    at = timestamp()
    master = master or create_master_profile(candidate, at)
    previous = current_cv(package)
    artifact = {
        **previous,
        "artifact_id": new_id(),
        "version": max(item["version"] for item in package["versions"]) + 1,
        "content": tailored_cv(candidate, job, master.source),
        "change_summary": [
            "Created from the latest immutable candidate-confirmed master profile revision.",
            "No unsupported facts were added.",
        ],
        "source_profile_version": master.profile_version,
        "created_at": at,
        "approval": None,
    }
    package["master_profile"] = master.model_dump(mode="json")
    package["master_profile_history"] = [*candidate.master_profile_history]
    package["source"] = master.source
    package["analysis"] = analyze_job(candidate, job)
    package["versions"].append(artifact)
    package["current_artifact_id"] = artifact["artifact_id"]
    package["status"] = "draft"
    package["updated_at"] = at
    invalidate_channels(package, at)
    return package


def save_cv_version(package: dict[str, Any], content: str) -> dict[str, Any]:
    if not content.strip():
        raise ApiError(422, "empty_artifact", "The tailored CV cannot be empty.")
    previous = current_cv(package)
    if previous["content"] == content:
        return package
    at = timestamp()
    artifact = {
        **previous,
        "artifact_id": new_id(),
        "version": max(item["version"] for item in package["versions"]) + 1,
        "content": content,
        "change_summary": [
            "Candidate edited the tailored CV and saved a new immutable version.",
            "Review every edited claim before approval.",
        ],
        "created_at": at,
        "approval": None,
    }
    package["versions"].append(artifact)
    package["current_artifact_id"] = artifact["artifact_id"]
    package["status"] = "draft"
    package["updated_at"] = at
    invalidate_channels(package, at)
    return package


def master_review_block(master: dict[str, Any]) -> str | None:
    if any(item.get("status") == "open" for item in master["conflicts"]):
        return "Resolve every uploaded-profile conflict before approval."
    count = sum(not fact.get("confirmed_at") for fact in master["facts"])
    return f"Confirm {count} extracted profile facts before approval." if count else None


def approve_cv(
    package: dict[str, Any], artifact_id: str, version: int, content: str, candidate_id: str
) -> dict[str, Any]:
    block = master_review_block(package["master_profile"])
    if block:
        raise ApiError(422, "master_review_required", block)
    artifact = current_cv(package)
    if (
        artifact["artifact_id"] != artifact_id
        or artifact["version"] != version
        or artifact["content"] != content
    ):
        raise ApiError(
            409,
            "approval_version_mismatch",
            "Approval does not match the current tailored CV version and content.",
        )
    at = timestamp()
    artifact["approval"] = {
        "artifact_id": artifact_id,
        "version": version,
        "approved_text_hash": content_hash(
            {
                "artifact_id": artifact_id,
                "package_id": package["package_id"],
                "version": version,
                "content": content,
            }
        ),
        "approved_at": at,
        "approved_by": candidate_id,
    }
    package["status"] = "approved"
    package["updated_at"] = at
    return package


def save_answer(
    package: dict[str, Any], answer_id: str | None, question: str, proposed: str, confirmed: bool
) -> dict[str, Any]:
    question = question.strip()
    proposed = proposed.strip()
    sensitive = bool(
        re.search(
            r"work authori[sz]ation|visa|sponsor|demographic|disability|gender|ethnicity|race|veteran|criminal|salary expectation",
            question,
            re.I,
        )
    )
    if confirmed and not proposed and not sensitive:
        raise ApiError(422, "answer_required", "Write your answer before confirming it.")
    existing = (
        next((item for item in package["answers"] if item["answer_id"] == answer_id), None)
        if answer_id
        else None
    )
    if answer_id and existing is None:
        raise ApiError(404, "answer_not_found", "The application answer is unavailable.")
    at = timestamp()
    answer: dict[str, Any] = {
        "answer_id": existing["answer_id"] if existing else new_id(),
        "question": question,
        "proposed_answer": proposed,
        "evidence_fact_ids": [],
        "status": "candidate_confirmed" if confirmed else "needs_candidate_input",
        "sensitive": sensitive,
        "version": existing["version"] + 1 if existing else 1,
        "updated_at": at,
    }
    if existing:
        package["answers"] = [
            answer if item["answer_id"] == existing["answer_id"] else item
            for item in package["answers"]
        ]
    else:
        package["answers"].append(answer)
    package["updated_at"] = at
    invalidate_channels(package, at)
    return package


def cover_letter(package: dict[str, Any], content: str | None = None) -> dict[str, Any]:
    at = timestamp()
    previous = current_cover(package)
    if content is not None and previous is None:
        raise ApiError(422, "cover_letter_missing", "Create a cover letter before editing it.")
    if content is not None and not content.strip():
        raise ApiError(422, "empty_artifact", "The cover letter cannot be empty.")
    master = package["master_profile"]
    values = {fact["fact_id"]: fact["value"] for fact in master["facts"]}
    generated = "\n".join(
        [
            "Dear Hiring Team,",
            "",
            f"I am interested in the {package['job_snapshot']['title']} role at {package['job_snapshot']['company']}.",
            values.get("fact_summary", ""),
            f"My candidate-confirmed skills include {values['fact_skills']}."
            if values.get("fact_skills")
            else "",
            "",
            "I would welcome the opportunity to discuss how my confirmed background relates to this role.",
            "",
            "Kind regards,",
            values.get("fact_full_name", ""),
        ]
    )
    artifact = {
        "artifact_id": new_id(),
        "package_id": package["package_id"],
        "version": max((item["version"] for item in package["cover_letter_versions"]), default=0)
        + 1,
        "content": content if content is not None else generated,
        "source_profile_version": master["profile_version"],
        "source_job_snapshot_id": package["job_snapshot"]["snapshot_id"],
        "created_at": at,
        "approval": None,
    }
    package["cover_letter_versions"].append(artifact)
    package["current_cover_letter_id"] = artifact["artifact_id"]
    package["updated_at"] = at
    invalidate_channels(package, at)
    return package


def approve_cover(
    package: dict[str, Any], artifact_id: str, version: int, content: str, candidate_id: str
) -> dict[str, Any]:
    artifact = current_cover(package)
    if (
        artifact is None
        or artifact["artifact_id"] != artifact_id
        or artifact["version"] != version
        or artifact["content"] != content
    ):
        raise ApiError(
            409,
            "approval_version_mismatch",
            "Cover-letter approval does not match the exact current version.",
        )
    at = timestamp()
    artifact["approval"] = {
        "artifact_id": artifact_id,
        "version": version,
        "approved_text_hash": content_hash(
            {"artifact_id": artifact_id, "version": version, "content": content}
        ),
        "approved_at": at,
        "approved_by": candidate_id,
    }
    package["updated_at"] = at
    return package


def canonical_channel_payload(package: dict[str, Any], channel: str, destination: str) -> str:
    artifact = current_cv(package)
    cover = current_cover(package)
    return canonical_json(
        {
            "package_id": package["package_id"],
            "channel": channel,
            "destination": destination,
            "cv": {
                "artifact_id": artifact["artifact_id"],
                "version": artifact["version"],
                "content": artifact["content"],
            },
            "cover_letter": {
                "artifact_id": cover["artifact_id"],
                "version": cover["version"],
                "content": cover["content"],
            }
            if cover
            else None,
            "answers": [
                {
                    "answer_id": answer["answer_id"],
                    "version": answer["version"],
                    "question": answer["question"],
                    "answer": answer["proposed_answer"],
                    "status": answer["status"],
                }
                for answer in package["answers"]
            ],
            "attachments": [f"cv:{artifact['artifact_id']}:{artifact['version']}"],
        }
    )


def package_prerequisites(package: dict[str, Any]) -> None:
    artifact = current_cv(package)
    block = master_review_block(package["master_profile"])
    if block:
        raise ApiError(422, "master_review_required", block)
    if not artifact.get("approval") or package["status"] != "approved":
        raise ApiError(
            422,
            "cv_approval_required",
            "Approve the exact current CV version before channel approval or export.",
        )
    if any(answer["status"] != "candidate_confirmed" for answer in package["answers"]):
        raise ApiError(
            422,
            "answer_confirmation_required",
            "Confirm every supplied application answer before handoff.",
        )
    cover = current_cover(package)
    if cover and not cover.get("approval"):
        raise ApiError(
            422, "cover_approval_required", "Approve the exact cover-letter version before handoff."
        )


def approve_channel(
    package: dict[str, Any], channel: str, destination: str | None, job: Job, candidate_id: str
) -> dict[str, Any]:
    package_prerequisites(package)
    if channel not in {"linkedin_easy_apply", "employer_site"}:
        raise ApiError(
            422, "unsupported_channel", "This application channel does not support package handoff."
        )
    if not destination or not same_public_url(destination, job.source_url):
        raise ApiError(
            422,
            "destination_mismatch",
            "The approved destination must match the selected job source URL.",
        )
    if channel == "linkedin_easy_apply" and not (
        job.application_method == "easy_apply" and "linkedin.com" in urlparse(job.source_url).netloc
    ):
        raise ApiError(
            422,
            "easy_apply_unconfirmed",
            "The selected job does not have reliable Easy Apply source evidence.",
        )
    at = timestamp()
    canonical = canonical_channel_payload(package, channel, destination)
    approval = {
        "approval_id": new_id(),
        "channel": channel,
        "destination": destination,
        "canonical_payload": canonical,
        "payload_hash": hashlib.sha256(canonical.encode()).hexdigest(),
        "cv_artifact_id": current_cv(package)["artifact_id"],
        "cv_version": current_cv(package)["version"],
        "approved_at": at,
        "approved_by": candidate_id,
        "invalidated_at": None,
    }
    action = next(item for item in package["channel_actions"] if item["channel"] == channel)
    action["state"] = "approved"
    action["approval"] = approval
    package["updated_at"] = at
    return package


def application_handoff(
    package: dict[str, Any], channel: str, destination: str | None, job: Job
) -> dict[str, Any]:
    package_prerequisites(package)
    action = next((item for item in package["channel_actions"] if item["channel"] == channel), None)
    if (
        action is None
        or action["state"] not in {"approved", "handed_off", "candidate_reported"}
        or not action.get("approval")
    ):
        raise ApiError(
            422,
            "channel_approval_required",
            "Approve the exact destination and package before handoff.",
        )
    if action["approval"].get("invalidated_at") or action["approval"][
        "canonical_payload"
    ] != canonical_channel_payload(package, channel, destination or ""):
        raise ApiError(
            409,
            "approval_invalidated",
            "The package changed. Fresh exact-package approval is required.",
        )
    if not destination or not same_public_url(destination, job.source_url):
        raise ApiError(
            422, "destination_mismatch", "The handoff destination must match the selected job."
        )
    if action["state"] == "approved":
        action["state"] = "handed_off"
        action["handed_off_at"] = timestamp()
        package["updated_at"] = action["handed_off_at"]
    return package


def report_application(package: dict[str, Any], channel: str) -> dict[str, Any]:
    action = next((item for item in package["channel_actions"] if item["channel"] == channel), None)
    if action is None or action["state"] not in {"handed_off", "candidate_reported"}:
        raise ApiError(
            422,
            "handoff_required",
            "Open the approved handoff before reporting your own submission.",
        )
    if action["state"] == "handed_off":
        action["state"] = "candidate_reported"
        action["candidate_reported_at"] = timestamp()
        package["updated_at"] = action["candidate_reported_at"]
    return package


def same_public_url(left: str, right: str) -> bool:
    try:
        return normalize_public_url(left) == normalize_public_url(right)
    except ProviderError:
        return False


def validate_linkedin_profile(value: str) -> str:
    try:
        normalized = normalize_public_url(value)
    except ProviderError:
        raise ApiError(
            422,
            "invalid_linkedin_profile",
            "Use a public HTTPS LinkedIn profile URL in the format https://www.linkedin.com/in/name.",
        ) from None
    parsed = urlparse(normalized)
    if (
        parsed.scheme != "https"
        or not (
            parsed.hostname == "linkedin.com"
            or (parsed.hostname and parsed.hostname.endswith(".linkedin.com"))
        )
        or not re.fullmatch(r"/in/[^/]+/?", parsed.path)
    ):
        raise ApiError(
            422,
            "invalid_linkedin_profile",
            "Use a public HTTPS LinkedIn profile URL in the format https://www.linkedin.com/in/name.",
        )
    return f"https://www.linkedin.com{parsed.path.rstrip('/')}"


def people_search_url(job: Job) -> str:
    return f"https://www.linkedin.com/search/results/people/?keywords={quote(f'{job.title} {job.company}')}"


def contact_from_result(
    result: PublicSearchResult, job: Job, candidate_id: str
) -> dict[str, Any] | None:
    try:
        profile_url = validate_linkedin_profile(result.url)
    except ApiError:
        return None
    title_parts = [
        part.strip() for part in re.split(r"\s+[–—|-]\s+|\s+\|\s+", result.title) if part.strip()
    ]
    full_name = title_parts[0] if title_parts else ""
    if (
        not full_name
        or len(full_name) > 120
        or any(word in full_name.lower() for word in ("linkedin", "jobs", "hiring"))
    ):
        return None
    evidence = f"{result.title}\n{result.description}".strip()
    company_match = bool(job.company and job.company.lower() in evidence.lower())
    role_tokens = {token for token in re.findall(r"[a-z]{4,}", job.title.lower())}
    evidence_tokens = set(re.findall(r"[a-z]{4,}", evidence.lower()))
    role_match = bool(role_tokens & evidence_tokens)
    recruiter = bool(re.search(r"recruit|talent acquisition|people partner", evidence, re.I))
    manager = bool(
        re.search(
            r"hiring manager|engineering manager|team lead|head of|director|vp|lead", evidence, re.I
        )
    )
    if not company_match or not (role_match or recruiter or manager):
        return None
    confidence = "high" if company_match and role_match and manager else "medium"
    current_title = title_parts[1] if len(title_parts) > 1 else ""
    at = timestamp()
    relevance = (
        "Public search evidence names the company and "
        + (
            "a likely team-leadership role"
            if manager
            else "a recruiting role"
            if recruiter
            else "role-related terms"
        )
        + "; vacancy ownership is not established."
    )
    return {
        "contact_id": new_id(),
        "candidate_id": candidate_id,
        "job_id": job.job_id,
        "full_name": full_name,
        "current_title": current_title,
        "company": job.company,
        "profile_url": profile_url,
        "email": "",
        "location": "",
        "source_url": result.url,
        "evidence_notes": evidence[:4000],
        "confidence": confidence,
        "relevance": relevance,
        "evidence_status": "public_search_result",
        "last_checked_at": at,
        "evidence_date": at,
        "created_at": at,
        "updated_at": at,
        "is_demo": False,
    }


def grounded_message(
    candidate: Candidate, job: Job, contact: HiringContact, channel: str = "linkedin"
) -> tuple[str, str | None]:
    first_name = contact.full_name.split(" ", 1)[0]
    skills = ", ".join(candidate.skills[:3])
    focus = " and ".join(job.requirements[:2])
    lines = [
        f"Hi {first_name},",
        "",
        f"I’m interested in the {job.title} role at {job.company}."
        + (f" Its focus on {focus} caught my attention." if focus else ""),
        f"My confirmed background includes {skills}."
        if skills
        else "I’ve reviewed the role against my confirmed career profile.",
        "",
        "Would you be open to a short conversation about the role and the team’s work?",
        "",
        "Best,",
        candidate.full_name,
    ]
    body = "\n".join(lines)
    subject = f"Application for {job.title} — {candidate.full_name}" if channel == "email" else None
    return body, subject


def outreach_canonical(message: dict[str, Any]) -> str:
    if message["channel"] == "email":
        return canonical_json(
            {
                "channel": "email",
                "recipient_url": message.get("recipient_url"),
                "recipient_email": message.get("recipient_email"),
                "subject": message.get("subject"),
                "body": message["body"],
                "attachment": message.get("attachment"),
                "package_id": message.get("package_id"),
            }
        )
    return canonical_json(
        {
            "channel": "linkedin",
            "recipient_url": message.get("recipient_url"),
            "body": message["body"],
        }
    )


def history_event(event_type: str, label: str, detail: str) -> dict[str, Any]:
    return {
        "history_id": new_id(),
        "type": event_type,
        "label": label,
        "detail": detail,
        "created_at": timestamp(),
        "actor": "backend",
        "simulated": False,
    }


def create_outreach(
    candidate: Candidate,
    job: Job,
    contact: HiringContact,
    channel: str,
    package: dict[str, Any] | None = None,
) -> dict[str, Any]:
    body, subject = grounded_message(candidate, job, contact, channel)
    at = timestamp()
    draft_id = new_id()
    attachment = None
    if channel == "email":
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", contact.email):
            raise ApiError(
                422, "recipient_email_required", "A candidate-supplied recipient email is required."
            )
        if package is None:
            raise ApiError(
                422,
                "application_package_required",
                "Select an application package for email outreach.",
            )
        package_prerequisites(package)
        artifact = current_cv(package)
        attachment = {
            "artifact_id": artifact["artifact_id"],
            "version": artifact["version"],
            "content_hash": content_hash(
                {
                    "artifact_id": artifact["artifact_id"],
                    "package_id": package["package_id"],
                    "version": artifact["version"],
                    "content": artifact["content"],
                }
            ),
            "filename": f"{candidate.full_name}-{job.title}-cv-v{artifact['version']}.pdf",
        }
    return {
        "message_id": draft_id,
        "draft_id": draft_id,
        "candidate_id": candidate.candidate_id,
        "job_id": job.job_id,
        "contact_id": contact.contact_id,
        "package_id": package["package_id"] if package else None,
        "channel": channel,
        "recipient_name": contact.full_name,
        "recipient_url": contact.profile_url or None,
        "recipient_email": contact.email if channel == "email" else None,
        "subject": subject,
        "attachment": attachment,
        "body": body,
        "status": "draft",
        "factuality_notes": [
            "Only candidate-confirmed profile facts and selected job details were referenced.",
            "Public search or candidate-supplied contact evidence does not establish vacancy ownership.",
            "Nothing is sent automatically; review and exact-payload approval are required.",
        ],
        "personalization_rationale": f"Uses the selected job, confirmed profile facts, and the supplied public evidence for {contact.full_name}.",
        "approved_text_hash": None,
        "approved_at": None,
        "approved_by": None,
        "handed_off_at": None,
        "candidate_confirmed_sent_at": None,
        "created_at": at,
        "updated_at": at,
        "responses": [],
        "history": [
            history_event(
                "draft_created",
                "Draft created",
                "Exact-payload approval is required before handoff.",
            )
        ],
        "is_demo": False,
    }


def edit_outreach(message: dict[str, Any], body: str, subject: str | None) -> dict[str, Any]:
    if message["status"] in {"handed_off", "candidate_confirmed_sent"}:
        raise ApiError(
            409,
            "draft_locked",
            "A message cannot be edited after handoff. Create a new draft instead.",
        )
    if message["channel"] == "email" and not (subject or "").strip():
        raise ApiError(422, "subject_required", "An email subject is required.")
    message["body"] = body.strip()
    if message["channel"] == "email":
        message["subject"] = (subject or "").strip()
    message["status"] = "draft"
    message["approved_text_hash"] = None
    message["approved_at"] = None
    message["approved_by"] = None
    message["updated_at"] = timestamp()
    message["history"].append(
        history_event("draft_edited", "Draft edited", "The edit invalidated any earlier approval.")
    )
    return message


def approve_outreach(message: dict[str, Any], candidate_id: str) -> dict[str, Any]:
    if message["channel"] == "linkedin":
        message["recipient_url"] = validate_linkedin_profile(
            str(message.get("recipient_url") or "")
        )
    canonical = outreach_canonical(message)
    at = timestamp()
    message["approved_text_hash"] = hashlib.sha256(canonical.encode()).hexdigest()
    message["approved_at"] = at
    message["approved_by"] = candidate_id
    message["status"] = "approved"
    message["updated_at"] = at
    message["history"].append(
        history_event("approved", "Exact message approved", "Approval did not send anything.")
    )
    return message


def handoff_outreach(message: dict[str, Any]) -> dict[str, Any]:
    if message["status"] != "approved" or not message.get("approved_text_hash"):
        raise ApiError(
            422,
            "outreach_approval_required",
            "Backend-confirmed exact-message approval is required before handoff.",
        )
    current_hash = hashlib.sha256(outreach_canonical(message).encode()).hexdigest()
    if current_hash != message["approved_text_hash"]:
        raise ApiError(
            409,
            "approval_invalidated",
            "The recipient or message changed. Approve the exact payload again.",
        )
    at = timestamp()
    message["status"] = "handed_off"
    message["handed_off_at"] = at
    message["updated_at"] = at
    message["history"].append(
        history_event(
            "linkedin_handoff_opened"
            if message["channel"] == "linkedin"
            else "email_handoff_opened",
            "Handoff recorded",
            "Opening a draft or profile is not proof of sending.",
        )
    )
    return message


def confirm_outreach(message: dict[str, Any]) -> dict[str, Any]:
    if message["status"] not in {"handed_off", "candidate_confirmed_sent"}:
        raise ApiError(
            422,
            "handoff_required",
            "Complete the handoff before confirming that you sent the message.",
        )
    if message["status"] == "handed_off":
        at = timestamp()
        message["status"] = "candidate_confirmed_sent"
        message["candidate_confirmed_sent_at"] = at
        message["updated_at"] = at
        message["history"].append(
            history_event(
                "candidate_confirmed_sent",
                "Candidate confirmed sent",
                "Self-reported; not provider-verified delivery.",
            )
        )
    return message