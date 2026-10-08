# Phase 1 verification

Date: 2026-10-07 (Asia/Colombo).

## Completed checks

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
- Features in Phases 2–6, including real multilingual AI responses, queues, Meta channels, orders/payments, and usage enforcement.

## References used during implementation

- [Next.js App Router installation](https://nextjs.org/docs/app/getting-started/installation) and the installed Next.js 16.4 documentation for client components and Tailwind/global CSS.
- [Prisma 6 data sources](https://docs.prisma.io/docs/orm/v6/prisma-schema/overview/data-sources).
- [PostgreSQL row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).
- [Railway config-as-code reference](https://docs.railway.com/config-as-code/reference).
