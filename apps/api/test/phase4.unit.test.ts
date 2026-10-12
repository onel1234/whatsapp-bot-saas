import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { encrypt, decrypt, verifySignature } from "../src/channels/crypto";
import {
  normalizeEnvelope,
  withinReplyWindow,
  WhatsAppAdapter,
  MessengerAdapter,
  InstagramAdapter,
  renderMetaText,
  advanceDelivery,
} from "../src/channels/meta-adapter";
export const waEnvelope = (
  account = "1339213065945263",
  mid = "wamid.test",
  from = "94770000000",
  text = "hello",
  time = Math.floor(Date.now() / 1000),
) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "123",
      changes: [
        {
          field: "messages",
          value: {
            metadata: { phone_number_id: account },
            messages: [
              {
                id: mid,
                from,
                type: "text",
                text: { body: text },
                timestamp: String(time),
              },
            ],
          },
        },
      ],
    },
  ],
});
export const socialEnvelope = (
  channel = "page",
  account = "123",
  mid = "mid.test",
  message = { text: "hello" },
) => ({
  object: channel,
  entry: [
    {
      id: account,
      messaging: [
        {
          sender: { id: "456" },
          recipient: { id: account },
          timestamp: Date.now(),
          message: { mid, ...message },
        },
      ],
    },
  ],
});
describe("Phase 4 credentials and Meta contracts", () => {
  beforeEach(() => {
    process.env.CHANNEL_ENCRYPTION_KEYS = JSON.stringify({
      v1: randomBytes(32).toString("hex"),
    });
    process.env.CHANNEL_ENCRYPTION_KEY_VERSION = "v1";
    process.env.META_GRAPH_VERSION = "v25.0";
  });
  it("authenticates exact raw bytes and rejects absent, malformed and changed signatures", () => {
    const raw = Buffer.from('{ "a": 1 }'),
      secret = "test-app-secret";
    const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
    expect(verifySignature(raw, signature, secret)).toBe(true);
    expect(verifySignature(Buffer.from('{"a":1}'), signature, secret)).toBe(
      false,
    );
    for (const header of [undefined, "sha1=hello", "sha256=00", [signature]])
      expect(verifySignature(raw, header, secret)).toBe(false);
  });
  it("encrypts with random IVs, enforces tenant/purpose binding, and supports old keys during rotation", () => {
    const a = encrypt("secret-token", "tenant:connection:credentials"),
      b = encrypt("secret-token", "tenant:connection:credentials");
    expect(a).not.toBe(b);
    expect(a).not.toContain("secret-token");
    expect(decrypt(a, "tenant:connection:credentials")).toBe("secret-token");
    expect(() => decrypt(a, "other:connection:credentials")).toThrow();
    const ring = JSON.parse(process.env.CHANNEL_ENCRYPTION_KEYS!);
    process.env.CHANNEL_ENCRYPTION_KEYS = JSON.stringify({
      ...ring,
      v2: randomBytes(32).toString("hex"),
    });
    process.env.CHANNEL_ENCRYPTION_KEY_VERSION = "v2";
    expect(encrypt("new", "context").startsWith("v2.")).toBe(true);
    expect(decrypt(a, "tenant:connection:credentials")).toBe("secret-token");
  });
  it("fails closed without a valid key", () => {
    process.env.CHANNEL_ENCRYPTION_KEYS = "{}";
    expect(() => encrypt("secret", "tenant")).toThrow();
  });
  it.each(["page", "instagram"])(
    "normalizes %s DMs and ignores echoes",
    (channel) => {
      expect(normalizeEnvelope(socialEnvelope(channel))[0]).toMatchObject({
        channel: channel === "page" ? "MESSENGER" : "INSTAGRAM",
        text: "hello",
        kind: "message",
      });
      const echo = socialEnvelope(channel);
      Object.assign(echo.entry[0].messaging[0].message, { is_echo: true });
      expect(normalizeEnvelope(echo)).toEqual([]);
    },
  );
  it("splits multi-account WhatsApp envelopes into individual events", () => {
    const one = waEnvelope("111", "one"),
      two = waEnvelope("222", "two");
    one.entry.push(...two.entry);
    const events = normalizeEnvelope(one);
    expect(events.map((e) => e.accountId)).toEqual(["111", "222"]);
    expect(JSON.stringify(events[0])).not.toContain("two");
  });
  it("normalizes media as a team request without inventing extracted content", () => {
    const envelope = waEnvelope();
    Object.assign(envelope.entry[0].changes[0].value.messages[0], {
      type: "image",
    });
    expect(normalizeEnvelope(envelope)[0]).toMatchObject({
      unsupported: true,
      text: "[Unsupported customer message]",
    });
  });
  it("rejects invalid routing IDs, mismatched recipients, oversized text and bad timestamps", () => {
    expect(() => normalizeEnvelope(waEnvelope("../evil"))).toThrow();
    expect(() =>
      normalizeEnvelope(waEnvelope("111", "id", "customer", "x".repeat(2001))),
    ).toThrow();
    const mismatched = socialEnvelope();
    mismatched.entry[0].messaging[0].recipient.id = "789";
    expect(() => normalizeEnvelope(mismatched)).toThrow();
    expect(() =>
      normalizeEnvelope(waEnvelope("111", "id", "customer", "hello", -1)),
    ).toThrow();
  });
  it("uses a strict 24-hour reply boundary and rejects missing/future customer timestamps", () => {
    const now = Date.now();
    expect(withinReplyWindow(new Date(now - 86400000 + 1), now)).toBe(true);
    expect(withinReplyWindow(new Date(now - 86400000), now)).toBe(false);
    expect(withinReplyWindow(null, now)).toBe(false);
    expect(withinReplyWindow(new Date(now + 1), now)).toBe(false);
  });
  it.each([
    new WhatsAppAdapter(),
    new MessengerAdapter(),
    new InstagramAdapter(),
  ])(
    "holds uncertain sends and only retries explicit rate-limit rejection ($channel)",
    async (adapter) => {
      const transport = vi.fn().mockRejectedValue(new Error("private error"));
      const instance =
        adapter.channel === "WHATSAPP"
          ? new WhatsAppAdapter(transport)
          : adapter.channel === "MESSENGER"
            ? new MessengerAdapter(transport)
            : new InstagramAdapter(transport);
      const input = {
        accountId: "123",
        customerId: "456",
        text: "hello",
        accessToken: "test-token-only",
        instagramLogin: "INSTAGRAM",
      };
      expect((await instance.send(input)).state).toBe("UNKNOWN");
      transport.mockResolvedValue(new Response("", { status: 429 }));
      expect((await instance.send(input)).state).toBe("RETRY");
      transport.mockResolvedValue(new Response("", { status: 503 }));
      expect((await instance.send(input)).state).toBe("UNKNOWN");
      transport.mockResolvedValue(new Response("", { status: 401 }));
      expect((await instance.send(input)).state).toBe("FAILED");
    },
  );
  it.each(["WHATSAPP", "MESSENGER", "INSTAGRAM"])(
    "uses the documented %s endpoint/body and bearer header",
    async (channel) => {
      const transport = vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify(
              channel === "WHATSAPP"
                ? { messages: [{ id: "sent-1" }] }
                : { message_id: "sent-1" },
            ),
          ),
        );
      const adapter =
        channel === "WHATSAPP"
          ? new WhatsAppAdapter(transport)
          : channel === "MESSENGER"
            ? new MessengerAdapter(transport)
            : new InstagramAdapter(transport);
      expect(
        await adapter.send({
          accountId: "123",
          customerId: "456",
          text: "hello",
          accessToken: "test-token-only",
          instagramLogin: "INSTAGRAM",
        }),
      ).toEqual({ state: "SENT", providerMessageId: "sent-1" });
      const [url, options] = transport.mock.calls[0];
      expect(url).toBe(
        `https://${channel === "INSTAGRAM" ? "graph.instagram.com" : "graph.facebook.com"}/v25.0/123/messages`,
      );
      expect(options.headers.Authorization).toBe("Bearer test-token-only");
      expect(url).not.toContain("token");
      expect(JSON.parse(options.body)).toMatchObject(
        channel === "WHATSAPP"
          ? { messaging_product: "whatsapp", text: { body: "hello" } }
          : { recipient: { id: "456" }, message: { text: "hello" } },
      );
    },
  );
  it("does not call Meta without an explicit Graph version or for oversized replies", async () => {
    const transport = vi.fn(),
      adapter = new InstagramAdapter(transport),
      input = {
        accountId: "123",
        customerId: "456",
        text: "x".repeat(1001),
        accessToken: "token-value",
        instagramLogin: "INSTAGRAM",
      };
    expect((await adapter.send(input)).errorCode).toBe("MESSAGE_TOO_LONG");
    delete process.env.META_GRAPH_VERSION;
    expect((await adapter.send({ ...input, text: "hello" })).errorCode).toBe(
      "GRAPH_VERSION_REQUIRED",
    );
    expect(transport).not.toHaveBeenCalled();
  });
  it("renders catalog cents exactly and keeps delivery progress monotonic", () => {
    expect(
      renderMetaText("Catalog", [
        {
          id: "id",
          sku: "TEA",
          name: "Tea",
          variants: [
            { sku: "TEA", attributes: {}, priceMinor: 125050, stock: 24 },
          ],
        },
      ]),
    ).toContain("LKR 1,250.50 · Stock 24");
    expect(advanceDelivery("READ", "SENT")).toBe("READ");
    expect(advanceDelivery("DELIVERED", "FAILED")).toBe("DELIVERED");
    expect(advanceDelivery("SENT", "FAILED")).toBe("FAILED");
  });
});
