import "reflect-metadata";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import request from "supertest";
import { randomUUID, randomBytes, createHmac } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { createApp } from "../src/app";
import { Database } from "../src/database/database.service";
import { ConversationEngine } from "../src/conversations/engine";
import { OutboundProcessor } from "../src/channels/outbound";
import {
  WhatsAppAdapter,
  type MetaSendInput,
} from "../src/channels/meta-adapter";
import { decrypt } from "../src/channels/crypto";
import { startConversationQueue } from "../src/conversations/queue";
import { startOutboundQueue } from "../src/channels/queue";

describe("Phase 4 real PostgreSQL Meta ingestion and delivery", () => {
  let app: INestApplication,
    db: Database,
    alice: ReturnType<typeof request.agent>,
    bob: ReturnType<typeof request.agent>,
    a: string,
    b: string,
    userA: string,
    connectionA: string,
    connectionB: string;
  const accountA = `${Date.now()}1`,
    accountB = `${Date.now()}2`,
    secret = "fixture-meta-app-secret",
    token = "fixture-access-token-only",
    origin = "http://localhost:3000";
  const oldEnv = { ...process.env };
  const envelope = (
    account: string,
    mid: string = randomUUID(),
    customer: string = randomUUID(),
    text = "hello",
    seconds = Math.floor(Date.now() / 1000),
  ) => ({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: account },
              messages: [
                {
                  id: mid,
                  from: customer,
                  type: "text",
                  text: { body: text },
                  timestamp: String(seconds),
                },
              ],
            },
          },
        ],
      },
    ],
  });
  const status = (mid: string, state = "read") => ({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: accountA },
              statuses: [
                {
                  id: mid,
                  status: state,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                },
              ],
            },
          },
        ],
      },
    ],
  });
  const post = (payload: unknown, signature?: string) => {
    const raw = JSON.stringify(payload);
    return request(app.getHttpServer())
      .post("/webhooks/meta")
      .set("Content-Type", "application/json")
      .set(
        "X-Hub-Signature-256",
        signature ??
          `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`,
      )
      .send(raw);
  };
  async function prepare(
    customer = randomUUID(),
    text = "hello",
    seconds = Math.floor(Date.now() / 1000),
  ) {
    const mid = randomUUID();
    await post(envelope(accountA, mid, customer, text, seconds)).expect(200);
    const turn = await db.forWorkerTenant(a, (tx) =>
      tx.conversationTurn.findFirstOrThrow({
        where: {
          tenantId: a,
          conversation: {
            messages: {
              some: { metadata: { path: ["providerMessageId"], equals: mid } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
    );
    await app.get(ConversationEngine).processTurn(turn.id);
    return db.forWorkerTenant(a, (tx) =>
      tx.outboundDelivery.findFirstOrThrow({
        where: { tenantId: a, message: { turnId: turn.id } },
      }),
    );
  }
  beforeAll(async () => {
    process.env.WEB_ORIGIN = origin;
    process.env.META_APP_SECRET = secret;
    process.env.META_VERIFY_TOKEN = "fixture-verification-token";
    process.env.CHANNEL_ENCRYPTION_KEYS = JSON.stringify({
      v1: randomBytes(32).toString("hex"),
    });
    process.env.CHANNEL_ENCRYPTION_KEY_VERSION = "v1";
    process.env.META_GRAPH_VERSION = "v25.0";
    process.env.META_LIVE_SEND_ENABLED = "true";
    app = await createApp();
    db = app.get(Database);
    alice = request.agent(app.getHttpServer());
    bob = request.agent(app.getHttpServer());
    for (const [agent, label] of [
      [alice, "A"],
      [bob, "B"],
    ] as const)
      await agent
        .post("/auth/register")
        .set("Origin", origin)
        .send({
          email: `meta-${label}-${randomUUID()}@example.com`,
          password: "phase four secure password",
          name: label,
          businessName: `Meta store ${label}`,
        })
        .expect(201);
    const me = (await alice.get("/auth/me")).body;
    a = me.tenants[0].id;
    userA = me.id;
    b = (await bob.get("/auth/me")).body.tenants[0].id;
    process.env.META_ACCOUNT_BINDINGS = JSON.stringify({
      [`WHATSAPP:${accountA}`]: a,
      [`WHATSAPP:${accountB}`]: b,
    });
    for (const [agent, tenant, account] of [
      [alice, a, accountA],
      [bob, b, accountB],
    ] as const) {
      const connected = (
        await agent
          .post(`/tenants/${tenant}/channels`)
          .set("Origin", origin)
          .send({
            channel: "WHATSAPP",
            providerAccountId: account,
            label: "Test WhatsApp",
            accessToken: token,
          })
          .expect(201)
      ).body;
      expect(JSON.stringify(connected)).not.toContain(token);
      expect(connected.enabled).toBe(false);
      if (tenant === a) connectionA = connected.id;
      else connectionB = connected.id;
      await agent
        .post(`/tenants/${tenant}/channels/${connected.id}`)
        .set("Origin", origin)
        .send({ enabled: true })
        .expect(201);
    }
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
    process.env = oldEnv;
  });
  it("checks verification challenges, exact signatures and narrowly exempts webhook POST from browser Origin", async () => {
    await request(app.getHttpServer())
      .get("/webhooks/meta")
      .query({
        "hub.mode": "subscribe",
        "hub.verify_token": "fixture-verification-token",
        "hub.challenge": "12345",
      })
      .expect(200, "12345");
    await request(app.getHttpServer())
      .get("/webhooks/meta")
      .query({
        "hub.mode": "subscribe",
        "hub.verify_token": "wrong",
        "hub.challenge": "12345",
      })
      .expect(403);
    await post(envelope(accountA), "sha256=" + "0".repeat(64)).expect(403);
    await request(app.getHttpServer())
      .post("/webhooks/meta")
      .send(envelope(accountA))
      .expect(403);
    await alice
      .post(`/tenants/${a}/channels/${connectionA}`)
      .send({ enabled: false })
      .expect(403);
    await post(envelope(accountA)).expect(200);
  });
  it("isolates tenant APIs, encrypted credentials, raw SQL, composite foreign keys and agent permissions", async () => {
    await alice.get(`/tenants/${b}/channels`).expect(403);
    await alice
      .post(`/tenants/${b}/channels/${connectionB}`)
      .set("Origin", origin)
      .send({ enabled: false })
      .expect(403);
    for (const table of [
      "ChannelConnection",
      "WebhookEvent",
      "OutboundDelivery",
    ])
      expect(
        await db.forTenant(userA, a, true, (tx) =>
          tx.$queryRawUnsafe(
            `SELECT * FROM "${table}" WHERE "tenantId"='${b}'`,
          ),
        ),
      ).toEqual([]);
    const stored = await db.forWorkerTenant(a, (tx) =>
      tx.channelConnection.findUniqueOrThrow({
        where: { tenantId_id: { tenantId: a, id: connectionA } },
      }),
    );
    expect(stored.encryptedCredentials).not.toContain(token);
    expect(
      JSON.parse(
        decrypt(stored.encryptedCredentials, `${a}:${connectionA}:credentials`),
      ),
    ).toEqual({ accessToken: token });
    await expect(
      db.forWorkerTenant(a, (tx) =>
        tx.webhookEvent.create({
          data: {
            tenantId: a,
            channelConnectionId: connectionB,
            dedupeKey: "forged",
            encryptedPayload: "x",
            providerMessageId: "x",
            occurredAt: new Date(),
          },
        }),
      ),
    ).rejects.toThrow();
    const bobUser = (await bob.get("/auth/me")).body.id;
    await db.forWorkerTenant(a, (tx) =>
      tx.membership.create({
        data: { tenantId: a, userId: bobUser, role: "AGENT" },
      }),
    );
    await bob.get(`/tenants/${a}/channels`).expect(403);
    await alice
      .post(`/tenants/${a}/channels`)
      .set("Origin", origin)
      .send({
        channel: "WHATSAPP",
        providerAccountId: accountB,
        label: "Unauthorized account",
        accessToken: token,
      })
      .expect(403);
    await alice
      .post(`/tenants/${a}/channels`)
      .set("Origin", origin)
      .send({
        channel: "WHATSAPP",
        providerAccountId: accountA,
        label: "Duplicate",
        accessToken: token,
      })
      .expect(409);
  });
  it("splits multi-tenant envelopes and deduplicates concurrent replays before queue dispatch", async () => {
    const one = envelope(accountA, "multi-a", "multi-customer-a"),
      two = envelope(accountB, "multi-b", "multi-customer-b");
    one.entry.push(...two.entry);
    await Promise.all([post(one).expect(200), post(one).expect(200)]);
    for (const [tenant, connection, mid, foreign] of [
      [a, connectionA, "multi-a", "multi-b"],
      [b, connectionB, "multi-b", "multi-a"],
    ]) {
      const events = await db.forWorkerTenant(tenant, (tx) =>
        tx.webhookEvent.findMany({
          where: { tenantId: tenant, providerMessageId: mid },
        }),
      );
      expect(events).toHaveLength(1);
      const event = events[0];
      const decrypted = decrypt(
        event.encryptedPayload,
        `${tenant}:${connection}:event:${event.dedupeKey}`,
      );
      expect(decrypted).not.toContain(foreign);
      const turns = await db.forWorkerTenant(tenant, (tx) =>
        tx.conversationTurn.findMany({
          where: {
            tenantId: tenant,
            conversation: {
              messages: {
                some: {
                  metadata: { path: ["providerMessageId"], equals: mid },
                },
              },
            },
          },
        }),
      );
      expect(turns).toHaveLength(1);
      await app.get(ConversationEngine).processTurn(turns[0].id);
      await app.get(ConversationEngine).processTurn(turns[0].id);
      expect(
        await db.forWorkerTenant(tenant, (tx) =>
          tx.outboundDelivery.count({
            where: { tenantId: tenant, message: { turnId: turns[0].id } },
          }),
        ),
      ).toBe(1);
    }
  });
  it("returns retryable failure on storage errors and creates no partial accepted receipt", async () => {
    const payload = envelope(accountA, "recoverable-mid");
    const keys = process.env.CHANNEL_ENCRYPTION_KEYS;
    process.env.CHANNEL_ENCRYPTION_KEYS = "{}";
    await post(payload).expect(500);
    process.env.CHANNEL_ENCRYPTION_KEYS = keys;
    expect(
      await db.forWorkerTenant(a, (tx) =>
        tx.webhookEvent.count({
          where: { tenantId: a, providerMessageId: "recoverable-mid" },
        }),
      ),
    ).toBe(0);
    await post(payload).expect(200);
    expect(
      await db.forWorkerTenant(a, (tx) =>
        tx.webhookEvent.count({
          where: { tenantId: a, providerMessageId: "recoverable-mid" },
        }),
      ),
    ).toBe(1);
  });
  it("routes Messenger and Instagram separately, ignores echoes and scopes Messenger read watermarks", async () => {
    const bindings = JSON.parse(process.env.META_ACCOUNT_BINDINGS!);
    for (const [channel, object, account] of [
      ["MESSENGER", "page", `${Date.now()}3`],
      ["INSTAGRAM", "instagram", `${Date.now()}4`],
    ]) {
      bindings[`${channel}:${account}`] = a;
      process.env.META_ACCOUNT_BINDINGS = JSON.stringify(bindings);
      const connection = (
        await alice
          .post(`/tenants/${a}/channels`)
          .set("Origin", origin)
          .send({
            channel,
            providerAccountId: account,
            label: channel,
            accessToken: token,
          })
          .expect(201)
      ).body;
      await alice
        .post(`/tenants/${a}/channels/${connection.id}`)
        .set("Origin", origin)
        .send({ enabled: true })
        .expect(201);
      const mid = randomUUID(),
        customer = "social-customer";
      const event = {
        sender: { id: customer },
        recipient: { id: account },
        timestamp: Date.now(),
        message: { mid, text: "hello" },
      };
      const payload = { object, entry: [{ id: account, messaging: [event] }] };
      await post(payload).expect(200);
      await post(payload).expect(200);
      await post({
        object,
        entry: [
          {
            id: account,
            messaging: [
              {
                ...event,
                message: { mid: randomUUID(), text: "echo", is_echo: true },
              },
            ],
          },
        ],
      }).expect(200);
      const turns = await db.forWorkerTenant(a, (tx) =>
        tx.conversationTurn.findMany({
          where: {
            tenantId: a,
            conversation: { channelConnectionId: connection.id },
          },
        }),
      );
      expect(turns).toHaveLength(1);
      await app.get(ConversationEngine).processTurn(turns[0].id);
      const reply = await db.forWorkerTenant(a, (tx) =>
        tx.chatMessage.findFirstOrThrow({
          where: { tenantId: a, turnId: turns[0].id },
        }),
      );
      expect(reply.metadata).toMatchObject({ channel });
      const delivery = await db.forWorkerTenant(a, (tx) =>
        tx.outboundDelivery.findFirstOrThrow({
          where: { tenantId: a, messageId: reply.id },
        }),
      );
      await db.forWorkerTenant(a, (tx) =>
        tx.outboundDelivery.update({
          where: { tenantId_id: { tenantId: a, id: delivery.id } },
          data: {
            state: "SENT",
            providerMessageId: randomUUID(),
            sentAt: new Date(Date.now() - 1000),
          },
        }),
      );
      if (channel === "MESSENGER") {
        await post({
          object,
          entry: [
            {
              id: account,
              messaging: [
                {
                  sender: { id: "foreign-customer" },
                  recipient: { id: account },
                  timestamp: Date.now(),
                  read: { watermark: Date.now() },
                },
              ],
            },
          ],
        }).expect(200);
        expect(
          await db.forWorkerTenant(a, (tx) =>
            tx.outboundDelivery.findUniqueOrThrow({
              where: { tenantId_id: { tenantId: a, id: delivery.id } },
            }),
          ),
        ).toMatchObject({ state: "SENT" });
        await post({
          object,
          entry: [
            {
              id: account,
              messaging: [
                {
                  sender: { id: customer },
                  recipient: { id: account },
                  timestamp: Date.now(),
                  read: { watermark: Date.now() },
                },
              ],
            },
          ],
        }).expect(200);
        expect(
          await db.forWorkerTenant(a, (tx) =>
            tx.outboundDelivery.findUniqueOrThrow({
              where: { tenantId_id: { tenantId: a, id: delivery.id } },
            }),
          ),
        ).toMatchObject({ state: "READ" });
      }
    }
  });
  it("reconciles early delivery receipts and ignores status regressions/replays", async () => {
    const delivery = await prepare(),
      processor = app.get(OutboundProcessor),
      adapter = new WhatsAppAdapter();
    const mock = vi.spyOn(adapter, "send").mockImplementation(async () => {
      await post(status("sent-early")).expect(200);
      return { state: "SENT", providerMessageId: "sent-early" };
    });
    await Promise.all([
      processor.process(delivery.id, adapter),
      processor.process(delivery.id, adapter),
    ]);
    expect(mock).toHaveBeenCalledTimes(1);
    await post(status("sent-early", "sent")).expect(200);
    await post(status("sent-early")).expect(200);
    expect(
      await db.forWorkerTenant(a, (tx) =>
        tx.outboundDelivery.findUniqueOrThrow({
          where: { tenantId_id: { tenantId: a, id: delivery.id } },
        }),
      ),
    ).toMatchObject({ state: "READ", attempts: 1 });
  });
  it("holds network ambiguity without a second send and surfaces a seller notification", async () => {
    const delivery = await prepare(),
      adapter = new WhatsAppAdapter(),
      processor = app.get(OutboundProcessor);
    const mock = vi.spyOn(adapter, "send").mockResolvedValue({
      state: "UNKNOWN",
      errorCode: "META_NETWORK_OUTCOME_UNKNOWN",
    });
    await processor.process(delivery.id, adapter);
    await processor.process(delivery.id, adapter);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(
      await db.forWorkerTenant(a, (tx) =>
        tx.outboundDelivery.findUniqueOrThrow({
          where: { tenantId_id: { tenantId: a, id: delivery.id } },
        }),
      ),
    ).toMatchObject({ state: "UNKNOWN", attempts: 1 });
    expect(
      (await alice.get(`/tenants/${a}/bot/notifications`)).body.some(
        (n: { reason: string }) => n.reason === "delivery_unknown",
      ),
    ).toBe(true);
  });
  it("processes multiple customer turns and sends replies in order, excluding future customer text from memory", async () => {
    const customer = randomUUID();
    await post(envelope(accountA, randomUUID(), customer, "hello")).expect(200);
    await post(envelope(accountA, randomUUID(), customer, "hi")).expect(200);
    const turns = await db.forWorkerTenant(a, (tx) =>
      tx.conversationTurn.findMany({
        where: {
          tenantId: a,
          conversation: {
            encryptedCustomerId: { not: null },
            messages: {
              some: {
                body: "hi",
                metadata: { path: ["channel"], equals: "WHATSAPP" },
              },
            },
          },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    );
    expect(turns).toHaveLength(2);
    const engine = app.get(ConversationEngine);
    await expect(engine.processTurn(turns[1].id)).rejects.toThrow(
      "INBOUND_ORDER_WAIT",
    );
    await engine.processTurn(turns[0].id);
    await engine.processTurn(turns[1].id);
    const replies = await db.forWorkerTenant(a, (tx) =>
      tx.chatMessage.findMany({
        where: {
          tenantId: a,
          conversationId: turns[0].conversationId,
          sender: "BOT",
        },
        orderBy: { createdAt: "asc" },
        include: { delivery: true },
      }),
    );
    expect(replies[0].metadata).toMatchObject({ memoryMessages: 1 });
    expect(replies[1].metadata).toMatchObject({ memoryMessages: 3 });
    const adapter = new WhatsAppAdapter(),
      mock = vi
        .spyOn(adapter, "send")
        .mockImplementation(async () => ({
          state: "SENT",
          providerMessageId: randomUUID(),
        })),
      processor = app.get(OutboundProcessor);
    await expect(
      processor.process(replies[1].delivery!.id, adapter),
    ).rejects.toThrow("OUTBOUND_ORDER_WAIT");
    expect(mock).not.toHaveBeenCalled();
    await processor.process(replies[0].delivery!.id, adapter);
    await processor.process(replies[1].delivery!.id, adapter);
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it("sends one handoff acknowledgement and creates no more bot deliveries in human mode", async () => {
    const customer = randomUUID();
    await prepare(customer, "human please");
    const mid = randomUUID();
    await post(envelope(accountA, mid, customer, "hello again")).expect(200);
    const turn = await db.forWorkerTenant(a, (tx) =>
      tx.conversationTurn.findFirstOrThrow({
        where: { tenantId: a, text: "hello again" },
      }),
    );
    await app.get(ConversationEngine).processTurn(turn.id);
    expect(
      await db.forWorkerTenant(a, (tx) =>
        tx.outboundDelivery.count({
          where: {
            tenantId: a,
            message: { conversationId: turn.conversationId },
          },
        }),
      ),
    ).toBe(1);
    expect(
      await db.forWorkerTenant(a, (tx) =>
        tx.conversationTurn.findUniqueOrThrow({
          where: { tenantId_id: { tenantId: a, id: turn.id } },
        }),
      ),
    ).toMatchObject({ status: "DONE" });
  });
  it("retries explicit rejection within a bounded budget and recovers interrupted sends as unknown", async () => {
    const delivery = await prepare(),
      processor = app.get(OutboundProcessor),
      adapter = new WhatsAppAdapter();
    vi.spyOn(adapter, "send").mockResolvedValue({
      state: "RETRY",
      errorCode: "META_RATE_LIMIT",
    });
    for (let i = 0; i < 3; i++) {
      await db.forWorkerTenant(a, (tx) =>
        tx.outboundDelivery.update({
          where: { tenantId_id: { tenantId: a, id: delivery.id } },
          data: { availableAt: new Date(0) },
        }),
      );
      await processor.process(delivery.id, adapter);
    }
    expect(
      await db.forWorkerTenant(a, (tx) =>
        tx.outboundDelivery.findUniqueOrThrow({
          where: { tenantId_id: { tenantId: a, id: delivery.id } },
        }),
      ),
    ).toMatchObject({ state: "FAILED", attempts: 3 });
    const interrupted = await prepare();
    await db.forWorkerTenant(a, (tx) =>
      tx.outboundDelivery.update({
        where: { tenantId_id: { tenantId: a, id: interrupted.id } },
        data: { state: "SENDING", updatedAt: new Date(Date.now() - 120000) },
      }),
    );
    await processor.recover(interrupted.id);
    expect(
      await db.forWorkerTenant(a, (tx) =>
        tx.outboundDelivery.findUniqueOrThrow({
          where: { tenantId_id: { tenantId: a, id: interrupted.id } },
        }),
      ),
    ).toMatchObject({ state: "UNKNOWN", errorCode: "WORKER_INTERRUPTED" });
  });
  it("checks reply windows, connection pause, human takeover and the global send switch at delivery time", async () => {
    const processor = app.get(OutboundProcessor),
      adapter = new WhatsAppAdapter(),
      mock = vi.spyOn(adapter, "send");
    const expired = await prepare(
      randomUUID(),
      "hello",
      Math.floor(Date.now() / 1000) - 86401,
    );
    await processor.process(expired.id, adapter);
    expect(
      await db.forWorkerTenant(a, (tx) =>
        tx.outboundDelivery.findUniqueOrThrow({
          where: { tenantId_id: { tenantId: a, id: expired.id } },
        }),
      ),
    ).toMatchObject({ state: "BLOCKED", errorCode: "REPLY_WINDOW_CLOSED" });
    const human = await prepare();
    await db.forWorkerTenant(a, async (tx) => {
      const message = await tx.chatMessage.findUniqueOrThrow({
        where: { tenantId_id: { tenantId: a, id: human.messageId } },
      });
      await tx.conversation.update({
        where: { tenantId_id: { tenantId: a, id: message.conversationId } },
        data: { mode: "HUMAN" },
      });
    });
    await processor.process(human.id, adapter);
    const paused = await prepare();
    await alice
      .post(`/tenants/${a}/channels/${connectionA}`)
      .set("Origin", origin)
      .send({ enabled: false })
      .expect(201);
    await processor.process(paused.id, adapter);
    await alice
      .post(`/tenants/${a}/channels/${connectionA}`)
      .set("Origin", origin)
      .send({ enabled: true })
      .expect(201);
    const switched = await prepare();
    process.env.META_LIVE_SEND_ENABLED = "false";
    await processor.process(switched.id, adapter);
    process.env.META_LIVE_SEND_ENABLED = "true";
    expect(mock).not.toHaveBeenCalled();
  });
  it.skipIf(!process.env.TEST_REDIS_URL)(
    "recovers persisted inbound/outbound work through real BullMQ with fixture sends",
    async () => {
      const redis = new URL(process.env.TEST_REDIS_URL!),
        connection = {
          host: redis.hostname,
          port: Number(redis.port || 6379),
          db: Number(redis.pathname.slice(1) || 0),
          maxRetriesPerRequest: null,
        },
        prefix = `meta${randomUUID()}`;
      const customer = randomUUID(),
        mid = randomUUID();
      await post(envelope(accountA, mid, customer)).expect(200);
      // Every provider operation in this queue test is intercepted; no real account/token is used.
      const mock = vi
        .spyOn(WhatsAppAdapter.prototype, "send")
        .mockImplementation(async (_input: MetaSendInput) => ({
          state: "SENT",
          providerMessageId: randomUUID(),
        }));
      const inbound = startConversationQueue(
          db,
          app.get(ConversationEngine),
          connection,
          prefix,
        ),
        outbound = startOutboundQueue(
          db,
          app.get(OutboundProcessor),
          connection,
          prefix,
        );
      try {
        const until = Date.now() + 12000;
        let sent = false;
        while (Date.now() < until) {
          sent = !!(await db.forWorkerTenant(a, (tx) =>
            tx.outboundDelivery.findFirst({
              where: {
                tenantId: a,
                state: "SENT",
                message: {
                  conversation: {
                    messages: {
                      some: {
                        metadata: { path: ["providerMessageId"], equals: mid },
                      },
                    },
                  },
                },
              },
            }),
          ));
          if (sent) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        expect(sent).toBe(true);
        expect(mock).toHaveBeenCalled();
      } finally {
        await inbound.close();
        await outbound.close();
        mock.mockRestore();
      }
    },
  );
});
