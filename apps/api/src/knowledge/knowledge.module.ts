import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { KnowledgeService } from "./knowledge.service";
import { KnowledgeController } from "./knowledge.controller";
import { DevelopmentEmbeddingProvider } from "../embeddings/provider";
@Module({
  imports: [AuthModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService, DevelopmentEmbeddingProvider],
})
export class KnowledgeModule {}
