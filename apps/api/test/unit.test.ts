import { describe, it, expect } from "vitest";
import {
  hashPassword,
  hashToken,
  newToken,
  verifyPassword,
} from "../src/security";
import { registerSchema, invitationSchema, plans } from "@saha/shared";
describe("authentication primitives", () => {
  it("salts passwords and rejects an incorrect password", async () => {
    const first = await hashPassword("a long correct password");
    const second = await hashPassword("a long correct password");
    expect(first).not.toBe(second);
    expect(await verifyPassword("a long correct password", first)).toBe(true);
    expect(await verifyPassword("an incorrect password", first)).toBe(false);
    expect(await verifyPassword("anything", "corrupt")).toBe(false);
  });
  it("generates opaque tokens stored only as hashes", () => {
    const token = newToken();
    expect(token).toHaveLength(64);
    expect(hashToken(token)).not.toEqual(token);
    expect(newToken()).not.toEqual(token);
  });
  it("normalizes emails and refuses tenant or role injection during signup", () => {
    const valid = {
      name: "Amaya",
      email: " Amaya@Example.com ",
      businessName: "My shop",
      password: "long-enough-password",
    };
    expect(registerSchema.parse(valid).email).toBe("amaya@example.com");
    expect(
      registerSchema.safeParse({ ...valid, tenantId: "other-tenant" }).success,
    ).toBe(false);
    expect(
      registerSchema.safeParse({ ...valid, password: "short" }).success,
    ).toBe(false);
    expect(
      invitationSchema.safeParse({ email: "user@example.com", role: "ADMIN" })
        .success,
    ).toBe(false);
  });
  it("keeps PayHere limited to Growth and Business", () => {
    expect(plans.FREE.payhere).toBe(false);
    expect(plans.STARTER.payhere).toBe(false);
    expect(plans.GROWTH.payhere).toBe(true);
    expect(plans.BUSINESS.payhere).toBe(true);
  });
});
