import { Injectable, Inject } from "@nestjs/common";
import type { CatalogCard } from "@saha/shared";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { Database } from "../database/database.service";
import { decrypt } from "./crypto";
import { accountBound } from "./service";
import {
  adapterFor,
  advanceDelivery,
  renderMetaText,
  withinReplyWindow,
  type MetaAdapter,
} from "./meta-adapter";

@Injectable()
export class OutboundProcessor {
  constructor(@Inject(Database) private db: Database) {}
  // Adapter injection is used by fixture tests; normal workers use the real channel implementation.
  async process(id: string, adapter?: MetaAdapter) {
    if (process.env.META_LIVE_SEND_ENABLED !== "true") return;
    const routes = await this.db.$queryRaw<
      { tenantId: string; channelConnectionId: string }[]
    >`SELECT * FROM resolve_outbound_delivery(${id}::uuid)`;
    if (!routes[0]) return;
    const { tenantId, channelConnectionId } = routes[0];
    const claimed = await this.db.forWorkerTenant(tenantId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${channelConnectionId}), 8)`;
      const delivery = await tx.outboundDelivery.findUniqueOrThrow({
        where: { tenantId_id: { tenantId, id } },
        include: {
          connection: true,
          message: { include: { conversation: true, turn: true } },
        },
      });
      if (delivery.state !== "PENDING" || delivery.availableAt > new Date())
        return;
      const conversation = delivery.message.conversation;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${conversation.id}), 7)`;
      const current = await tx.conversation.findUniqueOrThrow({
        where: { tenantId_id: { tenantId, id: conversation.id } },
      });
      const metadata = delivery.message.metadata as Prisma.JsonObject;
      const earlier = await tx.outboundDelivery.findFirst({
        where: {
          tenantId,
          channelConnectionId,
          id: { not: id },
          state: { in: ["PENDING", "SENDING", "UNKNOWN"] },
          message: {
            conversationId: current.id,
            turn: {
              OR: [
                { createdAt: { lt: delivery.message.turn!.createdAt } },
                {
                  createdAt: delivery.message.turn!.createdAt,
                  id: { lt: delivery.message.turnId! },
                },
              ],
            },
          },
        },
      });
      if (earlier && earlier.state !== "UNKNOWN")
        throw new Error("OUTBOUND_ORDER_WAIT");
      const block = !delivery.connection.enabled
        ? "CHANNEL_DISABLED"
        : !accountBound(
              delivery.connection.channel,
              delivery.connection.providerAccountId,
              tenantId,
            )
          ? "ACCOUNT_NOT_AUTHORIZED"
          : earlier?.state === "UNKNOWN"
            ? "PREVIOUS_DELIVERY_UNKNOWN"
            : !withinReplyWindow(current.lastCustomerMessageAt)
              ? "REPLY_WINDOW_CLOSED"
              : current.mode === "HUMAN" && !metadata.handoffReason
                ? "HUMAN_TAKEOVER"
                : undefined;
      if (block) {
        await tx.outboundDelivery.update({
          where: { tenantId_id: { tenantId, id } },
          data: { state: "BLOCKED", errorCode: block },
        });
        if (
          ["REPLY_WINDOW_CLOSED", "PREVIOUS_DELIVERY_UNKNOWN"].includes(block)
        )
          await tx.conversation.update({
            where: { tenantId_id: { tenantId, id: conversation.id } },
            data: { mode: "HUMAN" },
          });
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
            reason: block.toLowerCase(),
          },
          update: { readAt: null, reason: block.toLowerCase() },
        });
        return;
      }
      const credentials = z
        .object({ accessToken: z.string().min(10) })
        .parse(
          JSON.parse(
            decrypt(
              delivery.connection.encryptedCredentials,
              `${tenantId}:${channelConnectionId}:credentials`,
            ),
          ),
        );
      const customerId = decrypt(
        current.encryptedCustomerId!,
        `${tenantId}:${channelConnectionId}:customer:${current.externalCustomerHash}`,
      );
      await tx.outboundDelivery.update({
        where: { tenantId_id: { tenantId, id } },
        data: { state: "SENDING", attempts: { increment: 1 }, errorCode: null },
      });
      return {
        delivery,
        input: {
          accountId: delivery.connection.providerAccountId,
          customerId,
          accessToken: credentials.accessToken,
          instagramLogin: delivery.connection.instagramLogin,
          text: renderMetaText(
            delivery.message.body,
            (metadata.cards ?? []) as unknown as CatalogCard[],
          ),
        },
      };
    });
    if (!claimed) return;
    // SENDING commits before the network operation. A crash or uncertain response is never automatically resent.
    const result = await (
      adapter ?? adapterFor(claimed.delivery.connection.channel)
    ).send(claimed.input);
    await this.db.forWorkerTenant(tenantId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${channelConnectionId}), 8)`;
      const current = await tx.outboundDelivery.findUniqueOrThrow({
        where: { tenantId_id: { tenantId, id } },
      });
      if (current.state !== "SENDING") return;
      let state: string = result.state;
      if (result.state === "RETRY")
        state = current.attempts < 3 ? "PENDING" : "FAILED";
      if (result.providerMessageId) {
        // A status webhook can beat the HTTP send response; reconcile durable receipts before finalizing.
        const receipts = await tx.webhookEvent.findMany({
          where: {
            tenantId,
            channelConnectionId,
            providerMessageId: result.providerMessageId,
            deliveryStatus: { not: null },
          },
          orderBy: { occurredAt: "asc" },
        });
        for (const receipt of receipts)
          state = advanceDelivery(state, receipt.deliveryStatus!);
      }
      await tx.outboundDelivery.update({
        where: { tenantId_id: { tenantId, id } },
        data: {
          state,
          providerMessageId: result.providerMessageId,
          errorCode: result.errorCode ?? null,
          ...(result.providerMessageId ? { sentAt: new Date() } : {}),
          ...(state === "PENDING"
            ? { availableAt: new Date(Date.now() + 30_000 * current.attempts) }
            : {}),
        },
      });
      if (["UNKNOWN", "FAILED"].includes(state))
        await tx.notification.upsert({
          where: {
            tenantId_conversationId: {
              tenantId,
              conversationId: claimed.delivery.message.conversationId,
            },
          },
          create: {
            tenantId,
            conversationId: claimed.delivery.message.conversationId,
            reason: `delivery_${state.toLowerCase()}`,
          },
          update: { readAt: null, reason: `delivery_${state.toLowerCase()}` },
        });
    });
  }
  async recover(id: string) {
    const routes = await this.db.$queryRaw<
      { tenantId: string; channelConnectionId: string }[]
    >`SELECT * FROM resolve_outbound_delivery(${id}::uuid)`;
    if (!routes[0]) return;
    const { tenantId, channelConnectionId } = routes[0];
    await this.db.forWorkerTenant(tenantId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${channelConnectionId}), 8)`;
      const delivery = await tx.outboundDelivery.findUniqueOrThrow({
        where: { tenantId_id: { tenantId, id } },
        include: { message: true },
      });
      if (
        delivery.state !== "SENDING" ||
        delivery.updatedAt.getTime() > Date.now() - 60000
      )
        return;
      await tx.outboundDelivery.update({
        where: { tenantId_id: { tenantId, id } },
        data: { state: "UNKNOWN", errorCode: "WORKER_INTERRUPTED" },
      });
      await tx.notification.upsert({
        where: {
          tenantId_conversationId: {
            tenantId,
            conversationId: delivery.message.conversationId,
          },
        },
        create: {
          tenantId,
          conversationId: delivery.message.conversationId,
          reason: "delivery_unknown",
        },
        update: { readAt: null, reason: "delivery_unknown" },
      });
    });
  }
}
