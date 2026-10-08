import "reflect-metadata";
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { Queue, Worker } from "bullmq";
import { randomUUID } from "node:crypto";
import { Database } from "../src/database/database.service";
import { TaskDispatcher } from "../src/queues/dispatcher";
import { TaskProcessor } from "../src/queues/task-processor";
import { WebsiteCrawler } from "../src/crawling/crawler";
import { SafeFetcher } from "../src/crawling/safe-fetch";
import { DevelopmentEmbeddingProvider } from "../src/embeddings/provider";
// CI always enables this against its isolated Redis service. Local runs explicitly report a skip without Redis.
describe.skipIf(!process.env.TEST_REDIS_URL)(
  "real BullMQ dispatch and worker",
  () => {
    let db: Database;
    let queues: { CRAWL: Queue; EMBED: Queue };
    let worker: Worker;
    let tenantId: string;
    let entryId: string;
    let taskId: string;
    const prefix = `phase2-${randomUUID()}`;
    beforeAll(async () => {
      db = new Database();
      await db.onModuleInit();
      const url = new URL(process.env.TEST_REDIS_URL!);
      const connection = {
        host: url.hostname,
        port: Number(url.port || 6379),
        maxRetriesPerRequest: null,
      };
      queues = {
        CRAWL: new Queue("saha-crawling", { connection, prefix }),
        EMBED: new Queue("saha-embedding", { connection, prefix }),
      };
      tenantId = randomUUID();
      entryId = randomUUID();
      const userId = randomUUID();
      await db.$transaction(async (tx) => {
        await tx.user.create({
          data: {
            id: userId,
            email: `queue-${userId}@example.com`,
            name: "Queue test",
          },
        });
        await tx.$executeRaw`SELECT set_config('app.tenant_id',${tenantId},true)`;
        await tx.tenant.create({
          data: { id: tenantId, name: "Queue test workspace" },
        });
        await tx.membership.create({
          data: { tenantId, userId, role: "OWNER" },
        });
        await tx.knowledgeEntry.create({
          data: {
            id: entryId,
            tenantId,
            title: "Delivery",
            draftContent: "Delivery in Colombo",
            approvedTitle: "Delivery",
            approvedContent: "Delivery in Colombo",
            approvedRevision: 1,
            reviewStatus: "APPROVED",
            embeddingStatus: "PENDING",
          },
        });
        taskId = (
          await tx.backgroundTask.create({
            data: {
              tenantId,
              kind: "EMBED",
              knowledgeEntryId: entryId,
              revision: 1,
            },
          })
        ).id;
      });
      const processor = new TaskProcessor(
        db,
        new WebsiteCrawler(new SafeFetcher()),
        new DevelopmentEmbeddingProvider(),
      );
      worker = new Worker(
        "saha-embedding",
        (job) => processor.process(job.data.taskId, job.attemptsMade >= 2),
        { connection, prefix },
      );
      worker.on("error", () => {});
    }, 30000);
    afterAll(async () => {
      if (worker) await worker.close();
      if (queues)
        for (const queue of Object.values(queues)) {
          await queue.obliterate({ force: true });
          await queue.close();
        }
      if (db) await db.$disconnect();
    });
    it("dispatches committed work with stable IDs and indexes it through a real Redis worker", async () => {
      const dispatcher = new TaskDispatcher(db, queues);
      await dispatcher.dispatch();
      await dispatcher.dispatch();
      const job = await queues.EMBED.getJob(taskId);
      expect(job?.data).toEqual({ taskId });
      await expect
        .poll(
          async () =>
            db
              .forWorkerTenant(tenantId, (tx) =>
                tx.knowledgeEntry.findUniqueOrThrow({
                  where: { tenantId_id: { tenantId, id: entryId } },
                }),
              )
              .then((e) => e.embeddingStatus),
          { timeout: 15000, interval: 100 },
        )
        .toBe("READY");
      expect(
        await db.forWorkerTenant(tenantId, (tx) =>
          tx.knowledgeChunk.count({
            where: { tenantId, knowledgeEntryId: entryId },
          }),
        ),
      ).toBe(1);
    }, 20000);
  },
);
