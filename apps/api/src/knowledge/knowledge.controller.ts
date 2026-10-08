import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Req,
  Inject,
  Query,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import {
  knowledgeDraftSchema,
  approveKnowledgeSchema,
  websiteSchema,
  retrievalSchema,
} from "@saha/shared";
import { AuthService } from "../auth/auth.service";
import { parse, tenantId } from "../common/validation";
import { KnowledgeService } from "./knowledge.service";
@Controller("tenants/:tenant/knowledge")
export class KnowledgeController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(KnowledgeService) private readonly knowledge: KnowledgeService,
  ) {}
  @Get("entries") async entries(
    @Req() req: Request,
    @Param("tenant") tenant: string,
    @Query("page") page = "1",
  ) {
    const user = await this.auth.viewer(req);
    return this.knowledge.entries(
      user.id,
      tenantId(tenant),
      parse(z.coerce.number().int().min(1).max(100000), page),
    );
  }
  @Get("sources") async sources(
    @Req() req: Request,
    @Param("tenant") tenant: string,
  ) {
    const user = await this.auth.viewer(req);
    return this.knowledge.sources(user.id, tenantId(tenant));
  }
  @Post("entries") async create(
    @Req() req: Request,
    @Param("tenant") tenant: string,
    @Body() body: unknown,
  ) {
    const user = await this.auth.viewer(req);
    return this.knowledge.createManual(
      user.id,
      tenantId(tenant),
      parse(knowledgeDraftSchema, body),
    );
  }
  @Post("entries/:id/save") async save(
    @Req() req: Request,
    @Param("tenant") tenant: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const user = await this.auth.viewer(req);
    return this.knowledge.save(
      user.id,
      tenantId(tenant),
      tenantId(id),
      parse(approveKnowledgeSchema, body),
      false,
    );
  }
  @Post("entries/:id/approve") async approve(
    @Req() req: Request,
    @Param("tenant") tenant: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const user = await this.auth.viewer(req);
    return this.knowledge.save(
      user.id,
      tenantId(tenant),
      tenantId(id),
      parse(approveKnowledgeSchema, body),
      true,
    );
  }
  @Post("entries/:id/delete") async remove(
    @Req() req: Request,
    @Param("tenant") tenant: string,
    @Param("id") id: string,
  ) {
    const user = await this.auth.viewer(req);
    return this.knowledge.remove(user.id, tenantId(tenant), tenantId(id));
  }
  @Post("sources") async addWebsite(
    @Req() req: Request,
    @Param("tenant") tenant: string,
    @Body() body: unknown,
  ) {
    const user = await this.auth.viewer(req);
    return this.knowledge.addWebsite(
      user.id,
      tenantId(tenant),
      parse(websiteSchema, body),
    );
  }
  @Post("sources/:id/recrawl") async recrawl(
    @Req() req: Request,
    @Param("tenant") tenant: string,
    @Param("id") id: string,
  ) {
    const user = await this.auth.viewer(req);
    return this.knowledge.recrawl(user.id, tenantId(tenant), tenantId(id));
  }
  @Post("search") async search(
    @Req() req: Request,
    @Param("tenant") tenant: string,
    @Body() body: unknown,
  ) {
    const user = await this.auth.viewer(req);
    const input = parse(retrievalSchema, body);
    return this.knowledge.retrieve(
      user.id,
      tenantId(tenant),
      input.query,
      input.limit,
    );
  }
}
