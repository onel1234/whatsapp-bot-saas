# Saha · multilingual customer workspace

Working product name. Phases 1–3 implement the approved [architecture](ARCHITECTURE.md): authentication and tenant isolation, catalog and knowledge ingestion, a constrained conversation engine, bot settings and embeddable website chat.

## Run locally

Requirements: Node.js 22 LTS (minimum 20.19), pnpm 10.11, Docker with Compose.

```sh
corepack enable
corepack prepare pnpm@10.11.0 --activate
pnpm install
```

Copy `apps/api/.env.example` to `apps/api/.env` and `apps/web/.env.example` to `apps/web/.env.local`. On PowerShell:

```powershell
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/web/.env.example apps/web/.env.local
```

```sh
docker compose up -d --wait
pnpm db:generate
pnpm db:migrate
pnpm dev
```

In a second terminal run `pnpm worker` to dispatch durable tasks and process crawling/embedding queues. Redis must be running at `REDIS_URL`; without it, accepted tasks remain queued in PostgreSQL. For worker development with reload, use `pnpm --filter @saha/api worker:dev`.

Open [localhost:3000](http://localhost:3000). Create an account with a password of at least 12 characters. Signup creates your first workspace and owner membership. There are no seeded passwords or production demo accounts.

The API runs at [localhost:4000](http://localhost:4000/health). Liveness is `/health`; database readiness is `/ready`. Local Postgres and Redis bind to loopback only. Compose creates a restricted `saha_app` login; `DIRECT_URL` is for privileged migrations and `DATABASE_URL` must use the restricted role.

For an existing PostgreSQL installation, create a separate UTF-8 `saha` database, run `infra/init-db.sql` as an administrator, and point both database URLs at it. Do not run the initialization SQL against an unrelated database. The SQL enables pgvector. Phase 2 requires Redis for background processing.

## What to review

- Landing page, account creation, login, logout, dashboard and mobile layout.
- Create a second workspace and switch using the selector.
- As owner, change the workspace name, inspect provisional plans, and create a team invitation.
- Share the private invitation link manually. The recipient signs in with its matching email and accepts; the link expires in 48 hours and works once. Existing memberships cannot be promoted by accepting another invitation.
- Agents can enter their workspace but cannot edit settings, view team/plan management, or issue invitations. API authorization enforces this independently of the UI.
- As owner, create/edit products with English, Sinhala and Tamil names, variants, stock, attributes and exact LKR prices. Search the catalog and preview a CSV before importing.
- Add a public website under Knowledge, wait for crawling, edit the resulting drafts and approve reviewed content. Approving schedules indexing; only approved, successfully indexed revisions appear in the search preview. Manual knowledge entries use the same review flow.
- Re-crawl a source: changed text becomes a draft while its previously approved version remains available. Duplicate active crawl requests reuse the existing run.
- The live inbox, Meta channels, commerce and metering remain at their upcoming build phases.

## Catalog imports and knowledge limits

Download the sample CSV from the Catalog import panel. Required headers: `product_sku,variant_sku,name_en,price_lkr,stock`. Optional headers: `name_si,name_ta,description,attributes_json,image_url,active`. Quote JSON/commas using normal CSV escaping. A product's repeated rows must share its metadata. SKU matching is case-insensitive (stored uppercase); prices accept decimal strings with at most two cents digits, never float rounding. Imports allow 500 rows and 500,000 characters and commit atomically. Supplied variants merge by SKU; omitted existing variants remain. Editing a product directly replaces its variant list.

Crawling is limited to the same hostname, up to 50 pages and depth 3. It honors robots.txt, uses bounded requests, blocks private/reserved destinations and DNS rebinding, and checks redirects. Only static HTML/text is supported; JavaScript-rendered content and PDFs are not extracted. Content enters the knowledge library as drafts, never automatically approved.

The default **development embedding provider** is deterministic token hashing with 64 dimensions. It tests indexing, isolation and retrieval mechanics without paid API calls. It is not a production semantic model or proof of multilingual answer quality. Choose an approved provider/model before production; changing dimensions requires a database migration and reindex.

## Google sign-in

Optional. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in the API environment, then restart it. Register the exact callback (`http://localhost:4000/auth/google/callback` for development) in your Google OAuth project. The sign-in option appears only when all values exist.

The implementation uses state, nonce, PKCE, and Google ID-token verification. It never automatically links an existing password account by matching email. A first-time Google user creates a workspace after sign-in. No Google credentials have been created or assumed; the live provider flow requires your configuration.

## Checks

```sh
pnpm db:generate
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

Integration tests require a migrated test database and deliberately fail if the connecting role is a superuser or bypasses RLS. Use a disposable database: tests create distinct users/workspaces and retain records for debugging. They cover auth, tenant isolation, catalog rollback, crawl/review/index workflows and cross-tenant vector retrieval. Set `TEST_REDIS_URL` to a disposable Redis instance to enable the BullMQ dispatch/worker test; otherwise that test is explicitly skipped. CI starts PostgreSQL/pgvector and Redis and enables it.

Authentication uses salted scrypt passwords and opaque HttpOnly SameSite cookies. Session tokens are hashed at rest. All mutation requests require the exact configured `Origin`; this includes command-line API clients. No API response contains password hashes or raw session tokens. General and authentication rate limits are process-local in Phase 1; shared Redis limits are required for multiple API replicas in Phase 6.

## Railway deployment configuration

Deployment files are prepared but nothing is published. Use the repository root as build context for separate web/API/worker services with `infra/railway-web.toml`, `infra/railway-api.toml` and `infra/railway-worker.toml`. The worker shares the API image and database/Redis configuration. Provision PostgreSQL with pgvector and Redis separately. Before the API's migration command, provision the `saha_app` role with a strong password and no superuser/BYPASSRLS privileges. Adapt `infra/init-db.sql` with your production database name/password; its committed values are local-only.

Set the API's `DATABASE_URL`, `DIRECT_URL`, `REDIS_URL`, `WEB_ORIGIN`, and optional Google variables. Set web's `NEXT_PUBLIC_API_URL` at build time. Use HTTPS and same-site sibling domains (for example `app.example.lk` and `api.example.lk`) for cookie authentication. Configure Google's exact HTTPS callback. Railway supplies `PORT`; Next.js and the API honor it. Default unrelated service domains are not suitable for this SameSite cookie setup.

The migration role owns narrowly scoped SECURITY DEFINER invitation and background-task routing lookups; the runtime role cannot execute arbitrary privileged functions. Migrations assume a PostgreSQL administrator able to bypass forced RLS for these lookups. If your host supplies a different privilege model, provision a dedicated function-owner role and validate isolation tests there before use.

## Phase boundary and known limitations

This is a reviewable Phase 3, not a launched chatbot. Plan limits are provisional; there is no upgrade checkout or quota enforcement yet. Email verification/password recovery, session management UI, member removal/ownership transfer, shared rate limiting, production retention and operational hardening remain before public launch. Invitations are shared manually; no email provider is assumed. Google live sign-in and Railway deployment need your credentials/configuration. No paid service is called.

See [DECISIONS.md](DECISIONS.md) for approved decisions and remaining questions. Stop for review here before implementing Meta adapters in Phase 4.

See [VERIFICATION.md](VERIFICATION.md) for the checks completed in this environment and the integrations that remain unverified.

## Try Phase 3

1. Add a catalog product and open **Bot settings**. Choose your greeting, customer languages, rules, handoff phrases and business hours.
2. Click **Start preview**. Try `tea price` using your product name, `tea vilai evvalavu`, and `human please`. Catalog prices/stock come from the database. Handoffs appear under **Requests for your team**; start a new conversation to test the bot again.
3. Add your website's exact origin (scheme + hostname + port, no path) and enable website chat. For the built-in demo, allow the web origin, e.g. `http://localhost:3000`.
4. Save and open **website demo**, or paste the displayed script into your own page. The embed validates a frame/parent postMessage handshake before bootstrapping a conversation.
5. To test knowledge, approve/index an entry with `pnpm worker`, then ask a related question. Reviewed excerpts retain their original language; absent evidence or language mismatch triggers a localized handoff.

The example API environment uses `WIDGET_PROCESSING_MODE=inline`, which runs the local engine after durable receipt commit without Redis. Set it to `queue` and run `pnpm worker` to exercise the BullMQ inbound path. Queue mode without a worker truthfully shows a pending reply. Crawling and indexing always require Redis/the worker.

The local LLM selects validated tools and excerpts only. It has no live model, translation service or paid API. Reply metadata records language, channel, model, token estimates and zero development cost; these estimates are not provider billing counts. Order tools are unavailable until Phase 5. HUMAN mode saves requests but dashboard human replies are not implemented yet.

Credentials expire after 24 hours and stay in frame memory. Reload starts a new anonymous conversation. Disabling the widget or removing its origin blocks existing public sessions. Public endpoints are rate-limited per process until Phase 6. Production API startup refuses the development LLM unless `ALLOW_DEVELOPMENT_LLM=true` explicitly enables staging review; choose an approved real provider before launch.
