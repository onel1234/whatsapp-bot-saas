import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { ConversationModule } from "../conversations/module";
import { ChannelController, MetaWebhookController } from "./controller";
import { ChannelService } from "./service";
import { OutboundProcessor } from "./outbound";
@Module({
  imports: [AuthModule, DatabaseModule, ConversationModule],
  controllers: [ChannelController, MetaWebhookController],
  providers: [ChannelService, OutboundProcessor],
  exports: [OutboundProcessor],
})
export class ChannelModule {}
