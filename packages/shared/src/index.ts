import { z } from "zod";
export const emailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
export const passwordSchema = z.string().min(12).max(128);
export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    name: z.string().trim().min(1).max(80),
    businessName: z.string().trim().min(2).max(100),
  })
  .strict();
export const loginSchema = z
  .object({ email: emailSchema, password: z.string().min(1).max(128) })
  .strict();
export const tenantSchema = z
  .object({ name: z.string().trim().min(2).max(100) })
  .strict();
export const invitationSchema = z
  .object({
    email: emailSchema,
    role: z.enum(["OWNER", "AGENT"]).default("AGENT"),
  })
  .strict();
export const acceptInvitationSchema = z
  .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
export const planNames = ["FREE", "STARTER", "GROWTH", "BUSINESS"] as const;
export type Plan = (typeof planNames)[number];
// Development defaults only. Commercial limits must be approved before launch.
export const plans = {
  FREE: {
    label: "Free",
    conversations: 100,
    channels: ["WIDGET"],
    payhere: false,
  },
  STARTER: {
    label: "Starter",
    conversations: 1000,
    channels: ["WIDGET", "WHATSAPP"],
    payhere: false,
  },
  GROWTH: {
    label: "Growth",
    conversations: 5000,
    channels: ["WIDGET", "WHATSAPP", "MESSENGER", "INSTAGRAM"],
    payhere: true,
  },
  BUSINESS: {
    label: "Business",
    conversations: 20000,
    channels: ["WIDGET", "WHATSAPP", "MESSENGER", "INSTAGRAM"],
    payhere: true,
  },
} as const;
export type Workspace = {
  id: string;
  name: string;
  plan: Plan;
  role: "OWNER" | "AGENT";
};
export type Viewer = {
  id: string;
  name: string;
  email: string;
  tenants: Workspace[];
};

const skuSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[a-zA-Z0-9_-]+$/)
  .transform((v) => v.toUpperCase());
const optionalText = (max: number) => z.string().trim().max(max).default("");
export const imageUrlSchema = z
  .union([
    z.literal(""),
    z
      .string()
      .url()
      .max(2000)
      .refine((v) => {
        const url = new URL(v);
        return (
          ["http:", "https:"].includes(url.protocol) &&
          !url.username &&
          !url.password
        );
      }, "Use an HTTP or HTTPS image URL without credentials."),
  ])
  .default("");
export const variantSchema = z
  .object({
    id: z.string().uuid().optional(),
    sku: skuSchema,
    attributes: z
      .record(z.string().max(50), z.string().max(80))
      .refine((v) => Object.keys(v).length <= 10)
      .default({}),
    priceMinor: z.number().int().min(0).max(999999999),
    stock: z.number().int().min(0).max(1000000),
    active: z.boolean().default(true),
  })
  .strict();
export const productSchema = z
  .object({
    sku: skuSchema,
    nameEn: z.string().trim().min(1).max(200),
    nameSi: optionalText(200),
    nameTa: optionalText(200),
    description: optionalText(5000),
    imageUrl: imageUrlSchema,
    active: z.boolean().default(true),
    variants: z
      .array(variantSchema)
      .min(1)
      .max(50)
      .refine(
        (v) => new Set(v.map((x) => x.sku)).size === v.length,
        "Variant SKUs must be unique.",
      ),
  })
  .strict();
export type ProductInput = z.infer<typeof productSchema>;
export type ProductRecord = ProductInput & {
  id: string;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
  variants: (z.infer<typeof variantSchema> & { id: string })[];
};
export const csvSchema = z
  .object({ csv: z.string().min(1).max(500000) })
  .strict();
export function lkrToMinor(value: string): number {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(value.trim()))
    throw new Error(
      "Price must be a nonnegative LKR amount with at most two decimal places.",
    );
  const [whole, decimal = ""] = value.trim().split(".");
  return Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
}
export const knowledgeDraftSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(20000),
  })
  .strict();
export const approveKnowledgeSchema = knowledgeDraftSchema
  .extend({ version: z.number().int().min(1) })
  .strict();
export const editKnowledgeSchema = approveKnowledgeSchema;
export const websiteSchema = z
  .object({
    url: z
      .string()
      .url()
      .max(2000)
      .refine((v) => {
        const u = new URL(v);
        return (
          ["http:", "https:"].includes(u.protocol) &&
          !u.username &&
          !u.password &&
          (!u.port || ["80", "443"].includes(u.port))
        );
      }, "Use a public website URL without credentials or custom ports."),
    pageLimit: z.number().int().min(1).max(50).default(20),
    depthLimit: z.number().int().min(0).max(3).default(2),
  })
  .strict();
export const retrievalSchema = z
  .object({
    query: z.string().trim().min(2).max(1000),
    limit: z.number().int().min(1).max(10).default(5),
  })
  .strict();
export type KnowledgeEntryRecord = {
  id: string;
  title: string;
  draftContent: string;
  approvedContent: string | null;
  approvedTitle: string | null;
  sourceUrl: string | null;
  knowledgeSourceId: string | null;
  reviewStatus: "DRAFT" | "APPROVED" | "CHANGES_PENDING";
  version: number;
  approvedRevision: number;
  embeddingStatus: "NONE" | "PENDING" | "READY" | "FAILED";
  updatedAt: string;
};
export type KnowledgeSourceRecord = {
  id: string;
  url: string;
  pageLimit: number;
  depthLimit: number;
  runs: {
    id: string;
    status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
    pageCount: number;
    skippedCount: number;
    errorCode: string | null;
    createdAt: string;
  }[];
};
