<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.

<!-- LOVABLE:END -->

## Hired Not Tired architecture

- The outreach slice uses candidate-supplied or cited public-search contacts and exact-payload approval in `src/lib/hiring-contacts.ts`; LinkedIn and email are user-controlled handoffs, candidate-reported sends and replies stay distinct from provider-confirmed events, and Needle is an optional server-side capability only.
- The durable career engine is owned by `backend/app/routers/career.py`, `career_store.py`, `career_engine.py` and `providers.py`: candidate ownership and idempotent audit persistence stay at the route/store boundary, deterministic generation stays in the engine, and all public-page/search network access stays behind server-side provider adapters.
- The CV-led application package uses `src/lib/application-package.ts` for versioned, evidence-grounded artifacts and `src/lib/cv-documents.ts` for local PDF/DOCX parsing and validated export; all external application channels remain capability-gated handoffs, and local package state is explicitly ephemeral.
- LinkedIn production authentication uses `src/lib/linkedin-auth.ts` only for OIDC contracts and capability gating; the standalone modular FastAPI service in `backend/` owns code exchange, validation, account provisioning and secure sessions, while the explicitly fictional local demo never counts as authentication.
- Backend auth uses async SQLAlchemy/Alembic with PostgreSQL in production; local portable tests may use SQLite, CI must exercise PostgreSQL, and the backend must never be replaced by browser-side OAuth or Lovable Cloud auth.
- PayPal billing stays in the FastAPI ownership/CSRF/idempotency boundary: pending checkout associations, server-verified subscriptions and signed webhooks own entitlements, while the frontend never grants paid state from browser approval or demo data.
- Framer Motion owns UI micro-interactions and must respect reduced-motion preferences so animation remains consistent and accessible across routes.