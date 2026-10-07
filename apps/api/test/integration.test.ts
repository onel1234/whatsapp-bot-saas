import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app";
import { Database } from "../src/database/database.service";
import { hashToken } from "../src/security";
// Must run against an isolated migrated database as the non-owner saha_app role.
describe("real PostgreSQL auth and tenant boundaries", () => {
  let app: INestApplication;
  let db: Database;
  let alice: ReturnType<typeof request.agent>;
  let bob: ReturnType<typeof request.agent>;
  let tenantA: string;
  let tenantB: string;
  let aliceId: string;
  let bobEmail: string;
  const origin = "http://localhost:3000";
  beforeAll(async () => {
    process.env.WEB_ORIGIN = origin;
    app = await createApp();
    db = app.get(Database);
    const roles = await db.$queryRaw<
      { rolsuper: boolean; rolbypassrls: boolean }[]
    >`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(roles[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    alice = request.agent(app.getHttpServer());
    bob = request.agent(app.getHttpServer());
    const suffix = randomUUID();
    bobEmail = `bob-${suffix}@example.com`;
    await alice
      .post("/auth/register")
      .set("Origin", origin)
      .send({
        email: `alice-${suffix}@example.com`,
        name: "Alice",
        businessName: "Tenant A",
        password: "a secure long password",
      })
      .expect(201);
    await bob
      .post("/auth/register")
      .set("Origin", origin)
      .send({
        email: bobEmail,
        name: "Bob",
        businessName: "Tenant B",
        password: "another long password",
      })
      .expect(201);
    const a = (await alice.get("/auth/me").expect(200)).body;
    const b = (await bob.get("/auth/me").expect(200)).body;
    tenantA = a.tenants[0].id;
    tenantB = b.tenants[0].id;
    aliceId = a.id;
  }, 30000);
  afterAll(async () => {
    if (app) await app.close();
  });
  it("requires a session and rejects CSRF even for unauthenticated signup", async () => {
    await request(app.getHttpServer()).get(`/tenants/${tenantA}`).expect(401);
    await alice
      .post(`/tenants/${tenantA}/settings`)
      .set("Origin", "https://evil.example")
      .send({ name: "Hijacked" })
      .expect(403);
    await request(app.getHttpServer())
      .post("/auth/register")
      .send({})
      .expect(403);
  });
  it("tenant A cannot read or write tenant B through any workspace endpoint", async () => {
    for (const path of ["", "/members", "/plan"])
      await alice.get(`/tenants/${tenantB}${path}`).expect(403);
    await alice
      .post(`/tenants/${tenantB}/settings`)
      .set("Origin", origin)
      .send({ name: "Hijacked" })
      .expect(403);
    await alice
      .post(`/tenants/${tenantB}/invitations`)
      .set("Origin", origin)
      .send({ email: "steal@example.com" })
      .expect(403);
    expect((await bob.get(`/tenants/${tenantB}`)).body.name).toBe("Tenant B");
  });
  it("RLS blocks cross-tenant reads and writes even if repository filters are omitted", async () => {
    await db.forTenant(aliceId, tenantA, true, async (tx) => {
      expect(await tx.tenant.findUnique({ where: { id: tenantB } })).toBeNull();
      expect(
        await tx.membership.findMany({ where: { tenantId: tenantB } }),
      ).toEqual([]);
      expect(
        (
          await tx.tenant.updateMany({
            where: { id: tenantB },
            data: { name: "Leaked" },
          })
        ).count,
      ).toBe(0);
      expect(
        await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM "Tenant" WHERE id = ${tenantB}::uuid`,
      ).toEqual([]);
    });
    expect(await db.tenant.findMany()).toEqual([]); // SET LOCAL must not leak through pooled connections.
  });
  it("rejects cross-tenant inserts at the database layer", async () => {
    await expect(
      db.forTenant(aliceId, tenantA, true, (tx) =>
        tx.invitation.create({
          data: {
            tenantId: tenantB,
            email: "x@example.com",
            tokenHash: hashToken(randomUUID()),
            expiresAt: new Date(Date.now() + 10000),
          },
        }),
      ),
    ).rejects.toThrow();
  });
  it("invitations bind email, are single-use, and agents cannot manage a workspace", async () => {
    const response = await alice
      .post(`/tenants/${tenantA}/invitations`)
      .set("Origin", origin)
      .send({ email: bobEmail, role: "AGENT" })
      .expect(201);
    const token = new URL(response.body.url).searchParams.get("token");
    await alice
      .post("/invitations/accept")
      .set("Origin", origin)
      .send({ token })
      .expect(400);
    await bob
      .post("/invitations/accept")
      .set("Origin", origin)
      .send({ token })
      .expect(201);
    await bob
      .post("/invitations/accept")
      .set("Origin", origin)
      .send({ token })
      .expect(400);
    await bob.get(`/tenants/${tenantA}`).expect(200);
    await bob.get(`/tenants/${tenantA}/members`).expect(403);
    await bob.get(`/tenants/${tenantA}/plan`).expect(403);
    await bob
      .post(`/tenants/${tenantA}/settings`)
      .set("Origin", origin)
      .send({ name: "Agent edit" })
      .expect(403);
    await bob
      .post(`/tenants/${tenantA}/invitations`)
      .set("Origin", origin)
      .send({ email: "new@example.com" })
      .expect(403);
    expect((await bob.get("/auth/me")).body.tenants).toHaveLength(2);
  });
  it("validates payloads, revokes sessions on logout, and supports password login", async () => {
    await bob
      .post("/auth/login")
      .set("Origin", origin)
      .send({ email: bobEmail, password: "wrong password" })
      .expect(401);
    await bob
      .post(`/tenants/${tenantB}/settings`)
      .set("Origin", origin)
      .send({ name: "Good", plan: "BUSINESS" })
      .expect(400);
    await bob.post("/auth/logout").set("Origin", origin).send({}).expect(201);
    await bob.get("/auth/me").expect(401);
    const response = await bob
      .post("/auth/login")
      .set("Origin", origin)
      .send({ email: bobEmail, password: "another long password" })
      .expect(201);
    expect(response.headers["set-cookie"][0]).toContain("HttpOnly");
    expect(response.headers["set-cookie"][0]).toContain("SameSite=Lax");
    await bob.get("/auth/me").expect(200);
  });
  it("keeps active tenant queries isolated even when the user belongs to both businesses", async () => {
    const viewer = (await bob.get("/auth/me").expect(200)).body;
    await db.forTenant(viewer.id, tenantB, true, async (tx) => {
      expect((await tx.tenant.findMany()).map((t) => t.id)).toEqual([tenantB]);
      expect(
        await tx.membership.findMany({ where: { tenantId: tenantA } }),
      ).toEqual([]);
    });
    expect((await bob.get("/auth/me").expect(200)).body.tenants).toHaveLength(
      2,
    );
  });
});
