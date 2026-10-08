import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { z } from "zod";
import {
  knowledgeDraftSchema,
  approveKnowledgeSchema,
  websiteSchema,
} from "@saha/shared";
import { Database } from "../database/database.service";
import {
  DevelopmentEmbeddingProvider,
  vectorLiteral,
} from "../embeddings/provider";
import { publicWebsiteUrl, CrawlError } from "../crawling/safe-fetch";
@Injectable()
export class KnowledgeService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(DevelopmentEmbeddingProvider)
    private readonly embeddings: DevelopmentEmbeddingProvider,
  ) {}
  entries(userId: string, tenantId: string, page: number) {
    return this.db.forTenant(userId, tenantId, true, async (tx) => {
      const [items, total] = await Promise.all([
        tx.knowledgeEntry.findMany({
          where: { tenantId },
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
          take: 25,
          skip: (page - 1) * 25,
        }),
        tx.knowledgeEntry.count({ where: { tenantId } }),
      ]);
      return {
        items,
        total,
        page,
        pages: Math.max(1, Math.ceil(total / 25)),
        embeddingProvider: this.embeddings.model,
        development: true,
      };
    });
  }
  sources(userId: string, tenantId: string) {
    return this.db.forTenant(userId, tenantId, true, (tx) =>
      tx.knowledgeSource.findMany({
        where: { tenantId },
        include: { runs: { orderBy: { createdAt: "desc" }, take: 3 } },
        orderBy: { createdAt: "desc" },
      }),
    );
  }
  createManual(
    userId: string,
    tenantId: string,
    data: z.infer<typeof knowledgeDraftSchema>,
  ) {
    return this.db.forTenant(userId, tenantId, true, (tx) =>
      tx.knowledgeEntry.create({
        data: { tenantId, title: data.title, draftContent: data.content },
      }),
    );
  }
  save(
    userId: string,
    tenantId: string,
    id: string,
    data: z.infer<typeof approveKnowledgeSchema>,
    approve: boolean,
  ) {
    return this.db.forTenant(userId, tenantId, true, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}), 4)`;
      const entry = await tx.knowledgeEntry.findUnique({
        where: { tenantId_id: { tenantId, id } },
      });
      if (!entry) throw new NotFoundException("Knowledge entry not found.");
      const updated = await tx.knowledgeEntry.updateMany({
        where: { tenantId, id, version: data.version },
        data: {
          title: data.title,
          draftContent: data.content,
          version: { increment: 1 },
          reviewStatus: approve
            ? "APPROVED"
            : entry.approvedContent
              ? "CHANGES_PENDING"
              : "DRAFT",
          ...(approve
            ? {
                approvedTitle: data.title,
                approvedContent: data.content,
                approvedRevision: { increment: 1 },
                embeddingStatus: "PENDING",
              }
            : {}),
        },
      });
      if (!updated.count)
        throw new ConflictException(
          "This entry changed since you opened it. Reload it before saving.",
        );
      const saved = await tx.knowledgeEntry.findUniqueOrThrow({
        where: { tenantId_id: { tenantId, id } },
      });
      if (approve)
        await tx.backgroundTask.create({
          data: {
            tenantId,
            kind: "EMBED",
            knowledgeEntryId: id,
            revision: saved.approvedRevision,
          },
        });
      return saved;
    });
  }
  remove(userId: string, tenantId: string, id: string) {
    return this.db.forTenant(userId, tenantId, true, async (tx) => {
      if (
        !(await tx.knowledgeEntry.deleteMany({ where: { tenantId, id } })).count
      )
        throw new NotFoundException("Entry not found.");
      return { ok: true };
    });
  }
  private async schedule(userId: string, tenantId: string, sourceId: string) {
    return this.db.forTenant(userId, tenantId, true, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), 3)`;
      const source = await tx.knowledgeSource.findUnique({
        where: { tenantId_id: { tenantId, id: sourceId } },
      });
      if (!source) throw new NotFoundException("Website source not found.");
      const active = await tx.crawlRun.findFirst({
        where: {
          tenantId,
          knowledgeSourceId: sourceId,
          status: { in: ["QUEUED", "RUNNING"] },
        },
      });
      if (active) return active;
      const run = await tx.crawlRun.create({
        data: { tenantId, knowledgeSourceId: sourceId },
      });
      await tx.backgroundTask.create({
        data: { tenantId, kind: "CRAWL", crawlRunId: run.id },
      });
      return run;
    });
  }
  async addWebsite(
    userId: string,
    tenantId: string,
    data: z.infer<typeof websiteSchema>,
  ) {
    let url: URL;
    try {
      url = publicWebsiteUrl(data.url);
    } catch (error) {
      if (error instanceof CrawlError)
        throw new BadRequestException(
          "Use a public website. Private and local network addresses are not allowed.",
        );
      throw error;
    }
    url.hash = "";
    url.search = "";
    const source = await this.db.forTenant(
      userId,
      tenantId,
      true,
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), 3)`;
        const existing = await tx.knowledgeSource.findUnique({
          where: { tenantId_url: { tenantId, url: url.href } },
        });
        if (existing) return existing;
        if ((await tx.knowledgeSource.count({ where: { tenantId } })) >= 10)
          throw new BadRequestException(
            "A workspace supports up to 10 website sources in this version.",
          );
        return tx.knowledgeSource.create({
          data: { tenantId, ...data, url: url.href },
        });
      },
    );
    const run = await this.schedule(userId, tenantId, source.id);
    return { source, run };
  }
  recrawl(userId: string, tenantId: string, sourceId: string) {
    return this.schedule(userId, tenantId, sourceId);
  }
  async retrieve(
    userId: string,
    tenantId: string,
    query: string,
    limit: number,
  ) {
    const vector = vectorLiteral(
      await this.embeddings.embed(query),
      this.embeddings.dimensions,
    );
    return this.db.forTenant(userId, tenantId, true, async (tx) => ({
      development: true,
      provider: this.embeddings.model,
      matches: await tx.$queryRaw<
        {
          id: string;
          knowledgeEntryId: string;
          title: string;
          content: string;
          sourceUrl: string | null;
          score: number;
        }[]
      >`
      SELECT c.id, c."knowledgeEntryId", e."approvedTitle" AS title, c.content, e."sourceUrl",
        (1 - (c.embedding <=> ${vector}::vector))::float8 AS score
      FROM "KnowledgeChunk" c JOIN "KnowledgeEntry" e ON e."tenantId"=c."tenantId" AND e.id=c."knowledgeEntryId"
      WHERE c."tenantId"=${tenantId}::uuid AND e."tenantId"=${tenantId}::uuid
        AND c.revision=e."approvedRevision" AND e."approvedContent" IS NOT NULL AND e."embeddingStatus"='READY'
        AND c."embeddingModel"=${this.embeddings.model} AND c."embeddingVersion"=${this.embeddings.version}
      ORDER BY c.embedding <=> ${vector}::vector, c.id LIMIT ${limit}
    `,
    }));
  }
}
