"""Loopback-only single-user application. The public OIDC service never mounts these routes."""

import json
import os
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import UUID, uuid4

import asyncpg
import httpx
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, SecretStr
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .advisor import DEFAULT_EFFORT, MODEL, Effort, answer, provider_call
from .catalog import CARD, Search, berlin_calendar, encode, import_snapshot, search
from .discovery import discovery_page, discovery_topics


@asynccontextmanager
async def lifespan(app):
    pool = await asyncpg.create_pool(
        host="127.0.0.1",
        database=os.environ["PGDATABASE"],
        user=os.environ["PGUSER"],
        min_size=1,
        max_size=5,
    )
    try:
        async with pool.acquire() as conn:
            await conn.execute(Path(__file__).with_name("schema.sql").read_text(encoding="utf-8"))
            await conn.execute(Path(__file__).with_name("discovery.sql").read_text(encoding="utf-8"))
            if os.environ.get("HNT_INVENTORY_FILE") and not await conn.fetchval(
                "SELECT 1 FROM hnt_pm.inventory"
            ):
                await import_snapshot(conn, Path(os.environ["HNT_INVENTORY_FILE"]))
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(180, connect=12), trust_env=False
        ) as client:
            app.state.db, app.state.http = pool, client
            app.state.key, app.state.effort = None, DEFAULT_EFFORT
            yield
    finally:
        await pool.close()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])


@app.middleware("http")
async def local_request(request: Request, call_next):
    origin = request.headers.get("origin")
    if (
        request.client is None
        or request.client.host not in ("127.0.0.1", "::1")
        or request.headers.get("x-hnt-workspace") != "local"
        or (origin and origin != "http://" + request.headers.get("host", ""))
        or request.headers.get("sec-fetch-site") not in (None, "same-origin")
    ):
        return JSONResponse({"detail": "Open the coach from your local workspace."}, 403)
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(RequestValidationError)
async def invalid_input(_request, _exc):
    # Validation detail can contain the API key or the original CV text.
    return JSONResponse({"detail": "Check the fields and try again."}, 422)


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Connection(Input):
    key: SecretStr = Field(min_length=10, max_length=1024)
    effort: Effort


class Cv(Input):
    filename: str = Field(min_length=1, max_length=250)
    format: str = Field(pattern="^(pdf|docx|md|txt)$")
    text: str = Field(min_length=20, max_length=100000)


class Message(Input):
    id: UUID
    previous_id: UUID | None
    question: str = Field(min_length=1, max_length=12000)


@app.get("/local-api/workspace")
async def workspace():
    async with app.state.db.acquire() as conn:
        catalog = await conn.fetchrow("""SELECT metadata->'counts' counts,
             metadata->>'observedAt' observed_at, (SELECT count(*) FROM hnt_pm.company_source) pages
             FROM hnt_pm.inventory""")
        cv = await conn.fetchrow("SELECT filename,format,length(content) characters FROM hnt_pm.cv")
        chats = await conn.fetch("SELECT id,title FROM hnt_pm.chat ORDER BY created_at DESC")
        calendar = await berlin_calendar(conn)
    return {
        "inventory": (
            {
                "counts": json.loads(catalog["counts"]),
                "observed_at": catalog["observed_at"],
                "pages": catalog["pages"],
            }
            if catalog
            else None
        ),
        "cv": dict(cv) if cv else None,
        "chats": [dict(r) for r in chats],
        "calendar": dict(calendar),
        "model": MODEL,
        "effort": app.state.effort,
        "connected": bool(app.state.key),
    }


@app.post("/local-api/inventory/refresh")
async def refresh():
    path = os.environ.get("HNT_INVENTORY_FILE")
    if not path:
        raise HTTPException(409, "Set HNT_INVENTORY_FILE to refresh this inventory.")
    try:
        async with app.state.db.acquire() as conn:
            await import_snapshot(conn, Path(path))
    except (OSError, ValueError, KeyError):
        raise HTTPException(
            422, "The inventory could not be validated. Check the source file and its evidence."
        ) from None
    return await workspace()


@app.post("/local-api/inventory/search")
async def browse(query: Search):
    async with app.state.db.acquire() as conn:
        return await search(conn, query)


@app.get("/local-api/discovery")
async def discover():
    async with app.state.db.acquire() as conn:
        return await discovery_topics(conn)


@app.get("/local-api/discovery/{topic_id}")
async def discover_topic(topic_id: str, offset: int = Query(0, ge=0, le=100000), limit: int = Query(6, ge=1, le=20)):
    async with app.state.db.acquire() as conn:
        return await discovery_page(conn, topic_id, offset, limit)


@app.put("/local-api/connection")
async def connect(payload: Connection):
    key = payload.key.get_secret_value().strip()
    await provider_call(app.state.http, key, "GET", "/models/" + MODEL)
    app.state.key, app.state.effort = key, payload.effort
    return {"connected": True}


@app.delete("/local-api/connection")
async def disconnect():
    app.state.key = None
    return {"connected": False}


@app.put("/local-api/cv")
async def save_cv(payload: Cv):
    text = payload.text.strip()
    if len(text) < 20 or "\x00" in text:
        raise HTTPException(422, "Your CV needs at least 20 characters of readable text.")
    await app.state.db.execute(
        """INSERT INTO hnt_pm.cv(singleton,filename,format,content)
        VALUES(true,$1,$2,$3) ON CONFLICT(singleton) DO UPDATE SET filename=excluded.filename,
        format=excluded.format,content=excluded.content""",
        payload.filename,
        payload.format,
        text,
    )
    return {"filename": payload.filename, "format": payload.format, "characters": len(text)}


