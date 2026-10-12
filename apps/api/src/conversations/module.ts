import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { DevelopmentEmbeddingProvider } from "../embeddings/provider";
import { LlmProvider, DevelopmentLlmProvider } from "../llm/provider";
import { ConversationEngine } from "./engine";
import { ConversationService } from "./service";
import { BotController, WidgetController } from "./controller";
import { WidgetAdapter } from "../channels/adapter";
@Module({
  imports: [DatabaseModule, AuthModule],
  providers: [
    DevelopmentEmbeddingProvider,
    { provide: LlmProvider, useClass: DevelopmentLlmProvider },
    ConversationEngine,
    ConversationService,
    WidgetAdapter,
  ],
  controllers: [BotController, WidgetController],
  exports: [ConversationEngine, ConversationService],
})
export class ConversationModule {}
