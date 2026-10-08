import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Req,
  Query,
  Inject,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { productSchema, csvSchema } from "@saha/shared";
import { AuthService } from "../auth/auth.service";
import { parse, tenantId } from "../common/validation";
import { CatalogService } from "./catalog.service";
@Controller("tenants/:tenant/catalog")
export class CatalogController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}
  @Get() async list(
    @Req() req: Request,
    @Param("tenant") tenant: string,
    @Query("q") q = "",
    @Query("page") page = "1",
  ) {
    const user = await this.auth.viewer(req);
    return this.catalog.list(
      user.id,
      tenantId(tenant),
      parse(z.string().max(200), q),
      parse(z.coerce.number().int().min(1).max(100000), page),
    );
  }
  @Post() async create(
    @Req() req: Request,
    @Param("tenant") tenant: string,
    @Body() body: unknown,
  ) {
    const user = await this.auth.viewer(req);
    return this.catalog.saveProduct(
      user.id,
      tenantId(tenant),
      parse(productSchema, body),
    );
  }
  @Post("import/preview") async preview(
    @Req() req: Request,
    @Param("tenant") tenant: string,
    @Body() body: unknown,
  ) {
    const user = await this.auth.viewer(req);
    return this.catalog.preview(
      user.id,
      tenantId(tenant),
      parse(csvSchema, body).csv,
    );
  }
  @Post("import") async import(
    @Req() req: Request,
    @Param("tenant") tenant: string,
    @Body() body: unknown,
  ) {
    const user = await this.auth.viewer(req);
    return this.catalog.import(
      user.id,
      tenantId(tenant),
      parse(csvSchema, body).csv,
    );
  }
  @Post(":id/save") async update(
    @Req() req: Request,
    @Param("tenant") tenant: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const user = await this.auth.viewer(req);
    return this.catalog.saveProduct(
      user.id,
      tenantId(tenant),
      parse(productSchema, body),
      tenantId(id),
    );
  }
  @Post(":id/delete") async remove(
    @Req() req: Request,
    @Param("tenant") tenant: string,
    @Param("id") id: string,
  ) {
    const user = await this.auth.viewer(req);
    return this.catalog.remove(user.id, tenantId(tenant), tenantId(id));
  }
}
