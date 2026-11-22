import re
from typing import Any, cast
from urllib.parse import quote
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.career_engine import (
    application_handoff,
    approve_channel,
    approve_cover,
    approve_cv,
    approve_outreach,
    confirm_outreach,
    contact_from_result,
    cover_letter,
    create_master_profile,
    create_outreach,
    create_package,
    edit_outreach,
    generate_cv_from_master,
    handoff_outreach,
    match_job,
    new_id,
    people_search_url,
    provider_capabilities,
    report_application,
    revise_master,
    save_answer,
    save_cv_version,
    timestamp,
    validate_linkedin_profile,
)
from app.career_schemas import (
    ActionInput,
    ActionPlan,
    AnswerInput,
    ApplicationPackage,
    ApprovalInput,
    ApprovalReceipt,
    Candidate,
    CandidateConfirmationInput,
    CandidateSentReceipt,
    CoachInput,
    CoachReply,
    ContactDiscoveryResult,
    ContactInput,
    ContactPatch,
    CvArtifactInput,
    CvUploadInput,
    DownloadResponse,
    DraftApprovalInput,
    EmailDraftInput,
    EmptyInput,
    FactRevisionInput,
    FactRevisionResponse,
    HandoffInput,
    HandoffReceipt,
    HiringContact,
    Interaction,
    InteractionInput,
    Job,
    JobDiscoverInput,
    JobImportInput,
    JobMatch,
    JobsResponse,
    LinkedInProfileInput,
    OnboardInput,
    OutreachDraft,
    OutreachDraftInput,
    PackagePatch,
    ProfilePatch,
    ProviderCapabilitiesResponse,
    RevisionResponse,
    WorkspaceData,
)
from app.career_store import (
    check_package_revision,
    contact_schema,
    current_master,
    get_candidate,
    job_schema,
    owned_contact,
    owned_job,
    owned_package,
    package_schema,
    require_candidate,
    run_mutation,
    save_candidate_revision,
    save_package,
    timeline_for,
)
from app.config import Settings
from app.database import get_db, utcnow
from app.dependencies import AuthContext, get_current_auth, require_csrf
from app.errors import ApiError
from app.needle import NeedleClient, NeedleError
from app.models import (
    ApplicationPackageRecord,
    CareerProfile,
    ContactRecord,
    InteractionRecord,
    JobRecord,
    OutreachRecord,
    PackageRevision,
    ProfileRevision,
)
from app.providers import BraveSearchProvider, JobPageImporter, ProviderError, normalize_public_url

router = APIRouter(tags=["Career engine"])
JsonDict = dict[str, Any]


