import { z } from "zod";
import type { CatalogCard } from "@saha/shared";

export const metaChannel = z.enum(["WHATSAPP", "MESSENGER", "INSTAGRAM"]);
export type MetaChannel = z.infer<typeof metaChannel>;
const id = z.string().min(1).max(300);
const accountId = z.string().regex(/^\d{1,40}$/);
const at = z.number().int().nonnegative().max(8640000000000000);
const inbound = z.object({
  channel: metaChannel,
  accountId,
  kind: z.literal("message"),
  providerMessageId: id,
  customerId: id,
  text: z.string().min(1).max(2000),
  at,
  unsupported: z.boolean(),
  providerPayload: z.record(z.unknown()).optional(),
});
const status = z.object({
  channel: metaChannel,
  accountId,
  kind: z.literal("status"),
  providerMessageId: id,
  status: z.enum(["SENT", "DELIVERED", "READ", "FAILED"]),
  at,
  customerId: id.optional(),
  watermark: at.optional(),
  providerPayload: z.record(z.unknown()).optional(),
});
export const normalizedEvent = z.discriminatedUnion("kind", [inbound, status]);
export type MetaEvent = z.infer<typeof normalizedEvent>;
const record = z.record(z.unknown());
function obj(value: unknown): Record<string, unknown> {
  return record.parse(value);
}
function list(value: unknown): unknown[] {
  return z.array(z.unknown()).max(1000).parse(value);
}
function timestamp(value: unknown, seconds = false) {
  const n =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return at.parse(typeof n === "number" ? n * (seconds ? 1000 : 1) : n);
}
// Keep only the individual routed event; never persist the multi-tenant envelope.
export function normalizeEnvelope(input: unknown): MetaEvent[] {
  const envelope = obj(input);
  const result: MetaEvent[] = [];
  if (
    !["whatsapp_business_account", "page", "instagram"].includes(
      String(envelope.object),
    )
  )
    return result;
  for (const item of list(envelope.entry ?? [])) {
    const entry = obj(item);
    if (envelope.object === "whatsapp_business_account") {
      for (const c of list(entry.changes ?? [])) {
        const change = obj(c);
        if (change.field !== "messages") continue;
        const value = obj(change.value),
          account = accountId.parse(obj(value.metadata).phone_number_id);
        for (const m of list(value.messages ?? [])) {
          const message = obj(m);
          const unsupported = message.type !== "text";
          result.push(
            inbound.parse({
              channel: "WHATSAPP",
              accountId: account,
              kind: "message",
              providerMessageId: message.id,
              customerId: message.from,
              text: unsupported
                ? "[Unsupported customer message]"
                : obj(message.text).body,
              at: timestamp(message.timestamp, true),
              unsupported,
              providerPayload: message,
            }),
          );
        }
        for (const s of list(value.statuses ?? [])) {
          const delivery = obj(s),
            state = String(delivery.status).toUpperCase();
          if (!["SENT", "DELIVERED", "READ", "FAILED"].includes(state))
            continue;
          result.push(
            status.parse({
              channel: "WHATSAPP",
              accountId: account,
              kind: "status",
              providerMessageId: delivery.id,
              status: state,
              at: timestamp(delivery.timestamp, true),
              providerPayload: delivery,
            }),
          );
        }
      }
    } else {
      const channel: MetaChannel =
        envelope.object === "page" ? "MESSENGER" : "INSTAGRAM";
      const account = accountId.parse(entry.id);
      for (const m of list(entry.messaging ?? [])) {
        const event = obj(m);
        if (event.recipient && obj(event.recipient).id !== account)
          throw new Error("META_RECIPIENT_MISMATCH");
        if (event.message) {
          const message = obj(event.message);
          if (message.is_echo === true || obj(event.sender).id === account)
            continue;
          // Reject mismatched routing instead of trusting a sender-provided account.
          if (obj(event.recipient).id !== account)
            throw new Error("META_RECIPIENT_MISMATCH");
          const unsupported = typeof message.text !== "string";
          result.push(
            inbound.parse({
              channel,
              accountId: account,
              kind: "message",
              providerMessageId: message.mid,
              customerId: obj(event.sender).id,
              text: unsupported
                ? "[Unsupported customer message]"
                : message.text,
              at: timestamp(event.timestamp),
              unsupported,
              providerPayload: message,
            }),
          );
        } else if (event.delivery) {
          const delivery = obj(event.delivery);
          for (const mid of list(delivery.mids ?? []))
            result.push(
              status.parse({
                channel,
                accountId: account,
                kind: "status",
                providerMessageId: mid,
                status: "DELIVERED",
                at: timestamp(event.timestamp),
              }),
            );
        } else if (event.read && obj(event.read).mid) {
          result.push(
            status.parse({
              channel,
              accountId: account,
              kind: "status",
              providerMessageId: obj(event.read).mid,
              status: "READ",
              at: timestamp(event.timestamp),
            }),
          );
        } else if (
          channel === "MESSENGER" &&
          event.read &&
          obj(event.read).watermark
        ) {
          const customer = id.parse(obj(event.sender).id),
            watermark = timestamp(obj(event.read).watermark);
          result.push(
            status.parse({
              channel,
              accountId: account,
              kind: "status",
              providerMessageId: `watermark:${customer}:${watermark}`,
              customerId: customer,
              watermark,
              status: "READ",
              at: timestamp(event.timestamp),
            }),
          );
        }
      }
    }
  }
  if (result.length > 1000) throw new Error("META_BATCH_TOO_LARGE");
  return result;
}
export function withinReplyWindow(last: Date | null, now = Date.now()) {
  return (
    !!last &&
    last.getTime() <= now &&
    now - last.getTime() < 24 * 60 * 60 * 1000
  );
}
export function renderMetaText(body: string, cards: CatalogCard[] = []) {
  return [
    body,
    ...cards.map(
      (c) =>
        `${c.name}\n${c.variants.map((v) => `${v.sku}: LKR ${Math.floor(v.priceMinor / 100).toLocaleString("en-US")}.${String(v.priceMinor % 100).padStart(2, "0")} · Stock ${v.stock}`).join("\n")}`,
    ),
  ].join("\n\n");
}
export type SendResult = {
  state: "SENT" | "FAILED" | "UNKNOWN" | "RETRY";
  providerMessageId?: string;
  errorCode?: string;
};
export type MetaSendInput = {
  accountId: string;
  customerId: string;
  text: string;
  accessToken: string;
  instagramLogin: string;
};
export abstract class MetaAdapter {
  abstract readonly channel: MetaChannel;
  constructor(private transport: typeof fetch = fetch) {}
  async send(input: MetaSendInput): Promise<SendResult> {
    const version = process.env.META_GRAPH_VERSION;
    if (!version || !/^v\d+\.\d+$/.test(version))
      return { state: "FAILED", errorCode: "GRAPH_VERSION_REQUIRED" };
    const host =
      this.channel === "INSTAGRAM" && input.instagramLogin === "INSTAGRAM"
        ? "graph.instagram.com"
        : "graph.facebook.com";
    // One provider send per delivery. Long replies are held for review instead of being split into ambiguous partial sends.
    const limit =
      this.channel === "WHATSAPP"
        ? 4096
        : this.channel === "INSTAGRAM"
          ? 1000
          : 2000;
    if (input.text.length > limit)
      return { state: "FAILED", errorCode: "MESSAGE_TOO_LONG" };
    const payload =
      this.channel === "WHATSAPP"
        ? {
            messaging_product: "whatsapp",
            to: input.customerId,
            type: "text",
            text: { body: input.text },
          }
        : {
            recipient: { id: input.customerId },
            message: { text: input.text },
            ...(this.channel === "MESSENGER"
              ? { messaging_type: "RESPONSE" }
              : {}),
          };
    try {
      const response = await this.transport(
        `https://${host}/${version}/${input.accountId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${input.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15000),
          redirect: "error",
        },
      );
      if (response.status === 429)
        return { state: "RETRY", errorCode: "META_RATE_LIMIT" };
      if (response.status >= 500)
        return { state: "UNKNOWN", errorCode: "META_SERVER_OUTCOME_UNKNOWN" };
      if (!response.ok)
        return { state: "FAILED", errorCode: `META_HTTP_${response.status}` };
      const data = obj(await response.json());
      const providerMessageId =
        this.channel === "WHATSAPP"
          ? obj(list(data.messages)[0]).id
          : data.message_id;
      const parsed = id.safeParse(providerMessageId);
      return parsed.success
        ? { state: "SENT", providerMessageId: parsed.data }
        : { state: "UNKNOWN", errorCode: "META_RESPONSE_UNKNOWN" };
    } catch {
      return { state: "UNKNOWN", errorCode: "META_NETWORK_OUTCOME_UNKNOWN" };
    }
  }
}
export class WhatsAppAdapter extends MetaAdapter {
  readonly channel = "WHATSAPP" as const;
}
export class MessengerAdapter extends MetaAdapter {
  readonly channel = "MESSENGER" as const;
}
export class InstagramAdapter extends MetaAdapter {
  readonly channel = "INSTAGRAM" as const;
}
export function adapterFor(channel: string): MetaAdapter {
  if (channel === "WHATSAPP") return new WhatsAppAdapter();
  if (channel === "MESSENGER") return new MessengerAdapter();
  if (channel === "INSTAGRAM") return new InstagramAdapter();
  throw new Error("META_CHANNEL_INVALID");
}
export function advanceDelivery(current: string, incoming: string) {
  const ranks: Record<string, number> = { SENT: 1, DELIVERED: 2, READ: 3 };
  if (current === "READ" || (current === "DELIVERED" && incoming === "FAILED"))
    return current;
  if (incoming === "FAILED") return "FAILED";
  return (ranks[incoming] ?? 0) > (ranks[current] ?? 0) ? incoming : current;
}
