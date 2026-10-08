# Architecture decisions and open questions

Status: architecture approved on 2026-10-07. The owner authorized Phases 2 and 3 on 2026-10-08. Phase 3 engine and widget are implemented and verified for review.

## Requirements accepted from the brief

- Keep Next.js App Router + TypeScript + Tailwind, NestJS, pnpm workspaces, Prisma/PostgreSQL/pgvector, Redis/BullMQ, Docker Compose and Railway deployability.
- Server-owned catalog, inventory, quotes and orders are the source of monetary facts.
- English dashboard; customer support in English, Sinhala, Tamil, Singlish and Tanglish.
- Build in six phases and stop after each for review.
- Ask before assuming paid services, Meta app review or PayHere credentials.

## Approved architecture decisions

| Decision | Reason |
| --- | --- |
| Global User/AuthIdentity/Session/AuthToken; tenant-scoped business records | One identity can join multiple businesses; explicit exception to literal every-table tenancy requirement |
| Composite tenant foreign keys, scoped repositories, and PostgreSQL RLS | Protect both normal access and accidental cross-tenant references |
| Durable transactional outbox before BullMQ dispatch | Avoid losing accepted webhooks during database/Redis partial failure |
| Integer LKR minor units and default product variants | Consistent stock and pricing source for simple and variant products |
| Server-rendered commerce facts and server-owned confirmed quote | Prevent generated prices and unauthorized/replayed order creation |
| Separate provider abstractions for chat and embeddings | Allow switching providers while tracking vector compatibility |
| Approved knowledge revisions, draft re-crawls | Avoid silently publishing unreviewed website content or replacing owner edits |
| Opaque cookie sessions and explicit identity linking | Avoid exposing long-lived tokens or unsafe email-only account linking |
| Durable dashboard notifications for MVP | Notify sellers without assuming email/SMS services |
| Conversation-scoped widget credentials | A public embed identifier must not expose existing customer transcripts |

## Open decisions

These do not block the architecture review unless noted.

- **Approval gate:** architecture and global-identity exception approved on 2026-10-07; Phase 2 authorized on 2026-10-08. Phase 3 is authorized; stop for review before Meta adapters in Phase 4.
- **Brand:** product name, logo and visual identity; use a neutral working label until chosen.
- **Plan rules:** exact quotas, enabled channels/features, reset period, and retention by plan. Keep development values explicitly provisional; confirm before enforcing commercial plans. PayHere is Growth-enabled as requested, with Business inheritance proposed.
- **AI:** approved LLM and embedding providers/models, budget, expected dimensions, data processing requirements. No paid API calls until authorized.
- **Google:** OAuth project/client configuration and deployment callback domains; configurable implementation can be tested locally before credentials exist.
- **Meta:** account assets, app ownership/review status, permissions, templates and onboarding model; ask in Phase 4.
- **Payments:** PayHere merchant configuration, sandbox access, bank-transfer instructions and private attachment storage; ask in Phase 5.
- **Commerce:** delivery charges/areas, taxes, reservation/cancellation rules, and slip review behavior; require explicit business configuration before live checkout.
- **Operations:** production hosting authorization, region, backups, encryption key management/rotation, raw-event and customer-data retention, and optional seller notification channels.

## Verification commitments

- Tenant A cannot read, update, join or retrieve vectors belonging to tenant B; include worker and raw-SQL paths and checks using the real non-owner database role.
- Repeated webhook delivery cannot create duplicate inbound processing or orders; test queue-dispatch interruption and worker retry.
- Orders require an unexpired customer-confirmed quote, authoritative prices, valid stock, and transactional idempotency.
- Include at least 30 labeled customer-message fixtures: six each for English, Sinhala, Tamil, Singlish and Tanglish, plus ambiguous/mixed-language examples.
- Report which checks ran and which provider integrations remain unverified; never present local fake-provider behavior as live multilingual quality validation.

## Phase 1 implementation notes

