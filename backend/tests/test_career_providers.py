import httpx
import pytest

from app.career_engine import contact_from_result, grounded_message
from app.career_schemas import Candidate, HiringContact, Job
from app.config import Settings
from app.providers import (
    BraveSearchProvider,
    JobPageImporter,
    ProviderError,
    PublicSearchResult,
    normalize_public_url,
    parse_job_page,
)
from tests.conftest import make_test_settings


def job() -> Job:
    return Job(
        job_id="job-provider",
        title="Platform Engineer",
        company="Example Engineering",
        location="Berlin",
        description="Build Python services.",
        requirements=["Python"],
        source="job_url_import",
        source_url="https://example.com/jobs/platform",
        retrieved_at="2026-11-22T00:00:00Z",
        is_demo=False,
    )


def test_job_json_ld_preserves_source_evidence_and_requirements() -> None:
    imported = parse_job_page(
        """<html><script type='application/ld+json'>{"@context":"https://schema.org","@type":"JobPosting","title":"Platform Engineer","hiringOrganization":{"@type":"Organization","name":"Example Engineering"},"jobLocation":{"address":{"addressLocality":"Berlin","addressCountry":"DE"}},"description":"<p>Build Python services.</p>","skills":"Python\\nKubernetes"}</script></html>""",
        "https://example.com/jobs/platform",
    )
    assert imported.title == "Platform Engineer"
    assert imported.company == "Example Engineering"
    assert imported.location == "Berlin, DE"
    assert imported.requirements == ["Python", "Kubernetes"]
    assert imported.source_url == "https://example.com/jobs/platform"


def test_job_import_rejects_missing_company_and_unsafe_urls() -> None:
    with pytest.raises(ProviderError, match="job_details_not_found"):
        parse_job_page(
            "<html><meta property='og:title' content='Engineer'><meta name='description' content='Build services'></html>",
            "https://example.com/job",
        )
    for value in (
        "javascript:alert(1)",
        "http://127.0.0.1/job",
        "http://localhost/job",
        "https://user:pass@example.com/job",
        "https://example.com:8443/job",
    ):
        with pytest.raises(ProviderError, match="invalid_url"):
            normalize_public_url(value)


async def test_job_import_uses_mocked_public_http_without_fabrication() -> None:
    settings = make_test_settings()
    html = """<script type='application/ld+json'>{"@type":"JobPosting","title":"Platform Engineer","hiringOrganization":{"name":"Example Engineering"},"description":"Build Python services."}</script>"""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "example.com"
        return httpx.Response(200, headers={"Content-Type": "text/html; charset=utf-8"}, text=html)

    importer = JobPageImporter(settings, transport=httpx.MockTransport(handler))
    imported = await importer.import_url("https://example.com/jobs/platform")
    assert imported.company == "Example Engineering"


def test_contact_matching_requires_company_role_and_public_profile_evidence() -> None:
    result = PublicSearchResult(
        title="Robin Example - Engineering Manager - Example Engineering | LinkedIn",
        url="https://www.linkedin.com/in/robin-example",
        description="Engineering Manager leading the Platform Engineer team at Example Engineering.",
    )
    contact = contact_from_result(result, job(), "candidate-1")
    assert contact is not None
    assert contact["full_name"] == "Robin Example"
    assert contact["confidence"] == "high"
    assert contact["source_url"] == result.url
    assert contact["evidence_status"] == "public_search_result"
    assert contact["evidence_date"]
    unrelated = PublicSearchResult(
        "Robin Example - Engineer - Other Company | LinkedIn",
        result.url,
        "Other Company engineering role.",
    )
    assert contact_from_result(unrelated, job(), "candidate-1") is None
    invalid = PublicSearchResult(
        result.title, "https://example.com/not-linkedin", result.description
    )
    assert contact_from_result(invalid, job(), "candidate-1") is None


async def test_search_provider_empty_results_stay_empty() -> None:
    settings = Settings(
        **{**make_test_settings().model_dump(), "search_api_key": "test-search-key"}
    )
    provider = BraveSearchProvider(
        settings,
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"web": {"results": []}})),
    )
    assert await provider.search("site:linkedin.com/in Example") == []


async def test_unconfigured_search_never_makes_a_request() -> None:
    provider = BraveSearchProvider(
        make_test_settings(),
        transport=httpx.MockTransport(
            lambda _: (_ for _ in ()).throw(AssertionError("network called"))
        ),
    )
    with pytest.raises(ProviderError, match="integration_not_configured"):
        await provider.search("anything")


def test_grounded_message_uses_only_candidate_and_job_facts() -> None:
    candidate = Candidate(
        candidate_id="candidate-1",
        full_name="Amara Example",
        skills=["Python"],
        career_goal="Platform Engineer",
    )
    contact = HiringContact(
        contact_id="contact-1",
        candidate_id="candidate-1",
        job_id="job-provider",
        full_name="Robin Example",
        current_title="Engineering Manager",
        company="Example Engineering",
        profile_url="https://www.linkedin.com/in/robin-example",
        confidence="high",
        relevance="Public evidence",
        evidence_status="public_search_result",
        last_checked_at="2026-11-22T00:00:00Z",
        created_at="2026-11-22T00:00:00Z",
        updated_at="2026-11-22T00:00:00Z",
        is_demo=False,
    )
    body, subject = grounded_message(candidate, job(), contact)
    assert "Python" in body
    assert "Platform Engineer" in body
    assert "Robin" in body
    assert "knows" not in body.lower()
    assert "achievement" not in body.lower()
    assert subject is None
