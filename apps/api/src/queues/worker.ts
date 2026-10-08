import "reflect-metadata";
import "dotenv/config";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Queue, Worker } from "bullmq";
import { DatabaseModule } from "../database/database.module";
import { Database } from "../database/database.service";
import { DevelopmentEmbeddingProvider } from "../embeddings/provider";
import { SafeFetcher } from "../crawling/safe-fetch";
import { WebsiteCrawler } from "../crawling/crawler";
import { TaskProcessor } from "./task-processor";
import { TaskDispatcher } from "./dispatcher";
import { ConversationModule } from "../conversations/module";
import { ConversationEngine } from "../conversations/engine";
import { startConversationQueue } from "../conversations/queue";
@Module({
  imports: [DatabaseModule, ConversationModule],
  providers: [
    DevelopmentEmbeddingProvider,
    SafeFetcher,
    WebsiteCrawler,
    TaskProcessor,
  ],
})
class WorkerModule {}
async function main() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_DEVELOPMENT_LLM !== "true"
  )
    throw new Error(
      "Only the development LLM is implemented. Approve a production provider before launch.",
    );
  if (!process.env.REDIS_URL)
    throw new Error("REDIS_URL is required for the worker.");
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ["error", "warn"],
  });
  const db = app.get(Database);
  const processor = app.get(TaskProcessor);
  const redis = new URL(process.env.REDIS_URL);
  const connection = {
    host: redis.hostname,
    port: Number(redis.port || 6379),
    username: redis.username || undefined,
    password: redis.password || undefined,
    db: Number(redis.pathname.slice(1) || 0),
    ...(redis.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
  const queues = {
    CRAWL: new Queue("saha-crawling", { connection }),
    EMBED: new Queue("saha-embedding", { connection }),
  };
  const inbound = startConversationQueue(
    db,
    app.get(ConversationEngine),
    connection,
  );
  const workers = Object.entries(queues).map(
    ([_kind, queue]) =>
      new Worker<{ taskId: string }>(
        queue.name,
        (job) =>
          processor.process(
            job.data.taskId,
            job.attemptsMade >= (job.opts.attempts ?? 3) - 1,
          ),
        { connection, concurrency: 2, lockDuration: 60000 },
      ),
  );
  let stopping = false;
  const dispatcher = new TaskDispatcher(db, queues);
  for (const queue of Object.values(queues)) queue.on("error", () => {});
  for (const worker of workers) worker.on("error", () => {});
  async function dispatch() {
    if (stopping) return;
    try {
      await dispatcher.dispatch();
    } catch {
      /* Durable tasks are retried on the next tick. Never log secrets. */
    }
  }
  const interval = setInterval(() => void dispatch(), 2000);
  void dispatch();
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    clearInterval(interval);
    await inbound.close();
    await Promise.all(workers.map((worker) => worker.close()));
    await Promise.all(Object.values(queues).map((queue) => queue.close()));
    await app.close();
  }
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}
void main();
