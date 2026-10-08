import { Queue, Worker } from "bullmq";
import type { ConnectionOptions } from "bullmq";
import { Database } from "../database/database.service";
import { ConversationEngine } from "./engine";
export function startConversationQueue(
  db: Database,
  engine: ConversationEngine,
  connection: ConnectionOptions,
  prefix = "bull",
) {
  const queue = new Queue("saha-inbound", { connection, prefix });
  const worker = new Worker<{ turnId: string }>(
    queue.name,
    (job) => engine.processTurn(job.data.turnId),
    { connection, prefix, concurrency: 2, lockDuration: 60000 },
  );
  queue.on("error", () => {});
  worker.on("error", () => {});
  let running = false;
  const dispatch = async () => {
    if (running) return;
    running = true;
    try {
      const turns = await db.$queryRaw<
        { id: string }[]
      >`SELECT * FROM pending_conversation_turns(100)`;
      for (const turn of turns) {
        const job = await queue.getJob(turn.id);
        if (
          job &&
          (await job.getState()) === "failed" &&
          Date.now() - (job.finishedOn ?? 0) > 60_000
        )
          await job.retry();
        else if (!job)
          await queue.add(
            "message",
            { turnId: turn.id },
            {
              jobId: turn.id,
              attempts: 3,
              backoff: { type: "exponential", delay: 2000 },
              removeOnComplete: { age: 3600, count: 1000 },
              removeOnFail: { age: 86400, count: 1000 },
            },
          );
      }
    } catch {
      /* Persisted receipts survive broker/database outages. */
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void dispatch(), 2000);
  void dispatch();
  return {
    queue,
    close: async () => {
      clearInterval(timer);
      await worker.close();
      await queue.close();
    },
  };
}
