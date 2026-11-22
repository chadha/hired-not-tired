from uuid import UUID, uuid4

from httpx import AsyncClient, MockTransport, Response

from app.database import utcnow
from app.models import JobRecord
from app.providers import ImportedJob
from app.schemas import LinkedInIdentityClaims
from tests.conftest import bootstrap, complete_login, mutation_headers


def key() -> str:
    return str(uuid4())


def headers(
    workspace: dict[str, object], idempotency: str | None = None, revision: int | None = None
) -> dict[str, str]:
    return {
        **mutation_headers(workspace),
        "Idempotency-Key": idempotency or key(),
        **({"If-Match": str(revision)} if revision is not None else {}),
    }


async def login(
    client: AsyncClient, app: object, subject: str = "career-user"
) -> dict[str, object]:
    app.state.oidc.claims = LinkedInIdentityClaims(  # type: ignore[attr-defined]
        sub=subject,
        name="Amara Example",
        email="amara@example.test",
        email_verified=True,
    )
    await complete_login(client, app)
    return await bootstrap(client)


async def confirm_profile(client: AsyncClient, workspace: dict[str, object]) -> None:
    response = await client.patch(
        f"/api/v1/candidates/{workspace['candidate_id']}/profile",
        headers=headers(workspace),
        json={
            "expected_version": 1,
            "candidate_confirmed": True,
            "full_name": "Amara Example",
            "email": "amara@example.test",
            "career_goal": "Platform Engineer",
            "target_roles": ["Platform Engineer"],
            "locations": ["Berlin"],
            "skills": ["Python"],
            "summary": "Candidate-confirmed platform engineering background.",
            "cv_text": "Platform Engineer — Example Studio\nBuilt Python services.",
        },
    )
    assert response.status_code == 200, response.text


async def insert_job(client: AsyncClient, app: object, workspace: dict[str, object]) -> str:
    del client
    record = JobRecord(
        user_id=UUID(str(workspace["candidate_id"])),
        title="Platform Engineer",
        company="Example Engineering",
        location="Berlin",
        description="Build reliable Python services.",
        requirements=["Python", "Kubernetes"],
        source="candidate_submitted",
        source_url="https://example.com/jobs/platform",
        application_method="external",
        retrieved_at=utcnow(),
    )
    async with app.state.session_factory() as db:  # type: ignore[attr-defined]
        db.add(record)
        await db.commit()
    return str(record.id)


async def package_for(
    client: AsyncClient, app: object, workspace: dict[str, object]
) -> tuple[str, dict]:
    await confirm_profile(client, workspace)
    job_id = await insert_job(client, app, workspace)
    response = await client.post(
        f"/api/v1/candidates/{workspace['candidate_id']}/jobs/{job_id}/application-package",
        headers=headers(workspace),
        json={},
    )
    assert response.status_code == 200, response.text
    return job_id, response.json()


async def test_profile_revisions_are_immutable_optimistic_and_idempotent(client_app) -> None:
    client, app = client_app
    workspace = await login(client, app)
    initial = await client.get(f"/api/v1/candidates/{workspace['candidate_id']}/profile/revisions")
    assert len(initial.json()["revisions"]) == 1
    idempotency = key()
    payload = {
        "expected_version": 1,
        "candidate_confirmed": True,
        "full_name": "Amara Confirmed",
        "email": "amara@example.test",
        "career_goal": "Platform Engineer",
        "skills": ["Python"],
    }
    path = f"/api/v1/candidates/{workspace['candidate_id']}/profile"
    first = await client.patch(path, headers=headers(workspace, idempotency), json=payload)
    assert first.status_code == 200, first.text
    assert first.json()["master_profile_version"] == 2
    repeated = await client.patch(path, headers=headers(workspace, idempotency), json=payload)
    assert repeated.json() == first.json()
    conflict = await client.patch(path, headers=headers(workspace), json=payload)
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "revision_conflict"
    revisions = await client.get(
        f"/api/v1/candidates/{workspace['candidate_id']}/profile/revisions"
    )
    assert [item["profile_version"] for item in revisions.json()["revisions"]] == [1, 2]
    assert revisions.json()["revisions"][0]["facts"][0]["value"] == "Amara Example"