def settings_for(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


def search_for(request: Request) -> BraveSearchProvider:
    return cast(BraveSearchProvider, request.app.state.search_provider)


def importer_for(request: Request) -> JobPageImporter:
    return cast(JobPageImporter, request.app.state.job_importer)


def needle_for(request: Request) -> NeedleClient:
    return cast(NeedleClient, request.app.state.needle)


def public_url(value: str) -> str:
    try:
        return normalize_public_url(value)
    except ProviderError as error:
        raise provider_error(error) from None


def provider_error(error: ProviderError) -> ApiError:
    messages = {
        "invalid_url": (
            422,
            "Enter a public HTTP(S) job URL without credentials, local addresses or custom ports.",
        ),
        "destination_unavailable": (
            422,
            "The public job page could not be retrieved. No job was invented or imported.",
        ),
        "job_details_not_found": (
            422,
            "The page did not expose a job title, company and description. Add a different public job URL.",
        ),
        "unsupported_content": (422, "The supplied URL did not return an HTML job page."),
        "response_too_large": (422, "The job page exceeded the safe import size limit."),
        "integration_not_configured": (
            503,
            "The optional public search provider is not configured.",
        ),
        "provider_unavailable": (
            503,
            "The public search provider is temporarily unavailable. No contact results were substituted.",
        ),
    }
    status, message = messages.get(str(error), (503, "The external provider is unavailable."))
    return ApiError(status, str(error), message)


@router.get("/providers/capabilities", response_model=ProviderCapabilitiesResponse)
async def capabilities(request: Request) -> dict[str, Any]:
    return provider_capabilities(settings_for(request).search_configured)


@router.get("/candidates/{candidate_id}/profile", response_model=Candidate)
async def get_profile(
    candidate_id: UUID,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
) -> Candidate:
    require_candidate(auth, candidate_id)
    return await get_candidate(db, auth)


@router.get("/candidates/{candidate_id}/profile/revisions", response_model=RevisionResponse)
async def profile_revisions(
    candidate_id: UUID,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
) -> RevisionResponse:
    require_candidate(auth, candidate_id)
    await get_candidate(db, auth)
    rows = (
        (
            await db.execute(
                select(ProfileRevision)
                .join(CareerProfile, CareerProfile.id == ProfileRevision.profile_id)
                .where(CareerProfile.user_id == auth.user.id)
                .order_by(ProfileRevision.revision.asc())
            )
        )
        .scalars()
        .all()
    )
    return RevisionResponse(revisions=[row.master_profile for row in rows])


@router.patch("/candidates/{candidate_id}/profile", response_model=Candidate)
async def patch_profile(
    candidate_id: UUID,
    payload: ProfilePatch,
    request: Request,
    auth: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> JsonDict:
    require_candidate(auth, candidate_id)

    async def mutate() -> Candidate:
        candidate = await get_candidate(db, auth)
        if candidate.master_profile_version != payload.expected_version:
            raise ApiError(
                409,
                "revision_conflict",
                "The profile changed. Reload the latest revision and review again.",
            )
        changes = payload.model_dump(
            exclude_unset=True, exclude={"expected_version", "candidate_confirmed"}
        )
        if not changes:
            return candidate
        if payload.email is not None and not re.fullmatch(
            r"[^\s@]+@[^\s@]+\.[^\s@]+", payload.email
        ):
            raise ApiError(422, "invalid_email", "Enter a valid candidate-confirmed email address.")
        confirmed_at = timestamp() if payload.candidate_confirmed else None
        updated = candidate.model_copy(
            update={
                **changes,
                "master_profile_version": candidate.master_profile_version + 1,
                "profile_confirmed_at": confirmed_at,
            }
        )
        master = create_master_profile(updated)
        await save_candidate_revision(db, auth, updated, master, payload.expected_version)
        return updated

    return await run_mutation(
        db,
        request,
        auth,
        "master_profile_revised",
        payload.model_dump(mode="json"),
        "profile",
        str(candidate_id),
        mutate,
    )


@router.post("/candidates/{candidate_id}/documents/cv", response_model=Candidate)
async def upload_cv(
    candidate_id: UUID,
    payload: CvUploadInput,
    request: Request,
    auth: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> JsonDict:
    require_candidate(auth, candidate_id)

    async def mutate() -> Candidate:
        candidate = await get_candidate(db, auth)
        supported = (".pdf", ".docx", ".txt")
        if not payload.filename.lower().endswith(supported):
            raise ApiError(
                422, "unsupported_document", "Upload a PDF, DOCX or TXT CV parsed by the frontend."
            )
        known = (
            "python",
            "typescript",
            "javascript",
            "aws",
            "azure",
            "gcp",
            "kubernetes",
            "docker",
            "fastapi",
            "terraform",
            "postgresql",
            "react",
        )
        found = [item for item in known if re.search(rf"\b{re.escape(item)}\b", payload.text, re.I)]
        updated = candidate.model_copy(
            update={
                "cv_filename": payload.filename,
                "cv_text": payload.text,
                "skills": list(dict.fromkeys([*candidate.skills, *found])),
                "master_profile_version": candidate.master_profile_version + 1,
                "profile_confirmed_at": None,
                "master_documents": [
                    *candidate.master_documents,
                    {
                        "filename": payload.filename,
                        "text": payload.text,
                        "version": candidate.master_profile_version + 1,
                        "captured_at": timestamp(),
                    },
                ],
            }
        )
        master = create_master_profile(updated)
        await save_candidate_revision(db, auth, updated, master, candidate.master_profile_version)
        return updated

    return await run_mutation(
        db,
        request,
        auth,
        "master_profile_revised",
        payload.model_dump(mode="json"),
        "profile",
        str(candidate_id),
        mutate,
    )


@router.post("/candidates/{candidate_id}/profile/linkedin", response_model=Candidate)
async def save_linkedin_profile(
    candidate_id: UUID,
    payload: LinkedInProfileInput,
    request: Request,
    auth: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> JsonDict:
    require_candidate(auth, candidate_id)
    if payload.consent_confirmed is not True:
        raise ApiError(422, "consent_required", "Confirm that you want Hired Not Tired to import your LinkedIn profile.")

    async def mutate() -> Candidate:
        candidate = await get_candidate(db, auth)
        profile_url = validate_linkedin_profile(payload.linkedin_url)
        identity_match = re.search(r"/in/([^/?#]+)", profile_url)
        if not identity_match:
            raise ApiError(422, "invalid_linkedin_profile", "Use a LinkedIn public profile URL in the format linkedin.com/in/your-profile.")
        try:
            response = await needle_for(request).get_profile(identity_match.group(1))
        except NeedleError as error:
            raise ApiError(503, "needle_unavailable", str(error)) from None
        imported = response.get("profile", response.get("data", response))
        if not isinstance(imported, dict):
            raise ApiError(502, "invalid_needle_response", "Needle returned an invalid profile.")
        first = str(imported.get("firstName") or "").strip()
        last = str(imported.get("lastName") or "").strip()
        full_name = str(imported.get("fullName") or " ".join(x for x in (first, last) if x)).strip()
        raw_skills = imported.get("skills") or []
        skills = []
        for item in raw_skills:
            value = item.get("name") if isinstance(item, dict) else item
            if isinstance(value, str) and value.strip():
                skills.append(value.strip())
        work = imported.get("workExperience") or []
        experience_lines = []
        if isinstance(work, list):
            for item in work[:30]:
                if isinstance(item, dict):
                    title = item.get("title") or item.get("jobTitle") or ""
                    company = item.get("companyName") or item.get("company") or ""
                    dates = " ".join(str(item.get(key) or "") for key in ("startDate", "endDate")).strip()
                    line = " at ".join(x for x in (str(title).strip(), str(company).strip()) if x)
                    if line:
                        experience_lines.append(f"{line} {dates}".strip())
        headline = str(imported.get("headline") or "").strip()
        summary = str(imported.get("summary") or "").strip()
        profile_summary = "\n".join(x for x in (headline, summary, *experience_lines) if x)
        update = {
            "linkedin_url": profile_url,
            "full_name": candidate.full_name or full_name,
            "summary": candidate.summary or profile_summary[:20000],
            "skills": list(dict.fromkeys([*candidate.skills, *skills]))[:100],
            "master_profile_version": candidate.master_profile_version + 1,
            "profile_confirmed_at": None,
            "master_documents": [
                *candidate.master_documents,
                {
                    "source": "needle_linkedin_profile",
                    "profile_url": profile_url,
                    "imported_at": timestamp(),
                    "headline": headline,
                    "summary": summary,
                    "work_experience": work[:30] if isinstance(work, list) else [],
                    "education": imported.get("education") or [],
                    "skills": skills,
                    "throttled_sections": imported.get("throttledSections") or [],
                },
            ],
        }
        updated = candidate.model_copy(update=update)
        master = create_master_profile(updated)
        await save_candidate_revision(db, auth, updated, master, candidate.master_profile_version)
        return updated

    return await run_mutation(
        db,
        request,
        auth,
        "master_profile_revised",
        payload.model_dump(mode="json"),
        "profile",
        str(candidate_id),
        mutate,
    )


@router.post("/candidates/onboard", response_model=Candidate)
async def onboard(
    payload: OnboardInput,
    request: Request,
    auth: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> JsonDict:
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", payload.email):
        raise ApiError(422, "invalid_email", "Enter a valid candidate-confirmed email address.")

    async def mutate() -> Candidate:
        candidate = await get_candidate(db, auth)
        updated = candidate.model_copy(
            update={
                **payload.model_dump(),
                "linkedin_url": validate_linkedin_profile(payload.linkedin_url)
                if payload.linkedin_url
                else None,
                "master_profile_version": candidate.master_profile_version + 1,
                "profile_confirmed_at": timestamp(),
            }
        )
        master = create_master_profile(updated)
        await save_candidate_revision(db, auth, updated, master, candidate.master_profile_version)
        return updated

    return await run_mutation(
        db,
        request,
        auth,
        "master_profile_revised",
        payload.model_dump(mode="json"),
        "profile",
        str(auth.user.id),
        mutate,
    )


@router.patch(
    "/candidates/{candidate_id}/profile/facts/{fact_id}", response_model=FactRevisionResponse
)
async def revise_fact(
    candidate_id: UUID,
    fact_id: str,
    payload: FactRevisionInput,
    request: Request,
    auth: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> JsonDict:
    require_candidate(auth, candidate_id)

    async def mutate() -> FactRevisionResponse:
        candidate = await get_candidate(db, auth)
        if candidate.master_profile_version != payload.expected_version:
            raise ApiError(
                409,
                "revision_conflict",
                "The profile changed. Reload the latest revision and review again.",
            )
        master = await current_master(db, auth, candidate)
        updated, revision, changed = revise_master(
            candidate,
            master,
            fact_id=payload.fact_id or (None if fact_id == "confirmation" else fact_id),
            value=payload.value,
            conflict_id=payload.conflict_id,
            use_proposed=payload.use_proposed,
            confirm_all=payload.confirm_all is True,
        )
        if changed:
            await save_candidate_revision(db, auth, updated, revision, payload.expected_version)
        return FactRevisionResponse(candidate=updated, master_profile=revision)

    return await run_mutation(
        db,
        request,
        auth,
        "master_profile_revised",
        payload.model_dump(mode="json"),
        "profile",
        str(candidate_id),
        mutate,
    )


@router.get("/jobs", response_model=list[Job])
async def list_jobs(
    auth: AuthContext = Depends(get_current_auth), db: AsyncSession = Depends(get_db)
) -> list[Job]:
    rows = (
        (
            await db.execute(
                select(JobRecord)
                .where(JobRecord.user_id == auth.user.id)
                .order_by(JobRecord.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [job_schema(row) for row in rows]


@router.post("/jobs/import", response_model=Job)
async def import_job(
    payload: JobImportInput,
    request: Request,
    auth: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> JsonDict:
    require_candidate(auth, payload.candidate_id)

    async def mutate() -> Job:
        try:
            imported = await importer_for(request).import_url(payload.source_url)
        except ProviderError as error:
            raise provider_error(error) from None
        existing = await db.scalar(
            select(JobRecord).where(
                JobRecord.user_id == auth.user.id, JobRecord.source_url == imported.source_url
            )
        )
        at = utcnow()
        if existing:
            existing.title = imported.title
            existing.company = imported.company
            existing.location = imported.location
            existing.description = imported.description
            existing.requirements = imported.requirements
            existing.application_method = imported.application_method
            existing.retrieved_at = at
            existing.updated_at = at
            record = existing
        else:
            record = JobRecord(
                user_id=auth.user.id,
                title=imported.title,
                company=imported.company,
                location=imported.location,
                description=imported.description,
                requirements=imported.requirements,
                source="job_url_import",
                source_url=imported.source_url,
                application_method=imported.application_method,
                retrieved_at=at,
            )
            db.add(record)
        await db.flush()
        return job_schema(record)

    return await run_mutation(
        db,
        request,
        auth,
        "job_imported",
        payload.model_dump(mode="json"),
        "job",
        payload.source_url,
        mutate,
    )


@router.post("/jobs/discover", response_model=JobsResponse)
async def discover_jobs(
    payload: JobDiscoverInput,
    request: Request,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
) -> JobsResponse:
    require_candidate(auth, payload.candidate_id)
    candidate = await get_candidate(db, auth)
    if not needle_for(request).configured:
        raise ApiError(503, "needle_not_configured", "LinkedIn job discovery is not configured on the production backend.")
    terms = list(dict.fromkeys([*candidate.target_roles, candidate.career_goal]))
    keywords = " ".join(value.strip() for value in terms if value and value.strip())[:500]
    if not keywords:
        raise ApiError(422, "job_preferences_required", "Add at least one target role or career goal before searching LinkedIn.")
    try:
        response = await needle_for(request).search_jobs(
            keywords=keywords,
            location=candidate.locations[0] if candidate.locations else None,
            limit=payload.limit,
        )
    except NeedleError as error:
        raise ApiError(503, "needle_unavailable", str(error)) from None
    external_jobs = response.get("jobs", response.get("data", []))
    if isinstance(external_jobs, dict):
        external_jobs = external_jobs.get("jobs", [])
    if not isinstance(external_jobs, list):
        raise ApiError(502, "invalid_needle_response", "Needle returned an invalid jobs response.")
    saved: list[Job] = []
    for item in external_jobs[:payload.limit]:
        if not isinstance(item, dict):
            continue
        job_id = str(item.get("jobId") or item.get("id") or "").strip()
        source_url = str(item.get("jobUrl") or item.get("url") or item.get("linkedinUrl") or "").strip()
        if not source_url and job_id:
            source_url = f"https://www.linkedin.com/jobs/view/{job_id}/"
        title = str(item.get("title") or "").strip()
        company_value = item.get("companyName") or item.get("company") or ""
        company = str(company_value.get("name") if isinstance(company_value, dict) else company_value).strip()
        if not source_url or not title or not company:
            continue
        description = str(item.get("description") or "")
        location = str(item.get("location") or "")
        requirements = item.get("skills") or item.get("requirements") or []
        if not isinstance(requirements, list):
            requirements = []
        requirements = [str(value.get("name") if isinstance(value, dict) else value) for value in requirements]
        existing = await db.scalar(select(JobRecord).where(JobRecord.user_id == auth.user.id, JobRecord.source_url == source_url))
        at = utcnow()
        if existing:
            existing.title, existing.company, existing.location = title, company, location
            existing.description, existing.requirements = description, requirements
            existing.retrieved_at, existing.updated_at = at, at
            record = existing
        else:
            record = JobRecord(
                id=uuid4(), user_id=auth.user.id, title=title, company=company,
                location=location, description=description, requirements=requirements,
                source="linkedin_needle", source_url=source_url, retrieved_at=at,
            )
            db.add(record)
        await db.flush()
        saved.append(job_schema(record))
    return JobsResponse(jobs=saved)


@router.post("/jobs/{job_id}/match/{candidate_id}", response_model=JobMatch)
async def match(
    job_id: UUID,
    candidate_id: UUID,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
) -> JobMatch:
    require_candidate(auth, candidate_id)
    candidate = await get_candidate(db, auth)
    job = job_schema(await owned_job(db, auth, job_id))
    return JobMatch.model_validate(match_job(candidate, job))


@router.post(
    "/candidates/{candidate_id}/jobs/{job_id}/application-package",
    response_model=ApplicationPackage,
)
async def create_application_package(
    candidate_id: UUID,
    job_id: UUID,
    payload: EmptyInput,
    request: Request,
    auth: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> JsonDict:
    require_candidate(auth, candidate_id)

    async def mutate() -> ApplicationPackage:
        existing = await db.scalar(
            select(ApplicationPackageRecord).where(
                ApplicationPackageRecord.user_id == auth.user.id,
                ApplicationPackageRecord.job_id == job_id,
            )
        )
        if existing:
            return package_schema(existing)
        candidate = await get_candidate(db, auth)
        job = job_schema(await owned_job(db, auth, job_id))
        data = create_package(
            candidate, job, provider_capabilities(settings_for(request).search_configured)
        )
        record = ApplicationPackageRecord(
            id=UUID(data["package_id"]), user_id=auth.user.id, job_id=job_id, revision=1, data=data
        )
        db.add(record)
        await db.flush()
        db.add(PackageRevision(package_id=record.id, revision=1, data=data))
        await db.flush()
        return package_schema(record)

    return await run_mutation(
        db,
        request,
        auth,
        "application_package_created",
        payload.model_dump(mode="json"),
        "application_package",
        str(job_id),
        mutate,
    )


@router.get("/application-packages/{package_id}", response_model=ApplicationPackage)
async def get_package(
    package_id: UUID,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
) -> ApplicationPackage:
    return package_schema(await owned_package(db, auth, package_id))


@router.get("/application-packages/{package_id}/revisions", response_model=list[ApplicationPackage])
async def package_revisions(
    package_id: UUID,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
) -> list[ApplicationPackage]:
    record = await owned_package(db, auth, package_id)
    rows = (
        (
            await db.execute(
                select(PackageRevision)
                .where(PackageRevision.package_id == record.id)
                .order_by(PackageRevision.revision.asc())
            )
        )
        .scalars()
        .all()
    )
    return [ApplicationPackage.model_validate(row.data) for row in rows]


@router.post("/application-packages/{package_id}/cv-artifacts", response_model=ApplicationPackage)
async def generate_cv_artifact(
    package_id: UUID,
    payload: CvArtifactInput,
    request: Request,
    auth: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> JsonDict:
    async def mutate() -> ApplicationPackage:
        record = await owned_package(db, auth, package_id)
        check_package_revision(request, record)
        candidate = await get_candidate(db, auth)
        if (
            payload.source_profile_version is not None
            and candidate.master_profile_version != payload.source_profile_version
        ):
            raise ApiError(
                409, "revision_conflict", "The requested master profile is no longer current."
            )
        data = dict(record.data)
        master = await current_master(db, auth, candidate)
        data = generate_cv_from_master(
            data, candidate, job_schema(await owned_job(db, auth, record.job_id)), master
        )
        return await save_package(db, record, data)

    return await run_mutation(
        db,
        request,
        auth,
        "cv_version_created",
        payload.model_dump(mode="json"),
        "application_package",
        str(package_id),
        mutate,
    )


@router.patch("/application-packages/{package_id}/cv-artifacts", response_model=ApplicationPackage)
async def edit_cv_artifact(
    package_id: UUID,
    payload: CvArtifactInput,
    request: Request,
    auth: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> JsonDict:
    async def mutate() -> ApplicationPackage:
        record = await owned_package(db, auth, package_id)
        check_package_revision(request, record)
        data = dict(record.data)
        if payload.artifact_id != data["current_artifact_id"] or payload.content is None:
            raise ApiError(
                409,
                "approval_version_mismatch",
                "The edited artifact is not the current package version.",
            )
        data = save_cv_version(data, payload.content)
        return await save_package(db, record, data)

    return await run_mutation(
        db,
        request,
        auth,
        "cv_version_created",
        payload.model_dump(mode="json"),
        "application_package",
        str(package_id),
        mutate,
    )


@router.get(
    "/application-packages/{package_id}/cv-artifacts/{artifact_id}/download",
    response_model=DownloadResponse,
)
async def download_cv(
    package_id: UUID,
    artifact_id: str,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
) -> DownloadResponse:
    record = await owned_package(db, auth, package_id)
    data: dict[str, Any] = record.data
    artifact = next((item for item in data["versions"] if item["artifact_id"] == artifact_id), None)
    if artifact is None or not artifact.get("approval"):
        raise ApiError(
            422, "cv_approval_required", "Only an exact approved artifact can be downloaded."
        )
    return DownloadResponse(
        artifact_id=artifact_id,
        version=artifact["version"],
        filename=f"tailored-cv-v{artifact['version']}.txt",
        content=artifact["content"],
    )


@router.post("/application-packages/{package_id}/answers", response_model=ApplicationPackage)
@router.post(
    "/application-packages/{package_id}/answers/{answer_id}", response_model=ApplicationPackage
)
@router.patch(
    "/application-packages/{package_id}/answers/{answer_id}", response_model=ApplicationPackage
)
async def save_application_answer(
    package_id: UUID,
    payload: AnswerInput,
    request: Request,
    answer_id: str | None = None,
    auth: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> JsonDict:
    async def mutate() -> ApplicationPackage:
        record = await owned_package(db, auth, package_id)
        check_package_revision(request, record)
        if answer_id and payload.answer_id != answer_id:
            raise ApiError(422, "answer_mismatch", "The answer path and payload do not match.")
        data = save_answer(
            dict(record.data),
            answer_id or payload.answer_id,
            payload.question,
            payload.proposed_answer,
            payload.confirmed,
        )
        return await save_package(db, record, data)

    return await run_mutation(
        db,
        request,
        auth,
        "answer_saved",
        payload.model_dump(mode="json"),
        "application_package",
        str(package_id),
        mutate,
    )


@router.patch("/application-packages/{package_id}", response_model=ApplicationPackage)
async def patch_package(
    package_id: UUID,
    payload: PackagePatch,
    request: Request,
    auth: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> JsonDict:
    async def mutate() -> ApplicationPackage:
        record = await owned_package(db, auth, package_id)
        check_package_revision(request, record)
        cover = payload.cover_letter
        if set(cover) - {"action", "artifact_id", "content"}:
            raise ApiError(422, "validation_error", "Unsupported cover-letter operation.")
        action = cover.get("action")
        content = cover.get("content")
        if action == "create":
            data = cover_letter(dict(record.data))
        else:
            if cover.get("artifact_id") != record.data.get(
                "current_cover_letter_id"
            ) or not isinstance(content, str):
                raise ApiError(
                    409,
                    "approval_version_mismatch",
                    "The edited cover letter is not the current version.",
                )
            data = cover_letter(dict(record.data), content)
        return await save_package(db, record, data)

    return await run_mutation(
        db,
        request,
        auth,
        "cover_letter_created",
        payload.model_dump(mode="json"),
        "application_package",
        str(package_id),
        mutate,
    )


@router.post("/application-packages/{package_id}/approvals", response_model=None)
async def approve_package_artifact(
    package_id: UUID,
    payload: ApprovalInput,
    request: Request,
    auth: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> JsonDict:
    if payload.artifact_type == "outreach_draft":
        if not payload.draft_id:
            raise ApiError(422, "draft_required", "Select an outreach draft for approval.")
        draft = await owned_outreach(db, auth, UUID(payload.draft_id))
        if draft.package_id != package_id or draft.channel != "email":
            raise ApiError(
                404, "draft_not_found", "The email draft is unavailable in this package."
            )
        return await approve_outreach_draft(
            candidate_id=auth.user.id,
            draft_id=UUID(payload.draft_id),
            payload=payload_to_draft_approval(payload),
            request=request,
            auth=auth,
            db=db,
        )

    async def mutate() -> ApplicationPackage:
        record = await owned_package(db, auth, package_id)
        check_package_revision(request, record)
        data = dict(record.data)
        if payload.artifact_type == "tailored_cv":
            if not payload.artifact_id or payload.version is None or payload.content is None:
                raise ApiError(
                    422,
                    "approval_payload_required",
                    "Artifact ID, version and exact content are required.",
                )
            data = approve_cv(
                data, payload.artifact_id, payload.version, payload.content, str(auth.user.id)
            )
        elif payload.artifact_type == "cover_letter":
            if not payload.artifact_id or payload.version is None or payload.content is None:
                raise ApiError(
                    422,
                    "approval_payload_required",
                    "Artifact ID, version and exact content are required.",
                )
            data = approve_cover(
                data, payload.artifact_id, payload.version, payload.content, str(auth.user.id)
            )
        else:
            if not payload.channel:
                raise ApiError(422, "channel_required", "Select an application channel.")
            data = approve_channel(
                data,
                payload.channel,
                payload.destination,
                job_schema(await owned_job(db, auth, record.job_id)),
                str(auth.user.id),
            )
        return await save_package(db, record, data)

    event = {
        "tailored_cv": "cv_approved",
        "cover_letter": "cover_letter_approved",
        "channel_action": "application_path_approved",
    }[payload.artifact_type]
    return await run_mutation(
        db,
        request,
        auth,
        event,
        payload.model_dump(mode="json"),
        "application_package",
        str(package_id),
        mutate,
    )


@router.post("/application-packages/{package_id}/actions/{channel}", response_model=None)
async def application_action(
    package_id: UUID,
    channel: str,
    payload: ActionInput,
    request: Request,
    auth: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> JsonDict:
    if channel == "email":

        async def mutate_email() -> JsonDict:
            if not payload.draft_id:
                raise ApiError(422, "draft_required", "Select an email draft for handoff.")
            record = await owned_outreach(db, auth, UUID(payload.draft_id))
            if record.package_id != package_id or record.channel != "email":
                raise ApiError(
                    404, "draft_not_found", "The email draft is unavailable in this package."
                )
            if payload.action != "handoff":
                raise ApiError(
                    503,
                    "integration_not_configured",
                    "Authorized email sending is not configured. Use the mailto handoff.",
                )
            if payload.approved_text_hash != record.data.get("approved_text_hash"):
                raise ApiError(
                    409, "approval_invalidated", "The exact email approval hash does not match."
                )
            data = handoff_outreach(dict(record.data))
            record.data = data
            await db.flush()
            return {
                "draft_id": str(record.id),
                "status": "handed_off",
                "recipient_email": data["recipient_email"],
                "subject": data["subject"],
                "message": data["body"],
                "mailto_url": f"mailto:{quote(data['recipient_email'])}?subject={quote(data['subject'])}&body={quote(data['body'])}",
                "handed_off_at": data["handed_off_at"],
            }

        return await run_mutation(
            db,
            request,
            auth,
            "email_handoff_opened",
            payload.model_dump(mode="json"),
            "outreach",
            payload.draft_id or str(package_id),
            mutate_email,
        )
    if payload.action == "submit":
        raise ApiError(
            503,
            "integration_not_configured",
            "No official authorized direct-submission integration is configured. Use guided handoff.",
        )

    async def mutate() -> ApplicationPackage:
        record = await owned_package(db, auth, package_id)
        check_package_revision(request, record)
        data = application_handoff(
            dict(record.data),
            channel,
            payload.destination,
            job_schema(await owned_job(db, auth, record.job_id)),
        )
        return await save_package(db, record, data)

    return await run_mutation(
        db,
        request,
        auth,
        "application_handoff_opened",
        payload.model_dump(mode="json"),
        "application_package",
        str(package_id),
        mutate,
    )


@router.post(
    "/application-packages/{package_id}/actions/{channel}/candidate-confirmation",
    response_model=None,
)
async def confirm_application_action(
    package_id: UUID,
    channel: str,
    payload: CandidateConfirmationInput,
    request: Request,
    auth: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> JsonDict:
    if not (payload.candidate_reported or payload.candidate_confirmed):
        raise ApiError(
            422, "candidate_confirmation_required", "Explicit candidate confirmation is required."
        )
    if channel == "email":

        async def mutate_email_confirmation() -> CandidateSentReceipt:
            if not payload.draft_id:
                raise ApiError(422, "draft_required", "Select the exact email draft.")
            record = await owned_outreach(db, auth, payload.draft_id)
            if record.package_id != package_id or record.channel != "email":
                raise ApiError(
                    404, "draft_not_found", "The email draft is unavailable in this package."
                )
            data = confirm_outreach(dict(record.data))
            record.data = data
            await db.flush()
            return CandidateSentReceipt(
                draft_id=str(record.id),
                candidate_confirmed_sent_at=data["candidate_confirmed_sent_at"],
            )

        return await run_mutation(
            db,
            request,
            auth,
            "candidate_confirmed_sent",
            payload.model_dump(mode="json"),
            "outreach",
            str(payload.draft_id or package_id),
            mutate_email_confirmation,
        )

    async def mutate() -> ApplicationPackage:
        record = await owned_package(db, auth, package_id)
        check_package_revision(request, record)
        data = report_application(dict(record.data), channel)
        return await save_package(db, record, data)

    return await run_mutation(
        db,
        request,
        auth,
        "application_candidate_reported",
        payload.model_dump(mode="json"),
        "application_package",
        str(package_id),
        mutate,
    )


@router.post("/candidates/{candidate_id}/jobs/{job_id}/contacts", response_model=HiringContact)
async def create_contact(
    candidate_id: UUID,
    job_id: UUID,
    payload: ContactInput,
    request: Request,
    auth: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> JsonDict:
    require_candidate(auth, candidate_id)

    async def mutate() -> HiringContact:
        await owned_job(db, auth, job_id)
        evidence = payload.evidence
        source_url = evidence.get("source_url")
        source_url = public_url(source_url) if isinstance(source_url, str) and source_url else ""
        linkedin_url = (
            validate_linkedin_profile(payload.linkedin_url) if payload.linkedin_url else ""
        )
        email = str(evidence.get("email") or "")
        if email and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            raise ApiError(422, "invalid_email", "Enter a valid candidate-supplied email address.")
        at = timestamp()
        data = HiringContact(
            contact_id=new_id(),
            candidate_id=str(candidate_id),
            job_id=str(job_id),
            full_name=payload.display_name.strip(),
            current_title=payload.current_title or "",
            company=payload.current_company or "",
            profile_url=linkedin_url,
            email=email,
            location=payload.location or "",
            source_url=source_url,
            evidence_notes=str(evidence.get("observed_fact") or ""),
            confidence="medium" if source_url and evidence.get("observed_fact") else "low",
            relevance=str(
                evidence.get("observed_fact")
                or "Candidate-supplied potential contact; relevance has not been independently verified."
            ),
            evidence_status="candidate_supplied",
            last_checked_at=at,
            evidence_date=at,
            created_at=at,
            updated_at=at,
            is_demo=False,
        )
        record = ContactRecord(
            id=UUID(data.contact_id),
            user_id=auth.user.id,
            job_id=job_id,
            data=data.model_dump(mode="json"),
            discovery_provider="candidate",
        )
        db.add(record)
        await db.flush()
        return data

    return await run_mutation(
        db,
        request,
        auth,
        "contact_created",
        payload.model_dump(mode="json"),
        "hiring_contact",
        str(job_id),
        mutate,
    )


@router.patch("/candidates/{candidate_id}/contacts/{contact_id}", response_model=HiringContact)
async def update_contact(
    candidate_id: UUID,
    contact_id: UUID,
    payload: ContactPatch,
    request: Request,
    auth: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> JsonDict:
    require_candidate(auth, candidate_id)
    if payload.email and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", payload.email):
        raise ApiError(422, "invalid_email", "Enter a valid candidate-supplied email address.")

    async def mutate() -> HiringContact:
        record = await owned_contact(db, auth, contact_id)
        existing = contact_schema(record)
        messages = (
            (
                await db.execute(
                    select(OutreachRecord).where(
                        OutreachRecord.contact_id == record.id,
                        OutreachRecord.user_id == auth.user.id,
                    )
                )
            )
            .scalars()
            .all()
        )
        if any(
            message.data.get("status") in {"handed_off", "candidate_confirmed_sent"}
            for message in messages
        ):
            raise ApiError(
                409,
                "contact_locked",
                "This contact already has a handoff. Add a new contact instead of changing recipient history.",
            )
        data = existing.model_copy(
            update={
                "full_name": payload.display_name.strip(),
                "current_title": payload.current_title or "",
                "company": payload.current_company or "",
                "location": payload.location or "",
                "email": payload.email or "",
                "profile_url": validate_linkedin_profile(payload.linkedin_url)
                if payload.linkedin_url
                else "",
                "source_url": public_url(payload.source_url) if payload.source_url else "",
                "evidence_notes": payload.evidence_notes or "",
                "evidence_status": "candidate_supplied",
                "confidence": "medium" if payload.source_url and payload.evidence_notes else "low",
                "updated_at": timestamp(),
                "last_checked_at": timestamp(),
            }
        )
        record.data = data.model_dump(mode="json")
        record.discovery_provider = "candidate"
        await db.flush()
        for message in messages:
            if message.data.get("status") == "approved":
                subject = message.data.get("subject")
                edited = edit_outreach(
                    dict(message.data),
                    str(message.data["body"]),
                    subject if isinstance(subject, str) else None,
                )
                edited["recipient_name"] = data.full_name
                edited["recipient_url"] = data.profile_url or None
                edited["recipient_email"] = data.email or None
                message.data = edited
        await db.flush()
        return data

    return await run_mutation(
        db,
        request,
        auth,
        "contact_updated",
        payload.model_dump(mode="json"),
        "hiring_contact",
        str(contact_id),
        mutate,
    )


@router.post(
    "/candidates/{candidate_id}/jobs/{job_id}/contacts/discover",
    response_model=ContactDiscoveryResult,
)
async def discover_contacts(
    candidate_id: UUID,
    job_id: UUID,
    payload: EmptyInput,
    request: Request,
    auth: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> JsonDict:
    require_candidate(auth, candidate_id)

    async def mutate() -> ContactDiscoveryResult:
        job = job_schema(await owned_job(db, auth, job_id))
        fallback = people_search_url(job)
        at = timestamp()
        provider = search_for(request)
        if not provider.configured:
            return ContactDiscoveryResult(
                status="not_configured",
                contacts=[],
                fallback_url=fallback,
                searched_at=at,
                detail="Verified automatic contact discovery is not configured. Use the contextual LinkedIn people search or add a contact you already know; no person was invented.",
            )
        query = f'site:linkedin.com/in "{job.company}" ("{job.title}" OR "hiring manager" OR "team lead" OR "recruiter" OR "talent acquisition")'
        try:
            results = await provider.search(query)
        except ProviderError:
            return ContactDiscoveryResult(
                status="unavailable",
                contacts=[],
                fallback_url=fallback,
                searched_at=at,
                detail="The public search provider is unavailable. No contact results were substituted; use the people-search fallback.",
            )
        found: list[HiringContact] = []
        for result in results:
            data = contact_from_result(result, job, str(candidate_id))
            if data is None:
                continue
            contact = HiringContact.model_validate(data)
            duplicate = next(
                (item for item in found if item.profile_url == contact.profile_url), None
            )
            if duplicate:
                continue
            record = ContactRecord(
                id=UUID(contact.contact_id),
                user_id=auth.user.id,
                job_id=job_id,
                data=contact.model_dump(mode="json"),
                discovery_provider="brave",
                discovery_query=query,
            )
            db.add(record)
            found.append(contact)
        found.sort(
            key=lambda item: (item.confidence != "high", "recruit" in item.current_title.lower())
        )
        await db.flush()
        return ContactDiscoveryResult(
            status="found" if found else "no_reliable_match",
            contacts=found[:5],
            fallback_url=fallback,
            searched_at=at,
            detail="Public search results with company and role evidence are shown for your review; vacancy ownership is not established."
            if found
            else "No reliable public result with company and role evidence was found. Use the contextual LinkedIn people search; no person was invented.",
        )

    return await run_mutation(
        db,
        request,
        auth,
        "contact_discovery_completed",
        payload.model_dump(mode="json"),
        "job",
        str(job_id),
        mutate,
    )


async def owned_outreach(db: AsyncSession, auth: AuthContext, draft_id: UUID) -> OutreachRecord:
    record = await db.scalar(
        select(OutreachRecord).where(
            OutreachRecord.id == draft_id, OutreachRecord.user_id == auth.user.id
        )
    )
    if record is None:
        raise ApiError(404, "draft_not_found", "The outreach draft is unavailable in this account.")
    return record


@router.post("/outreach/draft", response_model=OutreachDraft)
async def create_linkedin_draft(
    payload: OutreachDraftInput,
    request: Request,
    auth: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> JsonDict:
    require_candidate(auth, payload.candidate_id)

    async def mutate() -> OutreachDraft:
        candidate = await get_candidate(db, auth)
        job = job_schema(await owned_job(db, auth, payload.job_id))
        contact_record: ContactRecord | None
        if payload.contact_id:
            contact_record = await owned_contact(db, auth, payload.contact_id)
        else:
            contact_record = await db.scalar(
                select(ContactRecord)
                .where(
                    ContactRecord.user_id == auth.user.id, ContactRecord.job_id == payload.job_id
                )
                .order_by(ContactRecord.updated_at.desc())
            )
        if contact_record is None or contact_record.job_id != payload.job_id:
            raise ApiError(
                422,
                "contact_required",
                "Select a real evidenced hiring contact before generating a message.",
            )
        contact = contact_schema(contact_record)
        if payload.hiring_contact_name and payload.hiring_contact_name != contact.full_name:
            raise ApiError(
                422,
                "contact_mismatch",
                "The supplied contact name does not match the selected recipient.",
            )
        data = create_outreach(candidate, job, contact, "linkedin")
        db.add(
            OutreachRecord(
                id=UUID(data["draft_id"]),
                user_id=auth.user.id,
                job_id=payload.job_id,
                contact_id=contact_record.id,
                channel="linkedin",
                data=data,
            )
        )
        await db.flush()
        return OutreachDraft(
            draft_id=data["draft_id"],
            candidate_id=data["candidate_id"],
            job_id=data["job_id"],
            contact_id=data["contact_id"],
            recipient_name=contact.full_name,
            message=data["body"],
            factuality_notes=data["factuality_notes"],
        )

    return await run_mutation(
        db,
        request,
        auth,
        "draft_created",
        payload.model_dump(mode="json"),
        "outreach",
        str(payload.job_id),
        mutate,
    )


@router.post("/application-packages/{package_id}/outreach-drafts", response_model=OutreachDraft)
async def create_email_draft(
    package_id: UUID,
    payload: EmailDraftInput,
    request: Request,
    auth: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> JsonDict:
    async def mutate() -> OutreachDraft:
        package_record = await owned_package(db, auth, package_id)
        check_package_revision(request, package_record)
        candidate = await get_candidate(db, auth)
        job = job_schema(await owned_job(db, auth, package_record.job_id))
        contact_record = await owned_contact(db, auth, payload.contact_id)
        contact = contact_schema(contact_record)
        if contact_record.job_id != package_record.job_id:
            raise ApiError(
                422, "recipient_mismatch", "The selected contact does not belong to this job."
            )
        if contact.email.lower() != payload.recipient_email.lower():
            raise ApiError(
                422, "recipient_mismatch", "The recipient email must match the selected contact."
            )
        if payload.cv_artifact_id != package_record.data["current_artifact_id"]:
            raise ApiError(
                409, "approval_version_mismatch", "Select the current exact approved CV artifact."
            )
        data = create_outreach(candidate, job, contact, "email", package_record.data)
        db.add(
            OutreachRecord(
                id=UUID(data["draft_id"]),
                user_id=auth.user.id,
                job_id=package_record.job_id,
                contact_id=contact_record.id,
                package_id=package_id,
                channel="email",
                data=data,
            )
        )
        await db.flush()
        return OutreachDraft(
            draft_id=data["draft_id"],
            candidate_id=data["candidate_id"],
            job_id=data["job_id"],
            contact_id=data["contact_id"],
            recipient_name=contact.full_name,
            subject=data["subject"],
            message=data["body"],
            factuality_notes=data["factuality_notes"],
        )

    return await run_mutation(
        db,
        request,
        auth,
        "draft_created",
        payload.model_dump(mode="json"),
        "outreach",
        str(package_id),
        mutate,
    )


@router.patch("/candidates/{candidate_id}/outreach/drafts/{draft_id}", response_model=OutreachDraft)
@router.patch(
    "/application-packages/{package_id}/outreach-drafts/{draft_id}", response_model=OutreachDraft
)
async def save_draft(
    draft_id: UUID,
    payload: dict[str, Any],
    request: Request,
    candidate_id: UUID | None = None,
    package_id: UUID | None = None,
    auth: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> JsonDict:
    from app.career_schemas import DraftPatch

    validated = DraftPatch.model_validate(payload)
    if candidate_id:
        require_candidate(auth, candidate_id)

    async def mutate() -> OutreachDraft:
        record = await owned_outreach(db, auth, draft_id)
        if record.contact_id != validated.contact_id or (
            package_id and record.package_id != package_id
        ):
            raise ApiError(
                422,
                "recipient_mismatch",
                "The draft and selected recipient or package do not match.",
            )
        data = edit_outreach(dict(record.data), validated.body, validated.subject)
        record.data = data
        await db.flush()
        return OutreachDraft(
            draft_id=str(record.id),
            candidate_id=data["candidate_id"],
            job_id=data["job_id"],
            contact_id=data["contact_id"],
            recipient_name=data["recipient_name"],
            subject=data.get("subject"),
            message=data["body"],
            factuality_notes=data["factuality_notes"],
        )

    return await run_mutation(
        db,
        request,
        auth,
        "draft_edited",
        validated.model_dump(mode="json"),
        "outreach",
        str(draft_id),
        mutate,
    )


def payload_to_draft_approval(payload: ApprovalInput) -> DraftApprovalInput:
    if not payload.draft_id or not payload.contact_id or payload.body is None:
        raise ApiError(
            422, "approval_payload_required", "Draft, contact and exact body are required."
        )
    return DraftApprovalInput(
        draft_id=payload.draft_id,
        contact_id=payload.contact_id,
        recipient_url=payload.recipient_url,
        recipient_email=payload.recipient_email,
        subject=payload.subject,
        attachment=payload.attachment,
        body=payload.body,
    )


@router.post(
    "/candidates/{candidate_id}/outreach/drafts/{draft_id}/approve", response_model=ApprovalReceipt
)
async def approve_outreach_draft(
    candidate_id: UUID,
    draft_id: UUID,
    payload: DraftApprovalInput,
    request: Request,
    auth: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> JsonDict:
    validated = payload
    require_candidate(auth, candidate_id)

    async def mutate() -> ApprovalReceipt:
        record = await owned_outreach(db, auth, draft_id)
        if record.contact_id != validated.contact_id or validated.draft_id != draft_id:
            raise ApiError(
                422,
                "recipient_mismatch",
                "The approval does not match the selected draft and recipient.",
            )
        data = dict(record.data)
        if (
            data["body"] != validated.body
            or data.get("recipient_url") != validated.recipient_url
            or data.get("recipient_email") != validated.recipient_email
            or data.get("subject") != validated.subject
            or data.get("attachment") != validated.attachment
        ):
            raise ApiError(
                409,
                "approval_payload_mismatch",
                "Approval must match the exact saved recipient, subject, attachment and body.",
            )
        data = approve_outreach(data, str(auth.user.id))
        record.data = data
        await db.flush()
        return ApprovalReceipt(
            draft_id=str(record.id),
            recipient_url=data.get("recipient_url"),
            recipient_email=data.get("recipient_email"),
            subject=data.get("subject"),
            attachment=data.get("attachment"),
            body=data["body"],
            approved_text_hash=data["approved_text_hash"],
            approved_at=data["approved_at"],
            approved_by=data["approved_by"],
        )

    return await run_mutation(
        db,
        request,
        auth,
        "approved",
        validated.model_dump(mode="json"),
        "outreach",
        str(draft_id),
        mutate,
    )


@router.post(
    "/candidates/{candidate_id}/outreach/drafts/{draft_id}/handoff", response_model=HandoffReceipt
)
async def linkedin_handoff(
    candidate_id: UUID,
    draft_id: UUID,
    payload: HandoffInput,
    request: Request,
    auth: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> JsonDict:
    require_candidate(auth, candidate_id)

    async def mutate() -> HandoffReceipt:
        record = await owned_outreach(db, auth, draft_id)
        if (
            record.channel != "linkedin"
            or record.contact_id != payload.contact_id
            or record.data.get("recipient_url") != validate_linkedin_profile(payload.recipient_url)
        ):
            raise ApiError(
                422,
                "recipient_mismatch",
                "The handoff recipient does not match the approved draft.",
            )
        data = handoff_outreach(dict(record.data))
        record.data = data
        await db.flush()
        return HandoffReceipt(
            draft_id=str(record.id),
            linkedin_url=data["recipient_url"],
            message=data["body"],
            handed_off_at=data["handed_off_at"],
        )

    return await run_mutation(
        db,
        request,
        auth,
        "linkedin_handoff_opened",
        payload.model_dump(mode="json"),
        "outreach",
        str(draft_id),
        mutate,
    )


@router.post(
    "/candidates/{candidate_id}/outreach/drafts/{draft_id}/confirm-sent",
    response_model=CandidateSentReceipt,
)
async def confirm_sent(
    candidate_id: UUID,
    draft_id: UUID,
    payload: CandidateConfirmationInput,
    request: Request,
    auth: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> JsonDict:
    require_candidate(auth, candidate_id)
    if not payload.candidate_confirmed:
        raise ApiError(
            422, "candidate_confirmation_required", "Explicit candidate confirmation is required."
        )

    async def mutate() -> CandidateSentReceipt:
        record = await owned_outreach(db, auth, draft_id)
        data = confirm_outreach(dict(record.data))
        record.data = data
        await db.flush()
        return CandidateSentReceipt(
            draft_id=str(record.id), candidate_confirmed_sent_at=data["candidate_confirmed_sent_at"]
        )

    return await run_mutation(
        db,
        request,
        auth,
        "candidate_confirmed_sent",
        payload.model_dump(mode="json"),
        "outreach",
        str(draft_id),
        mutate,
    )


@router.post("/interactions", response_model=Interaction)
async def create_interaction(
    payload: InteractionInput,
    request: Request,
    auth: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> JsonDict:
    require_candidate(auth, payload.candidate_id)

    async def mutate() -> Interaction:
        await owned_job(db, auth, payload.job_id)
        at = timestamp()
        interaction = Interaction(
            interaction_id=new_id(),
            candidate_id=str(payload.candidate_id),
            job_id=str(payload.job_id),
            channel=payload.channel,
            interaction_type=payload.interaction_type,
            content=payload.content,
            outcome=payload.outcome,
            simulated=False,
            created_at=at,
        )
        db.add(
            InteractionRecord(
                id=UUID(interaction.interaction_id),
                user_id=auth.user.id,
                job_id=payload.job_id,
                data=interaction.model_dump(mode="json"),
            )
        )
        if payload.draft_id:
            draft = await owned_outreach(db, auth, payload.draft_id)
            if draft.data.get("status") != "candidate_confirmed_sent":
                raise ApiError(
                    422,
                    "send_confirmation_required",
                    "Confirm that you sent the message before recording a reply.",
                )
            data = dict(draft.data)
            response = {
                "response_id": new_id(),
                "reply_date": payload.reply_date or at[:10],
                "content": payload.content,
                "outcome": payload.outcome,
                "created_at": at,
                "source": "candidate_recorded",
                "simulated": False,
            }
            previous_responses = data.get("responses")
            data["responses"] = [
                *(previous_responses if isinstance(previous_responses, list) else []),
                response,
            ]
            data["updated_at"] = at
            draft.data = data
        await db.flush()
        return interaction

    return await run_mutation(
        db,
        request,
        auth,
        "reply_recorded"
        if payload.interaction_type == "recruiter_reply"
        else "interaction_recorded",
        payload.model_dump(mode="json"),
        "interaction",
        str(payload.job_id),
        mutate,
    )


@router.get("/candidates/{candidate_id}/workspace", response_model=WorkspaceData)
async def workspace(
    candidate_id: UUID,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
) -> WorkspaceData:
    require_candidate(auth, candidate_id)
    contacts = (
        (
            await db.execute(
                select(ContactRecord)
                .where(ContactRecord.user_id == auth.user.id)
                .order_by(ContactRecord.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    packages = (
        (
            await db.execute(
                select(ApplicationPackageRecord)
                .where(ApplicationPackageRecord.user_id == auth.user.id)
                .order_by(ApplicationPackageRecord.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    messages = (
        (
            await db.execute(
                select(OutreachRecord)
                .where(OutreachRecord.user_id == auth.user.id)
                .order_by(OutreachRecord.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    interactions = (
        (
            await db.execute(
                select(InteractionRecord)
                .where(InteractionRecord.user_id == auth.user.id)
                .order_by(InteractionRecord.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    return WorkspaceData(
        contacts=[contact_schema(row) for row in contacts],
        application_packages=[package_schema(row) for row in packages],
        messages=[row.data for row in messages],
        interactions=[Interaction.model_validate(row.data) for row in interactions],
        timeline=await timeline_for(db, auth),
    )


@router.post("/coach/chat", response_model=CoachReply)
async def coach_chat(
    payload: CoachInput,
    auth: AuthContext = Depends(get_current_auth),
    db: AsyncSession = Depends(get_db),
) -> CoachReply:
    require_candidate(auth, payload.candidate_id)
    candidate = await get_candidate(db, auth)
    actions = action_items()
    return CoachReply(
        message="Your confirmed profile and saved jobs are available. Choose one job to prepare or review; no application or message is sent automatically.",
        insights=[
            f"Confirmed skills available for evidence mapping: {', '.join(candidate.skills[:3])}."
            if candidate.skills
            else "Add and confirm profile facts before relying on an application draft."
        ],
        recommended_actions=actions,
        workflow_id=new_id(),
    )


@router.get("/coach/action-plan/{candidate_id}", response_model=ActionPlan)
async def action_plan(
    candidate_id: UUID, auth: AuthContext = Depends(get_current_auth)
) -> ActionPlan:
    require_candidate(auth, candidate_id)
    return ActionPlan(candidate_id=str(candidate_id), actions=action_items())


def action_items() -> list[dict[str, Any]]:
    return [
        {
            "action_id": "review-match",
            "title": "Review your top match",
            "description": "Check requirements and unknown evidence before deciding.",
            "priority": "high",
            "action_type": "job_search",
            "estimated_minutes": 10,
        },
        {
            "action_id": "review-message",
            "title": "Review one thoughtful message",
            "description": "Edit and approve the exact text before a user-controlled handoff.",
            "priority": "medium",
            "action_type": "outreach",
            "estimated_minutes": 15,
        },
    ]