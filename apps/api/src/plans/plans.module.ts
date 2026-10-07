import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PlansController } from "./plans.controller";
@Module({ imports: [AuthModule], controllers: [PlansController] })
export class PlansModule {}
