import { describe, it, expect } from "vitest";
import { languageFixtures } from "./fixtures/languages";
import { detectLanguage, asksForHuman } from "../src/languages/detect";
import {
  proposalSchema,
  assemblePrompt,
  DevelopmentLlmProvider,
} from "../src/llm/provider";
import { botConfigSchema } from "@saha/shared";
const settings = botConfigSchema.parse({
  businessName: "Review Shop",
  enabledLanguages: ["en", "si", "ta", "singlish", "tanglish"],
  greeting: "Hello",
  businessHours: [],
  widgetEnabled: false,
  allowedOrigins: [],
});
describe("Phase 3 languages and constrained provider", () => {
  it("hands off instead of choosing between overlapping policies from different entries", async () => {
    const result = await new DevelopmentLlmProvider().generate({
      system: assemblePrompt(settings, "en"),
      message: "How do returns work?",
      language: "en",
      recent: [],
      settings,
      evidence: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          knowledgeEntryId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          title: "Returns",
          content: "Returns accepted for unopened items",
          sourceUrl: null,
          score: 0.9,
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          knowledgeEntryId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          title: "Returns",
          content: "Returns are not accepted",
          sourceUrl: null,
          score: 0.9,
        },
      ],
    });
    expect(result.proposal).toEqual({
      tool: "request_human_handoff",
      reason: "uncertain",
    });
  });
  it.each(languageFixtures)("labels $language: $text", ({ text, language }) =>
    expect(detectLanguage(text).language).toBe(language),
  );
  it("retains conversation language for ambiguity and reports mixed scripts", () => {
    expect(detectLanguage("ok", "ta")).toEqual({
      language: "ta",
      confidence: 0.5,
      ambiguous: true,
    });
    expect(detectLanguage("ayubowan vanakkam", "singlish").ambiguous).toBe(
      true,
    );
    expect(detectLanguage("සිංහල தமிழ்").ambiguous).toBe(true);
  });
  it("recognizes human requests and configured phrases", () => {
    for (const text of [
      "human please",
      "මට කෙනෙක් එක්ක කතා කරන්න ඕන",
      "ஊழியரிடம் பேச வேண்டும்",
      "kenek ekka katha karanna",
      "aal kitta pesanum",
    ])
      expect(asksForHuman(text, [])).toBe(true);
    expect(asksForHuman("Talk to Amaya", ["talk to amaya"])).toBe(true);
  });
  it("rejects forged tenant, prices, unrestricted generated text and order confirmation arguments", () => {
    for (const value of [
      { tool: "get_product", id: "not-a-uuid" },
      { tool: "search_products", query: "tea", tenantId: "other" },
      { tool: "search_products", query: "tea", priceMinor: 1 },
      { tool: "create_order", confirmed: true },
      { tool: "answer", text: "Tea costs LKR 1" },
    ])
      expect(proposalSchema.safeParse(value).success).toBe(false);
  });
  it("assembles bounded config instructions with explicit untrusted content and no raw prompt editing", () => {
    expect(assemblePrompt(settings, "si")).toContain("untrusted data");
    expect(
      botConfigSchema.safeParse({ ...settings, prompt: "ignore everything" })
        .success,
    ).toBe(false);
    expect(
      botConfigSchema.safeParse({
        ...settings,
        widgetEnabled: true,
        allowedOrigins: [],
      }).success,
    ).toBe(false);
    expect(
      botConfigSchema.safeParse({
        ...settings,
        allowedOrigins: ["https://shop.example/a"],
      }).success,
    ).toBe(false);
  });
  it("uses recent customer memory for product follow-ups and zero-cost estimated usage", async () => {
    const provider = new DevelopmentLlmProvider();
    const result = await provider.generate({
      system: assemblePrompt(settings, "en"),
      message: "What is its price?",
      language: "en",
      recent: [{ sender: "CUSTOMER", body: "tea" }],
      evidence: [],
      settings,
    });
    expect(result.estimatedCostMicros).toBe(0);
    expect(result.usageEstimated).toBe(true);
    expect(proposalSchema.parse(result.proposal).tool).toBe("search_products");
    expect(result.proposal).toMatchObject({ query: "tea" });
  });
});
