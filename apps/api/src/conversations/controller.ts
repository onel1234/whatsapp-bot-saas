import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Req,
  Inject,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { botConfigSchema, customerMessageSchema } from "@saha/shared";
import { AuthService } from "../auth/auth.service";
import { parse, tenantId } from "../common/validation";
import { ConversationService } from "./service";
@Controller("tenants/:tenant/bot")
export class BotController {
  constructor(
    @Inject(AuthService) private auth: AuthService,
    @Inject(ConversationService) private service: ConversationService,
  ) {}
  @Get() async settings(@Req() req: Request, @Param("tenant") id: string) {
    return this.service.settings(
      (await this.auth.viewer(req)).id,
      tenantId(id),
    );
  }
  @Post() async save(
    @Req() req: Request,
    @Param("tenant") id: string,
    @Body() body: unknown,
  ) {
    return this.service.save(
      (await this.auth.viewer(req)).id,
      tenantId(id),
      parse(botConfigSchema, body),
    );
  }
  @Post("preview") async preview(
    @Req() req: Request,
    @Param("tenant") id: string,
  ) {
    return this.service.preview((await this.auth.viewer(req)).id, tenantId(id));
  }
  @Get("notifications") async notifications(
    @Req() req: Request,
    @Param("tenant") id: string,
  ) {
    return this.service.notices((await this.auth.viewer(req)).id, tenantId(id));
  }
  @Post("notifications/:id/read") async read(
    @Req() req: Request,
    @Param("tenant") id: string,
    @Param("id") noticeId: string,
  ) {
    return this.service.readNotice(
      (await this.auth.viewer(req)).id,
      tenantId(id),
      tenantId(noticeId),
    );
  }
}
@Controller("widget")
export class WidgetController {
  constructor(
    @Inject(ConversationService) private service: ConversationService,
  ) {}
  private credentials(req: Request) {
    return {
      token: parse(
        z.string().regex(/^Bearer [a-zA-Z0-9_-]{43}$/),
        req.headers.authorization,
      ).slice(7),
      origin: parse(z.string().url().max(300), req.headers["x-widget-origin"]),
    };
  }
  @Post(":id/session") bootstrap(@Req() req: Request, @Param("id") id: string) {
    return this.service.bootstrap(
      tenantId(id),
      parse(z.string().url().max(300), req.headers["x-widget-origin"]),
    );
  }
  @Get("session/messages") state(@Req() req: Request) {
    const c = this.credentials(req);
    return this.service.state(c.token, c.origin);
  }
  @Post("session/messages") send(@Req() req: Request, @Body() body: unknown) {
    const c = this.credentials(req);
    return this.service.send(
      c.token,
      c.origin,
      parse(customerMessageSchema, body),
    );
  }
}
