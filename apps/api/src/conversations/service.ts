import {
  Injectable,
  Inject,
  ForbiddenException,
  ConflictException,
} from "@nestjs/common";
import { randomBytes, createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  botConfigSchema,
  type BotConfigInput,
  type ChatSession,
} from "@saha/shared";
import { Database } from "../database/database.service";
import { ConversationEngine } from "./engine";
import { WidgetAdapter } from "../channels/adapter";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
@Injectable()
export class ConversationService {
  constructor(
    @Inject(Database) private db: Database,
    @Inject(ConversationEngine) private engine: ConversationEngine,
    @Inject(WidgetAdapter) private adapter: WidgetAdapter,
  ) {}
  defaults(name: string): BotConfigInput {
    return {
      businessName: name,
      tone: "friendly",
      enabledLanguages: ["en", "si", "ta", "singlish", "tanglish"],
      greeting: "Hello! Welcome. How can we help?",
      rules: ["Never offer discounts."],
      handoffTriggers: [],
      businessHours: [],
      widgetEnabled: false,
      allowedOrigins: [],
    };
  }
  settings(userId: string, tenantId: string) {
    return this.db.forTenant(userId, tenantId, true, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
      });
      return tx.botConfig.upsert({
        where: { tenantId },
        create: { tenantId, settings: this.defaults(tenant.name) },
        update: {},
      });
    });
  }
  save(userId: string, tenantId: string, settings: BotConfigInput) {
    return this.db.forTenant(userId, tenantId, true, (tx) =>
      tx.botConfig.upsert({
        where: { tenantId },
        create: { tenantId, settings },
        update: { settings },
      }),
    );
  }
  notices(userId: string, tenantId: string) {
    return this.db.forTenant(userId, tenantId, false, (tx) =>
      tx.notification.findMany({
        where: { tenantId, readAt: null },
        orderBy: { createdAt: "desc" },
        take: 25,
        select: {
          id: true,
          reason: true,
          conversationId: true,
          createdAt: true,
        },
      }),
    );
  }
  readNotice(userId: string, tenantId: string, id: string) {
    return this.db.forTenant(userId, tenantId, false, (tx) =>
      tx.notification.updateMany({
        where: { tenantId, id },
        data: { readAt: new Date() },
      }),
    );
  }
  async preview(userId: string, tenantId: string) {
    await this.settings(userId, tenantId);
    return this.db.forTenant(userId, tenantId, true, async (tx) =>
      this.createSession(tx, tenantId, process.env.WEB_ORIGIN!, true),
    );
  }
  private async createSession(
    tx: Prisma.TransactionClient,
    tenantId: string,
    origin: string,
    preview: boolean,
  ): Promise<ChatSession> {
    const config = await tx.botConfig.findUniqueOrThrow({
      where: { tenantId },
    });
    const settings = botConfigSchema.parse(config.settings);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await tx.conversation.create({
      data: { tenantId, tokenHash: hash(token), origin, preview, expiresAt },
    });
    return {
      token,
      expiresAt: expiresAt.toISOString(),
      businessName: settings.businessName,
      greeting: settings.greeting,
      development: true,
    };
  }
  async bootstrap(publicId: string, origin: string) {
    const routes = await this.db.$queryRaw<
      { tenantId: string }[]
    >`SELECT * FROM resolve_widget(${publicId}::uuid)`;
    if (!routes[0]) throw new ForbiddenException("Widget unavailable.");
    return this.db.forWorkerTenant(routes[0].tenantId, async (tx) => {
      const cfg = await tx.botConfig.findUniqueOrThrow({
        where: { tenantId: routes[0].tenantId },
      });
      const settings = botConfigSchema.parse(cfg.settings);
      if (!settings.widgetEnabled || !settings.allowedOrigins.includes(origin))
        throw new ForbiddenException("Widget unavailable on this website.");
      return this.createSession(tx, cfg.tenantId, origin, false);
    });
  }
  private async session<T>(
    token: string,
    origin: string,
    work: (
      tx: Prisma.TransactionClient,
      tenantId: string,
      conversationId: string,
    ) => Promise<T>,
  ) {
    if (!/^[a-zA-Z0-9_-]{43}$/.test(token))
      throw new ForbiddenException("Chat session expired or unavailable.");
    const routes = await this.db.$queryRaw<
      { tenantId: string; id: string }[]
    >`SELECT * FROM resolve_widget_session(${hash(token)})`;
    if (!routes[0])
      throw new ForbiddenException("Chat session expired or unavailable.");
    const route = routes[0];
    return this.db.forWorkerTenant(route.tenantId, async (tx) => {
      const conversation = await tx.conversation.findUnique({
        where: { tenantId_id: { tenantId: route.tenantId, id: route.id } },
      });
      if (
        !conversation ||
        conversation.origin !== origin ||
        conversation.expiresAt <= new Date()
      )
        throw new ForbiddenException("Chat session expired or unavailable.");
      const cfg = await tx.botConfig.findUniqueOrThrow({
        where: { tenantId: route.tenantId },
      });
      const settings = botConfigSchema.parse(cfg.settings);
      if (
        !conversation.preview &&
        (!settings.widgetEnabled || !settings.allowedOrigins.includes(origin))
      )
        throw new ForbiddenException("Widget is disabled.");
      return work(tx, route.tenantId, route.id);
    });
  }
  state(token: string, origin: string) {
    return this.session(token, origin, async (tx, tenantId, id) => {
      const conversation = await tx.conversation.findUniqueOrThrow({
        where: { tenantId_id: { tenantId, id } },
      });
      const messages = await tx.chatMessage.findMany({
        where: { tenantId, conversationId: id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 50,
      });
      const pending = !!(await tx.conversationTurn.findFirst({
        where: { tenantId, conversationId: id, status: "PENDING" },
      }));
      return this.adapter.present(
        conversation.mode as "BOT" | "HUMAN",
        messages.reverse(),
        pending,
      );
    });
  }
  async send(
    token: string,
    origin: string,
    data: { clientMessageId: string; text: string },
  ) {
    data = this.adapter.normalize(data);
    const turn = await this.session(token, origin, async (tx, tenantId, id) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}),7)`;
      const existing = await tx.conversationTurn.findUnique({
        where: {
          tenantId_conversationId_clientMessageId: {
            tenantId,
            conversationId: id,
            clientMessageId: data.clientMessageId,
          },
        },
      });
      if (existing) {
        if (existing.text !== data.text)
          throw new ConflictException(
            "This message ID was already used for different text.",
          );
        return existing;
      }
      if (
        await tx.conversationTurn.findFirst({
          where: { tenantId, conversationId: id, status: "PENDING" },
        })
      )
        throw new ConflictException(
          "Wait for the previous reply before sending another message.",
        );
      await tx.chatMessage.create({
        data: {
          tenantId,
          conversationId: id,
          clientMessageId: data.clientMessageId,
          sender: "CUSTOMER",
          body: data.text,
          language: "und",
        },
      });
      return tx.conversationTurn.create({
        data: { tenantId, conversationId: id, ...data },
      });
    });
    // Widget requests can run the local provider inline. The committed turn remains recoverable by the Redis worker.
    if (
      process.env.WIDGET_PROCESSING_MODE === "inline" &&
      turn.status !== "DONE"
    )
      await this.engine.processTurn(turn.id);
    return this.state(token, origin);
  }
}
