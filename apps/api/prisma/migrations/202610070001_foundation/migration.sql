CREATE TYPE "Role" AS ENUM ('OWNER', 'AGENT');
CREATE TYPE "Plan" AS ENUM ('FREE', 'STARTER', 'GROWTH', 'BUSINESS');
CREATE TABLE "User" (
  "id" UUID NOT NULL, "email" TEXT NOT NULL, "name" TEXT NOT NULL,
  "passwordHash" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE TABLE "AuthIdentity" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "provider" TEXT NOT NULL, "subject" TEXT NOT NULL,
  CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AuthIdentity_provider_subject_key" ON "AuthIdentity"("provider", "subject");
CREATE TABLE "Session" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE TABLE "Tenant" (
  "id" UUID NOT NULL, "name" TEXT NOT NULL, "plan" "Plan" NOT NULL DEFAULT 'FREE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Membership" (
  "id" UUID NOT NULL, "tenantId" UUID NOT NULL, "userId" UUID NOT NULL, "role" "Role" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Membership_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Membership_tenantId_userId_key" ON "Membership"("tenantId", "userId");
CREATE UNIQUE INDEX "Membership_tenantId_id_key" ON "Membership"("tenantId", "id");
CREATE TABLE "Invitation" (
  "id" UUID NOT NULL, "tenantId" UUID NOT NULL, "email" TEXT NOT NULL, "role" "Role" NOT NULL DEFAULT 'AGENT',
  "tokenHash" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, "acceptedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Invitation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");
CREATE UNIQUE INDEX "Invitation_tenantId_id_key" ON "Invitation"("tenantId", "id");

-- Tenant-scoped tables are fail-closed without transaction-local context.
ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Tenant" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Membership" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Invitation" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_read ON "Tenant" FOR SELECT USING (
  id::text = current_setting('app.tenant_id', true)
  OR (NULLIF(current_setting('app.tenant_id', true), '') IS NULL AND EXISTS (SELECT 1 FROM "Membership" m WHERE m."tenantId" = "Tenant".id AND m."userId"::text = current_setting('app.user_id', true)))
);
CREATE POLICY tenant_insert ON "Tenant" FOR INSERT WITH CHECK (id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_update ON "Tenant" FOR UPDATE USING (id::text = current_setting('app.tenant_id', true)) WITH CHECK (id::text = current_setting('app.tenant_id', true));
CREATE POLICY tenant_delete ON "Tenant" FOR DELETE USING (id::text = current_setting('app.tenant_id', true));
CREATE POLICY membership_read ON "Membership" FOR SELECT USING (
  "tenantId"::text = current_setting('app.tenant_id', true) OR (NULLIF(current_setting('app.tenant_id', true), '') IS NULL AND "userId"::text = current_setting('app.user_id', true))
);
CREATE POLICY membership_insert ON "Membership" FOR INSERT WITH CHECK ("tenantId"::text = current_setting('app.tenant_id', true));
CREATE POLICY membership_update ON "Membership" FOR UPDATE USING ("tenantId"::text = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId"::text = current_setting('app.tenant_id', true));
CREATE POLICY membership_delete ON "Membership" FOR DELETE USING ("tenantId"::text = current_setting('app.tenant_id', true));
CREATE POLICY invitation_scope ON "Invitation" USING ("tenantId"::text = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId"::text = current_setting('app.tenant_id', true));

-- Narrow pre-tenant lookup. Owned by the privileged migrator, never the app role.
-- Only a matching secret, email, unused state and expiry resolve a tenant.
CREATE FUNCTION resolve_invitation(secret_hash text, recipient_email text)
RETURNS TABLE("tenantId" uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i."tenantId" FROM public."Invitation" i
  WHERE i."tokenHash" = secret_hash AND i.email = recipient_email
    AND i."acceptedAt" IS NULL AND i."expiresAt" > CURRENT_TIMESTAMP
$$;
REVOKE ALL ON FUNCTION resolve_invitation(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_invitation(text, text) TO saha_app;

-- Existing deployments must provision this restricted role before migrations.
GRANT USAGE ON SCHEMA public TO saha_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "User", "AuthIdentity", "Session", "Tenant", "Membership", "Invitation" TO saha_app;
