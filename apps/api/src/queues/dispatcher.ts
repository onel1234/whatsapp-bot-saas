import type { Queue } from "bullmq";
import { Database } from "../database/database.service";
export type TaskQueues = Record<"CRAWL" | "EMBED", Queue>;
export class TaskDispatcher {
  private running = false;
  constructor(
    private readonly db: Database,
    private readonly queues: TaskQueues,
  ) {}
  async dispatch() {
    if (this.running) return;
    this.running = true;
    try {
      const tasks = await this.db.$queryRaw<
        { id: string; tenantId: string; kind: "CRAWL" | "EMBED" }[]
      >`SELECT * FROM pending_background_tasks(100)`;
      for (const task of tasks) {
        const queue = this.queues[task.kind];
        const existing = await queue.getJob(task.id);
        if (existing && (await existing.getState()) === "failed") {
          await this.db.forWorkerTenant(task.tenantId, async (tx) => {
            const failed = await tx.backgroundTask.findUnique({
              where: { tenantId_id: { tenantId: task.tenantId, id: task.id } },
            });
            if (!failed || ["FAILED", "SUCCEEDED"].includes(failed.status))
              return;
            await tx.backgroundTask.update({
              where: { tenantId_id: { tenantId: task.tenantId, id: task.id } },
              data: { status: "FAILED", errorCode: "QUEUE_FAILED" },
            });
            if (failed.crawlRunId)
              await tx.crawlRun.updateMany({
                where: {
                  tenantId: task.tenantId,
                  id: failed.crawlRunId,
                  status: { not: "COMPLETED" },
                },
                data: {
                  status: "FAILED",
                  errorCode: "QUEUE_FAILED",
                  finishedAt: new Date(),
                },
              });
            if (failed.knowledgeEntryId)
              await tx.knowledgeEntry.updateMany({
                where: {
                  tenantId: task.tenantId,
                  id: failed.knowledgeEntryId,
                  approvedRevision: failed.revision ?? -1,
                },
                data: { embeddingStatus: "FAILED" },
              });
          });
          continue;
        }
        if (!existing)
          await queue.add(
            task.kind.toLowerCase(),
            { taskId: task.id },
            {
              jobId: task.id,
              attempts: 3,
              backoff: { type: "exponential", delay: 2000 },
              removeOnComplete: { age: 3600, count: 1000 },
              removeOnFail: { age: 86400, count: 1000 },
            },
          );
        await this.db.forWorkerTenant(task.tenantId, (tx) =>
          tx.backgroundTask.updateMany({
            where: {
              tenantId: task.tenantId,
              id: task.id,
              status: { in: ["PENDING", "DISPATCHED"] },
            },
            data: { status: "DISPATCHED", updatedAt: new Date() },
          }),
        );
      }
    } finally {
      this.running = false;
    }
  }
}
