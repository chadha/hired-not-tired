"""Import the canonical GoToWork Link inventory and retrieve cited job and company evidence."""

import asyncio
import hashlib
import json
from datetime import date
from pathlib import Path

import asyncpg
from pydantic import BaseModel, ConfigDict, Field


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


async def berlin_calendar(conn):
    return dict(await conn.fetchrow("""SELECT berlin_date AS today,
        berlin_date - (extract(isodow FROM berlin_date)::int - 1) AS week_start
        FROM (SELECT (now() AT TIME ZONE 'Europe/Berlin')::date AS berlin_date) calendar"""))


def read_snapshot(path: Path):
    raw = path.read_bytes()
    data = json.loads(raw)
    jobs, companies = data["postings"], data["companies"]
    by_id = {j["sourceId"]: j for j in jobs}
    members = {jid: c["organizationKey"] for c in companies for jid in c["postingIds"]}
    if (
        len(by_id) != len(jobs)
        or len(jobs) != data["counts"]["postings"]
        or len(companies) != data["counts"]["publisherNames"]
        or len({c["organizationKey"] for c in companies}) != len(companies)
        or set(members) != set(by_id)
        or sum(len(c["postingIds"]) for c in companies) != len(jobs)
    ):
        raise ValueError("Los IDs y totales del inventario no coinciden.")
    for job in jobs:
        if (
            not job["sourceId"]
            or not job["title"]
            or not job["sourceUrl"]
            or job["organizationKey"] is not None
            and job["organizationKey"] != members[job["sourceId"]]
        ):
            raise ValueError("Falta la identidad de una oferta o su vínculo con la empresa.")
    signature = hashlib.sha256(raw)
    sources = []
    root = path.parent.resolve()
    for company in companies:
        if company["researchCoverage"] is None:
            continue
        for section in company["researchCoverage"]["sections"]:
            if not section.get("original"):
                continue
            source = (root / section["original"]).resolve()
            if not source.is_relative_to(root) or source.suffix.lower() != ".txt":
                raise ValueError("Ruta de evidencia de empresa inválida.")
            content = source.read_bytes()
            signature.update(hashlib.sha256(content).digest())
            sources.append(
                (
                    company["organizationKey"],
                    section["key"],
                    section["url"],
                    section["revision"],
                    content.decode("utf-8-sig"),
                )
            )
    return signature.hexdigest(), data, sources


async def import_snapshot(conn: asyncpg.Connection, path: Path):
    # Serialize readers of the changing source file as well as database writers.
    async with conn.transaction():
        await conn.execute("SELECT pg_advisory_xact_lock(hashtext('hnt_pm.inventory'))")
        digest, data, sources = await asyncio.to_thread(read_snapshot, path)
        if digest == await conn.fetchval("SELECT digest FROM hnt_pm.inventory"):
            return
        await conn.execute("CREATE TEMP TABLE incoming_company (doc jsonb) ON COMMIT DROP")
        await conn.execute("CREATE TEMP TABLE incoming_job (doc jsonb) ON COMMIT DROP")
        for table, rows in (
            ("incoming_company", data["companies"]),
            ("incoming_job", data["postings"]),
        ):
            await conn.copy_records_to_table(
                table, columns=["doc"], records=((encode(row),) for row in rows)
            )
        await conn.execute("""
            INSERT INTO hnt_pm.company SELECT doc->>'organizationKey',doc,
                to_tsvector('simple',concat_ws(' ',doc->>'publisher',doc->>'industry',
                    doc#>>'{about,original}',doc->>'reviewedResearch',doc->>'companyClassifications'))
            FROM incoming_company ON CONFLICT (organization_key) DO UPDATE
            SET record=excluded.record,search_text=excluded.search_text
            WHERE company.record IS DISTINCT FROM excluded.record;
            INSERT INTO hnt_pm.job SELECT doc->>'sourceId',membership.publisher_key,
                (doc#>>'{publication,sortDay}')::date,doc,
                setweight(to_tsvector('simple',concat_ws(' ',doc->>'title',doc->>'publisher',doc->>'specialties')),'A')
                || to_tsvector('simple',concat_ws(' ',doc->>'description',doc->>'function',doc->>'requirements'))
            FROM incoming_job JOIN (
              SELECT c.doc->>'organizationKey' publisher_key,
                     jsonb_array_elements_text(c.doc->'postingIds') source_id FROM incoming_company c
            ) membership ON membership.source_id=doc->>'sourceId'
            ON CONFLICT (source_id) DO UPDATE SET
                organization_key=excluded.organization_key,listed_on=excluded.listed_on,
                record=excluded.record,search_text=excluded.search_text
            WHERE (job.record,job.organization_key) IS DISTINCT FROM (excluded.record,excluded.organization_key);
            DELETE FROM hnt_pm.job j WHERE NOT EXISTS
                (SELECT 1 FROM incoming_job WHERE doc->>'sourceId'=j.source_id);
            DELETE FROM hnt_pm.company c WHERE NOT EXISTS
                (SELECT 1 FROM incoming_company WHERE doc->>'organizationKey'=c.organization_key);
        """)
        await conn.execute("DELETE FROM hnt_pm.company_source")
        await conn.copy_records_to_table("company_source", schema_name="hnt_pm", records=sources)
        metadata = {k: v for k, v in data.items() if k not in ("postings", "companies")}
        await conn.execute(
            """INSERT INTO hnt_pm.inventory(singleton,digest,metadata) VALUES(true,$1,$2)
            ON CONFLICT(singleton) DO UPDATE SET digest=excluded.digest, metadata=excluded.metadata""",
            digest,
            encode(metadata),
        )


