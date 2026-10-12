import {
  Injectable,
  Inject,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { Database } from "../database/database.service";
import { ConversationService } from "../conversations/service";
import { encrypt } from "./crypto";
import { metaChannel, type MetaEvent, advanceDelivery } from "./meta-adapter";

export const connectionSchema = z
  .object({
    channel: metaChannel,
    providerAccountId: z.string().regex(/^\d{1,40}$/),
    label: z.string().trim().min(1).max(80),
    accessToken: z.string().trim().min(10).max(4096),
    instagramLogin: z.enum(["INSTAGRAM", "FACEBOOK"]).default("INSTAGRAM"),
  })
  .strict();
export const updateConnectionSchema = z
  .object({
    enabled: z.boolean(),
    accessToken: z.string().trim().min(10).max(4096).optional(),
  })
  .strict();
export const connectionSelect = {
  id: true,
  channel: true,
  providerAccountId: true,
  label: true,
  enabled: true,
  instagramLogin: true,
  updatedAt: true,
} as const;
export const identityHash = (connectionId: string, customerId: string) =>
  createHash("sha256").update(`${connectionId}:${customerId}`).digest("hex");
export function accountBound(
  channel: string,
  accountId: string,
  tenantId: string,
) {
  const bindings = z
    .record(z.string().uuid())
    .parse(JSON.parse(process.env.META_ACCOUNT_BINDINGS ?? "{}"));
  return bindings[`${channel}:${accountId}`] === tenantId;
}
@Injectable()
export class ChannelService {
  constructor(
    @Inject(Database) private db: Database,
    @Inject(ConversationService) private conversations: ConversationService,
  ) {}
  list(userId: string, tenantId: string) {
    return this.db.forTenant(userId, tenantId, true, async (tx) => ({
      connections: await tx.channelConnection.findMany({
        where: { tenantId },
        select: connectionSelect,
        orderBy: { createdAt: "desc" },
      }),
      liveSendingEnabled: process.env.META_LIVE_SEND_ENABLED === "true",
      webhookConfigured:
        !!process.env.META_APP_SECRET && !!process.env.META_VERIFY_TOKEN,
    }));
  }
  async create(
    userId: string,
    tenantId: string,
    input: z.infer<typeof connectionSchema>,
  ) {
    const id = randomUUID();
    try {
      return await this.db.forTenant(userId, tenantId, true, async (tx) => {
        if (!accountBound(input.channel, input.providerAccountId, tenantId))
          throw new ForbiddenException(
            "Ask your server administrator to authorize this account for your workspace before connecting it.",
          );
        const tenant = await tx.tenant.findUniqueOrThrow({
          where: { id: tenantId },
        });
        await tx.botConfig.upsert({
          where: { tenantId },
          create: {
            tenantId,
            settings: this.conversations.defaults(tenant.name),
          },
          update: {},
        });
        return tx.channelConnection.create({
          data: {
            id,
            tenantId,
            channel: input.channel,
            providerAccountId: input.providerAccountId,
            label: input.label,
            instagramLogin: input.instagramLogin,
            encryptedCredentials: encrypt(
              JSON.stringify({ accessToken: input.accessToken }),
              `${tenantId}:${id}:credentials`,
            ),
          },
          select: connectionSelect,
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException("This account is already connected.");
      throw error;
    }
  }
  update(
    userId: string,
    tenantId: string,
    id: string,
    input: z.infer<typeof updateConnectionSchema>,
  ) {
    return this.db.forTenant(userId, tenantId, true, async (tx) => {
      const found = await tx.channelConnection.findUnique({
        where: { tenantId_id: { tenantId, id } },
      });
      if (!found) throw new NotFoundException("Connection unavailable.");
      if (
        input.enabled &&
        !accountBound(found.channel, found.providerAccountId, tenantId)
      )
        throw new ForbiddenException(
          "This account is not authorized for your workspace.",
        );
      return tx.channelConnection.update({
        where: { tenantId_id: { tenantId, id } },
        data: {
          enabled: input.enabled,
          ...(input.accessToken
            ? {
                encryptedCredentials: encrypt(
                  JSON.stringify({ accessToken: input.accessToken }),
                  `${tenantId}:${id}:credentials`,
                ),
              }
            : {}),
        },
        select: connectionSelect,
      });
    });
  }
  deliveries(userId: string, tenantId: string) {
    return this.db.forTenant(userId, tenantId, true, (tx) =>
      tx.outboundDelivery.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          state: true,
          errorCode: true,
          attempts: true,
          createdAt: true,
          providerMessageId: true,
          connection: { select: { label: true, channel: true } },
        },
      }),
    );
  }
  async receive(events: MetaEvent[]) {
    // Routes are resolved only after raw-body signature verification in the controller.
    for (const event of events) {
      const routes = await this.db.$queryRaw<
        { tenantId: string; id: string }[]
      >`SELECT * FROM resolve_meta_connection(${event.channel}, ${event.accountId})`;
      if (!routes[0]) continue;
      const { tenantId, id: connectionId } = routes[0];
      if (!accountBound(event.channel, event.accountId, tenantId)) continue;
      await this.db.forWorkerTenant(tenantId, async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${connectionId}), 8)`;
        const connection = await tx.channelConnection.findUniqueOrThrow({
          where: { tenantId_id: { tenantId, id: connectionId } },
        });
        const dedupeKey =
          event.kind === "message"
            ? `message:${event.providerMessageId}`
            : `status:${event.providerMessageId}:${event.status}:${event.at}`;
        const existing = await tx.webhookEvent.findUnique({
          where: {
            tenantId_channelConnectionId_dedupeKey: {
              tenantId,
              channelConnectionId: connectionId,
              dedupeKey,
            },
          },
        });
        if (existing) return;
        await tx.webhookEvent.create({
          data: {
            tenantId,
            channelConnectionId: connectionId,
            dedupeKey,
            providerMessageId: event.providerMessageId,
            deliveryStatus: event.kind === "status" ? event.status : null,
            occurredAt: new Date(event.at),
            encryptedPayload: encrypt(
              JSON.stringify(event),
              `${tenantId}:${connectionId}:event:${dedupeKey}`,
            ),
          },
        });
        if (event.kind === "status") {
          if (event.customerId && event.watermark !== undefined) {
            await tx.outboundDelivery.updateMany({
              where: {
                tenantId,
                channelConnectionId: connectionId,
                state: { in: ["SENT", "DELIVERED"] },
                sentAt: { lte: new Date(event.watermark) },
                message: {
                  conversation: {
                    externalCustomerHash: identityHash(
                      connectionId,
                      event.customerId,
                    ),
                  },
                },
              },
              data: { state: "READ" },
            });
            return;
          }
          const delivery = await tx.outboundDelivery.findUnique({
            where: {
              tenantId_channelConnectionId_providerMessageId: {
                tenantId,
                channelConnectionId: connectionId,
                providerMessageId: event.providerMessageId,
              },
            },
          });
          if (delivery) {
            const state = advanceDelivery(delivery.state, event.status);
            await tx.outboundDelivery.update({
              where: { tenantId_id: { tenantId, id: delivery.id } },
              data: { state },
            });
            if (state === "FAILED") {
              const message = await tx.chatMessage.findUniqueOrThrow({
                where: { tenantId_id: { tenantId, id: delivery.messageId } },
              });
              await tx.notification.upsert({
                where: {
                  tenantId_conversationId: {
                    tenantId,
                    conversationId: message.conversationId,
                  },
                },
                create: {
                  tenantId,
                  conversationId: message.conversationId,
                  reason: "delivery_failed",
                },
                update: { readAt: null, reason: "delivery_failed" },
              });
            }
          }
          return;
        }
        if (!connection.enabled) return;
        const customerHash = identityHash(connectionId, event.customerId);
        const conversation = await tx.conversation.upsert({
          where: {
            tenantId_channelConnectionId_externalCustomerHash: {
              tenantId,
              channelConnectionId: connectionId,
              externalCustomerHash: customerHash,
            },
          },
          create: {
            tenantId,
            channel: event.channel,
            channelConnectionId: connectionId,
            externalCustomerHash: customerHash,
            encryptedCustomerId: encrypt(
              event.customerId,
              `${tenantId}:${connectionId}:customer:${customerHash}`,
            ),
            tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
            origin: "meta",
            expiresAt: new Date(0),
          },
          update: {},
        });
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${conversation.id}), 7)`;
        // Provider timestamps, not receipt time, define the reply window; delayed events cannot extend it.
        const when = new Date(Math.min(event.at, Date.now()));
        await tx.conversation.update({
          where: { tenantId_id: { tenantId, id: conversation.id } },
          data: {
            ...(event.unsupported ? { mode: "HUMAN" } : {}),
            ...(!conversation.lastCustomerMessageAt ||
            when > conversation.lastCustomerMessageAt
              ? { lastCustomerMessageAt: when }
              : {}),
          },
        });
        const clientMessageId = randomUUID();
        await tx.chatMessage.create({
          data: {
            tenantId,
            conversationId: conversation.id,
            clientMessageId,
            sender: "CUSTOMER",
            body: event.text,
            language: "und",
            metadata: {
              channel: event.channel,
              providerMessageId: event.providerMessageId,
              unsupported: event.unsupported,
            },
          },
        });
        if (event.unsupported)
          await tx.notification.upsert({
            where: {
              tenantId_conversationId: {
                tenantId,
                conversationId: conversation.id,
              },
            },
            create: {
              tenantId,
              conversationId: conversation.id,
              reason: "unsupported_message",
            },
            update: { readAt: null, reason: "unsupported_message" },
          });
        // The durable turn is the inbound outbox; receipt, message and turn commit together.
        await tx.conversationTurn.create({
          data: {
            tenantId,
            conversationId: conversation.id,
            clientMessageId,
            text: event.text,
          },
        });
      });
    }
  }
}
