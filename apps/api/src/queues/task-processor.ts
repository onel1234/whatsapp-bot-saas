import { Inject, Injectable } from "@nestjs/common";
import { randomUUID, createHash } from "node:crypto";
import { Database } from "../database/database.service";
import { WebsiteCrawler } from "../crawling/crawler";
import { CrawlError } from "../crawling/safe-fetch";
import {
  DevelopmentEmbeddingProvider,
  chunkText,
  vectorLiteral,
} from "../embeddings/provider";
@Injectable()
export class TaskProcessor {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(WebsiteCrawler) private readonly crawler: WebsiteCrawler,
    @Inject(DevelopmentEmbeddingProvider)
    private readonly embeddings: DevelopmentEmbeddingProvider,
  ) {}
  async process(taskId: string, finalAttempt = false) {
    // The broker carries only a task ID. Resolve tenancy from its database record.
    const routes = await this.db.$queryRaw<
      { tenantId: string }[]
    >`SELECT * FROM resolve_background_task(${taskId}::uuid)`;
    if (!routes[0]) return;
    const tenantId = routes[0].tenantId;
    const task = await this.db.forWorkerTenant(tenantId, async (tx) => {
      const found = await tx.backgroundTask.findUnique({
        where: { tenantId_id: { tenantId, id: taskId } },
      });
      if (!found || found.status === "SUCCEEDED" || found.status === "FAILED")
        return null;
      return tx.backgroundTask.update({
        where: { tenantId_id: { tenantId, id: taskId } },
        data: {
          status: "RUNNING",
          attempts: { increment: 1 },
          errorCode: null,
        },
      });
    });
    if (!task) return;
    try {
      if (task.kind === "CRAWL" && task.crawlRunId)
        await this.crawl(tenantId, task.crawlRunId);
      else if (task.kind === "EMBED" && task.knowledgeEntryId && task.revision)
        await this.embed(tenantId, task.knowledgeEntryId, task.revision);
      else throw new CrawlError("INVALID_TASK");
      await this.db.forWorkerTenant(tenantId, (tx) =>
        tx.backgroundTask.updateMany({
          where: { tenantId, id: taskId },
          data: { status: "SUCCEEDED", errorCode: null },
        }),
      );
    } catch (error) {
      const code =
        error instanceof CrawlError ? error.code : "PROCESSING_FAILED";
      await this.db.forWorkerTenant(tenantId, async (tx) => {
        await tx.backgroundTask.updateMany({
          where: { tenantId, id: taskId },
          data: {
            status: finalAttempt ? "FAILED" : "DISPATCHED",
            errorCode: code,
          },
        });
        if (task.crawlRunId)
          await tx.crawlRun.updateMany({
            where: { tenantId, id: task.crawlRunId },
            data: {
              status: finalAttempt ? "FAILED" : "QUEUED",
              errorCode: code,
              finishedAt: finalAttempt ? new Date() : null,
            },
          });
        if (task.knowledgeEntryId && finalAttempt)
          await tx.knowledgeEntry.updateMany({
            where: {
              tenantId,
              id: task.knowledgeEntryId,
              approvedRevision: task.revision ?? -1,
            },
            data: { embeddingStatus: "FAILED" },
          });
      });
      throw new CrawlError(code);
    }
  }
  private async crawl(tenantId: string, runId: string) {
    const run = await this.db.forWorkerTenant(tenantId, async (tx) => {
      const run = await tx.crawlRun.findUniqueOrThrow({
        where: { tenantId_id: { tenantId, id: runId } },
        include: { source: true },
      });
      if (run.status === "COMPLETED") return null;
      await tx.crawlRun.update({
        where: { tenantId_id: { tenantId, id: runId } },
        data: {
          status: "RUNNING",
          startedAt: new Date(),
          errorCode: null,
          pageCount: 0,
          skippedCount: 0,
        },
      });
      return run;
    });
    if (!run) return;
    const result = await this.crawler.crawl(run.source, async (page) => {
      const hash = createHash("sha256")
        .update(page.title + "\n" + page.content)
        .digest("hex");
      await this.db.forWorkerTenant(tenantId, async (tx) => {
        const existing = await tx.knowledgeEntry.findUnique({
          where: {
            tenantId_knowledgeSourceId_sourceUrl: {
              tenantId,
              knowledgeSourceId: run.knowledgeSourceId,
              sourceUrl: page.url,
            },
          },
        });
        if (!existing)
          await tx.knowledgeEntry.create({
            data: {
              tenantId,
              knowledgeSourceId: run.knowledgeSourceId,
              sourceUrl: page.url,
              title: page.title,
              draftContent: page.content,
              sourceContentHash: hash,
            },
          });
        else if (existing.sourceContentHash !== hash)
          await tx.knowledgeEntry.update({
            where: { tenantId_id: { tenantId, id: existing.id } },
            data: {
              title: page.title,
              draftContent: page.content,
              sourceContentHash: hash,
              version: { increment: 1 },
              reviewStatus: existing.approvedContent
                ? "CHANGES_PENDING"
                : "DRAFT",
            },
          });
        await tx.crawlRun.update({
          where: { tenantId_id: { tenantId, id: runId } },
          data: { pageCount: { increment: 1 } },
        });
      });
    });
    await this.db.forWorkerTenant(tenantId, (tx) =>
      tx.crawlRun.update({
        where: { tenantId_id: { tenantId, id: runId } },
        data: {
          status: "COMPLETED",
          ...result,
          errorCode: result.skippedCount ? "PARTIAL_CRAWL" : null,
          finishedAt: new Date(),
        },
      }),
    );
  }
  private async embed(tenantId: string, entryId: string, revision: number) {
    const entry = await this.db.forWorkerTenant(tenantId, (tx) =>
      tx.knowledgeEntry.findUnique({
        where: { tenantId_id: { tenantId, id: entryId } },
      }),
    );
    if (!entry?.approvedContent || entry.approvedRevision !== revision) return; // Stale task can never replace a newer approval.
    const chunks = chunkText(
      `${entry.approvedTitle}\n${entry.approvedContent}`,
    );
    const vectors = await Promise.all(
      chunks.map((chunk) => this.embeddings.embed(chunk)),
    );
    await this.db.forWorkerTenant(tenantId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${entryId}), 4)`;
      const current = await tx.knowledgeEntry.findUnique({
        where: { tenantId_id: { tenantId, id: entryId } },
      });
      if (current?.approvedRevision !== revision) return;
      await tx.knowledgeChunk.deleteMany({
        where: { tenantId, knowledgeEntryId: entryId },
      });
      for (let ordinal = 0; ordinal < chunks.length; ordinal++) {
        const vector = vectorLiteral(
          vectors[ordinal],
          this.embeddings.dimensions,
        );
        const id = randomUUID();
        await tx.$executeRaw`INSERT INTO "KnowledgeChunk" (id,"tenantId","knowledgeEntryId",revision,ordinal,content,"embeddingModel","embeddingVersion",embedding)
          VALUES (${id}::uuid,${tenantId}::uuid,${entryId}::uuid,${revision},${ordinal},${chunks[ordinal]},${this.embeddings.model},${this.embeddings.version},${vector}::vector)`;
      }
      await tx.knowledgeEntry.update({
        where: { tenantId_id: { tenantId, id: entryId } },
        data: { embeddingStatus: "READY" },
      });
    });
  }
}
