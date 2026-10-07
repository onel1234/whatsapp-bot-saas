import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Database } from "../database/database.service";
import { hashPassword, hashToken, newToken, verifyPassword } from "../security";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { registerSchema } from "@saha/shared";
import { z } from "zod";
export const sessionCookie = "saha_session";
export const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
});
@Injectable()
export class AuthService {
  constructor(@Inject(Database) private readonly db: Database) {}
  async viewer(req: Request) {
    const token = req.cookies?.[sessionCookie] as string | undefined;
    if (!token || !/^[a-f0-9]{64}$/.test(token))
      throw new UnauthorizedException("Please sign in.");
    const session = await this.db.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt <= new Date())
      throw new UnauthorizedException("Please sign in again.");
    return session.user;
  }
  async issue(userId: string, res: Response) {
    const token = newToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    await this.db.session.create({
      data: { userId, tokenHash: hashToken(token), expiresAt },
    });
    res.cookie(sessionCookie, token, {
      ...cookieOptions(),
      expires: expiresAt,
    });
  }
  async register(input: z.infer<typeof registerSchema>, res: Response) {
    const passwordHash = await hashPassword(input.password);
    try {
      const user = await this.db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email: input.email, name: input.name, passwordHash },
        });
        await tx.$executeRaw`SELECT set_config('app.user_id', ${user.id}, true)`;
        await this.createWorkspace(tx, user.id, input.businessName);
        return user;
      });
      await this.issue(user.id, res);
      return { ok: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException(
          "This email is already registered. Please sign in.",
        );
      throw error;
    }
  }
  async createWorkspace(
    tx: Prisma.TransactionClient,
    userId: string,
    name: string,
  ) {
    const id = randomUUID();
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${id}, true)`;
    const tenant = await tx.tenant.create({ data: { id, name } });
    await tx.membership.create({
      data: { tenantId: id, userId, role: "OWNER" },
    });
    return tenant;
  }
  async login(email: string, password: string, res: Response) {
    const user = await this.db.user.findUnique({ where: { email } });
    // Run the same expensive KDF for missing users to reduce timing leakage.
    const fallback = `scrypt:${"0".repeat(32)}:${"0".repeat(128)}`;
    const valid = await verifyPassword(
      password,
      user?.passwordHash ?? fallback,
    );
    if (!user?.passwordHash || !valid)
      throw new UnauthorizedException("Email or password is incorrect.");
    await this.issue(user.id, res);
    return { ok: true };
  }
  async logout(req: Request, res: Response) {
    const token = req.cookies?.[sessionCookie];
    if (typeof token === "string")
      await this.db.session.deleteMany({
        where: { tokenHash: hashToken(token) },
      });
    res.clearCookie(sessionCookie, cookieOptions());
    return { ok: true };
  }
  async googleUser(subject: string, email: string, name: string) {
    const existing = await this.db.authIdentity.findUnique({
      where: { provider_subject: { provider: "google", subject } },
      include: { user: true },
    });
    if (existing) return existing.user;
    if (await this.db.user.findUnique({ where: { email } }))
      throw new BadRequestException(
        "This email already has an account. Sign in with its existing method.",
      );
    return this.db.user.create({
      data: {
        email,
        name,
        identities: { create: { provider: "google", subject } },
      },
    });
  }
}