class Search(BaseModel):
    model_config = ConfigDict(extra="forbid")
    terms: list[str] = Field(
        max_length=12,
        description="Alternative phrases (OR). Include English/German variants. Empty for all.",
    )
    city: str | None
    company: str | None
    industry: str | None
    date_from: date | None
    date_to: date | None
    offset: int = Field(ge=0, le=100000)
    limit: int = Field(ge=1, le=20)


class Details(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ids: list[str] = Field(min_length=1, max_length=5)


class CompanyEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    job_id: str
    terms: list[str] = Field(
        max_length=10, description="Optional search terms within source pages."
    )


async def company_sources(conn, query: CompanyEvidence):
    rows = await conn.fetch(
        """
        WITH words AS (SELECT plainto_tsquery('simple',term) q FROM unnest($2::text[]) term)
        SELECT s.section,s.url,s.revision,CASE WHEN cardinality($2::text[])=0
            THEN left(s.content,3200)
            ELSE ts_headline('simple',s.content,(SELECT to_tsquery('simple',string_agg('('||q::text||')',' | '))
                 FROM words WHERE q::text<>''),
                'MaxFragments=4,MaxWords=70,MinWords=15') END excerpt
        FROM hnt_pm.company_source s JOIN hnt_pm.job j USING(organization_key)
        WHERE j.source_id=$1 AND (cardinality($2::text[])=0 OR EXISTS
            (SELECT 1 FROM words WHERE to_tsvector('simple',s.content) @@ q))
        ORDER BY s.section""",
        query.job_id,
        query.terms,
    )
    return [dict(r) for r in rows]


CARD = """jsonb_build_object('id',j.source_id,'title',j.record->'title',
    'publisher',j.record->'publisher','employer',j.record->'employerSource',
    'location',j.record->'location','industry',c.record->'industry',
    'day',j.listed_on,'precision',j.record#>'{publication,precision}',
    'event',j.record#>'{publication,event}', 'url',j.record->'sourceUrl',
    'apply_url',j.record#>'{application,destination}','apply_status',j.record#>'{application,auditStatus}',
    'application_kind',j.record#>'{application,kind}',
    'verified_form',coalesce(j.record#>'{application,verification,submit}','false'::jsonb))"""


async def search(conn, query: Search):
    rows = await conn.fetch(
        f"""
        WITH terms AS (SELECT plainto_tsquery('simple',term) q FROM unnest($1::text[]) term),
        matches AS (
            SELECT j.source_id,j.listed_on,j.record#>>'{{publication,precision}}' AS day_precision,
                coalesce((SELECT max(ts_rank(j.search_text,t.q)+ts_rank(c.search_text,t.q))
                          FROM terms t),0) rank
            FROM hnt_pm.job j JOIN hnt_pm.company c USING(organization_key)
            WHERE (NOT EXISTS(SELECT 1 FROM terms) OR EXISTS(
                SELECT 1 FROM terms t WHERE j.search_text @@ t.q OR c.search_text @@ t.q))
              AND ($2::text IS NULL OR strpos(lower(j.record->>'location'),lower($2))>0)
              AND ($3::text IS NULL OR strpos(lower(j.record->>'publisher'),lower($3))>0
                   OR strpos(lower(j.record#>>'{{employerSource,name}}'),lower($3))>0)
              AND ($4::text IS NULL OR strpos(lower(c.record->>'industry'),lower($4))>0)
              AND ($5::date IS NULL OR j.listed_on >= $5)
              AND ($6::date IS NULL OR j.listed_on <= $6)
        ), page AS (
            SELECT * FROM matches ORDER BY rank DESC,listed_on DESC NULLS LAST,source_id
            OFFSET $7 LIMIT $8
        )
        SELECT (SELECT count(*) FROM matches) total,
           (SELECT count(*) FROM matches WHERE day_precision='estimated_day') estimated_dates,
           coalesce((SELECT jsonb_agg({CARD} ORDER BY p.rank DESC,p.listed_on DESC NULLS LAST,p.source_id)
             FROM page p JOIN hnt_pm.job j ON j.source_id=p.source_id
             JOIN hnt_pm.company c ON c.organization_key=j.organization_key),'[]') results
        """,
        query.terms,
        query.city,
        query.company,
        query.industry,
        query.date_from,
        query.date_to,
        query.offset,
        query.limit,
    )
    row = rows[0]
    return {
        "total": row["total"],
        "estimated_dates": row["estimated_dates"],
        "jobs": json.loads(row["results"]),
    }


async def details(conn, ids):
    rows = await conn.fetch(
        f"""SELECT {CARD} card,
        jsonb_build_object('description',j.record->'description','integrity',j.record->'descriptionReview',
          'languages_and_experience',j.record->'requirements','specialties',j.record->'specialties',
          'relationship',j.record->'hiringRelationship','deadline',j.record->'applicationDeadlineEvidence',
          'application',j.record->'application','work_mode',j.record->'workMode') job,
        jsonb_build_object('about',c.record#>'{{about,original}}','about_url',c.record#>'{{about,sourceUrl}}',
          'employee_band',c.record->'employeeBand','employees',c.record->'employees',
          'research',c.record->'reviewedResearch','coverage',c.record->'researchCoverage'->'pendingSections',
          'activity',c.record->'activity','passages_pending_review',c.record->'officialPassagesAwaitingReview',
          'website',c.record#>'{{officialWebsite,url}}') company
        FROM hnt_pm.job j JOIN hnt_pm.company c USING(organization_key)
        WHERE j.source_id=ANY($1::text[]) ORDER BY array_position($1::text[],j.source_id)""",
        ids,
    )
    return [{k: json.loads(row[k]) for k in ("card", "job", "company")} for row in rows]