@app.post("/local-api/chats")
async def new_chat():
    row = await app.state.db.fetchrow(
        """INSERT INTO hnt_pm.chat(id,title) VALUES($1,'Untitled conversation')
                                        RETURNING id,title""",
        uuid4(),
    )
    return dict(row)


def turn(row):
    return {
        "id": str(row["id"]),
        "question": row["question"],
        "answer": row["answer"],
        "sources": json.loads(row["sources"]),
    }


class RoleSelection(Input):
    job_ids: list[str] = Field(max_length=3)


async def focus_cards(conn, ids):
    rows = await conn.fetch(
        f"""SELECT {CARD} AS card FROM unnest($1::text[]) WITH ORDINALITY f(id,position)
        JOIN hnt_pm.job j ON j.source_id=f.id JOIN hnt_pm.company c USING (organization_key)
        ORDER BY f.position""", ids)
    return [json.loads(row["card"]) for row in rows]


@app.put("/local-api/role-focus/{chat_id}")
async def set_focus(chat_id: UUID, payload: RoleSelection):
    ids = payload.job_ids
    async with app.state.db.acquire() as conn, conn.transaction():
        if not await conn.fetchval("SELECT 1 FROM hnt_pm.chat WHERE id=$1 FOR UPDATE", chat_id):
            raise HTTPException(404, "Conversation not found.")
        cards = await focus_cards(conn, ids)
        if len(cards) != len(ids) or len(set(ids)) != len(ids):
            raise HTTPException(422, "Choose distinct roles from the current inventory.")
        await conn.execute("""INSERT INTO hnt_pm.chat_focus VALUES($1,$2)
            ON CONFLICT(chat_id) DO UPDATE SET job_ids=excluded.job_ids""", chat_id, ids)
    return cards


@app.get("/local-api/role-description/{job_id}")
async def role_description(job_id: str):
    row = await app.state.db.fetchrow(
        "SELECT record->>'description' AS description FROM hnt_pm.job WHERE source_id=$1", job_id)
    if row is None:
        raise HTTPException(404, "This posting is no longer in the inventory.")
    return dict(row)


@app.get("/local-api/chats/{chat_id}")
async def read_chat(chat_id: UUID):
    async with app.state.db.acquire() as conn:
        chat = await conn.fetchrow("""SELECT f.job_ids FROM hnt_pm.chat c
            LEFT JOIN hnt_pm.chat_focus f ON f.chat_id=c.id WHERE c.id=$1""", chat_id)
        if chat is None:
            raise HTTPException(404, "Conversation not found.")
        focus = None if chat["job_ids"] is None else await focus_cards(conn, chat["job_ids"])
        rows = await conn.fetch(
            "SELECT * FROM hnt_pm.turn WHERE chat_id=$1 ORDER BY created_at,id", chat_id
        )
    return {"turns": [turn(r) for r in rows], "focus": focus}


@app.post("/local-api/chats/{chat_id}/turns")
async def send(chat_id: UUID, payload: Message):
    key, effort = app.state.key, app.state.effort
    async with app.state.db.acquire() as conn, conn.transaction():
        if not await conn.fetchval(
            "SELECT pg_try_advisory_xact_lock(hashtextextended($1,0))", str(chat_id)
        ):
            raise HTTPException(409, "A reply is already in progress in this conversation.")
        if not await conn.fetchval("SELECT 1 FROM hnt_pm.chat WHERE id=$1", chat_id):
            raise HTTPException(404, "Conversation not found.")
        existing = await conn.fetchrow("SELECT * FROM hnt_pm.turn WHERE id=$1", payload.id)
        if existing:
            if existing["chat_id"] != chat_id or existing["question"] != payload.question:
                raise HTTPException(409, "This message already contains a different question.")
            return turn(existing)
        if not key:
            raise HTTPException(409, "Connect your OpenAI API key to send a message.")
        recent = await conn.fetch(
            """SELECT * FROM hnt_pm.turn WHERE chat_id=$1
                                      ORDER BY created_at DESC,id DESC LIMIT 24""",
            chat_id,
        )
        if (recent[0]["id"] if recent else None) != payload.previous_id:
            raise HTTPException(409, "This conversation changed in another tab. Reopen it and try again.")
        history = [
            {
                "question": r["question"],
                "answer": r["answer"],
                "jobs": [
                    {"id": s["id"], "title": s["title"], "publisher": s["publisher"]}
                    for s in json.loads(r["sources"])
                ],
            }
            for r in reversed(recent)
        ]
        cv = await conn.fetchval("SELECT content FROM hnt_pm.cv")
        reply, sources = await answer(
            conn, app.state.http, key, effort, payload.question, history, cv
        )
        row = await conn.fetchrow(
            """INSERT INTO hnt_pm.turn(id,chat_id,question,answer,sources)
            VALUES($1,$2,$3,$4,$5) RETURNING *""",
            payload.id,
            chat_id,
            payload.question,
            reply,
            encode(sources),
        )
        if not recent:
            await conn.execute(
                "UPDATE hnt_pm.chat SET title=$2 WHERE id=$1", chat_id, payload.question[:90]
            )
    return turn(row)