- Saha is a temporary product label, not a final brand decision.
- Development quotas: Free 100, Starter 1,000, Growth 5,000, Business 20,000. These are explicitly provisional and not enforced or sold.
- Prisma 6 is selected for its established connection/schema configuration; future major upgrades require a migration review. The package lock pins resolved versions.
- First phase includes password login, optional Google OAuth, opaque seven-day sessions, team invitations, owner/agent roles, and multiple workspaces. Google identities are not automatically linked by email.
- Team invitations are manually shared, single-use, email-bound links expiring after 48 hours; no mail provider is chosen. Email verification/recovery and member removal/ownership transfer remain pre-launch work.
- RLS uses transaction-local user context for membership discovery, and tenant context only after authorization. An active tenant context restricts even a user who belongs to multiple businesses. Only the tenancy root and global identity tables differ from the tenantId convention.
- Future models are added in their owning phases; the full proposed commerce/knowledge schema is not prematurely migrated in Phase 1.
- PostgreSQL 17 with pgvector is available locally for verification. Compose and CI use PostgreSQL 16 with pgvector; Docker execution is unavailable on this machine.
- Production web/API must use same-site HTTPS domains for SameSite session cookies. No external deployment or paid service has been activated.

## Phase 2 implementation notes

- Owner-managed multilingual products, variants, integer LKR prices, stock, attributes and atomic CSV import are now available. CSV updates merge supplied SKUs and preserve omitted variants; full product editing replaces the variant list.
- Crawled pages enter review as drafts. Approval snapshots content and creates a durable embedding task in the same transaction. Re-crawls retain the approved snapshot and existing index until a replacement is approved and indexed.
- BullMQ workers use database-owned task IDs, bounded retries and stable job IDs. Tenant routing is resolved from the persisted task, never trusted from queue payloads. Every new business table uses forced RLS and composite tenant foreign keys.
- Public HTML crawling honors robots.txt, pins vetted public DNS addresses, rechecks redirects, and caps pages, depth, bytes and time. It does not render JavaScript or extract PDFs.
- The no-cost development embedding provider uses deterministic 64-dimensional token hashing. It verifies the indexing/retrieval plumbing; it does not establish production semantic or multilingual search quality. A real provider/model and any dimension migration/reindex still require the owner's decision.
- Redis is unavailable on this machine. Direct processor integration checks passed using real PostgreSQL; the real Redis/BullMQ dispatch/worker test is enabled in CI but skipped locally. Nothing has been deployed.

## Phase 3 implementation notes

- `LlmProvider` exposes constrained tool proposals and usage metadata. The approved local provider selects tools and approved excerpts; it does not call paid APIs, generate unrestricted factual text or translate knowledge. Production provider selection and multilingual answer-quality evaluation remain open.
- Catalog cards use active tenant-scoped database variants. Tool schemas reject tenant IDs, model-created prices and forged confirmations. Knowledge proposals must reference current retrieved approved chunks; weak, mismatched-language or monetary/stock excerpts fall back to the team.
- Detection uses Sinhala/Tamil script, conservative romanized vocabulary and recent-language context for ambiguity. Thirty labeled fixtures (six per style), plus ambiguous/mixed cases, verify these heuristics rather than general language quality.
- Widget credentials are random, hashed at rest, valid for 24 hours and bound to one conversation/origin. The public embed ID cannot retrieve transcripts. Enabled origins and widget status are rechecked. Credentials remain in frame memory, never URLs or browser storage.
- ConversationTurn is both a committed widget receipt and durable inbound work item. Stable client UUIDs deduplicate retries. Database locks serialize each conversation; reply, usage and completion commit together. Model memory is ten recent messages; transcripts persist in full, with the latest fifty available to widget polling.
- `WIDGET_PROCESSING_MODE=inline` tests the local engine without Redis after receipt commit. Queue mode uses `saha-inbound` BullMQ and the same engine. Pending receipts survive outages; failed jobs have a recovery cooldown. Redis remains the required queue stack.
- HUMAN mode and one seller notification persist for requests, missing evidence or provider errors. Bot settings shows notifications; the live inbox and human replies remain Phase 5. Order tool contracts return unavailable and cannot mutate stock or create orders.
- Business name, tone, languages, greeting, rules, handoff phrases and Asia/Colombo hours assemble a structured prompt; there is no raw prompt editor. The local selector is not a production instruction-following/translation model.
- Production API startup rejects the local provider unless `ALLOW_DEVELOPMENT_LLM=true` explicitly enables a staging review. No paid service, deployment or Meta activation was performed.
