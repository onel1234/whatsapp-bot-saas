# Phases 1–4 verification

Updated: 2026-10-12 (Asia/Colombo).

## Phase 4 checks

- Generated and validated Prisma; applied all four migrations to a fresh UTF-8 `saha_phase4_test` PostgreSQL 17 database. The runtime role is restricted and all new business tables use forced RLS and composite tenant foreign keys.
- 80 unit tests passed, including 17 new Meta cases for raw-byte signatures, encryption/context binding/key rotation, multi-account normalization, unsupported media, echo suppression, malformed events, reply-window boundaries, all three send contracts, exact catalog rendering, uncertain outcomes, rate-limit rejection and delivery progress.
- 34 database integration tests passed across the four phases. Eleven new Phase 4 scenarios cover owner/agent and raw-SQL isolation, administrator-approved routing, cross-tenant foreign keys, concurrent event replay, encrypted tenant-only receipt splitting, failed-storage rollback/recovery, Messenger/Instagram identity routing, scoped Messenger read watermarks, early delivery receipts, uncertain sends, ordered turns/outbound replies, future-message memory exclusion, human-mode suppression, bounded explicit retries, worker interruption, current reply windows, connection pause and the send switch. Provider sends in these checks use fixtures; no Meta request is issued.
- Three Redis-dependent tests are enabled in CI and skipped locally, including the new inbound/outbound BullMQ recovery test. Local Redis and Docker remain unavailable. Persisted receipt/outbox recovery was exercised through direct processors; this does not establish Redis/BullMQ operation or hosted CI results.
- ESLint, shared/API/web type checks, API compilation, Prisma validation and optimized Next.js production build passed.
- Browser review used a synthetic local workspace and dummy account/token. Connection creation, enable/pause and token replacement persisted through the UI; token fields cleared after saving. Fixed saved sign-in credentials autofilling the channel form by using new-password fields and disabling account-ID autofill. Checked desktop and 390px mobile layout, including stacked connection controls and delivery history; no document-level horizontal overflow was visible. The fixture connection was returned to paused. Temporary viewport overrides were cleared after review.
- No real access token, app secret or account permission was supplied or used. The owner's WhatsApp test phone-number ID is recorded in `META_SETUP.md`; it has not been connected or activated. Direct Meta developer-document fetches were rate-limited; send contracts were checked against Meta's official Postman collections. Live webhook registration, app permissions/review and successful delivery still need owner configuration and testing.
- WhatsApp outside-window replies are blocked and escalated. No approved template is assumed or automatically sent. Production onboarding, template management, private media handling, full key-rotation/retention operations and provider outcome reconciliation remain documented limitations. Human inbox replies remain Phase 5.

## Phase 3 checks

- Generated Prisma and applied all three migrations to a fresh UTF-8 `saha_phase3_test` PostgreSQL database. Tests used the restricted application role with forced RLS.
- 63 unit tests passed, including 36 Phase 3 cases: 30 labeled customer messages (six each for English, Sinhala, Tamil, Singlish and Tanglish), ambiguous/mixed-language context, human-request phrases, tool/prompt configuration validation, recent memory and conservative handling of overlapping knowledge policies.
- 23 PostgreSQL integration tests passed, including nine Phase 3 scenarios for origin/session expiry, transcript isolation, concurrent message replay, exact catalog facts, usage logging, forged tools/cross-tenant IDs, current approved knowledge, human-mode notifications, provider failure, disabled widgets and ten-message memory. Durable inbound receipt processing was tested directly, including replay without duplicate replies.
- Two Redis-dependent tests (embedding and widget inbound workers) are enabled in CI by `TEST_REDIS_URL` and explicitly skipped locally. Redis and Docker remain unavailable on this machine; hosted CI has not been run. Direct processing and inline widget requests do not establish Redis operation.
- ESLint, type checks, API compilation and optimized Next.js production build passed.
- Browser checks with synthetic local data: saved bot settings and Monday hours, previewed a database-backed catalog reply, enabled an origin, and ran the actual embed script/frame handshake. A Tanglish question returned the saved LKR 1,250.50 price and stock 24. A human request produced a localized fallback and appeared in the seller's request list.
- Visually checked desktop and 390px mobile embedded chat; the frame fit the screen with no document-level horizontal overflow. Idle polling was reduced and non-JSON rate-limit replies produce readable errors. Temporary viewport overrides were cleared.
- No paid AI provider or translation quality is claimed. The local provider chooses validated tools and reviewed excerpts; it cannot generate unrestricted factual text. No Meta channel, external deployment or payment integration was activated. HUMAN mode persists requests; dashboard replies remain Phase 5.

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

The Phase 4 review uses web port 3001, API port 4001, and a disposable test database in the project's PostgreSQL cluster under ignored `.local/postgres`. Windows rejected binding to the previous loopback port 55432; the cluster runs on 55433. Private development connection URLs and project-local cluster configuration now use 55433. Fresh-database checks did not reset the previous development database. Committed example environment files retain the standard ports documented in README.

The machine's bundled pnpm is a different major version. Installation and verification used the pinned pnpm 10.11.0; local direct workspace commands avoided the bundled wrapper. Use the pinned version from `packageManager` for reproducible installs.

## Not claimed as verified

- Live Google OAuth without owner-supplied credentials.
- Docker image execution, hosted CI, or Railway deployment.
- Local Redis/BullMQ execution, production semantic embeddings or live multilingual answer quality.
- Live Meta account activation/webhook delivery; local adapters and mocked provider transports are verified, not live permissions or delivery.
- Features in Phases 5–6: live inbox/human replies, orders/payments, and usage enforcement.

## References used during implementation

- [Next.js App Router installation](https://nextjs.org/docs/app/getting-started/installation) and the installed Next.js 16.4 documentation for client components and Tailwind/global CSS.
- [Prisma 6 data sources](https://docs.prisma.io/docs/orm/v6/prisma-schema/overview/data-sources).
- [PostgreSQL row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).
- [Railway config-as-code reference](https://docs.railway.com/config-as-code/reference).
- [BullMQ idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs) and [job IDs](https://docs.bullmq.io/guide/jobs/job-ids).
- [CSV parse options](https://csv.js.org/parse/options/) and [Cheerio extraction](https://cheerio.js.org/docs/basics/extract/).
