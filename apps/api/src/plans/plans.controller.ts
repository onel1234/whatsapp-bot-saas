import { Controller, Get, Param, Req, Inject } from "@nestjs/common";
import type { Request } from "express";
import { plans } from "@saha/shared";
import { AuthService } from "../auth/auth.service";
import { Database } from "../database/database.service";
import { tenantId } from "../common/validation";
@Controller()
export class PlansController {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  @Get("tenants/:id/plan") async plan(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    const user = await this.auth.viewer(req);
    return this.db.forTenant(user.id, tenantId(id), true, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id } });
      return {
        plan: tenant.plan,
        config: plans[tenant.plan],
        provisional: true,
        meteringAvailable: false,
      };
    });
  }
}
