"""Browse evidence-backed topics without sending any candidate data to a model."""

import json

from fastapi import HTTPException

from .catalog import CARD


async def discovery_topics(conn):
    rows = await conn.fetch("""
        SELECT d.section,d.topic AS id,d.label,count(*) AS jobs,
            count(DISTINCT j.organization_key) AS advertisers
        FROM hnt_pm.discovery d JOIN hnt_pm.job j USING (source_id)
        GROUP BY d.section,d.topic,d.label
        ORDER BY d.section <> 'Companies',d.section,min(d.priority),jobs DESC,d.label
    """)
    sections = {}
    for row in rows:
        topic = dict(row)
        sections.setdefault(topic.pop("section"), []).append(topic)
    return [{"name": name, "topics": topics} for name, topics in sections.items()]


async def discovery_page(conn, topic_id, offset, limit):
    row = await conn.fetchrow(f"""
        WITH matches AS MATERIALIZED (
            SELECT d.source_id,d.label,d.evidence,d.evidence_url,j.organization_key,j.listed_on,
                row_number() OVER(PARTITION BY j.organization_key
                    ORDER BY j.listed_on DESC NULLS LAST,j.source_id) AS advertiser_position
            FROM hnt_pm.discovery d JOIN hnt_pm.job j USING (source_id)
            WHERE d.topic=$1
        ), page AS (
            SELECT * FROM matches ORDER BY advertiser_position,listed_on DESC NULLS LAST,source_id
            OFFSET $2 LIMIT $3
        )
        SELECT min(label) AS label,count(*) AS jobs,count(DISTINCT organization_key) AS advertisers,
            (SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'job',{CARD},'evidence',p.evidence,'evidence_url',p.evidence_url)
                 ORDER BY p.advertiser_position,p.listed_on DESC NULLS LAST,p.source_id),'[]')
             FROM page p JOIN hnt_pm.job j USING(source_id) JOIN hnt_pm.company c
                 ON c.organization_key=j.organization_key) AS items
        FROM matches
    """, topic_id, offset, limit)
    if not row["jobs"]:
        raise HTTPException(404, "This topic has no matching jobs in the current inventory.")
    return {
        "topic": {"id": topic_id, "label": row["label"], "jobs": row["jobs"], "advertisers": row["advertisers"]},
        "items": json.loads(row["items"]),
    }
