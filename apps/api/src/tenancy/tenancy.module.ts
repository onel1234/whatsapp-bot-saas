import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { TenancyController } from "./tenancy.controller";
@Module({ imports: [AuthModule], controllers: [TenancyController] })
export class TenancyModule {}
