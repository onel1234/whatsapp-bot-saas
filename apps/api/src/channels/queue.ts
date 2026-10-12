import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { Database } from "../database/database.service";
import { OutboundProcessor } from "./outbound";
export function startOutboundQueue(
  db: Database,
  processor: OutboundProcessor,
  connection: ConnectionOptions,
  prefix = "bull",
) {
  const queue = new Queue("saha-outbound", { connection, prefix });
  const worker = new Worker<{ deliveryId: string }>(
    queue.name,
    (job) => processor.process(job.data.deliveryId),
    { connection, prefix, concurrency: 2, lockDuration: 60000 },
  );
  queue.on("error", () => {});
  worker.on("error", () => {});
  let running = false;
  const dispatch = async () => {
    if (running) return;
    running = true;
    try {
      const stale = await db.$queryRaw<
        { id: string }[]
      >`SELECT * FROM stale_outbound_deliveries(100)`;
      for (const delivery of stale) await processor.recover(delivery.id);
      if (process.env.META_LIVE_SEND_ENABLED !== "true") return;
      const pending = await db.$queryRaw<
        { id: string }[]
      >`SELECT * FROM pending_outbound_deliveries(100)`;
      for (const delivery of pending) {
        const job = await queue.getJob(delivery.id);
        if (job) {
          const state = await job.getState();
          if (["failed", "completed"].includes(state)) await job.remove();
          else continue;
        }
        await queue.add(
          "send",
          { deliveryId: delivery.id },
          {
            jobId: delivery.id,
            attempts: 3,
            backoff: { type: "exponential", delay: 2000 },
            removeOnComplete: { age: 3600, count: 1000 },
            removeOnFail: { age: 86400, count: 1000 },
          },
        );
      }
    } catch {
      /* Durable rows remain pending; no request bodies or credentials are logged. */
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void dispatch(), 2000);
  void dispatch();
  return {
    queue,
    dispatch,
    close: async () => {
      clearInterval(timer);
      await worker.close();
      await queue.close();
    },
  };
}
