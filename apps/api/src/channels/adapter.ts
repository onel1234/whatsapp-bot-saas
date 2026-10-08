import type { CatalogCard, ChatState } from "@saha/shared";
import { customerMessageSchema } from "@saha/shared";
import type { Prisma } from "@prisma/client";
import { Injectable } from "@nestjs/common";
export type NormalizedInbound = { clientMessageId: string; text: string };
export interface ChannelAdapter {
  readonly channel: "WIDGET" | "WHATSAPP" | "MESSENGER" | "INSTAGRAM";
  normalize(input: unknown): NormalizedInbound;
  present(
    mode: "BOT" | "HUMAN",
    messages: {
      id: string;
      sender: string;
      body: string;
      language: string;
      createdAt: Date;
      metadata: Prisma.JsonValue;
    }[],
    pending: boolean,
  ): ChatState;
}
@Injectable()
export class WidgetAdapter implements ChannelAdapter {
  readonly channel = "WIDGET";
  normalize(input: unknown) {
    return customerMessageSchema.parse(input);
  }
  present(
    mode: "BOT" | "HUMAN",
    messages: {
      id: string;
      sender: string;
      body: string;
      language: string;
      createdAt: Date;
      metadata: Prisma.JsonValue;
    }[],
    pending: boolean,
  ): ChatState {
    return {
      mode,
      pending,
      messages: messages.map((m) => {
        const metadata = m.metadata as Prisma.JsonObject;
        return {
          id: m.id,
          sender: m.sender as "CUSTOMER" | "BOT",
          body: m.body,
          language: m.language,
          createdAt: m.createdAt.toISOString(),
          cards: (metadata.cards ?? []) as unknown as CatalogCard[],
          sources: (metadata.sources ?? []) as unknown as {
            title: string;
            url: string | null;
          }[],
        };
      }),
    };
  }
}
