# Phases 1–2 verification

Updated: 2026-10-08 (Asia/Colombo).

## Phase 2 checks

- Generated Prisma client and applied both migrations to a fresh UTF-8 PostgreSQL database with pgvector, using a restricted runtime role.
- 27 unit tests passed, including exact LKR conversion, CSV validation, private-address/DNS/redirect blocking, bounded DNS timeout, robots rules, extraction, crawl bounds, Unicode chunking and deterministic vectors.
- 14 PostgreSQL integration tests passed: the seven foundation checks and seven Phase 2 checks covering catalog CRUD, atomic import rollback, tenant API/RLS/raw SQL/composite foreign-key isolation, crawl deduplication, draft approval, version conflicts, indexing/retrieval, re-crawl preservation and stale embedding tasks.
- One real Redis/BullMQ dispatch/worker test is enabled by `TEST_REDIS_URL` in CI and explicitly skipped locally. Redis is not installed on this machine. Direct processor tests used real PostgreSQL with fixture HTML transport and the development embedding provider; they do not verify local Redis operation or live website crawling.
- ESLint, workspace type checks, NestJS build and optimized Next.js production build passed.
- Browser sign-in with the synthetic local review account succeeded. Multilingual product creation persisted LKR 1,250.50 and stock 24. CSV preview and import, and manual knowledge approval were checked through the UI. Approved knowledge correctly shows indexing queued while Redis is unavailable.
- Visually inspected the new desktop views and 390px mobile layout. Fixed catalog flex sizing and contained its accessible table header; both catalog and knowledge now avoid document-level horizontal overflow. The catalog table scrolls inside its card. Temporary viewport overrides were cleared after checking.

## Phase 1 checks retained

Completed on 2026-10-07:

- Prisma client generation succeeded with Prisma 6.19.3.
- Applied the migration to a fresh PostgreSQL database with `prisma migrate deploy`.
- Four unit tests passed: password hashing/verification, opaque tokens, registration validation, and plan feature configuration.
- Seven integration tests passed against real PostgreSQL 17 using `saha_app` (neither SUPERUSER nor BYPASSRLS). Tests cover unauthenticated access, CSRF, cross-tenant API reads/writes, RLS/raw SQL/transaction context reset, forbidden inserts, invitation email binding and replay, agent permissions, login/logout, and active-tenant isolation for multi-workspace users.
- ESLint and TypeScript checks passed across the workspace.
- NestJS build and optimized Next.js production build passed.
- Browser registration with a synthetic local account reached the authenticated dashboard. Updating the business name persisted and appeared in the workspace selector.
- Visually inspected the landing page, desktop dashboard, and 390px mobile layout. Mobile workspace selection and sign-out remain available.

## Environment notes

Docker is not installed here, so Compose containers and the GitHub Actions runner have not been executed locally. PostgreSQL 17 and pgvector 0.8.1 are available on this machine; Compose/CI target PostgreSQL 16 with pgvector. No external service credentials were used.

For this review session, the app uses web port 3001, API port 4001, and a dedicated PostgreSQL cluster on loopback port 55432 under ignored `.local/postgres`. An unrelated project already occupied port 3000. Example environment files retain the standard ports documented in README.

The machine's bundled pnpm is a different major version. Installation and verification used the pinned pnpm 10.11.0; local direct workspace commands avoided the bundled wrapper. Use the pinned version from `packageManager` for reproducible installs.

## Not claimed as verified

- Live Google OAuth without owner-supplied credentials.
- Docker image execution, hosted CI, or Railway deployment.
- Local Redis/BullMQ execution, production semantic embeddings or live multilingual answer quality.
- Features in Phases 3–6: conversation engine/widget, Meta channels, orders/payments, and usage enforcement.

## References used during implementation

- [Next.js App Router installation](https://nextjs.org/docs/app/getting-started/installation) and the installed Next.js 16.4 documentation for client components and Tailwind/global CSS.
- [Prisma 6 data sources](https://docs.prisma.io/docs/orm/v6/prisma-schema/overview/data-sources).
- [PostgreSQL row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).
- [Railway config-as-code reference](https://docs.railway.com/config-as-code/reference).
- [BullMQ idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs) and [job IDs](https://docs.bullmq.io/guide/jobs/job-ids).
- [CSV parse options](https://csv.js.org/parse/options/) and [Cheerio extraction](https://cheerio.js.org/docs/basics/extract/).
