import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { botConfigSchema, type Language, type CatalogCard } from "@saha/shared";
import { Database } from "../database/database.service";
import {
  DevelopmentEmbeddingProvider,
  vectorLiteral,
} from "../embeddings/provider";
import {
  LlmProvider,
  assemblePrompt,
  proposalSchema,
  ambiguousEvidence,
  type Evidence,
  type LlmResult,
} from "../llm/provider";
import { asksForHuman, detectLanguage } from "../languages/detect";
const texts: Record<
  Language,
  {
    handoff: string;
    catalog: string;
    unavailable: string;
    hello: string;
    disabled: string;
  }
> = {
  en: {
    handoff: "I’ll pass this to the team. They’ll reply when available.",
    catalog:
      "Here is the current catalog information. Prices and stock may change before checkout.",
    unavailable:
      "Ordering and order tracking are not available here yet. I’ll pass your request to the team.",
    hello: "Hello! How can I help with our products or business information?",
    disabled:
      "That language is not enabled. Please choose an enabled language or ask for the team.",
  },
  si: {
    handoff: "මෙය අපේ කණ්ඩායමට යොමු කරන්නම්. ඔවුන් හැකි විට පිළිතුරු දෙයි.",
    catalog: "මෙන්න දැනට ඇති නිෂ්පාදන තොරතුරු. මිල සහ තොග වෙනස් විය හැක.",
    unavailable:
      "මෙහි ඇණවුම් කිරීම සහ ඇණවුම් තත්ත්වය බැලීම තවම ලබා ගත නොහැක. ඔබේ ඉල්ලීම කණ්ඩායමට යොමු කරන්නම්.",
    hello: "ආයුබෝවන්! නිෂ්පාදන හෝ ව්‍යාපාර තොරතුරු ගැන ඔබට උදව් කරන්නේ කෙසේද?",
    disabled:
      "එම භාෂාව සක්‍රිය කර නැත. වෙනත් භාෂාවක් තෝරන්න හෝ කණ්ඩායම ඉල්ලන්න.",
  },
  ta: {
    handoff:
      "உங்கள் கோரிக்கையை குழுவிடம் அனுப்புகிறேன். அவர்கள் நேரம் கிடைக்கும்போது பதிலளிப்பார்கள்.",
    catalog:
      "தற்போதைய பொருள் விவரங்கள் இங்கே. வாங்குவதற்கு முன் விலையும் இருப்பும் மாறலாம்.",
    unavailable:
      "இங்கே ஆர்டர் செய்வதும் ஆர்டர் நிலையைப் பார்ப்பதும் இன்னும் கிடைக்கவில்லை. குழுவிடம் உங்கள் கோரிக்கையை அனுப்புகிறேன்.",
    hello: "வணக்கம்! பொருட்கள் அல்லது வணிகத் தகவல்களில் எப்படி உதவலாம்?",
    disabled:
      "அந்த மொழி இயக்கப்படவில்லை. இயக்கப்பட்ட மொழியைத் தேர்ந்தெடுக்கவும் அல்லது குழுவைக் கேட்கவும்.",
  },
  singlish: {
    handoff:
      "Me illima team ekata yawannam. Puluwan welawata eyala reply karai.",
    catalog:
      "Dan thiyena product wisthara me. Checkout ekata kalin mila saha stock wenas wenna puluwan.",
    unavailable:
      "Methanin order karanna saha order status balanna thawama baha. Team ekata illima yawannam.",
    hello:
      "Ayubowan! Products hari business wisthara gana kohomada udaw karanne?",
    disabled:
      "E language eka enable karala naha. Enable language ekak thoranna nathnam team eka illanna.",
  },
  tanglish: {
    handoff:
      "Unga request team kitta anuppuren. Avanga neram kidaikkumbodhu reply pannuvanga.",
    catalog:
      "Ippo irukkura product details inge. Checkout munnaadi vilaiyum stockum maaralaam.",
    unavailable:
      "Inge order seivadhum order status paarpadhum innum illai. Team kitta request anuppuren.",
    hello:
      "Vanakkam! Products alladhu business details pathi eppadi udhavalaam?",
    disabled:
      "Andha language enable seiyala. Enable panna language therndhedukkavum alladhu team kitta pesavum.",
  },
};
async function bounded<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("PROVIDER_TIMEOUT")), 8000);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
@Injectable()
export class ConversationEngine {
  constructor(
    @Inject(Database) private db: Database,
    @Inject(LlmProvider) private llm: LlmProvider,
    @Inject(DevelopmentEmbeddingProvider)
    private embeddings: DevelopmentEmbeddingProvider,
  ) {}
  async processTurn(turnId: string) {
    const routes = await this.db.$queryRaw<
      { tenantId: string }[]
    >`SELECT * FROM resolve_conversation_turn(${turnId}::uuid)`;
    if (!routes[0]) return;
    const tenantId = routes[0].tenantId;
    return this.db.forWorkerTenant(tenantId, async (tx) => {
      const turn = await tx.conversationTurn.findUnique({
        where: { tenantId_id: { tenantId, id: turnId } },
      });
      if (!turn || turn.status === "DONE") return;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${turn.conversationId}), 7)`;
      const fresh = await tx.conversationTurn.findUniqueOrThrow({
        where: { tenantId_id: { tenantId, id: turnId } },
      });
      if (fresh.status === "DONE") return;
      const conversation = await tx.conversation.findUniqueOrThrow({
        where: { tenantId_id: { tenantId, id: turn.conversationId } },
      });
      const predecessor = await tx.conversationTurn.findFirst({
        where: {
          tenantId,
          conversationId: conversation.id,
          status: "PENDING",
          OR: [
            { createdAt: { lt: turn.createdAt } },
            { createdAt: turn.createdAt, id: { lt: turn.id } },
          ],
        },
      });
      if (predecessor) throw new Error("INBOUND_ORDER_WAIT");
      if (conversation.channel !== "WIDGET" && conversation.mode === "HUMAN") {
        await tx.conversationTurn.update({
          where: { tenantId_id: { tenantId, id: turn.id } },
          data: { status: "DONE", attempts: { increment: 1 } },
        });
        return;
      }
      const config = await tx.botConfig.findUniqueOrThrow({
        where: { tenantId },
      });
      const settings = botConfigSchema.parse(config.settings);
      const detection = detectLanguage(
        turn.text,
        conversation.language as Language,
      );
      const language = detection.language;
      const incoming = await tx.chatMessage.findUnique({
        where: {
          tenantId_conversationId_clientMessageId: {
            tenantId,
            conversationId: conversation.id,
            clientMessageId: turn.clientMessageId,
          },
        },
      });
      await tx.chatMessage.updateMany({
        where: {
          tenantId,
          conversationId: conversation.id,
          clientMessageId: turn.clientMessageId,
          sender: "CUSTOMER",
        },
        data: {
          language,
          metadata: {
            ...((incoming?.metadata as Prisma.JsonObject) ?? {}),
            channel: conversation.channel,
            detection,
          },
        },
      });
      const copy = texts[language];
      let body = "",
        cards: CatalogCard[] = [],
        sources: { title: string; url: string | null }[] = [],
        handoffReason: string | undefined;
      let usage: LlmResult | undefined;
      const recent = (
        await tx.chatMessage.findMany({
          where: {
            tenantId,
            conversationId: conversation.id,
            OR: [
              { sender: "BOT" },
              { sender: "CUSTOMER", createdAt: { lte: turn.createdAt } },
            ],
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 10,
        })
      ).reverse();
      if (conversation.mode === "HUMAN") body = copy.handoff;
      else if (asksForHuman(turn.text, settings.handoffTriggers)) {
        body = copy.handoff;
        handoffReason = "requested";
      } else if (!settings.enabledLanguages.includes(language))
        body = copy.disabled;
      else if (
        /^(hi|hello|hey|ayubowan|vanakkam|ආයුබෝවන්|வணக்கம்)[\s!.👋]*$/iu.test(
          turn.text,
        )
      )
        body = copy.hello;
      else if (
        /\b(business hours|opening hours|open time)\b/.test(
          turn.text.toLowerCase(),
        ) &&
        settings.businessHours.length
      ) {
        const days = [
          "Sunday",
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
        ];
        body =
          "Business hours (Asia/Colombo):\n" +
          settings.businessHours
            .map((h) => `${days[h.day]}: ${h.open}–${h.close}`)
            .join("\n");
      } else {
        try {
          const vector = vectorLiteral(
            await this.embeddings.embed(turn.text),
            this.embeddings.dimensions,
          );
          const evidence = await tx.$queryRaw<
            Evidence[]
          >`SELECT c.id,c."knowledgeEntryId",e."approvedTitle" AS title,c.content,e."sourceUrl",(1-(c.embedding <=> ${vector}::vector))::float8 AS score
            FROM "KnowledgeChunk" c JOIN "KnowledgeEntry" e ON c."tenantId"=e."tenantId" AND c."knowledgeEntryId"=e.id
            WHERE c."tenantId"=${tenantId}::uuid AND e."tenantId"=${tenantId}::uuid AND c.revision=e."approvedRevision" AND e."embeddingStatus"='READY' AND e."approvedContent" IS NOT NULL
            AND c."embeddingModel"=${this.embeddings.model} AND c."embeddingVersion"=${this.embeddings.version}
            ORDER BY c.embedding <=> ${vector}::vector,c.id LIMIT 5`;
          usage = await bounded(
            this.llm.generate({
              system: assemblePrompt(settings, language),
              message: turn.text,
              language,
              recent: recent.map((m) => ({ sender: m.sender, body: m.body })),
              evidence,
              settings,
            }),
          );
          const proposal = proposalSchema.parse(usage.proposal);
          if (
            proposal.tool === "search_products" ||
            proposal.tool === "get_product"
          ) {
            cards = await this.catalog(tx, tenantId, language, proposal);
            body = cards.length ? copy.catalog : copy.handoff;
            if (!cards.length) handoffReason = "product_not_found";
          } else if (proposal.tool === "answer_knowledge") {
            if (ambiguousEvidence(evidence, turn.text))
              throw new Error("AMBIGUOUS_EVIDENCE");
            const selected = proposal.chunkIds.map((id) =>
              evidence.find((e) => e.id === id),
            );
            if (
              selected.some(
                (e) =>
                  !e ||
                  e.score < 0.25 ||
                  detectLanguage(e.content).language !== language ||
                  /\b(price|cost|stock|discount|LKR|Rs\.?|rupees)\b|රුපියල්|වට්ටම්|விலை|தள்ளுபடி/i.test(
                    e.content,
                  ),
              )
            )
              throw new Error("UNGROUNDED_EVIDENCE");
            // The development provider selects approved excerpts only; no generated facts are accepted.
            body = selected.map((e) => e!.content).join("\n\n");
            sources = selected.map((e) => ({
              title: e!.title,
              url: e!.sourceUrl,
            }));
          } else if (
            proposal.tool === "create_order" ||
            proposal.tool === "get_order_status"
          ) {
            body = copy.unavailable;
            handoffReason = "commerce_unavailable";
          } else {
            body = copy.handoff;
            handoffReason = proposal.reason;
          }
        } catch {
          body = copy.handoff;
          cards = [];
          sources = [];
          handoffReason = "provider_failure";
        }
      }
      if (handoffReason) {
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
            reason: handoffReason,
          },
          update: {},
        });
      }
      const reply = await tx.chatMessage.create({
        data: {
          tenantId,
          conversationId: conversation.id,
          turnId: turn.id,
          sender: "BOT",
          body,
          language,
          metadata: {
            cards,
            sources,
            channel: conversation.channel,
            handoffReason: handoffReason ?? null,
            development: true,
            detection,
            toolModel: usage?.model ?? "server-template",
            inputTokens: usage?.inputTokens ?? 0,
            outputTokens: usage?.outputTokens ?? 0,
            estimatedCostMicros: usage?.estimatedCostMicros ?? 0,
            usageEstimated: usage?.usageEstimated ?? false,
            rateVersion: "development-zero-v1",
            memoryMessages: recent.length,
          },
        },
      });
      if (conversation.channelConnectionId)
        await tx.outboundDelivery.create({
          data: {
            tenantId,
            messageId: reply.id,
            channelConnectionId: conversation.channelConnectionId,
          },
        });
      await tx.conversation.update({
        where: { tenantId_id: { tenantId, id: conversation.id } },
        data: { language },
      });
      await tx.conversationTurn.update({
        where: { tenantId_id: { tenantId, id: turn.id } },
        data: { status: "DONE", attempts: { increment: 1 } },
      });
    });
  }
  private async catalog(
    tx: Prisma.TransactionClient,
    tenantId: string,
    language: Language,
    p: z.infer<typeof proposalSchema>,
  ): Promise<CatalogCard[]> {
    if (p.tool !== "get_product" && p.tool !== "search_products") return [];
    const query = p.tool === "search_products" ? p.query : "";
    const tokens = query.match(/[\p{L}\p{M}\p{N}_-]+/gu)?.slice(0, 8) ?? [];
    const products = await tx.product.findMany({
      where: {
        tenantId,
        active: true,
        ...(p.tool === "get_product"
          ? { id: p.id }
          : query === "*"
            ? {}
            : {
                OR: tokens.flatMap((token) =>
                  ["nameEn", "nameSi", "nameTa", "sku"].map((key) => ({
                    [key]: { contains: token, mode: "insensitive" as const },
                  })),
                ),
              }),
      },
      include: {
        variants: {
          where: { tenantId, active: true },
          orderBy: { sku: "asc" },
        },
      },
      take: 5,
      orderBy: { sku: "asc" },
    });
    return products
      .filter((p) => p.variants.length)
      .map((p) => ({
        id: p.id,
        sku: p.sku,
        name:
          language === "si" && p.nameSi
            ? p.nameSi
            : language === "ta" && p.nameTa
              ? p.nameTa
              : p.nameEn,
        variants: p.variants.map((v) => ({
          sku: v.sku,
          attributes: v.attributes as Record<string, string>,
          priceMinor: v.priceMinor,
          stock: v.stock,
        })),
      }));
  }
}
