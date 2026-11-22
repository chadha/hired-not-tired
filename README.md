# Hired Not Tired

A chat-first career coach and candidate-controlled application workflow. In local development the coach uses a single-user PostgreSQL workspace. The hosted application uses its separately configured authenticated backend.

## Local PM coach on Windows

Open `/coach` in the local Vite server with `VITE_API_BASE_URL` unset. The development server forwards `/local-api` to the local FastAPI process on port 8019. Keep both processes bound to loopback. The local workspace supports CV upload and browsing without LinkedIn or an OpenAI key.

Use a dedicated PostgreSQL database and login for this workspace. The login owns the `hnt_pm` schema. The inventory import takes the GoToWork `inventario-consultable.json` file and the company text files referenced by that snapshot. The import validates membership and replaces the catalog atomically. The button **Actualizar inventario** imports the latest saved snapshot while keeping CV and chat history.

From the repository root, in PowerShell, use Python 3.12+ with the backend dependencies installed. On a fresh machine, create the virtual environment with `py -3.12 -m venv "$env:TEMP/hnt-local-coach-venv"` and install the backend with `& "$env:TEMP/hnt-local-coach-venv/Scripts/python.exe" -m pip install ./backend`. The following example uses a Windows user-protected credential exported with `Export-Clixml` for the dedicated database login.

```powershell
Set-Location backend
$env:PGDATABASE = 'hired_not_tired_local'
$credential = Import-Clixml (Join-Path $env:LOCALAPPDATA 'HiredNotTired/local-coach.xml')
$env:PGUSER = $credential.UserName
$env:PGPASSWORD = $credential.GetNetworkCredential().Password
$env:HNT_INVENTORY_FILE = Read-Host 'Full path to inventario-consultable.json for updates'
$env:PYTHONDONTWRITEBYTECODE = '1'
& (Join-Path $env:TEMP 'hnt-local-coach-venv/Scripts/python.exe') -m uvicorn local_coach.server:app --host 127.0.0.1 --port 8019 --no-proxy-headers --no-access-log
```

Start the frontend from the repository root in a second terminal with `bun run dev --host 127.0.0.1 --port 4178`. Once the inventory is imported, PostgreSQL serves searches independently of the original files. The API key is validated against the selected OpenAI model and held only in the local process. Sending a chat turn shares the CV text, recent conversation and retrieved evidence with OpenAI. Each chat keeps its own drafts and source links.

## Product workflow

- Confirm a conversational career profile or imported CV facts with immutable revisions.
- Import public job URLs, preserve source/retrieval evidence, and review requirement-level matches.
- Create versioned application packages, grounded answers, tailored CVs and cover letters; approve exact artifacts and export PDF/DOCX.
- Discover cited public hiring contacts only when an optional compliant search provider is configured, or use a contextual people-search/manual-contact fallback.
- Review, edit, approve and copy LinkedIn/email drafts; record handoffs, candidate-reported sends and replies without claiming provider delivery.

## Frontend

Requirements: Bun, Node.js and npm-compatible tooling.

```sh
bun install
bun run dev
bunx vitest run
bun run lint
```

Set `VITE_API_BASE_URL=http://localhost:8000` only when the separately runnable backend is available. Do not append `/api/v1`. In live mode, backend failures remain explicit and never substitute demo success.

## Standalone FastAPI backend

`backend/` contains LinkedIn OIDC (direct or existing-Supabase `linkedin_oidc`), secure opaque sessions, consent/account lifecycle, candidate-owned career persistence, Alembic migrations, provider boundaries, Docker-compatible deployment artifacts and PostgreSQL CI. See:

- [Backend setup and verification](backend/README.md)
- [Exact HTTP contract](backend/docs/API_CONTRACT.md)
- [Frontend integration](backend/docs/FRONTEND_INTEGRATION.md)
- [Security model](backend/docs/SECURITY.md)
- [Operator checklist](backend/docs/OPERATOR_CHECKLIST.md)

No production URL, cloud database, provider credential or successful real-provider login is included. External setup and deployment remain explicit operator actions.
