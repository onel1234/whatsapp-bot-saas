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
