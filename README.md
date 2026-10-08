# Saha · multilingual customer workspace

Working product name. Phase 1 implements the foundation of the approved [architecture](ARCHITECTURE.md): a pnpm monorepo, Next.js App Router dashboard, NestJS API, Prisma/PostgreSQL tenant isolation, authentication, team roles, configurable plans, Docker services and CI.

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

Open [localhost:3000](http://localhost:3000). Create an account with a password of at least 12 characters. Signup creates your first workspace and owner membership. There are no seeded passwords or production demo accounts.

The API runs at [localhost:4000](http://localhost:4000/health). Liveness is `/health`; database readiness is `/ready`. Local Postgres and Redis bind to loopback only. Compose creates a restricted `saha_app` login; `DIRECT_URL` is for privileged migrations and `DATABASE_URL` must use the restricted role.

For an existing PostgreSQL installation, create a separate UTF-8 `saha` database, run `infra/init-db.sql` as an administrator, and point both database URLs at it. Do not run the initialization SQL against an unrelated database. The SQL enables pgvector. Redis is provisioned for queues starting in Phase 2; Phase 1 does not dispatch background jobs.

## What to review

- Landing page, account creation, login, logout, dashboard and mobile layout.
- Create a second workspace and switch using the selector.
- As owner, change the workspace name, inspect provisional plans, and create a team invitation.
- Share the private invitation link manually. The recipient signs in with its matching email and accepts; the link expires in 48 hours and works once. Existing memberships cannot be promoted by accepting another invitation.
- Agents can enter their workspace but cannot edit settings, view team/plan management, or issue invitations. API authorization enforces this independently of the UI.
- Catalog, knowledge, conversations, channels, commerce and metering show their upcoming build phase. They are not simulated live services.

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

Integration tests require a migrated test database and deliberately fail if the connecting role is a superuser or bypasses RLS. Use a disposable database: tests create distinct users/workspaces and retain their records for debugging. They cover cross-tenant API access, RLS reads/writes and raw SQL, context leakage, CSRF, invitation recipient binding/replay, agent permissions, password login and logout. CI starts isolated PostgreSQL/pgvector and Redis services and runs the same checks.

Authentication uses salted scrypt passwords and opaque HttpOnly SameSite cookies. Session tokens are hashed at rest. All mutation requests require the exact configured `Origin`; this includes command-line API clients. No API response contains password hashes or raw session tokens. General and authentication rate limits are process-local in Phase 1; shared Redis limits are required for multiple API replicas in Phase 6.

## Railway deployment configuration

Deployment files are prepared but nothing is published. Use the repository root as the build context for separate web/API services and choose `infra/railway-web.toml` or `infra/railway-api.toml` respectively. Provision PostgreSQL with pgvector and Redis separately. Before the API's migration command, provision the `saha_app` role with a strong password and no superuser/BYPASSRLS privileges. Adapt `infra/init-db.sql` with your production database name/password; its committed values are local-only.

Set the API's `DATABASE_URL`, `DIRECT_URL`, `REDIS_URL`, `WEB_ORIGIN`, and optional Google variables. Set web's `NEXT_PUBLIC_API_URL` at build time. Use HTTPS and same-site sibling domains (for example `app.example.lk` and `api.example.lk`) for cookie authentication. Configure Google's exact HTTPS callback. Railway supplies `PORT`; Next.js and the API honor it. Default unrelated service domains are not suitable for this SameSite cookie setup.

The migration role owns a narrowly scoped SECURITY DEFINER invitation lookup; the runtime role cannot execute arbitrary privileged functions. Migrations assume a privileged PostgreSQL administrator able to bypass forced RLS for this lookup. If your host supplies a different privilege model, provision a dedicated function-owner role and validate invitation tests there before use.

## Phase boundary and known limitations

This is a reviewable Phase 1, not a launched chatbot. Plan limits are provisional configuration; there is no upgrade checkout or quota enforcement yet. Email verification/password recovery, session management UI, member removal/ownership transfer, shared rate limiting, production retention and operational hardening remain before public launch. Invitations are shared manually; no email provider is assumed. Google live sign-in and Railway deployment need your credentials/configuration. No paid service is called.

See [DECISIONS.md](DECISIONS.md) for approved decisions and remaining questions. Stop for review after this phase before implementing the catalog, crawler and embeddings in Phase 2.

See [VERIFICATION.md](VERIFICATION.md) for the checks completed in this environment and the integrations that remain unverified.
