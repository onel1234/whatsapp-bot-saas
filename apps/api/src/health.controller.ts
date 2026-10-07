import { Controller, Get, Inject } from "@nestjs/common";
import { Database } from "./database/database.service";
@Controller()
export class HealthController {
  constructor(@Inject(Database) private readonly db: Database) {}
  @Get("health") health() {
    return { status: "ok", phase: 1 };
  }
  @Get("ready") async ready() {
    await this.db.$queryRaw`SELECT 1`;
    return { status: "ready" };
  }
}
