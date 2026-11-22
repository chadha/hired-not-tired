-- One searchable row per verified inventory signal and posting. The importer updates
-- the digest after jobs and companies, so readers see the same snapshot as the coach.
CREATE MATERIALIZED VIEW IF NOT EXISTS hnt_pm.discovery_signal AS
WITH company_facts AS (
    SELECT c.organization_key, s.*
    FROM hnt_pm.company c
    CROSS JOIN LATERAL (
        SELECT 'size-' || (band->>'min') || '-' || (band->>'max') AS topic,
               (band->>'min') || '–' || (band->>'max') || ' employees' AS label,
               LEAST((band->>'min')::int, 50000) AS priority,
               c.record->>'employees' AS evidence, c.record#>>'{about,sourceUrl}' AS evidence_url
        FROM (SELECT c.record->'employeeBand' AS band) size
        WHERE band->>'min' IS NOT NULL AND band->>'max' IS NOT NULL
        UNION ALL
        SELECT 'startup', 'Documented startups', 12, c.record#>>'{evidencedStartup,summary}', c.record#>>'{evidencedStartup,url}'
        WHERE c.record#>>'{evidencedStartup,url}' IS NOT NULL
        UNION ALL
        SELECT 'research', 'What do these companies build?', 13, c.record#>>'{reviewedResearch,productOrService,summary}', c.record#>>'{reviewedResearch,productOrService,url}'
        WHERE c.record#>>'{reviewedResearch,productOrService,summary}' IS NOT NULL
        UNION ALL
        SELECT 'activity', 'Companies with captured posts', 14,
               c.record#>>'{activity,posts,0,original}', c.record#>>'{activity,posts,0,url}'
        WHERE c.record#>>'{activity,posts,0,original}' IS NOT NULL
        UNION ALL
        SELECT 'agency', 'Recruiting agencies', 15, c.record->>'publisher', c.record#>>'{about,sourceUrl}'
        WHERE c.record->>'publisherType' IN ('staffing_recruiting','staffing_agency')
    ) s
), job_facts AS (
    SELECT j.source_id, s.*, j.record->>'sourceUrl' AS evidence_url
    FROM hnt_pm.job j
    CROSS JOIN LATERAL (
        SELECT 'Experience' AS section, 'entry-title' AS topic, 'Entry-level titles' AS label, 1 AS priority, j.record->>'title' AS evidence
        WHERE j.record#>>'{roleLevel,id}' = 'entry'
        UNION ALL
        SELECT 'Experience', 'years-' || bands.key, bands.label, bands.priority, claim->>'quote'
        FROM jsonb_array_elements(j.record#>'{requirements,experience}') claim
        JOIN (VALUES ('0-2','0–2 years in a requirement',2,0,2),
                    ('3-4','3–4 years in a requirement',3,3,4),
                    ('5-plus','5+ years in a requirement',4,5,NULL::int)) bands(key,label,priority,low,high)
          ON (claim#>>'{value,minimum}')::numeric >= bands.low
         AND (bands.high IS NULL OR (claim#>>'{value,minimum}')::numeric <= bands.high)
        WHERE claim->>'force' = 'required' AND claim->>'quote' IS NOT NULL
        UNION ALL
        SELECT 'Work & language', 'mode-' || work.mode, work.label, work.priority, j.record->>'location'
        FROM (VALUES ('hybrid','Hybrid roles',1),('remote','Remote roles',2),('on-site','On-site roles',3)) work(mode,label,priority)
        WHERE j.record->>'workMode' = work.mode AND j.record->>'workModeConflict' IS NULL
        UNION ALL
        SELECT 'Work & language', lang.key, lang.label, lang.priority, claim->>'quote'
        FROM jsonb_array_elements(j.record#>'{requirements,languages}') claim
        JOIN (VALUES ('english-required','English required',4,'en','required'),
                     ('german-required','German required',5,'de','required'),
                     ('german-preferred','German preferred',6,'de','preferred')) lang(key,label,priority,code,force)
          ON claim#>>'{value,language}' = lang.code AND claim->>'force' = lang.force
        WHERE claim->>'quote' IS NOT NULL
        UNION ALL
        SELECT 'Product work', 'specialty-' || (specialty->>'id'), specialty->>'name', 10,
               specialty#>>'{evidence,quote}'
        FROM jsonb_array_elements(j.record->'specialties') specialty
        WHERE specialty->>'id' IS NOT NULL AND specialty#>>'{evidence,quote}' IS NOT NULL
        UNION ALL
        SELECT 'Product work', 'product-marketing', 'Product marketing', 2, j.record->>'title'
        WHERE j.record->'function' ? 'Product marketing'
        UNION ALL
        SELECT 'Product work', 'ownership', 'Mentions end-to-end ownership', 1, matched.parts[1]
        FROM regexp_match(j.record->>'description',
          '([^.!?[:cntrl:]]{0,60}end[- ]to[- ]end (product )?ownership[^.!?[:cntrl:]]{0,95})','i') AS matched(parts)
        WHERE matched.parts[1] IS NOT NULL
    ) s
), facts AS (
    SELECT j.source_id, 'Companies' AS section, c.topic,c.label,c.priority,c.evidence,c.evidence_url
    FROM company_facts c JOIN hnt_pm.job j USING (organization_key)
    UNION ALL SELECT * FROM job_facts
)
SELECT DISTINCT ON (source_id,topic)
    source_id,section,topic,label,priority,left(evidence,260) AS evidence,evidence_url
FROM facts
ORDER BY source_id,topic,length(evidence),evidence;

CREATE UNIQUE INDEX IF NOT EXISTS discovery_topic_job ON hnt_pm.discovery_signal(topic,source_id);

CREATE OR REPLACE FUNCTION hnt_pm.refresh_discovery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    REFRESH MATERIALIZED VIEW hnt_pm.discovery_signal;
    RETURN NULL;
END $$;
CREATE OR REPLACE TRIGGER refresh_discovery AFTER INSERT OR UPDATE OF digest ON hnt_pm.inventory
FOR EACH STATEMENT EXECUTE FUNCTION hnt_pm.refresh_discovery();

-- Date windows use Berlin's calendar on the day of the request, including after midnight.
CREATE OR REPLACE VIEW hnt_pm.discovery AS
SELECT * FROM hnt_pm.discovery_signal
UNION ALL
SELECT j.source_id,'Berlin',w.topic,w.label,w.priority,j.record->>'location',j.record->>'sourceUrl'
FROM hnt_pm.job j
CROSS JOIN (SELECT (now() AT TIME ZONE 'Europe/Berlin')::date AS today) cal
CROSS JOIN LATERAL (VALUES
    ('berlin-week','This week in Berlin',1,cal.today - (extract(isodow FROM cal.today)::int - 1),false),
    ('berlin-month','Last 30 days in Berlin',2,cal.today - 29,false),
    ('berlin-reposts','Berlin reposts in the last 30 days',3,cal.today - 29,true)
) w(topic,label,priority,first_day,reposts_only)
WHERE j.listed_on BETWEEN w.first_day AND cal.today
  AND j.record->>'location' ~* '\mBerlin\M'
  AND (NOT w.reposts_only OR j.record#>>'{publication,event}'='reposted');
