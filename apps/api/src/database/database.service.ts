import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaClient, Prisma } from "@prisma/client";
@Injectable()
export class Database
  extends PrismaClient
  implements OnModuleDestroy, OnModuleInit
{
  async onModuleInit() {
    const roles = await this.$queryRaw<
      { rolsuper: boolean; rolbypassrls: boolean }[]
    >`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    if (!roles[0] || roles[0].rolsuper || roles[0].rolbypassrls) {
      throw new Error(
        "DATABASE_URL must use a restricted role without SUPERUSER or BYPASSRLS.",
      );
    }
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
  async forUser<T>(
    userId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
      return work(tx);
    });
  }
  async forTenant<T>(
    userId: string,
    tenantId: string,
    owner: boolean,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return this.forUser(userId, async (tx) => {
      // Membership is read BEFORE granting transaction-local tenant context.
      const membership = await tx.membership.findUnique({
        where: { tenantId_userId: { tenantId, userId } },
      });
      if (!membership || (owner && membership.role !== "OWNER"))
        throw new ForbiddenException(
          "You do not have access to this workspace.",
        );
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return work(tx);
    });
  }
}
