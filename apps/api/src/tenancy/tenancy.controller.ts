import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Req,
  Inject,
  BadRequestException,
} from "@nestjs/common";
import type { Request } from "express";
import {
  acceptInvitationSchema,
  invitationSchema,
  tenantSchema,
} from "@saha/shared";
import { AuthService } from "../auth/auth.service";
import { Database } from "../database/database.service";
import { hashToken, newToken } from "../security";
import { parse, tenantId } from "../common/validation";
@Controller()
export class TenancyController {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  @Post("tenants") async create(@Req() req: Request, @Body() body: unknown) {
    const user = await this.auth.viewer(req);
    const data = parse(tenantSchema, body);
    return this.db.forUser(user.id, (tx) =>
      this.auth.createWorkspace(tx, user.id, data.name),
    );
  }
  @Get("tenants/:id") async getTenant(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    const user = await this.auth.viewer(req);
    return this.db.forTenant(user.id, tenantId(id), false, (tx) =>
      tx.tenant.findUniqueOrThrow({ where: { id } }),
    );
  }
  @Post("tenants/:id/settings") async update(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const user = await this.auth.viewer(req);
    const data = parse(tenantSchema, body);
    return this.db.forTenant(user.id, tenantId(id), true, (tx) =>
      tx.tenant.update({ where: { id }, data }),
    );
  }
  @Get("tenants/:id/members") async members(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    const user = await this.auth.viewer(req);
    return this.db.forTenant(user.id, tenantId(id), true, (tx) =>
      tx.membership.findMany({
        where: { tenantId: id },
        select: {
          id: true,
          role: true,
          user: { select: { name: true, email: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
    );
  }
  @Post("tenants/:id/invitations") async invite(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const user = await this.auth.viewer(req);
    const data = parse(invitationSchema, body);
    const token = newToken();
    await this.db.forTenant(user.id, tenantId(id), true, (tx) =>
      tx.invitation.create({
        data: {
          tenantId: id,
          ...data,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
        },
      }),
    );
    return {
      url: `${process.env.WEB_ORIGIN}/invite?token=${token}`,
      expiresInHours: 48,
    };
  }
  @Post("invitations/accept") async accept(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    const user = await this.auth.viewer(req);
    const { token } = parse(acceptInvitationSchema, body);
    return this.db.forUser(user.id, async (tx) => {
      const routes = await tx.$queryRaw<
        { tenantId: string }[]
      >`SELECT * FROM resolve_invitation(${hashToken(token)}, ${user.email})`;
      if (!routes[0])
        throw new BadRequestException(
          "Invitation is invalid, expired, or belongs to another email.",
        );
      const id = routes[0].tenantId;
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${id}, true)`;
      const invitation = await tx.invitation.findUniqueOrThrow({
        where: { tokenHash: hashToken(token) },
      });
      const consumed = await tx.invitation.updateMany({
        where: {
          id: invitation.id,
          tenantId: id,
          acceptedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { acceptedAt: new Date() },
      });
      if (consumed.count !== 1)
        throw new BadRequestException("Invitation already used.");
      // Existing members keep their role; an invitation cannot silently promote them.
      await tx.membership.upsert({
        where: { tenantId_userId: { tenantId: id, userId: user.id } },
        create: { tenantId: id, userId: user.id, role: invitation.role },
        update: {},
      });
      return { tenantId: id };
    });
  }
}
