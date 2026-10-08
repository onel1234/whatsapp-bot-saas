CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('DRAFT', 'APPROVED', 'CHANGES_PENDING');

-- CreateEnum
CREATE TYPE "EmbeddingStatus" AS ENUM ('NONE', 'PENDING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "CrawlStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "TaskKind" AS ENUM ('CRAWL', 'EMBED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'DISPATCHED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameSi" TEXT NOT NULL DEFAULT '',
    "nameTa" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "priceMinor" INTEGER NOT NULL,
    "stock" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeSource" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "pageLimit" INTEGER NOT NULL DEFAULT 20,
    "depthLimit" INTEGER NOT NULL DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlRun" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "knowledgeSourceId" UUID NOT NULL,
    "status" "CrawlStatus" NOT NULL DEFAULT 'QUEUED',
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "CrawlRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeEntry" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "knowledgeSourceId" UUID,
    "sourceUrl" TEXT,
    "sourceContentHash" TEXT,
    "title" TEXT NOT NULL,
    "draftContent" TEXT NOT NULL,
    "approvedTitle" TEXT,
    "approvedContent" TEXT,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "approvedRevision" INTEGER NOT NULL DEFAULT 0,
    "embeddingStatus" "EmbeddingStatus" NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "knowledgeEntryId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embeddingModel" TEXT NOT NULL,
    "embeddingVersion" TEXT NOT NULL,
    "embedding" vector(64) NOT NULL,

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackgroundTask" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kind" "TaskKind" NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "crawlRunId" UUID,
    "knowledgeEntryId" UUID,
    "revision" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackgroundTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_tenantId_id_key" ON "Product"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Product_tenantId_sku_key" ON "Product"("tenantId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_tenantId_id_key" ON "ProductVariant"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_tenantId_sku_key" ON "ProductVariant"("tenantId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeSource_tenantId_id_key" ON "KnowledgeSource"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeSource_tenantId_url_key" ON "KnowledgeSource"("tenantId", "url");

-- CreateIndex
CREATE UNIQUE INDEX "CrawlRun_tenantId_id_key" ON "CrawlRun"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeEntry_tenantId_id_key" ON "KnowledgeEntry"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeEntry_tenantId_knowledgeSourceId_sourceUrl_key" ON "KnowledgeEntry"("tenantId", "knowledgeSourceId", "sourceUrl");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeChunk_tenantId_id_key" ON "KnowledgeChunk"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeChunk_tenantId_knowledgeEntryId_revision_ordinal_key" ON "KnowledgeChunk"("tenantId", "knowledgeEntryId", "revision", "ordinal");

-- CreateIndex
CREATE INDEX "BackgroundTask_status_createdAt_idx" ON "BackgroundTask"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BackgroundTask_tenantId_id_key" ON "BackgroundTask"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BackgroundTask_tenantId_crawlRunId_key" ON "BackgroundTask"("tenantId", "crawlRunId");

-- CreateIndex
CREATE UNIQUE INDEX "BackgroundTask_tenantId_knowledgeEntryId_revision_key" ON "BackgroundTask"("tenantId", "knowledgeEntryId", "revision");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "Product"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlRun" ADD CONSTRAINT "CrawlRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlRun" ADD CONSTRAINT "CrawlRun_tenantId_knowledgeSourceId_fkey" FOREIGN KEY ("tenantId", "knowledgeSourceId") REFERENCES "KnowledgeSource"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeEntry" ADD CONSTRAINT "KnowledgeEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeEntry" ADD CONSTRAINT "KnowledgeEntry_tenantId_knowledgeSourceId_fkey" FOREIGN KEY ("tenantId", "knowledgeSourceId") REFERENCES "KnowledgeSource"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_tenantId_knowledgeEntryId_fkey" FOREIGN KEY ("tenantId", "knowledgeEntryId") REFERENCES "KnowledgeEntry"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackgroundTask" ADD CONSTRAINT "BackgroundTask_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackgroundTask" ADD CONSTRAINT "BackgroundTask_tenantId_crawlRunId_fkey" FOREIGN KEY ("tenantId", "crawlRunId") REFERENCES "CrawlRun"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackgroundTask" ADD CONSTRAINT "BackgroundTask_tenantId_knowledgeEntryId_fkey" FOREIGN KEY ("tenantId", "knowledgeEntryId") REFERENCES "KnowledgeEntry"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductVariant" ADD CONSTRAINT "variant_price_stock_bounds" CHECK ("priceMinor" BETWEEN 0 AND 999999999 AND stock BETWEEN 0 AND 1000000);
ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "crawl_bounds" CHECK ("pageLimit" BETWEEN 1 AND 50 AND "depthLimit" BETWEEN 0 AND 3);
ALTER TABLE "KnowledgeEntry" ADD CONSTRAINT "revision_bounds" CHECK (version >= 1 AND "approvedRevision" >= 0);
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "chunk_bounds" CHECK (revision >= 1 AND ordinal >= 0);
ALTER TABLE "BackgroundTask" ADD CONSTRAINT "task_shape" CHECK (
  (kind = 'CRAWL' AND "crawlRunId" IS NOT NULL AND "knowledgeEntryId" IS NULL AND revision IS NULL)
  OR (kind = 'EMBED' AND "crawlRunId" IS NULL AND "knowledgeEntryId" IS NOT NULL AND revision >= 1)
);

DO $$ DECLARE business_table text; BEGIN
  FOREACH business_table IN ARRAY ARRAY['Product','ProductVariant','KnowledgeSource','CrawlRun','KnowledgeEntry','KnowledgeChunk','BackgroundTask'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',business_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',business_table);
    EXECUTE format('CREATE POLICY tenant_scope ON %I USING ("tenantId"::text = current_setting(''app.tenant_id'',true)) WITH CHECK ("tenantId"::text = current_setting(''app.tenant_id'',true))',business_table);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO saha_app',business_table);
  END LOOP;
END $$;

-- Worker routing reads only task metadata. Business payloads still require tenant context.
CREATE FUNCTION resolve_background_task(task_id uuid) RETURNS TABLE("tenantId" uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT t."tenantId" FROM public."BackgroundTask" t WHERE t.id = task_id
$$;
CREATE FUNCTION pending_background_tasks(batch_size integer) RETURNS TABLE(id uuid,"tenantId" uuid,kind "TaskKind")
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT t.id,t."tenantId",t.kind FROM public."BackgroundTask" t
  WHERE t.status IN ('PENDING','DISPATCHED','RUNNING')
  ORDER BY t."updatedAt",t.id LIMIT LEAST(GREATEST(batch_size,1),100)
$$;
REVOKE ALL ON FUNCTION resolve_background_task(uuid), pending_background_tasks(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_background_task(uuid), pending_background_tasks(integer) TO saha_app;