async def test_package_exact_approval_download_handoff_and_candidate_report(client_app) -> None:
    client, app = client_app
    workspace = await login(client, app)
    job_id, package = await package_for(client, app, workspace)
    package_id = package["package_id"]
    artifact = package["versions"][0]
    unapproved_download = await client.get(
        f"/api/v1/application-packages/{package_id}/cv-artifacts/{artifact['artifact_id']}/download"
    )
    assert unapproved_download.status_code == 422
    edited = await client.patch(
        f"/api/v1/application-packages/{package_id}/cv-artifacts",
        headers=headers(workspace, revision=1),
        json={
            "artifact_id": artifact["artifact_id"],
            "content": artifact["content"] + "\nCandidate-reviewed correction.",
        },
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["revision"] == 2
    stale = await client.patch(
        f"/api/v1/application-packages/{package_id}/cv-artifacts",
        headers=headers(workspace, revision=1),
        json={"artifact_id": artifact["artifact_id"], "content": "Stale edit"},
    )
    assert stale.status_code == 409
    current = edited.json()["versions"][-1]
    approved = await client.post(
        f"/api/v1/application-packages/{package_id}/approvals",
        headers=headers(workspace, revision=2),
        json={
            "artifact_type": "tailored_cv",
            "artifact_id": current["artifact_id"],
            "version": 1,
            "content": current["content"],
        },
    )
    # The edited artifact is version 2; an exact version mismatch cannot be approved.
    assert approved.status_code == 409
    approved = await client.post(
        f"/api/v1/application-packages/{package_id}/approvals",
        headers=headers(workspace, revision=2),
        json={
            "artifact_type": "tailored_cv",
            "artifact_id": current["artifact_id"],
            "version": current["version"],
            "content": current["content"],
        },
    )
    assert approved.status_code == 200, approved.text
    download = await client.get(
        f"/api/v1/application-packages/{package_id}/cv-artifacts/{current['artifact_id']}/download"
    )
    assert download.status_code == 200
    assert download.json()["content"] == current["content"]
    channel = await client.post(
        f"/api/v1/application-packages/{package_id}/approvals",
        headers=headers(workspace, revision=3),
        json={
            "artifact_type": "channel_action",
            "channel": "employer_site",
            "destination": "https://example.com/jobs/platform",
        },
    )
    assert channel.status_code == 200, channel.text
    handed_off = await client.post(
        f"/api/v1/application-packages/{package_id}/actions/employer_site",
        headers=headers(workspace, revision=4),
        json={"action": "handoff", "destination": "https://example.com/jobs/platform"},
    )
    assert handed_off.status_code == 200, handed_off.text
    reported = await client.post(
        f"/api/v1/application-packages/{package_id}/actions/employer_site/candidate-confirmation",
        headers=headers(workspace, revision=5),
        json={"candidate_reported": True},
    )
    assert reported.status_code == 200, reported.text
    assert reported.json()["channel_actions"][1]["state"] == "candidate_reported"
    direct = await client.post(
        f"/api/v1/application-packages/{package_id}/actions/employer_site",
        headers=headers(workspace, revision=6),
        json={"action": "submit", "destination": "https://example.com/jobs/platform"},
    )
    assert direct.status_code == 503
    revisions = await client.get(f"/api/v1/application-packages/{package_id}/revisions")
    assert len(revisions.json()) == 6
    assert revisions.json()[0]["versions"][0]["content"] == artifact["content"]
    assert job_id == package["job_id"]


async def test_outreach_grounding_edit_approval_handoff_sent_reply_and_reload(client_app) -> None:
    client, app = client_app
    workspace = await login(client, app)
    await confirm_profile(client, workspace)
    job_id = await insert_job(client, app, workspace)
    contact = await client.post(
        f"/api/v1/candidates/{workspace['candidate_id']}/jobs/{job_id}/contacts",
        headers=headers(workspace),
        json={
            "display_name": "Robin Example",
            "current_title": "Engineering Lead",
            "current_company": "Example Engineering",
            "linkedin_url": "https://www.linkedin.com/in/robin-example",
            "evidence": {
                "source_url": "https://example.com/team",
                "observed_fact": "Public team page lists Robin as engineering lead.",
            },
        },
    )
    assert contact.status_code == 200, contact.text
    contact_id = contact.json()["contact_id"]
    updated_contact = await client.patch(
        f"/api/v1/candidates/{workspace['candidate_id']}/contacts/{contact_id}",
        headers=headers(workspace),
        json={
            "display_name": "Robin Example",
            "current_title": "Engineering Lead",
            "current_company": "Example Engineering",
            "linkedin_url": "https://www.linkedin.com/in/robin-example",
            "email": "robin@example.test",
            "source_url": "https://example.com/team",
            "evidence_notes": "Public team page lists Robin as engineering lead.",
        },
    )
    assert updated_contact.status_code == 200, updated_contact.text
    assert updated_contact.json()["email"] == "robin@example.test"
    draft = await client.post(
        "/api/v1/outreach/draft",
        headers=headers(workspace),
        json={
            "candidate_id": workspace["candidate_id"],
            "job_id": job_id,
            "contact_id": contact_id,
            "hiring_contact_name": "Robin Example",
            "tone": "warm",
        },
    )
    assert draft.status_code == 200, draft.text
    assert "Python" in draft.json()["message"]
    assert "90%" not in draft.json()["message"]
    draft_id = draft.json()["draft_id"]
    edited = await client.patch(
        f"/api/v1/candidates/{workspace['candidate_id']}/outreach/drafts/{draft_id}",
        headers=headers(workspace),
        json={
            "contact_id": contact_id,
            "recipient_url": contact.json()["profile_url"],
            "body": "Hi Robin,\n\nI reviewed the Platform Engineer role and my confirmed Python background.\n\nBest,\nAmara",
        },
    )
    assert edited.status_code == 200, edited.text
    approved = await client.post(
        f"/api/v1/candidates/{workspace['candidate_id']}/outreach/drafts/{draft_id}/approve",
        headers=headers(workspace),
        json={
            "draft_id": draft_id,
            "contact_id": contact_id,
            "recipient_url": contact.json()["profile_url"],
            "body": edited.json()["message"],
        },
    )
    assert approved.status_code == 200, approved.text
    early_confirm = await client.post(
        f"/api/v1/candidates/{workspace['candidate_id']}/outreach/drafts/{draft_id}/confirm-sent",
        headers=headers(workspace),
        json={"candidate_confirmed": True},
    )
    assert early_confirm.status_code == 422
    handed_off = await client.post(
        f"/api/v1/candidates/{workspace['candidate_id']}/outreach/drafts/{draft_id}/handoff",
        headers=headers(workspace),
        json={"contact_id": contact_id, "recipient_url": contact.json()["profile_url"]},
    )
    assert handed_off.status_code == 200, handed_off.text
    assert "message" in handed_off.json()
    confirmed = await client.post(
        f"/api/v1/candidates/{workspace['candidate_id']}/outreach/drafts/{draft_id}/confirm-sent",
        headers=headers(workspace),
        json={"candidate_confirmed": True},
    )
    assert confirmed.status_code == 200
    reply = await client.post(
        "/api/v1/interactions",
        headers=headers(workspace),
        json={
            "candidate_id": workspace["candidate_id"],
            "job_id": job_id,
            "draft_id": draft_id,
            "channel": "manual_linkedin",
            "interaction_type": "recruiter_reply",
            "content": "Candidate-recorded reply: Let’s talk",
            "outcome": "interview",
            "reply_date": "2026-11-22",
            "simulated": False,
        },
    )
    assert reply.status_code == 200, reply.text
    reloaded = await client.get(f"/api/v1/candidates/{workspace['candidate_id']}/workspace")
    assert reloaded.status_code == 200
    message = reloaded.json()["messages"][0]
    assert message["status"] == "candidate_confirmed_sent"
    assert message["responses"][0]["source"] == "candidate_recorded"
    assert reloaded.json()["timeline"]


async def test_job_import_and_contact_discovery_fail_honestly_without_providers(client_app) -> None:
    client, app = client_app
    workspace = await login(client, app)

    class FakeImporter:
        async def import_url(self, url: str) -> ImportedJob:
            assert url == "https://example.com/jobs/imported"
            return ImportedJob(
                "Imported Engineer",
                "Example Engineering",
                "Berlin",
                "Build Python services.",
                ["Python"],
                "external",
                url,
            )

    app.state.job_importer = FakeImporter()
    imported = await client.post(
        "/api/v1/jobs/import",
        headers=headers(workspace),
        json={
            "candidate_id": workspace["candidate_id"],
            "source_url": "https://example.com/jobs/imported",
        },
    )
    assert imported.status_code == 200, imported.text
    assert imported.json()["source_url"] == "https://example.com/jobs/imported"
    assert imported.json()["retrieved_at"]
    discovery = await client.post(
        f"/api/v1/candidates/{workspace['candidate_id']}/jobs/{imported.json()['job_id']}/contacts/discover",
        headers=headers(workspace),
        json={},
    )
    assert discovery.status_code == 200, discovery.text
    assert discovery.json()["status"] == "not_configured"
    assert discovery.json()["contacts"] == []
    assert (
        "keywords=Imported%20Engineer%20Example%20Engineering" in discovery.json()["fallback_url"]
    )
    capabilities = await client.get("/api/v1/providers/capabilities")
    assert capabilities.json()["contact_discovery"]["configured"] is False
    assert capabilities.json()["email"]["send"] is False


async def test_candidate_isolation_and_mutation_guards(client_app) -> None:
    client, app = client_app
    first = await login(client, app, "first-candidate")
    _, package = await package_for(client, app, first)
    job_id = package["job_id"]
    anonymous = await client.get(f"/api/v1/candidates/{first['candidate_id']}/workspace")
    # The existing session is still present; a missing CSRF mutation is rejected.
    missing_csrf = await client.post(
        f"/api/v1/candidates/{first['candidate_id']}/jobs/{job_id}/application-package", json={}
    )
    assert missing_csrf.status_code == 403
    second = await login(client, app, "second-candidate")
    assert second["candidate_id"] != first["candidate_id"]
    denied = await client.get(f"/api/v1/application-packages/{package['package_id']}")
    assert denied.status_code == 404
    other_candidate = await client.get(f"/api/v1/candidates/{first['candidate_id']}/profile")
    assert other_candidate.status_code == 404
    anonymous_client = AsyncClient(transport=client._transport, base_url="http://testserver")  # noqa: SLF001
    async with anonymous_client:
        anonymous = await anonymous_client.get(
            f"/api/v1/candidates/{first['candidate_id']}/workspace"
        )
        assert anonymous.status_code == 401


async def test_idempotency_key_cannot_be_reused_for_another_payload(client_app) -> None:
    client, app = client_app
    workspace = await login(client, app)
    idempotency = key()
    path = f"/api/v1/candidates/{workspace['candidate_id']}/profile"
    payload = {
        "expected_version": 1,
        "candidate_confirmed": True,
        "full_name": "Amara Example",
        "email": "amara@example.test",
        "career_goal": "Platform Engineer",
    }
    first = await client.patch(path, headers=headers(workspace, idempotency), json=payload)
    assert first.status_code == 200
    conflict = await client.patch(
        path, headers=headers(workspace, idempotency), json={**payload, "career_goal": "Other"}
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "idempotency_conflict"


async def test_email_requires_exact_package_approval_and_records_only_handoff(client_app) -> None:
    client, app = client_app
    workspace = await login(client, app)
    _, package = await package_for(client, app, workspace)
    package_id = package["package_id"]
    artifact = package["versions"][0]
    approved_cv = await client.post(
        f"/api/v1/application-packages/{package_id}/approvals",
        headers=headers(workspace, revision=1),
        json={
            "artifact_type": "tailored_cv",
            "artifact_id": artifact["artifact_id"],
            "version": 1,
            "content": artifact["content"],
        },
    )
    assert approved_cv.status_code == 200, approved_cv.text
    contact = await client.post(
        f"/api/v1/candidates/{workspace['candidate_id']}/jobs/{package['job_id']}/contacts",
        headers=headers(workspace),
        json={
            "display_name": "Robin Example",
            "current_company": "Example Engineering",
            "evidence": {
                "source_url": "https://example.com/team",
                "observed_fact": "Candidate supplied email",
                "email": "robin@example.com",
            },
        },
    )
    assert contact.status_code == 200, contact.text
    draft = await client.post(
        f"/api/v1/application-packages/{package_id}/outreach-drafts",
        headers=headers(workspace, revision=2),
        json={
            "channel": "email",
            "contact_id": contact.json()["contact_id"],
            "recipient_email": "robin@example.com",
            "cv_artifact_id": artifact["artifact_id"],
        },
    )
    assert draft.status_code == 200, draft.text
    draft_id = draft.json()["draft_id"]
    approval_payload = {
        "artifact_type": "outreach_draft",
        "draft_id": draft_id,
        "contact_id": contact.json()["contact_id"],
        "recipient_email": "robin@example.com",
        "subject": draft.json()["subject"],
        "body": draft.json()["message"],
        "attachment": {
            "artifact_id": artifact["artifact_id"],
            "version": 1,
            "content_hash": "backend-computed",
            "filename": "cv.pdf",
        },
    }
    workspace_response = await client.get(
        f"/api/v1/candidates/{workspace['candidate_id']}/workspace"
    )
    stored = workspace_response.json()["messages"][0]
    approval_payload["attachment"] = stored["attachment"]
    mismatch = await client.post(
        f"/api/v1/application-packages/{package_id}/approvals",
        headers=headers(workspace),
        json={**approval_payload, "body": "Changed unapproved body"},
    )
    assert mismatch.status_code == 409
    approved = await client.post(
        f"/api/v1/application-packages/{package_id}/approvals",
        headers=headers(workspace),
        json=approval_payload,
    )
    assert approved.status_code == 200, approved.text
    handoff_payload = {
        "action": "handoff",
        "draft_id": draft_id,
        "approved_text_hash": approved.json()["approved_text_hash"],
    }
    handoff = await client.post(
        f"/api/v1/application-packages/{package_id}/actions/email",
        headers=headers(workspace, "email-handoff-test"),
        json=handoff_payload,
    )
    assert handoff.status_code == 200, handoff.text
    assert handoff.json()["mailto_url"].startswith("mailto:")
    repeated = await client.post(
        f"/api/v1/application-packages/{package_id}/actions/email",
        headers=headers(workspace, "email-handoff-test"),
        json=handoff_payload,
    )
    assert repeated.json() == handoff.json()
    confirmed = await client.post(
        f"/api/v1/application-packages/{package_id}/actions/email/candidate-confirmation",
        headers=headers(workspace),
        json={"candidate_confirmed": True, "draft_id": draft_id},
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "candidate_confirmed_sent"


async def test_configured_contact_search_cites_results_and_empty_results(client_app) -> None:
    client, app = client_app
    workspace = await login(client, app)
    job_id = await insert_job(client, app, workspace)
    app.state.settings.search_api_key = "test-only-search-key"
    app.state.search_provider.transport = MockTransport(
        lambda _: Response(
            200,
            json={
                "web": {
                    "results": [
                        {
                            "title": "Robin Example - Engineering Manager - Example Engineering | LinkedIn",
                            "url": "https://www.linkedin.com/in/robin-example",
                            "description": "Engineering Manager leading the Platform Engineer team at Example Engineering.",
                        }
                    ]
                }
            },
        )
    )
    found = await client.post(
        f"/api/v1/candidates/{workspace['candidate_id']}/jobs/{job_id}/contacts/discover",
        headers=headers(workspace),
        json={},
    )
    assert found.status_code == 200, found.text
    assert found.json()["status"] == "found"
    assert found.json()["contacts"][0]["source_url"] == "https://www.linkedin.com/in/robin-example"
    assert found.json()["contacts"][0]["confidence"] == "high"
    assert found.json()["contacts"][0]["evidence_status"] == "public_search_result"
    app.state.search_provider.transport = MockTransport(
        lambda _: Response(200, json={"web": {"results": []}})
    )
    empty = await client.post(
        f"/api/v1/candidates/{workspace['candidate_id']}/jobs/{job_id}/contacts/discover",
        headers=headers(workspace),
        json={},
    )
    assert empty.json()["status"] == "no_reliable_match"
    assert empty.json()["contacts"] == []


async def test_invalid_contact_urls_return_safe_validation_errors(client_app) -> None:
    client, app = client_app
    workspace = await login(client, app)
    job_id = await insert_job(client, app, workspace)
    response = await client.post(
        f"/api/v1/candidates/{workspace['candidate_id']}/jobs/{job_id}/contacts",
        headers=headers(workspace),
        json={
            "display_name": "Robin Example",
            "linkedin_url": "https://example.com/not-linkedin",
            "evidence": {"source_url": "http://127.0.0.1/private"},
        },
    )
    assert response.status_code == 422
    assert "request_id" in response.json()["error"]
    assert "127.0.0.1" not in response.text


async def test_provider_capabilities_are_public_non_secret_metadata(client_app) -> None:
    client, _ = client_app
    anonymous = AsyncClient(transport=client._transport, base_url="http://testserver")  # noqa: SLF001
    async with anonymous:
        response = await anonymous.get("/api/v1/providers/capabilities")
    assert response.status_code == 200
    assert response.json()["contact_discovery"]["configured"] is False
    assert response.json()["email"]["send"] is False
    assert "SEARCH_API_KEY" not in response.text